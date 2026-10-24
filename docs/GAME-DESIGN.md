# Pralayam — game design

Co-operative flood-night rescue for 1–8 phones and one big screen, on a local hub laptop, with no Internet.
This is the rules document. Data shapes are in `GAME-CONTRACT.md`, the look in `GAME-VISUAL.md`, the build order
in `GAME-PLAN.md`. Everything here is deterministic so it can be unit-tested and replayed.

## 1. Fantasy

It is the night of 16 August. The river has broken its banks in Thuruthu ward. The control room (the big screen)
has a hand-drawn map, a radio and a list of calls. Each player is a boat crew. Phone signal is gone in the bend of
the river and in the paddy fields: when you go there you are on your own, and the control room only hears from
you when you come back. You have ten rounds until first light. Save as many as you can. Save the children and
the old first.

## 2. Pieces

### 2.1 The ward (one scenario file, see CONTRACT 3)
- A graph of **nodes** joined by **edges**. Boats move one edge per round.
- Node kinds: `house` (has a height 1–3), `school`, `temple` (height 3, people shelter there), `junction`
  (water only), `camp` (relief camp: unload, refill kits), `hospital` (unload; bonus for elderly or sick).
- Each node has `signal: true | false`. Nodes with `signal: false` are **dead zones**.
- The default ward "Thuruthu" has 22 nodes: 14 houses, 1 school, 1 temple, 3 junctions, 1 camp, 1 hospital,
  1 jetty (start). Two dead zones: "the bend" (3 nodes) and "the paddy fields" (3 nodes).

### 2.2 Water
- `waterLevel` starts at 0 and rises by 1 after rounds 3, 5, 7 and 9 (so it reaches 4 by the end).
- A house is **flooded** when `waterLevel >= height`. People still there climb to the roof and get a
  `roofRounds` countdown of 3 (tuned in G1 from 2: with 2, even five bots lost a third of the ward). When it
  reaches 0 they are **lost**.
- The temple and school never flood (height 3 but a special `safe: true` flag). They can hold many people and are
  the natural staging posts.

### 2.3 Calls
`needs[] ⊆ {water, food, medical, rescue, shelter}`, `peopleCount 1–8`, `hasChildren`, `hasElderlyOrSick`,
`urgent`, plus game fields: `nodeId`, `appearedRound`, `remaining` (people still there), `kitsNeeded`
(derived: water → water kit, food → food kit, medical → medical kit), `status: open | served | lost`.

Urgency = `baseScore(call) + waitBonus(rounds waited) + waterBonus` where `baseScore` and `waitBonus` are the shared urgency
functions (`shared/src/urgency.ts`) with one round = ten minutes of the night (+2 per round, capped at 20), and `waterBonus` = 25
once the house is flooded. Priority seats: a call with children has `round(people / 3)` of them (at least 1), one
with elderly or sick `round(people / 4)` (at least 1); they board first.
Bands: red ≥ 80, orange ≥ 50, else yellow. The big screen colours calls by band.

### 2.4 Boats (one per phone, plus bots)
- `capacity 4` people, kits `{water: 1, food: 1, medical: 1}` (refilled to 1 each at the camp).
- `nodeId` (where it is), `passengers[]` (who is aboard, with their flags), `standingOrder: hold | return`.
- `contact` = `nodes[boat.nodeId].signal` **and** the phone has talked to the hub in the last 20 s. Either one
  false shows the boat as "out of contact" on the big screen.
- Bots: the hub adds bots so there are at least 3 boats, named after coastal villages whose boats came in 2018
  ("Chellanam 1", "Vypin 2", "Kumbalangi 3"). A bot delivers when full, when nothing is worth a detour or when the
  night is nearly over; rescues or drops where it stands; otherwise heads for the best call by urgency over
  distance, skipping calls that boats arriving first will empty (but never idles while a call is open).

## 3. A round (45 s by default)

