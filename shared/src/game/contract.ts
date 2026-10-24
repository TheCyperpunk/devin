// Game data contract (docs/GAME-CONTRACT.md): rules constants, zod schemas for what phones send (strict), and the
// types of the hub-owned state. Phones never send state; the hub never trusts anything but an Order.
import { z } from 'zod';
import { NEED_TYPES, type NeedType } from '../contract.js';

export const KITS = ['water', 'food', 'medical'] as const;
export type Kit = (typeof KITS)[number];

export const BOAT_COLORS = ['moss', 'ember', 'lamp', 'water', 'rose', 'lilac', 'sand', 'sky'] as const;
export type BoatColor = (typeof BOAT_COLORS)[number];

export const NODE_KINDS = ['house', 'school', 'temple', 'junction', 'camp', 'hospital', 'jetty'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Rules constants (GAME-DESIGN sections 2, 4 and 6). */
export const GAME = {
  capacity: 4,
  kitsPerBoat: 1,
  /** Rounds people survive on the roof once the water reaches their house. */
  roofRounds: 3,
  minBoats: 3,
  maxOrdersPerBatch: 20,
  contactTimeoutMs: 20_000,
  /** Extra urgency once the water has reached the house. */
  waterBonus: 25,
  /** One game round stands for ten minutes of the night (drives the shared waitBonus). */
  minutesPerRound: 10,
  points: {
    saved: 10,
    prioritySaved: 5,
    hospitalBonus: 5,
    kitMatched: 3,
    kitWasted: -2,
    lost: -15,
    savedLate: 5,
  },
  /** Star thresholds as multiples of the bot baseline score. */
  stars: { one: 1, two: 1.3, three: 1.6 },
  /** Three bots alone on Thuruthu score 170 (`npm run sim`): 1 star = match the bots, 2 = 221, 3 = 272. */
  defaultStarBase: 170,
} as const;

// ---------- scenario ----------

export const ScenarioNodeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  name: z.string().min(1).max(40),
  nameMl: z.string().min(1).max(60),
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(600),
  kind: z.enum(NODE_KINDS),
  height: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  safe: z.boolean().optional(),
  signal: z.boolean(),
});
export type ScenarioNode = z.infer<typeof ScenarioNodeSchema>;

export const ScenarioCallSchema = z.strictObject({
  round: z.number().int().min(1),
  nodeId: z.string(),
  needs: z.array(z.enum(NEED_TYPES)).min(1).max(NEED_TYPES.length),
  peopleCount: z.number().int().min(1).max(8),
  hasChildren: z.boolean(),
  hasElderlyOrSick: z.boolean(),
  urgent: z.boolean(),
});
export type ScenarioCall = z.infer<typeof ScenarioCallSchema>;

export const ScenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  name: z.string().min(1),
  nameMl: z.string().min(1),
  rounds: z.number().int().min(1).max(30),
  roundSeconds: z.number().int().min(10).max(300),
  riseAfterRounds: z.array(z.number().int().min(1)),
  startNodeId: z.string(),
  nodes: z.array(ScenarioNodeSchema).min(2),
  edges: z.array(z.tuple([z.string(), z.string()])).min(1),
  calls: z.array(ScenarioCallSchema),
  generator: z.strictObject({ seed: z.number().int(), perRound: z.tuple([z.number().int().min(0), z.number().int().min(0)]) }).optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

// ---------- what a phone sends ----------

export const OrderSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), nodeId: z.string().min(1).max(40) }),
  z.strictObject({ type: z.literal('rescue') }),
  z.strictObject({ type: z.literal('drop'), kit: z.enum(KITS) }),
  z.strictObject({ type: z.literal('return') }),
  z.strictObject({ type: z.literal('hold') }),
  z.strictObject({ type: z.literal('standing'), mode: z.enum(['hold', 'return']) }),
  /** Removes whatever is queued at this seq (the crew changed its plan). Never a turn. */
  z.strictObject({ type: z.literal('cancel') }),
]);
export type Order = z.infer<typeof OrderSchema>;

export const QueuedOrderInputSchema = z.strictObject({
  id: z.uuidv4(),
  seq: z.number().int().min(1).max(10_000),
  order: OrderSchema,
});
export type QueuedOrderInput = z.infer<typeof QueuedOrderInputSchema>;

