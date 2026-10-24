// Dashboard state: session, every report (merged by revision), live socket with catch-up, cloud status.
// Same shape as the phone's SyncManager: the outside world comes in through DashEnv so tests can fake it.
import { TIMING, clockOffset, type CloudStatus, type PatchReport, type Report, type ServerMessage } from '@relief-mesh/shared';
import { ApiFail } from '../lib/api.js';
import type { SocketHandlers, SocketLike } from '../lib/socket.js';
import type { DashApi, JoinInfo } from './api.js';

export type HubState = 'unknown' | 'online' | 'offline';

export interface DashState {
  session: string | null;
  /** Set when the session was rejected or expired: shown on the login screen. */
  loginNotice: string | null;
  loading: boolean;
  hub: HubState;
  socket: boolean;
  cloud: CloudStatus;
  clockOffset: number;
  /** All reports, unsorted. Screens sort with shared sortReports() and the hub clock. */
  reports: Report[];
  /** Highest revision applied through catch-up pages (CONTRACT 2.3 cursor rule). */
  cursor: number;
  version: number;
}

export interface DashEnv {
  api: DashApi;
  now(): number;
  openSocket(h: SocketHandlers): SocketLike;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** Where the session token lives between reloads (sessionStorage in the browser). */
  loadSession(): string | null;
  saveSession(token: string | null): void;
}

type Listener = (s: DashState) => void;

/** How long a just-arrived report is highlighted in the list. */
export const FLASH_MS = 4000;

export class DashboardStore {
  state: DashState;
  private byId = new Map<string, Report>();
  private arrivedAt = new Map<string, number>();
  private listeners = new Set<Listener>();
  private refreshing: Promise<void> | null = null;
  private again = false;
  private timer: unknown = null;
  private socket: SocketLike | null = null;
  private socketTimer: unknown = null;
  private socketBackoff: number = TIMING.backoffStartMs;
  private stopped = true;

  constructor(private env: DashEnv) {
    this.state = {
      session: env.loadSession(),
      loginNotice: null,
      loading: false,
      hub: 'unknown',
      socket: false,
      cloud: { state: 'not_configured' },
      clockOffset: 0,
      reports: [],
      cursor: 0,
      version: 0,
    };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  private set(patch: Partial<DashState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /** When did this report first appear on this dashboard? (undefined = it was there at load) */
  arrived(id: string): number | undefined {
    return this.arrivedAt.get(id);
  }

  // ---------------- session ----------------

  /** Returns null on success, otherwise a message for the form. */
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
    this.byId.clear();
    this.arrivedAt.clear();
    this.set({ session: null, loginNotice: notice, reports: [], cursor: 0, hub: 'unknown', version: this.state.version + 1 });
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
    this.socket?.close();
    this.socket = null;
    this.set({ socket: false });
  }

  /** Fetch everything newer than the cursor (coalesced), then schedule the next poll. */
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

  /** App came to the foreground or the network came back: reconnect now. */
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
    this.set({ loading: this.byId.size === 0 });
    let after = this.state.cursor;
    try {
      for (let pages = 0; pages < 100; pages++) {
        const page = await this.env.api.reports(token, after);
        this.set({ clockOffset: clockOffset(page.serverTime, this.env.now()) });
        this.merge(page.reports, after === 0 && pages === 0 ? null : this.env.now());
        if (page.maxRevision > after) after = page.maxRevision;
        if (!page.hasMore) break;
      }
      const stats = await this.env.api.stats(token);
      this.set({ hub: 'online', cursor: after, cloud: stats.cloud, loading: false });
    } catch (err) {
      const code = err instanceof ApiFail ? err.code : 'network';
      if (code === 'unauthorized' || code === 'forbidden') {
        this.logout('Your session has expired. Enter the passcode again.');
        return;
      }
      this.set({ hub: code === 'network' ? 'offline' : this.state.hub, cursor: after, loading: false });
    }
  }

  /** Keep a copy only if it is newer than what we hold (CONTRACT 2.3). `arrivedNow` marks reports as new for the flash. */
  private merge(incoming: Report[], arrivedNow: number | null): boolean {
    let changed = false;
    for (const r of incoming) {
      const cur = this.byId.get(r.id);
      if (cur && cur.revision >= r.revision) continue;
      if (!cur && arrivedNow !== null) this.arrivedAt.set(r.id, arrivedNow);
      this.byId.set(r.id, r);
      changed = true;
    }
    if (changed) this.set({ reports: [...this.byId.values()], version: this.state.version + 1 });
    return changed;
  }

  private scheduleTick(): void {
    this.env.clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = this.env.setTimeout(() => void this.kick(), this.state.socket ? 60_000 : TIMING.pollIntervalMs);
  }

  // ---------------- actions ----------------

  /** Returns null on success, otherwise a message. The hub's answer is merged like any other update. */
  async patch(id: string, body: PatchReport): Promise<string | null> {
    const token = this.state.session;
    if (!token) return 'Not logged in.';
    try {
      const { report } = await this.env.api.patch(token, id, body);
      this.merge([report], null);
      return null;
    } catch (err) {
      const code = err instanceof ApiFail ? err.code : 'network';
      if (code === 'unauthorized' || code === 'forbidden') {
        this.logout('Your session has expired. Enter the passcode again.');
        return 'Session expired.';
      }
      if (code === 'network') {
        this.set({ hub: 'offline' });
        return 'Cannot reach the hub. The change was not saved.';
      }
      return err instanceof ApiFail ? err.message : 'Something went wrong.';
    }
  }

  join(): Promise<JoinInfo> {
    return this.env.api.join(this.state.session ?? '');
  }
  rotateJoin(): Promise<JoinInfo> {
    return this.env.api.rotateJoin(this.state.session ?? '');
  }
  exportDb(): Promise<{ blob: Blob; filename: string }> {
    return this.env.api.exportDb(this.state.session ?? '');
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
          void this.kick(); // anything missed while the socket was down
        } else if (m.type === 'report:upserted') {
          this.merge([m.payload.report], this.env.now());
        } else if (m.type === 'cloud:status') {
          this.set({ cloud: m.payload });
        }
      },
      onClose: (code) => {
        this.socket = null;
        this.set({ socket: false });
        if (code === 4001 && !authed) {
          this.logout('Your session has expired. Enter the passcode again.');
          return;
        }
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

export const SESSION_KEY = 'relief-mesh.session';