```
open  ──45 s or all orders in──▶ resolve (≤ 5 s animation) ──▶ open (next) … ──▶ end after round 10
```

1. **Open.** Every crew submits one order from the phone (CONTRACT 4.3). Changing your mind replaces it.
   Orders sent while out of contact wait in the phone's outbox and arrive later (section 5).
2. **Resolve** at the deadline, or early if every boat in contact has an order (bots always have one).
   Resolution is one pure function `resolveRound(state, ordersByBoat, rng) → { state, events }`.
3. **Animate** the events on the big screen (boats slide, people hop aboard, water rises), 3–5 s.
4. Round 10 resolves → **end**: passengers still aboard count as saved at half points, then the end screen.

## 4. Orders and resolution

Order types: `move(nodeId)`, `rescue`, `drop(kit)`, `return`, `hold`, `standing(mode)`.
`standing` is not a round action: it sets `standingOrder` immediately and does not use the crew's turn.
**People climb aboard as a boat arrives** (G1 tuning: a separate rescue round made every trip six rounds long), so
`rescue` is only needed when a boat is already there, for example when a new call opens under it or a second boat
takes the rest.

`resolveRound` applies these steps in this exact order, every boat in `boats` array order (joined order), so the
result never depends on network timing:

1. **Pick the acting order** per boat: the head of its order queue (5.1); if none, its standing order
   (`hold` → do nothing, `return` → one step toward the nearest of camp/hospital along the shortest path).
2. **Move.** `move(n)` succeeds if `n` is adjacent, then loads people there (step 3) in the same round; else the
   event is `invalid` and the boat holds. `return` sets the boat's plan to "returning" and moves one edge along the
   shortest path to the nearest place to unload: the camp, the hospital, or a shelter (temple, school; ties camp >
   hospital > shelter). If anyone aboard needs the hospital it goes there instead when that is at most one step
   farther. A returning boat keeps going round after round with no new order; any other order cancels the plan.
