// Game state transitions that are not a round: new game, join, bots, start, order queue (seq / replace /
// duplicate / late, GAME-DESIGN 5.1), contact. All pure: every function returns a new state.
import type { NeedType } from '../contract.js';
import {
  GAME,
  KITS,
  BOAT_COLORS,
  type Boat,
  type BoatColor,
  type Call,
  type GameState,
  type Kit,
  type OrderResult,
  type QueuedOrderInput,
  type Scenario,
  type ScenarioCall,
} from './contract.js';
import type { Ward } from './scenario.js';

export interface NewGameOptions {
  id: string;
  now: number;
  roundSeconds?: number;
  bots?: boolean;
  seed?: number;
  starBase?: number;
}

export function newGame(scn: Scenario, o: NewGameOptions): GameState {
  return {
    id: o.id,
    scenarioId: scn.id,
    createdAt: o.now,
    phase: 'lobby',
    round: 0,
    deadlineAt: null,
    roundSeconds: o.roundSeconds ?? scn.roundSeconds,
    botsEnabled: o.bots ?? true,
    waterLevel: 0,
    boats: [],
    calls: [],
    queues: {},
    applied: {},
    recent: {},
    score: 0,
    stars: 0,
    starBase: o.starBase ?? GAME.defaultStarBase,
    history: [],
    rng: (o.seed ?? scn.generator?.seed ?? 1) >>> 0,
  };
}

function freshKits(): Record<Kit, number> {
  return Object.fromEntries(KITS.map((k) => [k, GAME.kitsPerBoat])) as Record<Kit, number>;
}

function makeBoat(id: string, name: string, color: BoatColor, bot: boolean, nodeId: string, now: number | null): Boat {
  return { id, name, color, bot, nodeId, passengers: [], kits: freshKits(), standingOrder: 'hold', plan: null, lastHeardAt: now, saved: 0 };
}

/** Idempotent: joining again keeps the boat and refreshes name, colour and lastHeardAt. */
export function joinBoat(state: GameState, scn: Scenario, boatId: string, name: string, color: BoatColor, now: number): GameState {
  if (state.phase === 'ended') return state;
  const existing = state.boats.find((b) => b.id === boatId);
  if (existing) {
    return { ...state, boats: state.boats.map((b) => (b.id === boatId ? { ...b, name, color, lastHeardAt: now } : b)) };
  }
  return {
    ...state,
    boats: [...state.boats, makeBoat(boatId, name, color, false, scn.startNodeId, now)],
    queues: { ...state.queues, [boatId]: [] },
    applied: { ...state.applied, [boatId]: 0 },
    recent: { ...state.recent, [boatId]: [] },
  };
}

const BOT_NAMES = ['Chellanam 1', 'Vypin 2', 'Kumbalangi 3', 'Munambam 4', 'Fort Kochi 5'] as const;

/** Add bot boats until there are at least `minBoats`. Bots take the colours no crew has. */
export function addBots(state: GameState, scn: Scenario, minBoats: number = GAME.minBoats): GameState {
  let s = state;
  let i = 0;
  while (s.boats.length < minBoats && i < BOT_NAMES.length) {
    const id = `bot-${i + 1}`;
    if (!s.boats.some((b) => b.id === id)) {
      const used = new Set(s.boats.map((b) => b.color));
      const color = BOAT_COLORS.find((c) => !used.has(c)) ?? 'sand';
      s = {
        ...s,
        boats: [...s.boats, makeBoat(id, BOT_NAMES[i]!, color, true, scn.startNodeId, null)],
        queues: { ...s.queues, [id]: [] },
        applied: { ...s.applied, [id]: 0 },
        recent: { ...s.recent, [id]: [] },
      };
    }
    i++;
  }
  return s;
}

export function callFromScenario(c: ScenarioCall, id: string, round: number): Call {
  const priority = (c.hasChildren ? Math.max(1, Math.round(c.peopleCount / 3)) : 0) + (c.hasElderlyOrSick ? Math.max(1, Math.round(c.peopleCount / 4)) : 0);
  const kits = KITS.filter((k) => (c.needs as NeedType[]).includes(k));
  return {
    id,
    nodeId: c.nodeId,
    appearedRound: round,
    needs: [...c.needs],
    peopleCount: c.peopleCount,
    remaining: c.peopleCount,
    priorityLeft: Math.min(priority, c.peopleCount),
    hasChildren: c.hasChildren,
    hasElderlyOrSick: c.hasElderlyOrSick,
    urgent: c.urgent,
    kitsNeeded: kits,
    status: 'open',
    roofRounds: null,
  };
}

