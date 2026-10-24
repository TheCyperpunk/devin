// Outbox sender + status receiver (docs/PLAN.md Phase 5, DECISIONS D5-D8).
//
//   kick()  ->  flush(): health -> (hub reset? requeue) -> send due reports in batches -> catch up with the cursor
//   socket:     auth -> catch up -> live report:upserted pushes (merged by revision, never advance the cursor)
//
// The cursor only moves from catch-up pages. Upload answers and live pushes are merged but never move it, so a
// coordinator change that lands between two of our requests is still fetched by the next catch-up (no lost updates).
import { LIMITS, TIMING, clockOffset, type PhoneReportInput, type Report, type ServerMessage } from '@relief-mesh/shared';
import { ApiFail, type Api, type PairResponse } from './api.js';
import {
  applyHubReports,
  backoffEntries,
  completeBatch,
  dueReports,
  getSettings,
  makeAllDue,
  outboxCount,
  requeueAll,
  setSettings,
  type BatchUpdate,
} from './db.js';

export type HubState = 'unknown' | 'online' | 'offline';

export interface SyncState {
  hub: HubState;
  socket: boolean;
  sending: boolean;
  unsent: number;
  /** The token is no longer accepted (hub reset or token replaced): show the pairing screen. */
  needsPairing: false | 'reset' | 'unauthorized';
  /** Estimated hub time = Date.now() + offset (see shared hubNow). */
  clockOffset: number;
  /** Bumped whenever local reports changed, so lists re-read IndexedDB. */
  version: number;
}

/** The pieces that touch the outside world, so tests can swap them. */
export interface SocketLike {
  close(): void;
}
export interface Env {
  api: Api;
  now(): number;
  /** Open a WebSocket to /ws; handlers must be called from the socket's events. */
  openSocket(h: { onOpen(send: (msg: string) => void): void; onMessage(data: string): void; onClose(code: number): void }): SocketLike;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

type Listener = (s: SyncState) => void;

export class SyncManager {
  state: SyncState = { hub: 'unknown', socket: false, sending: false, unsent: 0, needsPairing: false, clockOffset: 0, version: 0 };
  private listeners = new Set<Listener>();
  private flushing: Promise<void> | null = null;
  private again = false;
  private timer: unknown = null;
  private socket: SocketLike | null = null;
  private socketBackoff: number = TIMING.backoffStartMs;
  private socketTimer: unknown = null;
  private stopped = true;
  private batchMax: number = LIMITS.batchMax;

  constructor(private env: Env) {}

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private changed(): void {
    this.set({ version: this.state.version + 1 });
  }

  /** Call once the phone is paired. Safe to call again after re-pairing. */
  start(): void {
    this.stopped = false;
    this.set({ needsPairing: false });
    this.kick();
    this.connectSocket();
  }

  stop(): void {
    this.stopped = true;
    this.env.clearTimeout(this.timer);
    this.env.clearTimeout(this.socketTimer);
    this.socket?.close();
    this.socket = null;
    this.set({ socket: false });
  }

  /** Something happened (submit, online, foreground, socket up): flush now, coalescing concurrent calls. */
  kick(): Promise<void> {
    if (this.stopped || this.state.needsPairing) return Promise.resolve();
    if (this.flushing) {
      // Resolve when the follow-up flush (started in the finally below) is done, not just the current one.
      this.again = true;
      return this.flushing.then(() => this.flushing ?? undefined);
    }
    this.flushing = this.flush().finally(() => {
      this.flushing = null;
      if (this.again) {
        this.again = false;
        void this.kick();
      } else {
        this.scheduleTick();
      }
    });
    return this.flushing;
  }

  /** The pairing screen succeeded. A different hubId means a new hub database: everything must be sent again. */
  async paired(r: PairResponse): Promise<void> {
    const s = await getSettings();
    const newHub = s.hubId !== undefined && s.hubId !== r.hubId;
    await setSettings({ deviceToken: r.deviceToken, hubId: r.hubId, reporterName: r.reporterName, ...(newHub ? { cursor: '0' } : {}) });
    if (newHub) await requeueAll();
    this.changed();
    this.start();
  }

