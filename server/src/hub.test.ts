// The hub's non-game surface over real HTTP and WebSocket: health, pairing, host login, join QR, limits, sockets.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { HubDb } from './db.js';
import { createHub } from './hub.js';

const PASS = 'correct horse battery';

interface Env {
  db: HubDb;
  base: string;
  server: http.Server;
  hub: ReturnType<typeof createHub>;
}
let env: Env;

async function start(db = new HubDb(':memory:'), over: Partial<Parameters<typeof createHub>[0]> = {}): Promise<Env> {
  const hub = createHub({
    db,
    coordinatorPasscode: PASS,
    baseUrl: 'https://hub.test:3443',
    webDist: null,
    rateLimitPerMin: 10_000,
    authRateLimitPerMin: 10_000,
    wsAuthDeadlineMs: 300,
    ...over,
  });
  const server = http.createServer(hub.app);
  hub.attach(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { db, base: `http://127.0.0.1:${port}`, server, hub };
}

beforeEach(async () => {
  env = await start();
});
afterEach(async () => {
  env.hub.game.stop();
  await new Promise<void>((r) => env.server.close(() => r()));
  env.server.closeAllConnections?.();
  env.db.close();
});

async function call(method: string, url: string, opts: { token?: string; body?: unknown; raw?: string } = {}) {
  const res = await fetch(env.base + url, {
    method,
    headers: {
      ...(opts.body !== undefined || opts.raw !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: text ? (JSON.parse(text) as any) : undefined };
}
async function pair(name = 'Asha', deviceId = 'dev-' + randomUUID().slice(0, 12)) {
  const r = await call('POST', '/api/pair', { body: { joinCode: env.db.joinCode, deviceId, reporterName: name } });
  expect(r.status).toBe(200);
  return { token: r.json.deviceToken as string, deviceId };
}
async function login() {
  const r = await call('POST', '/api/host/login', { body: { passcode: PASS } });
  expect(r.status).toBe(200);
  return r.json.sessionToken as string;
}

describe('health and pairing', () => {
  it('health is public and names the hub', async () => {
    const r = await call('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.json.hubId).toBe(env.db.hubId);
  });

  it('pairs with the join code (any case), refuses a wrong code and a bad body', async () => {
    const ok = await call('POST', '/api/pair', { body: { joinCode: env.db.joinCode.toLowerCase(), deviceId: 'phone-0001', reporterName: 'Asha' } });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ deviceId: 'phone-0001', reporterName: 'Asha', hubId: env.db.hubId });
    expect(ok.json.deviceToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect((await call('POST', '/api/pair', { body: { joinCode: 'NOPE1234', deviceId: 'phone-0001', reporterName: 'Asha' } })).json.error.code).toBe('bad_join_code');
    expect((await call('POST', '/api/pair', { body: { joinCode: env.db.joinCode, deviceId: 'x', reporterName: 'Asha' } })).status).toBe(400);
    expect((await call('POST', '/api/pair', { body: { joinCode: env.db.joinCode, deviceId: 'phone-0001', reporterName: 'Asha', role: 'host' } })).status).toBe(400);
    expect((await call('POST', '/api/pair', { raw: '{not json' })).json.error.code).toBe('invalid_body');
  });

  it('re-pairing replaces the token; the old one stops working', async () => {
    const a = await pair('Asha', 'phone-0002');
    const b = await pair('Asha', 'phone-0002');
    expect((await call('GET', '/api/game/state', { token: a.token })).status).toBe(401);
    expect((await call('GET', '/api/game/state', { token: b.token })).json.error.code).toBe('no_game');
  });

  it('pairing is rate limited per IP', async () => {
    await env.server.close();
    env = await start(env.db, { authRateLimitPerMin: 3 });
    for (let i = 0; i < 3; i++) await call('POST', '/api/pair', { body: { joinCode: 'WRONG000', deviceId: 'phone-0003', reporterName: 'A' } });
    const r = await call('POST', '/api/pair', { body: { joinCode: env.db.joinCode, deviceId: 'phone-0003', reporterName: 'A' } });
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe('rate_limited');
  });
});

describe('host', () => {
  it('login needs the passcode; the session opens the join QR; a crew token cannot', async () => {
    expect((await call('POST', '/api/host/login', { body: { passcode: 'wrong' } })).status).toBe(401);
    const host = await login();
    const j = await call('GET', '/api/host/join', { token: host });
    expect(j.status).toBe(200);
    expect(j.json).toMatchObject({ joinCode: env.db.joinCode, joinUrl: `https://hub.test:3443/?join=${env.db.joinCode}` });
    expect(j.json.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const crew = await pair();
    expect((await call('GET', '/api/host/join', { token: crew.token })).status).toBe(403);
    expect((await call('GET', '/api/host/join')).status).toBe(401);
  });

  it('rotating the join code invalidates the old one and keeps paired phones', async () => {
    const host = await login();
    const crew = await pair();
    const before = env.db.joinCode;
    const r = await call('POST', '/api/host/join/rotate', { token: host });
    expect(r.json.joinCode).not.toBe(before);
    expect(r.json.joinCode).toBe(env.db.joinCode);
    expect((await call('POST', '/api/pair', { body: { joinCode: before, deviceId: 'phone-0009', reporterName: 'B' } })).status).toBe(403);
    expect((await call('GET', '/api/game/state', { token: crew.token })).json.error.code).toBe('no_game');
  });

  it('unknown endpoints answer with the contract error shape', async () => {
    const r = await call('GET', '/api/nothing');
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: { code: 'not_found', message: 'No such endpoint' } });
  });
});

describe('websocket', () => {
  function open() {
    const ws = new WebSocket(env.base.replace('http', 'ws') + '/ws');
    const msgs: { type: string; payload: unknown }[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    return { ws, msgs, closed, ready: new Promise<void>((r) => ws.on('open', r)) };
  }

  it('authenticates with a device or host token and refuses the rest', async () => {
    const crew = await pair();
    const s = open();
    await s.ready;
    s.ws.send(JSON.stringify({ type: 'auth', payload: { token: crew.token } }));
    await new Promise((r) => setTimeout(r, 60));
    expect(s.msgs[0]).toMatchObject({ type: 'auth:ok', payload: { role: 'device' } });
    s.ws.close();

    const bad = open();
    await bad.ready;
    bad.ws.send(JSON.stringify({ type: 'auth', payload: { token: 'not-a-token-at-all-not-a-token' } }));
    expect(await bad.closed).toBe(4001);

    const silent = open();
    await silent.ready;
    expect(await silent.closed).toBe(4001); // auth deadline
  });

  it('re-pairing closes the old token\'s socket', async () => {
    const first = await pair('A', 'phone-sock-1');
    const s = open();
    await s.ready;
    s.ws.send(JSON.stringify({ type: 'auth', payload: { token: first.token } }));
    await new Promise((r) => setTimeout(r, 60));
    await pair('A', 'phone-sock-1');
    expect(await s.closed).toBe(4001);
  });

  it('a path other than /ws is refused', async () => {
    const ws = new WebSocket(env.base.replace('http', 'ws') + '/other');
    const code = await new Promise<string>((r) => ws.on('error', (e) => r(e.message)));
    expect(code).toMatch(/socket hang up|ECONNRESET|Unexpected/);
  });
});