/** Lobby -> playing: round 1 opens with its calls. Bots are added first if enabled. */
export function startGame(state: GameState, scn: Scenario, now: number): GameState {
  if (state.phase !== 'lobby') return state;
  let s = state.botsEnabled ? addBots(state, scn) : state;
  const opened = scn.calls.filter((c) => c.round === 1).map((c, i) => callFromScenario(c, `call-1-${i + 1}`, 1));
  s = { ...s, phase: 'playing', round: 1, deadlineAt: now + s.roundSeconds * 1000, calls: opened };
  return s;
}

export function markHeard(state: GameState, boatId: string, now: number): GameState {
  if (!state.boats.some((b) => b.id === boatId && !b.bot)) return state;
  return { ...state, boats: state.boats.map((b) => (b.id === boatId ? { ...b, lastHeardAt: now } : b)) };
}

/** In contact = the phone has talked to the hub recently AND its boat is somewhere with signal. Bots always are. */
export function inContact(state: GameState, ward: Ward, boatId: string, now: number): boolean {
  const b = state.boats.find((x) => x.id === boatId);
  if (!b) return false;
  if (b.bot) return true;
  const signal = ward.node(b.nodeId)?.signal ?? false;
  return signal && b.lastHeardAt !== null && now - b.lastHeardAt <= GAME.contactTimeoutMs;
}

const RECENT_MAX = 100;

/** Queue one order (GAME-DESIGN 5.1). `standing` orders apply at once and never use a turn. */
export function queueOrder(state: GameState, boatId: string, input: QueuedOrderInput, now: number): { state: GameState; result: OrderResult } {
  const boat = state.boats.find((b) => b.id === boatId);
  if (!boat || boat.bot) return { state, result: { id: input.id, result: 'not_joined', message: 'Join the game first' } };
  if (state.phase === 'ended') return { state, result: { id: input.id, result: 'ended', message: 'The night is over' } };
  if (state.phase === 'lobby') return { state, result: { id: input.id, result: 'invalid', message: 'The game has not started' } };

  const queue = state.queues[boatId] ?? [];
  const recent = state.recent[boatId] ?? [];
  if (queue.some((q) => q.id === input.id) || recent.includes(input.id)) {
    return { state, result: { id: input.id, result: 'duplicate' } };
  }
  const remember = (ids: string[]) => [...ids, input.id].slice(-RECENT_MAX);

  if (input.order.type === 'standing') {
    const mode = input.order.mode;
    const boats = state.boats.map((b) => (b.id === boatId ? { ...b, standingOrder: mode } : b));
    return {
      state: { ...state, boats, recent: { ...state.recent, [boatId]: remember(recent) } },
      result: { id: input.id, result: 'queued', message: 'Standing order set' },
    };
  }

  if (input.seq <= (state.applied[boatId] ?? 0)) {
    return { state, result: { id: input.id, result: 'late', message: `Order ${input.seq} already played` } };
  }
  const entry = { id: input.id, seq: input.seq, order: input.order, receivedAt: now };
  const replaced = queue.some((q) => q.seq === input.seq);
  const next = [...queue.filter((q) => q.seq !== input.seq), entry].sort((a, b) => a.seq - b.seq);
  return {
    state: { ...state, queues: { ...state.queues, [boatId]: next } },
    result: { id: input.id, result: replaced ? 'replaced' : 'queued' },
  };
}

/** Every crewed boat that is in contact has an order waiting (the hub may resolve early). */
export function allOrdersIn(state: GameState, ward: Ward, now: number): boolean {
  const crews = state.boats.filter((b) => !b.bot);
  if (crews.length === 0) return false;
  return crews.every((b) => !inContact(state, ward, b.id, now) || (state.queues[b.id]?.length ?? 0) > 0);
}

export function starsFor(score: number, starBase: number): 0 | 1 | 2 | 3 {
  if (starBase <= 0) return 0;
  if (score >= starBase * GAME.stars.three) return 3;
  if (score >= starBase * GAME.stars.two) return 2;
  if (score >= starBase * GAME.stars.one) return 1;
  return 0;
}
