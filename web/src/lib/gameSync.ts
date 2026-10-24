// The phone's link to the night (GAME-CONTRACT 4.3, GAME-DESIGN 5.2): orders go IndexedDB -> outbox -> hub,
// exactly once; the view comes back by catch-up (revision) and over the socket. Same shape as the old report
// sync: the outside world comes in through Env so tests can fake it, and the hub decides everything.
import { TIMING, clockOffset, type BoatColor, type GameRoundPayload, type GameView, type Order, type OrderResult, type ServerMessage } from '@pralayam/shared';
import { ApiFail, type HealthResponse } from './api.js';
import {
  addOrder,
  backoffOrders,
  clearOutbox,
  dropOrders,
  dueOrders,
  getSettings,
  makeAllDue,
  outboxCount,
  pendingOrders,
  setSettings,
  type OutboxEntry,
} from './db.js';

export type HubState = 'unknown' | 'online' | 'offline';

export interface GameSyncState {
  hub: HubState;
  socket: boolean;
  sending: boolean;
  /** Orders still in this phone's outbox. */
  unsent: number;
  /** Orders the hub holds for this crew, not yet played, and their seqs (lowest first). */
  queued: number;
  queuedSeqs: number[];
  nextSeq: number;
  view: GameView | null;
  viewAt: number | null;
  noGame: boolean;
  lastRound: GameRoundPayload | null;
  lastRoundAt: number | null;
  needsPairing: false | 'reset' | 'unauthorized';
  clockOffset: number;
  /** One-line message for the crew (a late order, an invalid one); cleared on the next send. */
  notice: string | null;
  /** The hub is reachable but our boat is in a dead zone: it tells us nothing and takes nothing (D16). */
  noSignal: boolean;
  /** The plan this phone last sent: where the boat is heading and how many moves that was. */
  plan: { target: string; steps: number } | null;
  version: number;
}

export interface GameApi {
  health(): Promise<HealthResponse>;
  state(token: string, after: number): Promise<{ view: GameView } | { unchanged: true; revision: number; serverTime: number } | { noSignal: true }>;
  orders(token: string, items: { id: string; seq: number; order: Order }[]): Promise<{ results: OrderResult[]; view: GameView } | { noSignal: true }>;
  join(token: string, color: BoatColor): Promise<{ view: GameView }>;
}
export interface SocketLike {
  close(): void;
}
export interface Env {
  api: GameApi;
  now(): number;
  openSocket(h: { onOpen(send: (msg: string) => void): void; onMessage(data: string): void; onClose(code: number): void }): SocketLike;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  uuid(): string;
}

type Listener = (s: GameSyncState) => void;
const BATCH = 20;

export class GameSync {
  state: GameSyncState = {
    hub: 'unknown',
    socket: false,
    sending: false,
    unsent: 0,
    queued: 0,
    queuedSeqs: [],
    nextSeq: 1,
    view: null,
    viewAt: null,
    noGame: false,
    lastRound: null,
    lastRoundAt: null,
    needsPairing: false,
    clockOffset: 0,
    notice: null,
    noSignal: false,
    plan: null,
    version: 0,
  };
  private listeners = new Set<Listener>();
  private flushing: Promise<void> | null = null;
  private again = false;
  private timer: unknown = null;
  private socket: SocketLike | null = null;
  private socketBackoff: number = TIMING.backoffStartMs;
  private socketTimer: unknown = null;
  private stopped = true;
  private deviceId: string | null = null;

