// Big-screen state: host session, the latest GameView (merged by revision), live socket with catch-up, the last
// round's events for animation, toasts, host actions. Same shape as the dashboard store: the outside world comes
// in through ScreenEnv so tests can fake it.
import { TIMING, clockOffset, type GameRoundPayload, type GameView, type ServerMessage } from '@relief-mesh/shared';
import { ApiFail } from '../lib/api.js';
import type { SocketHandlers, SocketLike } from '../lib/socket.js';
import type { JoinInfo } from '../dashboard/api.js';
import type { HostAction, NewGameBody, ScreenApi } from './api.js';
import { toastFor, type Toast } from './format.js';

export type HubState = 'unknown' | 'online' | 'offline';

export interface ScreenState {
  session: string | null;
  loginNotice: string | null;
  view: GameView | null;
  /** The hub answered: there is no game yet. */
  noGame: boolean;
  hub: HubState;
  socket: boolean;
  clockOffset: number;
  lastRound: GameRoundPayload | null;
  lastRoundAt: number | null;
  toasts: Toast[];
  join: JoinInfo | null;
  busy: boolean;
  notice: string | null;
  sound: boolean;
}

export interface ScreenEnv {
  api: ScreenApi;
  now(): number;
  openSocket(h: SocketHandlers): SocketLike;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  loadSession(): string | null;
  saveSession(token: string | null): void;
}

type Listener = (s: ScreenState) => void;

export const TOAST_MS = 6000;
export const MAX_TOASTS = 4;

export class ScreenStore {
  state: ScreenState;
  private listeners = new Set<Listener>();
  private refreshing: Promise<void> | null = null;
  private again = false;
  private timer: unknown = null;
  private toastTimer: unknown = null;
  private socket: SocketLike | null = null;
  private socketTimer: unknown = null;
  private socketBackoff: number = TIMING.backoffStartMs;
  private stopped = true;
  private toastId = 0;
  /** Called with each round so the page can play a sound (set by the UI). */
  onRound: ((p: GameRoundPayload) => void) | null = null;

