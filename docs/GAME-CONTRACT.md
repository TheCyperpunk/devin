# Pralayam — data contract

Additions to `CONTRACT.md` for the game. Same rules apply: identity from the bearer token, phone inputs strict,
the hub owns every derived field, order by revision, the phone writes through the outbox. Types will live in
`shared/src/game/contract.ts` (zod) once G1 starts.

## 1. Roles and auth
- **Crew** = a paired Relief Mesh device (same `/api/pair` flow, same device token). `reporterName` is the crew name.
- **Host / big screen** = the coordinator session (same `/api/dashboard/login`).
- WS: the existing `/ws` socket with the existing `auth` handshake; game messages are added to it.

## 2. Revision
`gameRevision` is its own monotonic counter in `meta`. Every change to the game state (join, order queued,
round resolved, host action) increments it. `GET /api/game/state?after=<rev>` returns `{ unchanged: true }` when
nothing changed; phones and the screen keep the last full view.

## 3. Scenario (JSON, in `shared/src/game/scenarios/thuruthu.json`)
```ts
interface Scenario {
  id: string; name: string; nameMl: string;
  rounds: number;               // 10
  roundSeconds: number;         // 45
  riseAfterRounds: number[];    // [3,5,7,9]
  startNodeId: string;          // the jetty
  nodes: ScenarioNode[]; edges: [string, string][];
  calls: ScenarioCall[];        // fixed list, or [] with `generator: { seed, perRound: [1,3] }`
  generator?: { seed: number; perRound: [number, number] };
}
interface ScenarioNode {
  id: string; name: string; nameMl: string; x: number; y: number;   // x,y in 0–1000 map units
  kind: 'house' | 'school' | 'temple' | 'junction' | 'camp' | 'hospital' | 'jetty';
  height: 1 | 2 | 3; safe?: boolean; signal: boolean;
}
interface ScenarioCall {
  round: number; nodeId: string; needs: NeedType[]; peopleCount: number;
  hasChildren: boolean; hasElderlyOrSick: boolean; urgent: boolean;
}
```

## 4. Game state

### 4.1 Hub-side `GameState` (stored as JSON in table `game`, one row per game)
```ts
interface GameState {
  id: string; scenarioId: string; createdAt: number;
  phase: 'lobby' | 'playing' | 'resolving' | 'paused' | 'ended';
  round: number;                 // 1-based; 0 in the lobby
  deadlineAt: number | null;     // hub clock, ms
  waterLevel: number;
  boats: Boat[]; calls: Call[];
  queues: Record<string, QueuedOrder[]>;   // boatId -> unapplied orders sorted by seq
  applied: Record<string, number>;         // boatId -> highest applied seq
  score: number; stars: 0 | 1 | 2 | 3;
  history: RoundResult[];                  // one per resolved round
  rng: number;                             // generator state, so a game can be replayed
}
interface Boat {
  id: string;                    // deviceId, or 'bot-1'…
  name: string; color: BoatColor; bot: boolean;
  nodeId: string; passengers: Passenger[];
  kits: { water: number; food: number; medical: number };
  standingOrder: 'hold' | 'return';
  lastHeardAt: number | null;    // hub clock; null for bots
  saved: number;                 // people this boat delivered (for the end screen)
}
interface Passenger { callId: string; child: boolean; elderlyOrSick: boolean; medical: boolean }
interface Call {
  id: string; nodeId: string; appearedRound: number;
  needs: NeedType[]; peopleCount: number; remaining: number;
  hasChildren: boolean; hasElderlyOrSick: boolean; urgent: boolean;
  kitsNeeded: ('water' | 'food' | 'medical')[];
  status: 'open' | 'served' | 'lost'; roofRounds: number | null;
}
interface QueuedOrder { id: string; seq: number; order: Order; receivedAt: number }
type Order =
  | { type: 'move'; nodeId: string } | { type: 'rescue' } | { type: 'drop'; kit: 'water' | 'food' | 'medical' }
  | { type: 'return' } | { type: 'hold' } | { type: 'standing'; mode: 'hold' | 'return' };
interface RoundResult { round: number; events: GameEvent[]; scoreAfter: number; waterLevel: number }
interface GameEvent {
  type: 'moved' | 'invalid' | 'rescued' | 'served' | 'kit_matched' | 'kit_wasted' | 'saved' | 'priority_saved'
      | 'hospital_bonus' | 'refilled' | 'flooded' | 'lost' | 'call_opened' | 'saved_late' | 'standing_used';
  boatId?: string; callId?: string; nodeId?: string; fromNodeId?: string; count?: number; points: number;
}
```

