// The live game on the hub (GAME-CONTRACT sections 2, 4, 7): one current game, persisted after every change so a
// restart resumes mid-round, a round timer, early resolve, and broadcasts. All rules live in shared/game; this
// file only decides WHEN to call them. Timers and the clock are injected so tests run in milliseconds.
import {
  GAME,
  QueuedOrderInputSchema,
  Ward,
  allOrdersIn,
  inContact,
  joinBoat,
  markHeard,
  newGame,
  parseScenario,
  queueOrder,
  resolveRound,
  startGame,
  thuruthu,
  toView,
  type BoatColor,
  type GameState,
  type GameView,
  type OrderResult,
  type Scenario,
} from '@pralayam/shared';
import { randomUUID } from 'node:crypto';
import type { HubDb } from './db.js';
import type { Events } from './ws.js';

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
const realTimers: Timers = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  },
  clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
};

/** A round may end early once every crew in contact has ordered, but never before this many ms have passed. */
export const EARLY_RESOLVE_MIN_MS = 10_000;

export type GameEvents = Pick<Events, 'gameState' | 'gameRound' | 'gameYou'>;

export interface NewGameRequest {
  roundSeconds?: 30 | 45 | 60;
  bots?: boolean;
}

export class GameService {
  private state: GameState | null;
  private ward: Ward;
  private timer: unknown = null;
  /** Heartbeats are not state changes: kept here so polling never bumps the revision. */
  private heardAt = new Map<string, number>();
  private pausedRemainingMs: number | null = null;

  constructor(
    private db: HubDb,
    private events: GameEvents,
    private now: () => number = Date.now,
    private timers: Timers = realTimers,
    readonly scenario: Scenario = parseScenario(thuruthu),
  ) {
    this.ward = new Ward(scenario);
    const loaded = db.loadGame();
    this.state = loaded && loaded.scenarioId === scenario.id ? loaded : null;
    // A hub restart mid-round: resolve what is overdue, then arm the timer again.
    if (this.state?.phase === 'playing' && this.state.deadlineAt !== null && this.state.deadlineAt <= this.now()) this.resolve();
    else this.arm();
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  current(): GameState | null {
    return this.state;
  }

  get revision(): number {
    return this.db.gameRevision;
  }

  view(youDeviceId?: string): GameView | null {
    if (!this.state) return null;
    return toView(this.withHeard(this.state), this.ward, this.now(), this.revision, youDeviceId);
  }

  // ---------------- host ----------------

  newGame(req: NewGameRequest = {}): GameView {
    this.stop();
    this.heardAt.clear();
    this.pausedRemainingMs = null;
    const s = newGame(this.scenario, { id: randomUUID(), now: this.now(), roundSeconds: req.roundSeconds, bots: req.bots ?? true });
    this.commit(s);
    return this.view()!;
  }

  start(): GameView | null {
    if (!this.state || this.state.phase !== 'lobby') return this.view();
    this.commit(startGame(this.state, this.scenario, this.now()));
    return this.view();
  }

  pause(): GameView | null {
    if (!this.state || this.state.phase !== 'playing') return this.view();
    this.pausedRemainingMs = Math.max(0, (this.state.deadlineAt ?? this.now()) - this.now());
    this.commit({ ...this.state, phase: 'paused', deadlineAt: null });
    return this.view();
  }

  resume(): GameView | null {
    if (!this.state || this.state.phase !== 'paused') return this.view();
    const remaining = this.pausedRemainingMs ?? this.state.roundSeconds * 1000;
    this.pausedRemainingMs = null;
    this.commit({ ...this.state, phase: 'playing', deadlineAt: this.now() + remaining });
    return this.view();
  }

  /** Resolve the current round now. */
  skip(): GameView | null {
    if (this.state?.phase === 'paused') this.resume();
    this.resolve();
    return this.view();
  }

  end(): GameView | null {
    if (!this.state || this.state.phase === 'ended') return this.view();
    this.commit({ ...this.state, phase: 'ended', deadlineAt: null });
    return this.view();
  }

  // ---------------- crew ----------------

  heard(deviceId: string): void {
    this.heardAt.set(deviceId, this.now());
  }

  join(deviceId: string, name: string, color: BoatColor): { view: GameView } | { error: 'no_game' | 'game_over' } {
    if (!this.state) return { error: 'no_game' };
    if (this.state.phase === 'ended') return { error: 'game_over' };
    this.heard(deviceId);
    const next = joinBoat(this.state, this.scenario, deviceId, name, color, this.now());
    this.commit(next, [deviceId]);
    return { view: this.view(deviceId)! };
  }

  /** Each item is validated and queued on its own; one bad order never blocks the rest (like report batches). */
  orders(deviceId: string, items: unknown[]): { results: OrderResult[]; view: GameView } | { error: 'no_game' } {
    if (!this.state) return { error: 'no_game' };
    this.heard(deviceId);
    const results: OrderResult[] = [];
    let s = this.state;
    let changed = false;
    for (const raw of items) {
      const id = typeof (raw as { id?: unknown } | null)?.id === 'string' ? (raw as { id: string }).id : '';
      const parsed = QueuedOrderInputSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        results.push({ id, result: 'invalid', message: (issue?.path.length ? issue.path.join('.') + ': ' : '') + (issue?.message ?? 'Invalid order') });
        continue;
      }
      const r = queueOrder(s, deviceId, parsed.data, this.now());
      if (r.state !== s) changed = true;
      s = r.state;
      results.push(r.result);
    }
    if (changed) {
      this.commit(s, [deviceId]);
      this.maybeResolveEarly();
    }
    return { results, view: this.view(deviceId)! };
  }