  constructor(private env: ScreenEnv) {
    this.state = {
      session: env.loadSession(),
      loginNotice: null,
      view: null,
      noGame: false,
      hub: 'unknown',
      socket: false,
      clockOffset: 0,
      lastRound: null,
      lastRoundAt: null,
      toasts: [],
      join: null,
      busy: false,
      notice: null,
      sound: false,
    };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  private set(patch: Partial<ScreenState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /** Hub time now, from the last serverTime we saw. */
  hubNow(): number {
    return this.env.now() + this.state.clockOffset;
  }

  // ---------------- session ----------------

  async login(passcode: string): Promise<string | null> {
    try {
      const { sessionToken } = await this.env.api.login(passcode);
      this.env.saveSession(sessionToken);
      this.set({ session: sessionToken, loginNotice: null });
      this.start();
      return null;
    } catch (err) {
      const code = err instanceof ApiFail ? err.code : 'internal';
      if (code === 'unauthorized') return 'Wrong passcode.';
      if (code === 'rate_limited') return 'Too many tries. Wait a minute and try again.';
      if (code === 'network') return 'Cannot reach the hub.';
      return 'Something went wrong. Try again.';
    }
  }

  logout(notice: string | null = null): void {
    this.stop();
    this.env.saveSession(null);
    this.set({ session: null, loginNotice: notice, view: null, noGame: false, join: null, hub: 'unknown', toasts: [] });
  }

  // ---------------- lifecycle ----------------

  start(): void {
    if (!this.state.session) return;
    this.stopped = false;
    void this.kick();
    this.connectSocket();
  }

  stop(): void {
    this.stopped = true;
    this.env.clearTimeout(this.timer);
    this.env.clearTimeout(this.socketTimer);
    this.env.clearTimeout(this.toastTimer);
    this.socket?.close();
    this.socket = null;
    this.set({ socket: false });
  }

  kick(): Promise<void> {
    if (this.stopped || !this.state.session) return Promise.resolve();
    if (this.refreshing) {
      this.again = true;
      return this.refreshing.then(() => this.refreshing ?? undefined);
    }
    this.refreshing = this.refresh().finally(() => {
      this.refreshing = null;
      if (this.again) {
        this.again = false;
        void this.kick();
      } else {
        this.scheduleTick();
      }
    });
    return this.refreshing;
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

  private async refresh(): Promise<void> {
    const token = this.state.session;
    if (!token) return;
    if (!this.state.join) {
      // The join QR does not depend on a game existing; fetch it once, quietly.
      try {
        this.set({ join: await this.env.api.join(token) });
      } catch {
        /* retried on the next kick */
      }
    }
    try {
      const res = await this.env.api.state(token, this.state.view?.revision ?? 0);
      if ('unchanged' in res) {
        this.set({ hub: 'online', clockOffset: clockOffset(res.serverTime, this.env.now()) });
      } else {
        this.merge(res.view);
        this.set({ hub: 'online' });
      }
    } catch (err) {
      const code = err instanceof ApiFail ? err.code : 'network';
      if (code === 'unauthorized' || code === 'forbidden') return this.logout('Your session has expired. Enter the passcode again.');
      if (code === 'no_game') return this.set({ hub: 'online', noGame: true, view: null });
      this.set({ hub: code === 'network' ? 'offline' : this.state.hub });
    }
  }

  /** Keep a view only if it is newer than what we hold (same rule as reports: by revision). */
  private merge(view: GameView): boolean {
    if (this.state.view && view.revision <= this.state.view.revision) return false;
    this.set({ view, noGame: false, clockOffset: clockOffset(view.serverTime, this.env.now()) });
    return true;
  }

  private scheduleTick(): void {
    this.env.clearTimeout(this.timer);
    if (this.stopped) return;
    const playing = this.state.view?.phase === 'playing';
    const delay = this.state.socket ? 60_000 : playing ? 5000 : TIMING.pollIntervalMs;
    this.timer = this.env.setTimeout(() => void this.kick(), delay);
  }

  // ---------------- rounds and toasts ----------------

  private onRoundPayload(p: GameRoundPayload): void {
    const at = this.env.now();
    const fresh: Toast[] = [];
    for (const e of p.events) {
      const t = toastFor(e, this.state.view);
      if (t) fresh.push({ ...t, id: ++this.toastId, at });
    }
    this.set({ lastRound: p, lastRoundAt: at, toasts: [...this.state.toasts, ...fresh].slice(-MAX_TOASTS) });
    this.onRound?.(p);
    this.pruneToastsLater();
  }

  private pruneToastsLater(): void {
    this.env.clearTimeout(this.toastTimer);
    this.toastTimer = this.env.setTimeout(() => {
      const cutoff = this.env.now() - TOAST_MS;
      const keep = this.state.toasts.filter((t) => t.at > cutoff);
      if (keep.length !== this.state.toasts.length) this.set({ toasts: keep });
      if (keep.length) this.pruneToastsLater();
    }, 1000);
  }

  // ---------------- host actions ----------------

  async newGame(body: NewGameBody): Promise<void> {
    await this.hostCall((token) => this.env.api.newGame(token, body));
    this.set({ lastRound: null, lastRoundAt: null, toasts: [] });
  }

  host(action: HostAction): Promise<void> {
    return this.hostCall((token) => this.env.api.host(token, action));
  }

  private async hostCall(fn: (token: string) => Promise<{ view: GameView }>): Promise<void> {
    const token = this.state.session;
    if (!token || this.state.busy) return;
    this.set({ busy: true, notice: null });
    try {
      const { view } = await fn(token);
      this.merge(view);
      this.set({ hub: 'online' });
    } catch (err) {
      const code = err instanceof ApiFail ? err.code : 'network';
      if (code === 'unauthorized' || code === 'forbidden') this.logout('Your session has expired. Enter the passcode again.');
      else this.set({ notice: code === 'network' ? 'Cannot reach the hub.' : err instanceof ApiFail ? err.message : 'Something went wrong.', hub: code === 'network' ? 'offline' : this.state.hub });
    } finally {
      this.set({ busy: false });
    }
  }

  setSound(on: boolean): void {
    this.set({ sound: on });
  }

  // ---------------- socket ----------------

  private connectSocket(): void {
    if (this.stopped || this.socket || !this.state.session) return;
    const token = this.state.session;
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
        } else if (m.type === 'game:round') {
          this.onRoundPayload(m.payload);
        } else if (m.type === 'game:state') {
          this.merge(m.payload.view);
        }
      },
      onClose: (code) => {
        this.socket = null;
        this.set({ socket: false });
        if (code === 4001 && !authed) return this.logout('Your session has expired. Enter the passcode again.');
        this.retrySocket();
      },
    });
  }

  private retrySocket(): void {
    if (this.stopped) return;
    this.env.clearTimeout(this.socketTimer);
    this.socketTimer = this.env.setTimeout(() => this.connectSocket(), this.socketBackoff);
    this.socketBackoff = Math.min(this.socketBackoff * 2, TIMING.backoffMaxMs);
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