### 4.2 `GameView` (what phones and the screen receive)
Everything in `GameState` except `queues`, `applied` and `rng`, plus:
```ts
interface GameView extends Omit<GameState, 'queues' | 'applied' | 'rng'> {
  revision: number; serverTime: number;
  contact: Record<string, boolean>;        // boatId -> in contact (signal at node AND heard in last 20 s)
  urgency: Record<string, { score: number; band: 'red' | 'orange' | 'yellow' }>;  // callId -> live score
  you?: { boatId: string; queued: number; nextSeq: number };   // only in a crew's response
}
```

### 4.3 Phone-side (IndexedDB, same database as Relief Mesh)
- store `gameOutbox` keyed by order `id`: `{ id, seq, order, createdAtLocal, attempts, nextTryAt, outcome? }`.
- `settings.game`: `{ gameId, lastView: GameView, receivedAt, nextSeq, color }`.
- Backoff and reconnect rules identical to reports (D8). A new `gameId` from the hub clears the outbox and
  `nextSeq` (a new game, old orders mean nothing).

## 5. REST (all under `/api/game`, `Cache-Control: no-store`, rate limits as today)

Crew (device token):
- `POST /join` `{ color: BoatColor }` → `200 { view: GameView }`. Idempotent. Lobby or mid-game (boat appears
  at the jetty from the next round). `409 game_over` after the end.
- `GET /state?after=<rev>` → `200 { view }` or `200 { unchanged: true, revision, serverTime }`.
- `POST /orders` `{ orders: [{ id: uuidv4, seq: int ≥ 1, order: Order }] }` (max 20, strict) →
  `200 { results: [{ id, result: 'queued' | 'replaced' | 'duplicate' | 'late' | 'invalid' | 'ended' | 'not_joined', message? }], view }`.
  Each item stands alone. `standing` orders are applied immediately and answer `queued`.

Host (coordinator session):
- `POST /new` `{ scenarioId, roundSeconds?: 30 | 45 | 60, bots?: boolean }` → `{ view }` (ends any current game).
- `POST /start`, `POST /pause`, `POST /resume`, `POST /skip` (resolve now), `POST /end` → `{ view }`.
- `GET /state?after=` same as crew (no `you`).
- `GET /replay` → the full `GameState` with history (for the demo video and for tests).

Error codes: existing ones plus `game_over`, `not_joined`, `no_game`.

## 6. WebSocket (existing `/ws`, after `auth:ok`)
- hub → all: `game:state { view: GameView }` on every revision (view without `you`; phones overlay their own).
- hub → all: `game:round { round, events, scoreAfter, waterLevel }` right after a resolve, before the next
  `game:state`, so screens can animate before showing the new positions.
- hub → crew: `game:you { boatId, queued, nextSeq }` whenever that crew's queue changes.
No phone → hub game messages over WS. Orders always go through REST + outbox.

## 7. Timing
`roundSeconds` 45 (host can pick 30/60). Early resolve when every non-bot boat in contact has a queued order and
at least 10 s have passed (gives latecomers a moment). Animation window 4 s during which `phase = 'resolving'`
and orders are accepted for the next round. Out-of-contact threshold 20 s without any request from that device.

## 8. Logging
As today: never log orders, names or positions. The hub logs one line per resolved round:
`[game] round 4 resolved in 3 ms, 5 boats (1 out of contact), score 120`.