  // ---------------- internals ----------------

  private withHeard(s: GameState): GameState {
    if (this.heardAt.size === 0) return s;
    return { ...s, boats: s.boats.map((b) => (b.bot ? b : { ...b, lastHeardAt: this.heardAt.get(b.id) ?? b.lastHeardAt })) };
  }

  private commit(next: GameState, youFor: string[] = []): void {
    const s = this.heardAt.size ? markHeardAll(next, this.heardAt) : next;
    this.state = s;
    this.db.saveGame(s, this.now());
    this.events.gameState(this.view()!);
    for (const id of youFor) {
      const you = this.view(id)?.you;
      if (you) this.events.gameYou(id, you);
    }
    this.arm();
  }

  private arm(): void {
    this.stop();
    const s = this.state;
    if (!s || s.phase !== 'playing' || s.deadlineAt === null) return;
    const delay = Math.max(0, s.deadlineAt - this.now());
    this.timer = this.timers.setTimeout(() => this.resolve(), delay);
  }

  private resolve(): void {
    const s = this.state;
    if (!s || s.phase !== 'playing') return;
    const t0 = performance.now();
    const r = resolveRound(this.withHeard(s), this.ward, this.now());
    const out = r.state.boats.filter((b) => !b.bot && !this.inContact(r.state, b.id)).length;
    this.events.gameRound({ round: s.round, events: r.events, scoreAfter: r.state.score, waterLevel: r.state.waterLevel });
    this.commit(r.state, r.state.boats.filter((b) => !b.bot).map((b) => b.id));
    console.log(`[game] round ${s.round} resolved in ${(performance.now() - t0).toFixed(0)} ms, ${s.boats.length} boats (${out} out of contact), score ${r.state.score}${r.state.phase === 'ended' ? ' — first light' : ''}`);
  }

  private inContact(s: GameState, boatId: string): boolean {
    return inContact(this.withHeard(s), this.ward, boatId, this.now());
  }

  private maybeResolveEarly(): void {
    const s = this.state;
    if (!s || s.phase !== 'playing' || s.deadlineAt === null) return;
    const started = s.deadlineAt - s.roundSeconds * 1000;
    if (this.now() - started < EARLY_RESOLVE_MIN_MS) return;
    if (allOrdersIn(this.withHeard(s), this.ward, this.now())) this.resolve();
  }
}

function markHeardAll(s: GameState, heard: Map<string, number>): GameState {
  let out = s;
  for (const [id, at] of heard) out = markHeard(out, id, at);
  return out;
}

export { GAME };