3. **Rescue.** At a node with an open call: take `min(capacity − aboard, remaining)` people. Children and the
   elderly or sick board first (they carry the call's flags). If `remaining` hits 0 the call becomes `served`.
   No open call there → `invalid`.
4. **Drop.** `drop(kit)` at a node whose open call needs that kit: kit consumed, need removed from the call,
   event `kit_matched` (+3). If the call does not need it: event `kit_wasted` (−2), kit still consumed. No kit
   left or no call → `invalid`.
5. **Unload.** A boat at the camp, the hospital or a shelter with passengers unloads all: each person `saved`
   (+10), each child or elderly/sick `priority_saved` (+5), and at the hospital `hospital_bonus` (+5) for each
   passenger who needed it (elderly/sick, or anyone from a medical call). Kits refill to 1 each at the camp only.
6. **Water.** If the round just finished is in `riseAfterRounds`, `waterLevel++` (event `water_rose`). Every
   house with `height <= waterLevel` and an open call: if not yet flooded, set `roofRounds = 3` (event
   `flooded`); else `roofRounds--`; at 0 all `remaining` people are `lost` (−15 each), call `lost`.
7. **New calls** for the next round from the scenario (fixed list) or from the generator (seeded `rng`).
8. `round++`. If `round > rounds` the game ends: each passenger still aboard → `saved_late` (+5).

Every step emits an event `{ type, boatId?, callId?, nodeId?, count?, points }`. The score is the sum of event
points. Events are what the big screen animates and what the phone uses for "you saved 3".

## 5. Works Anyway: dead zones and the outbox

### 5.1 Order queue semantics
- The phone numbers its orders `seq = 1, 2, 3 …` per game and gives each a UUID `id`.
- The hub keeps, per boat, a queue of **unapplied** orders sorted by `seq`. Resolution consumes the head.
- Same `id` again → `duplicate` (retry after a timeout: harmless). Same `seq` with a new `id` while that `seq`
  is unapplied → `replaced` (the player changed their mind). A `seq` already applied → `late` (ignored).
- So: online, one order per round, replaceable until the deadline. Offline, the player can line up several
  orders ("move to the school, then rescue, then return"); they play out one per round after reconnecting.

### 5.2 On the phone, out of contact
- The phone keeps the last `GameView` it received plus `receivedAt`. It estimates the current round from the
  hub clock offset and `deadlineAt`, and shows "Round ~6 · estimated · no signal".
- It still shows the map, the boat and the calls as last known, greyed, with "last update 1 min ago".
- Orders go to the `gameOutbox` store with the same backoff rules as reports (1 → 30 s, reset on reconnect).
- A standing order is sent immediately when in contact; when not, it is queued like any order but applies
  the moment it arrives (it is not a turn).

### 5.3 On the hub, while a boat is out of contact
- The boat follows its standing order each round (`hold` or `return`).
- The big screen shows the boat dimmed with "out of contact since round N" and a dotted "last heard" line.
- When orders arrive, results come back per order (`queued`/`replaced`/`duplicate`/`late`) and the phone marks
  them, exactly like report outcomes. Nothing is ever applied twice (unique `id`).

### 5.4 In the demo
Round 3: "Boat 2, you are entering the bend." That player switches on airplane mode. They keep issuing orders,
the phone shows them queued. Rounds 4 and 5 resolve with Boat 2 on standing order. Airplane mode off: two
queued orders arrive, apply to rounds 6 and 7 in sequence, the hub log shows two `queued` and zero duplicates.
Alternative without touching a phone: the host turns the laptop hotspot off for one round ("tower down");
every phone goes to its outbox and comes back together.

## 6. Scoring and the end screen

| Event | Points |
|---|---|
| person saved at camp/hospital | +10 |
| child or elderly/sick saved (per person) | +5 |
| elderly/sick unloaded at the hospital (per person) | +5 |
| kit matched to a need | +3 |
| kit wasted | −2 |
| person lost to the water | −15 |
| person still aboard at first light | +5 |

Team score only (co-op). Stars: the bot-only simulation (G1) sets the thresholds: 1★ = bot score,
2★ = bot × 1.3, 3★ = bot × 1.6, re-tuned after playtests. Measured in G1 on Thuruthu (`npm run sim`): three bots
score 170 (23 of 34 saved, 8 lost), four 238, five 343, so `starBase = 170` and a well-run five-boat night is 3★.

End screen shows three numbers, each with one real line from 2018:
- **Saved N of M** — "In 2018, fishermen's boats from the coast saved more people than any agency."
- **Children and elderly first: X%** — "Call-centre volunteers triaged every call before passing it on."
- **Rounds out of contact: Y** — "Networks faltered; WhatsApp groups became the control room."

## 7. Host controls (laptop, coordinator session)
`New game` (scenario, round length 30/45/60 s, bots on/off), `Start` (from the lobby), `Skip round` (resolve
now), `Pause`, `End`. The big screen is `/screen.html`; the host controls are a small bar on it.

## 8. Edge cases (each is a test in G1)
- Boat orders `move` to a non-adjacent node → `invalid`, holds.
- Two boats rescue at the same call in one round → first in `boats` order takes people first; the second takes
  what remains.
- A call at the temple/school never floods; `roofRounds` never set.
- Round ends with a boat mid-`return` → it keeps going next round without a new order.
- `standing` order arriving during resolution applies from the next round.
- Order for `seq` 3 arrives before `seq` 2 → queue is sorted; 2 applies first when it arrives, 3 waits.
- Late orders after the game ended → `ended`.
- A phone that joins mid-game gets a boat at the jetty from the next round.
- 1 phone + bots must produce a playable game; 0 phones + bots must produce a watchable demo loop.

## 9. Out of scope (stretch, after G6)
Multiple wards, player-vs-player, voice orders, a real GPS mode for a field drill, persistent accounts.
