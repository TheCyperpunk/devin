// resolveRound: the one pure function that plays a round, in the exact step order of GAME-DESIGN section 4.
// Boats act in join order, so the outcome never depends on network timing. Returns the new state and the events.
import { NEED_TYPES } from '../contract.js';
import { botOrder } from './bots.js';
import { GAME, type Boat, type Call, type GameEvent, type GameState, type Kit, type Order, type Scenario } from './contract.js';
import { rngInt, rngPick } from './rng.js';
import type { Ward } from './scenario.js';
import { callFromScenario, starsFor } from './state.js';

export interface Resolved {
  state: GameState;
  events: GameEvent[];
}

export function resolveRound(input: GameState, ward: Ward, now: number): Resolved {
  if (input.phase !== 'playing' && input.phase !== 'resolving' && input.phase !== 'paused') return { state: input, events: [] };
  const scn = ward.scenario;
  const s: GameState = structuredClone(input);
  const events: GameEvent[] = [];
  const emit = (e: GameEvent) => events.push(e);
  const finished = s.round;

  // 1. pick each boat's acting order
  const acting = new Map<string, Order>();
  for (const b of s.boats) {
    const queue = s.queues[b.id] ?? [];
    const head = queue[0];
    if (head) {
      queue.shift();
      s.applied[b.id] = Math.max(s.applied[b.id] ?? 0, head.seq);
      s.recent[b.id] = [...(s.recent[b.id] ?? []), head.id].slice(-100);
      acting.set(b.id, head.order);
    } else if (b.bot) {
      acting.set(b.id, botOrder(s, ward, b));
    } else if (b.plan === 'return') {
      acting.set(b.id, { type: 'return' });
    } else {
      acting.set(b.id, { type: b.standingOrder });
      emit({ type: 'standing_used', boatId: b.id, points: 0 });
    }
  }

  // 2-5. act, boat by boat
  for (const b of s.boats) {
    const order = acting.get(b.id) ?? { type: 'hold' };
    act(s, ward, b, order, emit);
    unload(s, ward, b, emit);
  }

  // 6. water
  if (scn.riseAfterRounds.includes(finished)) {
    s.waterLevel++;
    emit({ type: 'water_rose', count: s.waterLevel, points: 0 });
  }
  for (const c of s.calls) {
    if (c.status !== 'open') continue;
    const node = ward.node(c.nodeId);
    if (!node || !ward.canFlood(c.nodeId) || node.height > s.waterLevel) continue;
    if (c.roofRounds === null) {
      c.roofRounds = GAME.roofRounds;
      emit({ type: 'flooded', callId: c.id, nodeId: c.nodeId, count: c.remaining, points: 0 });
    } else {
      c.roofRounds--;
      if (c.roofRounds <= 0 && c.remaining > 0) {
        emit({ type: 'lost', callId: c.id, nodeId: c.nodeId, count: c.remaining, points: GAME.points.lost * c.remaining });
        c.remaining = 0;
        c.priorityLeft = 0;
        c.status = 'lost';
      } else if (c.remaining === 0) {
        c.status = 'served';
      }
    }
  }

  // 7. new calls for the next round
  const next = finished + 1;
  if (next <= scn.rounds) openCalls(s, ward, next, emit);

  // 8. advance
  for (const e of events) s.score += e.points;
  s.round = next;
  if (next > scn.rounds) {
    for (const b of s.boats) {
      if (b.passengers.length === 0) continue;
      emit({ type: 'saved_late', boatId: b.id, count: b.passengers.length, points: GAME.points.savedLate * b.passengers.length });
      s.score += GAME.points.savedLate * b.passengers.length;
      b.saved += b.passengers.length;
      b.passengers = [];
    }
    s.phase = 'ended';
    s.deadlineAt = null;
    s.round = scn.rounds;
  } else {
    s.phase = 'playing';
    s.deadlineAt = now + s.roundSeconds * 1000;
  }
  s.stars = starsFor(s.score, s.starBase);
  s.history.push({ round: finished, events, scoreAfter: s.score, waterLevel: s.waterLevel });
  return { state: s, events };
}

function act(s: GameState, ward: Ward, b: Boat, order: Order, emit: (e: GameEvent) => void): void {
  const from = b.nodeId;
  switch (order.type) {
    case 'hold':
      b.plan = null;
      return;
    case 'standing':
      b.standingOrder = order.mode;
      return;
    case 'move':
      b.plan = null;
      if (!ward.isAdjacent(from, order.nodeId)) return void emit({ type: 'invalid', boatId: b.id, nodeId: order.nodeId, points: 0 });
      b.nodeId = order.nodeId;
      emit({ type: 'moved', boatId: b.id, fromNodeId: from, nodeId: b.nodeId, points: 0 });
      load(s, b, emit); // people climb aboard as the boat arrives
      return;
    case 'return': {
      b.plan = 'return';
      const target = ward.nearestUnload(from, b.passengers.some((p) => p.hospital));
      if (target === null) return void emit({ type: 'invalid', boatId: b.id, points: 0 });
      if (target === from) return;
      const step = ward.shortestPath(from, target)?.[0];
      if (!step) return void emit({ type: 'invalid', boatId: b.id, points: 0 });
      b.nodeId = step;
      emit({ type: 'moved', boatId: b.id, fromNodeId: from, nodeId: step, points: 0 });
      return;
    }
    case 'rescue': {
      b.plan = null;
      if (!load(s, b, emit)) emit({ type: 'invalid', boatId: b.id, nodeId: from, points: 0 });
      return;
    }
    case 'drop': {
      b.plan = null;
      const call = openCallAt(s, from);
      if (!call || b.kits[order.kit] <= 0) return void emit({ type: 'invalid', boatId: b.id, nodeId: from, points: 0 });
      b.kits[order.kit]--;
      const idx = call.kitsNeeded.indexOf(order.kit);
      if (idx >= 0) {
        call.kitsNeeded.splice(idx, 1);
        emit({ type: 'kit_matched', boatId: b.id, callId: call.id, nodeId: from, points: GAME.points.kitMatched });
        if (call.remaining === 0 && call.kitsNeeded.length === 0) {
          call.status = 'served';
          emit({ type: 'served', callId: call.id, nodeId: from, points: 0 });
        }
      } else {
        emit({ type: 'kit_wasted', boatId: b.id, callId: call.id, nodeId: from, points: GAME.points.kitWasted });
      }
      return;
    }
  }
}