  // ---------------- flush ----------------

  private async flush(): Promise<void> {
    const settings = await getSettings();
    const token = settings.deviceToken;
    if (!token) return;

    let health: Awaited<ReturnType<Api['health']>>;
    try {
      health = await this.env.api.health();
    } catch {
      this.set({ hub: 'offline', unsent: await outboxCount() });
      return;
    }
    const localNow = this.env.now();
    this.set({ clockOffset: clockOffset(health.time, localNow) });

    if (settings.hubId && health.hubId !== settings.hubId) {
      // The hub's database was replaced: our token and cursor mean nothing there (CONTRACT 5, hubId).
      await requeueAll();
      await setSettings({ deviceToken: undefined, cursor: '0' });
      this.stop();
      this.set({ hub: 'online', needsPairing: 'reset', unsent: await outboxCount() });
      this.changed();
      return;
    }

    if (this.state.hub !== 'online') await makeAllDue(); // D8: reconnect => everything due now, backoff forgotten
    this.set({ hub: 'online' });

    await this.sendDue(token);
    if (this.state.needsPairing) return;
    await this.catchUp(token);
    this.set({ unsent: await outboxCount() });
  }

  private async sendDue(token: string): Promise<void> {
    for (;;) {
      const now = this.env.now();
      const due = await dueReports(now, this.batchMax);
      if (due.length === 0) break;
      this.set({ sending: true, unsent: await outboxCount() });

      const inputs: PhoneReportInput[] = due.map(({ local }) => ({
        ...local.input,
        ageMs: Math.max(0, now - local.createdAtLocal), // D7: age from one clock, so skew cancels out
      }));
      const ids = inputs.map((i) => i.id);

      try {
        const { results } = await this.env.api.sendBatch(token, inputs);
        const updates: BatchUpdate[] = [];
        for (const r of results) {
          if (!ids.includes(r.id)) continue;
          if ('report' in r) updates.push({ id: r.id, outcome: 'sent', report: r.report });
          else updates.push({ id: r.id, outcome: 'rejected', reason: r.message ?? r.result });
        }
        await completeBatch(updates);
        // Anything the hub did not answer for stays queued and is retried later.
        const unanswered = ids.filter((id) => !updates.some((u) => u.id === id));
        if (unanswered.length) await backoffEntries(unanswered, this.env.now());
        this.changed();
        if (this.batchMax < LIMITS.batchMax) this.batchMax = Math.min(LIMITS.batchMax, this.batchMax * 2);
      } catch (err) {
        const code = err instanceof ApiFail ? err.code : 'network';
        if (code === 'unauthorized') {
          await setSettings({ deviceToken: undefined });
          this.stop();
          this.set({ needsPairing: 'unauthorized' });
          break;
        }
        if (code === 'too_large' && this.batchMax > 1) {
          this.batchMax = Math.max(1, Math.floor(this.batchMax / 2));
          continue; // same reports, smaller batch, right away
        }
        const retryAfter = err instanceof ApiFail && err.retryAfterS ? err.retryAfterS * 1000 : 0;
        await backoffEntries(ids, this.env.now(), retryAfter);
        // Only an unreachable hub is "offline" (and gets the reconnect-makes-all-due treatment). A hub that
        // answers with an error stays "online" and these reports simply wait out their growing backoff.
        if (code === 'network') this.set({ hub: 'offline' });
        break;
      } finally {
        this.set({ sending: false });
      }
    }
  }

