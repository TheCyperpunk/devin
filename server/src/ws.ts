// WebSocket hub at /ws (CONTRACT section 6): token handshake, then per-role event delivery.
import type http from 'node:http';
import type https from 'node:https';
import { WebSocket, WebSocketServer } from 'ws';
import { TIMING, type CloudStatus, type Report, type ServerMessage } from '@relief-mesh/shared';
import { resolveToken, type Auth } from './auth.js';
import type { HubDb } from './db.js';

/** What the REST layer needs to tell connected clients. Tests can pass a no-op. */
export interface Events {
  reportUpserted(report: Report): void;
  deviceRevoked(deviceId: string): void;
  cloudStatus(status: CloudStatus): void;
}

export const noEvents: Events = { reportUpserted() {}, deviceRevoked() {}, cloudStatus() {} };

interface Client {
  ws: WebSocket;
  auth: Auth | null;
  alive: boolean;
}

const CLOSE_UNAUTHORIZED = 4001;

export class WsHub implements Events {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  private clients = new Set<Client>();
  private pinger?: NodeJS.Timeout;

  constructor(
    private db: HubDb,
    private now: () => number = Date.now,
    private authDeadlineMs: number = TIMING.wsAuthDeadlineMs,
    private pingEveryMs: number = TIMING.wsPingIntervalMs,
  ) {}

  attach(server: http.Server | https.Server): void {
    server.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://hub').pathname;
      if (path !== '/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
    this.pinger = setInterval(() => this.ping(), this.pingEveryMs);
    this.pinger.unref();
    server.on('close', () => this.close());
  }

  close(): void {
    if (this.pinger) clearInterval(this.pinger);
    for (const c of this.clients) c.ws.terminate();
    this.clients.clear();
    this.wss.close();
  }

  private onConnection(ws: WebSocket): void {
    const client: Client = { ws, auth: null, alive: true };
    this.clients.add(client);

    // An unauthenticated socket gets a few seconds, then it is dropped.
    const deadline = setTimeout(() => {
      if (!client.auth) ws.close(CLOSE_UNAUTHORIZED, 'auth timeout');
    }, this.authDeadlineMs);
    deadline.unref();

    ws.on('pong', () => (client.alive = true));
    ws.on('message', (data) => {
      if (client.auth) return; // clients send nothing after auth; all writes go through REST
      const token = parseAuth(data.toString());
      const auth = token ? resolveToken(this.db, token, this.now()) : null;
      if (!auth) {
        ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
      clearTimeout(deadline);
      client.auth = auth;
      send(ws, { type: 'auth:ok', payload: { role: auth.role, serverTime: this.now() } });
    });
    ws.on('close', () => {
      clearTimeout(deadline);
      this.clients.delete(client);
    });
    ws.on('error', () => ws.terminate());
  }

  private ping(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }

  // ---- Events ----

  /** Coordinators get every report; a phone only gets reports it owns (D4). */
  reportUpserted(report: Report): void {
    const stats = this.db.stats();
    for (const c of this.clients) {
      if (!c.auth) continue;
      if (c.auth.role === 'coordinator') {
        send(c.ws, { type: 'report:upserted', payload: { report } });
        send(c.ws, { type: 'stats', payload: stats });
      } else if (c.auth.deviceId === report.deviceId) {
        send(c.ws, { type: 'report:upserted', payload: { report } });
      }
    }
  }

  /** Re-pairing replaces a device token, so sockets opened with the old one are closed. */
  deviceRevoked(deviceId: string): void {
    for (const c of this.clients) {
      if (c.auth?.role === 'device' && c.auth.deviceId === deviceId) c.ws.close(CLOSE_UNAUTHORIZED, 'token replaced');
    }
  }

  cloudStatus(status: CloudStatus): void {
    for (const c of this.clients) {
      if (c.auth?.role === 'coordinator') send(c.ws, { type: 'cloud:status', payload: status });
    }
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function parseAuth(raw: string): string | null {
  try {
    const m = JSON.parse(raw) as { type?: unknown; payload?: { token?: unknown } };
    return m.type === 'auth' && typeof m.payload?.token === 'string' ? m.payload.token : null;
  } catch {
    return null;
  }
}