/** Take people from the open call where the boat stands, priority seats first. False when there was nobody / no room. */
function load(s: GameState, b: Boat, emit: (e: GameEvent) => void): boolean {
  const call = openCallAt(s, b.nodeId);
  const space = GAME.capacity - b.passengers.length;
  if (!call || call.remaining <= 0 || space <= 0) return false;
  const take = Math.min(space, call.remaining);
  const medical = call.needs.includes('medical');
  for (let i = 0; i < take; i++) {
    const priority = call.priorityLeft > 0;
    if (priority) call.priorityLeft--;
    // Hospital: anyone from a medical call, or the elderly/sick themselves (the priority seats of such a call).
    b.passengers.push({ callId: call.id, priority, hospital: medical || (call.hasElderlyOrSick && priority) });
  }
  call.remaining -= take;
  emit({ type: 'rescued', boatId: b.id, callId: call.id, nodeId: b.nodeId, count: take, points: 0 });
  if (call.remaining === 0 && call.kitsNeeded.length === 0) {
    call.status = 'served';
    emit({ type: 'served', callId: call.id, nodeId: b.nodeId, points: 0 });
  }
  return true;
}

/** At the camp, the hospital or a shelter: everyone aboard is safe. Hospital bonus only there; kits only at the camp. */
function unload(s: GameState, ward: Ward, b: Boat, emit: (e: GameEvent) => void): void {
  const node = ward.node(b.nodeId);
  if (!node || !ward.unloadNodes.includes(b.nodeId)) return;
  if (b.passengers.length > 0) {
    const n = b.passengers.length;
    const priority = b.passengers.filter((p) => p.priority).length;
    const hospital = node.kind === 'hospital' ? b.passengers.filter((p) => p.hospital).length : 0;
    emit({ type: 'saved', boatId: b.id, nodeId: b.nodeId, count: n, points: GAME.points.saved * n });
    if (priority) emit({ type: 'priority_saved', boatId: b.id, nodeId: b.nodeId, count: priority, points: GAME.points.prioritySaved * priority });
    if (hospital) emit({ type: 'hospital_bonus', boatId: b.id, nodeId: b.nodeId, count: hospital, points: GAME.points.hospitalBonus * hospital });
    b.saved += n;
    b.passengers = [];
    b.plan = null;
  }
  if (node.kind === 'camp') {
    let refilled = 0;
    for (const k of Object.keys(b.kits) as Kit[]) {
      if (b.kits[k] < GAME.kitsPerBoat) {
        refilled += GAME.kitsPerBoat - b.kits[k];
        b.kits[k] = GAME.kitsPerBoat;
      }
    }
    if (refilled) emit({ type: 'refilled', boatId: b.id, nodeId: b.nodeId, count: refilled, points: 0 });
  }
}

function openCallAt(s: GameState, nodeId: string): Call | undefined {
  return s.calls.find((c) => c.status === 'open' && c.nodeId === nodeId);
}

function openCalls(s: GameState, ward: Ward, round: number, emit: (e: GameEvent) => void): void {
  const scn: Scenario = ward.scenario;
  let i = 0;
  const add = (c: Call) => {
    s.calls.push(c);
    emit({ type: 'call_opened', callId: c.id, nodeId: c.nodeId, count: c.peopleCount, points: 0 });
  };
  for (const c of scn.calls) if (c.round === round) add(callFromScenario(c, `call-${round}-${++i}`, round));
  if (!scn.generator) return;
  const count = rngInt(s.rng, scn.generator.perRound[0], scn.generator.perRound[1]);
  s.rng = count.state;
  const busy = new Set(s.calls.filter((c) => c.status === 'open').map((c) => c.nodeId));
  const candidates = scn.nodes.filter((n) => ward.canFlood(n.id) && !busy.has(n.id)).map((n) => n.id);
  for (let k = 0; k < count.value; k++) {
    const node = rngPick(s.rng, candidates);
    s.rng = node.state;
    if (!node.value) break;
    busy.add(node.value);
    candidates.splice(candidates.indexOf(node.value), 1);
    const people = rngInt(s.rng, 1, 5);
    const need = rngPick(people.state, NEED_TYPES);
    const flags = rngInt(need.state, 0, 7);
    s.rng = flags.state;
    add(
      callFromScenario(
        {
          round,
          nodeId: node.value,
          needs: need.value ? [need.value] : ['rescue'],
          peopleCount: people.value,
          hasChildren: (flags.value & 1) !== 0,
          hasElderlyOrSick: (flags.value & 2) !== 0,
          urgent: (flags.value & 4) !== 0,
        },
        `call-${round}-${++i}`,
        round,
      ),
    );
  }
}