  /** Fetch everything newer than the cursor (status changes made by the coordinator) and move the cursor. */
  private async catchUp(token: string): Promise<void> {
    let after = Number((await getSettings()).cursor ?? '0') || 0;
    for (let pages = 0; pages < 50; pages++) {
      let page: Awaited<ReturnType<Api['myReports']>>;
      try {
        page = await this.env.api.myReports(token, after);
      } catch (err) {
        const code = err instanceof ApiFail ? err.code : 'network';
        if (code === 'unauthorized') {
          await setSettings({ deviceToken: undefined });
          this.stop();
          this.set({ needsPairing: 'unauthorized' });
        } else if (code === 'network') {
          this.set({ hub: 'offline' });
        }
        return; // anything else (e.g. rate limited): try again on the next tick
      }
      this.set({ clockOffset: clockOffset(page.serverTime, this.env.now()) });
      if (page.reports.length && (await applyHubReports(page.reports))) this.changed();
      if (page.maxRevision > after) {
        after = page.maxRevision;
        await setSettings({ cursor: String(after) });
      }
      if (!page.hasMore) break;
    }
  }

  // ---------------- timers ----------------

  /** Poll while there is something to send or no live socket; otherwise the socket wakes us. */
  private scheduleTick(): void {
    this.env.clearTimeout(this.timer);
    if (this.stopped || this.state.needsPairing) return;
    const delay = this.state.unsent > 0 ? 5000 : this.state.socket ? 60_000 : TIMING.pollIntervalMs;
    this.timer = this.env.setTimeout(() => void this.kick(), delay);
  }

  // ---------------- socket ----------------

  private connectSocket(): void {
    if (this.stopped || this.socket || this.state.needsPairing) return;
    void getSettings().then((s) => {
      if (!s.deviceToken || this.stopped || this.socket) return;
      const token = s.deviceToken;
      let authed = false;
      this.socket = this.env.openSocket({
        onOpen: (send) => send(JSON.stringify({ type: 'auth', payload: { token } })),
        onMessage: (data) => {
          const m = parse(data);
          if (!m) return;
          if (m.type === 'auth:ok') {
            authed = true;
            this.socketBackoff = TIMING.backoffStartMs;
            this.set({ socket: true, hub: 'online', clockOffset: clockOffset(m.payload.serverTime, this.env.now()) });
            void this.kick(); // flush + catch up on every (re)connect
          } else if (m.type === 'report:upserted') {
            void this.onPush(m.payload.report);
          }
        },
        onClose: (code) => {
          this.socket = null;
          this.set({ socket: false });
          if (code === 4001 && !authed) {
            // The hub refused our token. flush() tells us whether that is a reset (new hubId) or a replaced token.
            void this.kick().then(() => {
              if (this.state.hub === 'online' && !this.state.needsPairing) this.retrySocket();
            });
            return;
          }
          this.retrySocket();
        },
      });
    });
  }

  private retrySocket(): void {
    if (this.stopped) return;
    this.env.clearTimeout(this.socketTimer);
    this.socketTimer = this.env.setTimeout(() => this.connectSocket(), this.socketBackoff);
    this.socketBackoff = Math.min(this.socketBackoff * 2, TIMING.backoffMaxMs);
  }

  /** Reconnect right away (app came to the foreground, network came back). */
  wake(): void {
    if (this.stopped) return;
    this.socketBackoff = TIMING.backoffStartMs;
    if (!this.socket) {
      this.env.clearTimeout(this.socketTimer);
      this.connectSocket();
    }
    void this.kick();
  }

  private async onPush(report: Report): Promise<void> {
    if (await applyHubReports([report])) {
      this.set({ unsent: await outboxCount() });
      this.changed();
    }
  }
}

function parse(data: string): ServerMessage | null {
  try {
    const m = JSON.parse(data) as ServerMessage;
    return m && typeof m.type === 'string' ? m : null;
  } catch {
    return null;
  }
}

/** Production wiring: real fetch, real WebSocket, real timers. */
export function browserEnv(api: Api): Env {
  return {
    api,
    now: () => Date.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    openSocket(h) {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => h.onOpen((msg) => ws.send(msg));
      ws.onmessage = (e) => h.onMessage(String(e.data));
      ws.onclose = (e) => h.onClose(e.code);
      ws.onerror = () => ws.close();
      return { close: () => ws.close() };
    },
  };
}