/** Items are validated one by one by the hub so one bad order never blocks the rest (like report batches). */
export const OrdersEnvelopeSchema = z.strictObject({
  orders: z.array(z.unknown()).min(1).max(GAME.maxOrdersPerBatch),
});

export const JoinRequestSchema = z.strictObject({ color: z.enum(BOAT_COLORS) });

// ---------- hub-owned state ----------

export type GamePhase = 'lobby' | 'playing' | 'resolving' | 'paused' | 'ended';

export interface Passenger {
  callId: string;
  /** A child, or elderly or sick: boarded first, worth more when delivered. */
  priority: boolean;
  /** Needs the hospital (elderly/sick or a medical call) for the hospital bonus. */
  hospital: boolean;
}

export interface Boat {
  id: string;
  name: string;
  color: BoatColor;
  bot: boolean;
  nodeId: string;
  passengers: Passenger[];
  kits: Record<Kit, number>;
  standingOrder: 'hold' | 'return';
  /** A `return` order keeps going round after round until the boat unloads. */
  plan: 'return' | null;
  /** Hub clock; null for bots. */
  lastHeardAt: number | null;
  /** People this boat delivered (end screen ranking). */
  saved: number;
}

export interface Call {
  id: string;
  nodeId: string;
  appearedRound: number;
  needs: NeedType[];
  peopleCount: number;
  remaining: number;
  /** How many of `remaining` are children or elderly/sick; they board first. */
  priorityLeft: number;
  hasChildren: boolean;
  hasElderlyOrSick: boolean;
  urgent: boolean;
  kitsNeeded: Kit[];
  status: 'open' | 'served' | 'lost';
  /** Set once the water reaches the house; counts down to `lost`. */
  roofRounds: number | null;
}

export interface QueuedOrder {
  id: string;
  seq: number;
  order: Order;
  receivedAt: number;
}

export type GameEventType =
  | 'moved'
  | 'invalid'
  | 'rescued'
  | 'served'
  | 'kit_matched'
  | 'kit_wasted'
  | 'saved'
  | 'priority_saved'
  | 'hospital_bonus'
  | 'refilled'
  | 'flooded'
  | 'lost'
  | 'call_opened'
  | 'saved_late'
  | 'standing_used'
  | 'water_rose';

export interface GameEvent {
  type: GameEventType;
  boatId?: string;
  callId?: string;
  nodeId?: string;
  fromNodeId?: string;
  count?: number;
  points: number;
}

export interface RoundResult {
  round: number;
  events: GameEvent[];
  scoreAfter: number;
  waterLevel: number;
}

export interface GameState {
  id: string;
  scenarioId: string;
  createdAt: number;
  phase: GamePhase;
  /** 1-based; 0 in the lobby. */
  round: number;
  /** Hub clock, ms; null when not playing. */
  deadlineAt: number | null;
  roundSeconds: number;
  botsEnabled: boolean;
  waterLevel: number;
  boats: Boat[];
  calls: Call[];
  /** boatId -> unapplied orders sorted by seq. */
  queues: Record<string, QueuedOrder[]>;
  /** boatId -> highest applied seq. */
  applied: Record<string, number>;
  /** boatId -> ids of orders already taken (duplicate detection after they left the queue). */
  recent: Record<string, string[]>;
  score: number;
  stars: 0 | 1 | 2 | 3;
  starBase: number;
  history: RoundResult[];
  /** Generator state, so a game can be replayed. */
  rng: number;
}

export type OrderResultCode = 'queued' | 'replaced' | 'duplicate' | 'late' | 'invalid' | 'ended' | 'not_joined';
export interface OrderResult {
  id: string;
  result: OrderResultCode;
  message?: string;
}

export interface CallUrgency {
  score: number;
  band: 'red' | 'orange' | 'yellow';
}

/** What phones and the big screen receive (GAME-CONTRACT 4.2). */
export interface GameView extends Omit<GameState, 'queues' | 'applied' | 'recent' | 'rng'> {
  revision: number;
  serverTime: number;
  /** boatId -> in contact (signal at its node AND heard in the last 20 s). */
  contact: Record<string, boolean>;
  /** callId -> live urgency. */
  urgency: Record<string, CallUrgency>;
  /** Only in a crew's own response. */
  you?: { boatId: string; queued: number; nextSeq: number };
}