  constructor(private env: Env) {}

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }
  private set(patch: Partial<GameSyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
  private changed(): void {
    this.set({ version: this.state.version + 1 });
  }

  /** Call once the phone is paired. Restores the last view and seq from the phone so the screen is never blank. */
  start(): void {
    this.stopped = false;
    this.set({ needsPairing: false });
    void getSettings().then(async (s) => {
      if (this.stopped) return;
      this.deviceId = s.deviceId ?? null;
      if (s.lastView && !this.state.view) this.set({ view: s.lastView, viewAt: s.lastViewAt ?? null });
      this.set({ nextSeq: await this.nextSeqFrom(s.nextSeq ?? 1), unsent: await outboxCount() });
      void this.kick();
      this.connectSocket();
    });
  }

  stop(): void {
    this.stopped = true;
    this.env.clearTimeout(this.timer);
    this.env.clearTimeout(this.socketTimer);
    this.socket?.close();
    this.socket = null;
    this.set({ socket: false });
  }

  /** Flush now, coalescing concurrent calls; resolves when the follow-up flush (if any) is done too. */
  kick(): Promise<void> {
    if (this.stopped || this.state.needsPairing) return Promise.resolve();
    if (this.flushing) {
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

  wake(): void {
    if (this.stopped) return;
    this.socketBackoff = TIMING.backoffStartMs;
    if (!this.socket) {
      this.env.clearTimeout(this.socketTimer);
      this.connectSocket();
    }
    void this.kick();
  }

  /** The crew pressed Retry: forget every backoff and try the hub right now. */
  async retryNow(): Promise<void> {
    if (this.stopped) return;
    await makeAllDue();
    this.wake();
    await this.kick();
  }

  hubNow(): number {
    return this.env.now() + this.state.clockOffset;
  }

  // ---------------- crew actions ----------------

  async join(color: BoatColor): Promise<string | null> {
    const token = (await getSettings()).deviceToken;
    if (!token) return 'not paired';
    try {
      const { view } = await this.env.api.join(token, color);
      await setSettings({ color });
      await this.merge(view);
      this.set({ hub: 'online', noGame: false });
      return null;
    } catch (err) {
      const code = err instanceof ApiFail ? err.code : 'network';
      if (code === 'network') this.set({ hub: 'offline' });
      return code;
    }
  }

  /**
   * Write an order to the outbox and flush. `replace` re-uses the seq of the last order the hub has not played
   * yet (the crew changed their mind); `append` lines it up after everything already queued.
   */
  async submit(order: Order, mode: 'replace' | 'append' = 'replace'): Promise<void> {
    if (order.type === 'standing') {
      // Not a turn and never queued: it applies the moment it arrives, so it needs no place in the sequence.
      const gameId = this.state.view?.id ?? (await getSettings()).gameId;
      if (!gameId) return;
      await addOrder({ id: this.env.uuid(), seq: 1, order, gameId, createdAtLocal: this.env.now(), attempts: 0, nextTryAt: 0 });
      this.set({ unsent: await outboxCount(), notice: null });
      this.changed();
      void this.kick();
      return;
    }
    if (mode === 'replace') return this.plan([order], null);
    const s = await getSettings();
    const gameId = this.state.view?.id ?? s.gameId;
    if (!gameId) return;
    const seq = this.state.nextSeq;
    await addOrder({ id: this.env.uuid(), seq, order, gameId, createdAtLocal: this.env.now(), attempts: 0, nextTryAt: 0 });
    await setSettings({ nextSeq: seq + 1, gameId });
    this.set({ nextSeq: seq + 1, unsent: await outboxCount(), notice: null, plan: this.state.plan && { ...this.state.plan, steps: this.state.plan.steps + 1 } });
    this.changed();
    void this.kick();
  }

  /**
   * "This is my plan now": the steps take the place of every order not yet played (one seq each, lowest first);
   * any queued seq beyond the plan is cancelled. The boat then follows the plan round after round.
   */
  async plan(steps: Order[], target: string | null): Promise<void> {
    const s = await getSettings();
    const gameId = this.state.view?.id ?? s.gameId;
    if (!gameId || steps.length === 0) return;
    const pending = await pendingOrders();
    const turns = pending.filter((e) => e.order.type !== 'standing');
    await dropOrders(turns.map((e) => e.id));
    // The seqs that still hold a turn: what the hub reported, then what waited in the outbox. Each step takes one,
    // lowest first; steps beyond them get fresh seqs; seqs left over are cancelled.
    const slots = [...new Set([...this.state.queuedSeqs, ...turns.map((e) => e.seq)])].sort((a, b) => a - b);
    const now = this.env.now();
    let nextSeq = this.state.nextSeq;
    for (let i = 0; i < steps.length; i++) {
      const seq = slots[i] ?? nextSeq++;
      await addOrder({ id: this.env.uuid(), seq, order: steps[i]!, gameId, createdAtLocal: now, attempts: 0, nextTryAt: 0 });
    }
    for (const seq of slots.slice(steps.length)) {
      await addOrder({ id: this.env.uuid(), seq, order: { type: 'cancel' }, gameId, createdAtLocal: now, attempts: 0, nextTryAt: 0 });
    }
    await setSettings({ nextSeq, gameId });
    this.set({ nextSeq, unsent: await outboxCount(), notice: null, plan: target ? { target, steps: steps.length } : null });
    this.changed();
    void this.kick();
  }

  // ---------------- flush ----------------

  private async flush(): Promise<void> {
    const settings = await getSettings();
    const token = settings.deviceToken;
    if (!token) return;

    let health: HealthResponse;
    try {
      health = await this.env.api.health();
    } catch {
      this.set({ hub: 'offline', unsent: await outboxCount() });
      return;
    }
    this.set({ clockOffset: clockOffset(health.time, this.env.now()) });

    if (settings.hubId && health.hubId !== settings.hubId) {
      // A different hub database: our token and orders mean nothing there.
      await clearOutbox();
      await setSettings({ deviceToken: undefined, gameId: undefined, nextSeq: undefined, lastView: undefined, lastViewAt: undefined });
      this.stop();
      this.set({ hub: 'online', needsPairing: 'reset', unsent: 0, view: null });
      this.changed();
      return;
    }

    if (this.state.hub !== 'online') await makeAllDue(); // reconnect: everything due now, backoff forgotten
    this.set({ hub: 'online' });

    // Catch up first: if the hub has moved on to a new game, merge() clears the outbox before anything stale is sent.
    await this.catchUp(token);
    if (this.state.needsPairing) return;
    await this.sendDue(token);
    this.set({ unsent: await outboxCount() });
  }

  private async sendDue(token: string): Promise<void> {
    for (;;) {
      const due = await dueOrders(this.env.now(), BATCH);
      if (due.length === 0) break;
      this.set({ sending: true, unsent: await outboxCount() });
      const ids = due.map((e) => e.id);
      try {
        const res = await this.env.api.orders(token, due.map((e) => ({ id: e.id, seq: e.seq, order: e.order })));
        if ('noSignal' in res) {
          // In the bend: the orders wait on the phone and go the moment we are back in range.
          await backoffOrders(ids, this.env.now(), 5000);
          this.set({ noSignal: true });
          break;
        }
        const { results, view } = res;
        this.set({ noSignal: false });
        const answered = results.filter((r) => ids.includes(r.id));
        await dropOrders(answered.map((r) => r.id)); // every answer settles the order: the hub has it, or it never will
        const unanswered = ids.filter((id) => !answered.some((r) => r.id === id));
        if (unanswered.length) await backoffOrders(unanswered, this.env.now());
        const cancels = new Set(due.filter((e) => e.order.type === 'cancel').map((e) => e.id));
        const notice = noticeFor(answered.filter((r) => !cancels.has(r.id)));
        if (notice) this.set({ notice });
        await this.merge(view);
        this.changed();
      } catch (err) {
        const code = err instanceof ApiFail ? err.code : 'network';
        if (code === 'unauthorized') {
          await setSettings({ deviceToken: undefined });
          this.stop();
          this.set({ needsPairing: 'unauthorized' });
          break;
        }
        if (code === 'no_game') {
          await clearOutbox(); // the game those orders belonged to is gone
          this.set({ noGame: true, view: null });
          break;
        }
        const retryAfter = err instanceof ApiFail && err.retryAfterS ? err.retryAfterS * 1000 : 0;
        await backoffOrders(ids, this.env.now(), retryAfter);
        if (code === 'network') this.set({ hub: 'offline' });
        break;
      } finally {
        this.set({ sending: false });
      }
    }
  }

  private async catchUp(token: string): Promise<void> {
    try {
      const res = await this.env.api.state(token, this.state.view?.revision ?? 0);
      if ('noSignal' in res) return this.set({ noSignal: true, noGame: false });
      this.set({ noSignal: false });
      if ('view' in res) await this.merge(res.view);
      else this.set({ clockOffset: clockOffset(res.serverTime, this.env.now()), noGame: false });
    } catch (err) {
      const code = err instanceof ApiFail ? err.code : 'network';
      if (code === 'unauthorized') {
        await setSettings({ deviceToken: undefined });
        this.stop();
        this.set({ needsPairing: 'unauthorized' });
      } else if (code === 'no_game') {
        this.set({ noGame: true, view: null });
      } else if (code === 'network') {
        this.set({ hub: 'offline' });
      }
    }
  }

  /** Keep a view only if newer. A new game id clears the outbox and restarts the seq counter. */
  private async merge(view: GameView): Promise<void> {
    const s = await getSettings();
    if (s.gameId && s.gameId !== view.id) {
      await clearOutbox();
      await setSettings({ gameId: view.id, nextSeq: view.you?.nextSeq ?? 1 });
      this.set({ queued: 0, queuedSeqs: [], unsent: 0, nextSeq: view.you?.nextSeq ?? 1, lastRound: null, lastRoundAt: null, notice: null });
    } else if (!s.gameId) {
      await setSettings({ gameId: view.id });
    }
    if (this.state.view && view.revision <= this.state.view.revision && view.id === this.state.view.id) {
      if (view.you) await this.applyYou(view.you);
      return;
    }
    const at = this.env.now();
    await setSettings({ lastView: view, lastViewAt: at });
    this.set({ view, viewAt: at, noGame: false, clockOffset: clockOffset(view.serverTime, at) });
    if (view.you) await this.applyYou(view.you);
  }

  private async applyYou(you: NonNullable<GameView['you']>): Promise<void> {
    const nextSeq = await this.nextSeqFrom(you.nextSeq);
    await setSettings({ nextSeq });
    const unsent = await outboxCount();
    this.set({ queued: you.queued, queuedSeqs: you.queuedSeqs ?? [], nextSeq, plan: you.queued + unsent === 0 ? null : this.state.plan });
  }

  /** The next seq must clear both what the hub has played/queued and what is still in the outbox. */
  private async nextSeqFrom(hubNext: number): Promise<number> {
    const pending = (await pendingOrders()).filter((e) => e.order.type !== 'standing');
    const maxPending = pending.reduce((m, e) => Math.max(m, e.seq), 0);
    return Math.max(hubNext, maxPending + 1, this.state.nextSeq);
  }

  // ---------------- timers ----------------

  private scheduleTick(): void {
    this.env.clearTimeout(this.timer);
    if (this.stopped || this.state.needsPairing) return;
    // No pushes reach a muted phone, so poll every 5 s while in a dead zone (or out of contact by the last view) too.
    const quiet = this.state.noSignal || (this.deviceId !== null && this.state.view?.contact[this.deviceId] === false);
    const delay = this.state.unsent > 0 || quiet ? 5000 : this.state.socket ? 60_000 : 5000;
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
            void this.kick();
          } else if (m.type === 'game:state') {
            void this.merge(m.payload.view);
          } else if (m.type === 'game:round') {
            this.set({ lastRound: m.payload, lastRoundAt: this.env.now() });
          } else if (m.type === 'game:you') {
            void this.applyYou(m.payload);
          }
        },
        onClose: (code) => {
          this.socket = null;
          this.set({ socket: false });
          if (code === 4001 && !authed) {
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
}

function noticeFor(results: OrderResult[]): string | null {
  if (results.some((r) => r.result === 'late')) return 'late';
  if (results.some((r) => r.result === 'invalid')) return 'invalid';
  if (results.some((r) => r.result === 'ended')) return 'ended';
  if (results.some((r) => r.result === 'not_joined')) return 'not_joined';
  return null;
}

function parse(data: string): ServerMessage | null {
  try {
    const m = JSON.parse(data) as ServerMessage;
    return m && typeof m.type === 'string' ? m : null;
  } catch {
    return null;
  }
}

/** The pending outbox entries, for screens that want to list them. */
export { pendingOrders, type OutboxEntry };
