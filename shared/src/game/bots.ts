// Bot crew: deliver when full or when nothing is worth the detour, rescue or drop where it stands, otherwise head
// for the best call by urgency over distance, avoiding calls other boats already cover. Deterministic (ties by
// call id), so a bot-only game replays exactly.
import { GAME, type Boat, type Call, type GameState, type Order } from './contract.js';
import type { Ward } from './scenario.js';
import { callUrgency } from './urgency.js';

/** Seats other boats will fill at this call before (or alongside) `boat`: boats earlier in join order act first. */
function seatsClaimed(state: GameState, call: Call, boat: Boat): number {
  const me = state.boats.findIndex((b) => b.id === boat.id);
  let seats = 0;
  state.boats.forEach((b, i) => {
    if (b.id === boat.id || b.nodeId !== call.nodeId) return;
    const space = GAME.capacity - b.passengers.length;
    if (space <= 0) return;
    const head = state.queues[b.id]?.[0]?.order;
    const willRescue = b.bot ? i < me : head?.type === 'rescue';
    if (willRescue) seats += space;
  });
  return seats;
}

/**
 * People left for `boat` at `call` once the boats that would get there first have taken theirs: any boat with
 * room that is closer, or as close and earlier in join order, and not already heading home.
 */
function peopleFor(state: GameState, ward: Ward, call: Call, boat: Boat): number {
  const me = state.boats.findIndex((b) => b.id === boat.id);
  const mine = ward.distance(boat.nodeId, call.nodeId);
  let left = call.remaining;
  state.boats.forEach((b, i) => {
    if (b.id === boat.id || b.plan === 'return') return;
    const space = GAME.capacity - b.passengers.length;
    if (space <= 0 || b.passengers.length >= 3) return;
    const d = ward.distance(b.nodeId, call.nodeId);
    if (d < mine || (d === mine && i < me)) left -= space;
  });
  return left;
}

export function botOrder(state: GameState, ward: Ward, boat: Boat): Order {
  const open = state.calls.filter((c) => c.status === 'open' && c.remaining > 0);
  const here = state.calls.find((c) => c.status === 'open' && c.nodeId === boat.nodeId);
  const space = GAME.capacity - boat.passengers.length;
  const aboard = boat.passengers.length;

  // Where it stands: rescue what is left for it, or drop a kit the call needs that no earlier boat will drop.
  if (here && space > 0 && here.remaining - seatsClaimed(state, here, boat) > 0) return { type: 'rescue' };
  if (here) {
    const me = state.boats.findIndex((b) => b.id === boat.id);
    const earlier = state.boats.slice(0, me).filter((b) => b.bot && b.nodeId === here.nodeId);
    const kit = here.kitsNeeded.find((k) => boat.kits[k] > 0 && !earlier.some((b) => b.kits[k] > 0));
    if (kit) return { type: 'drop', kit };
  }

  // Best call worth going to: urgency over distance, preferring calls with people still left for this boat;
  // when every call is covered by boats arriving first, head for the best one anyway rather than idle.
  type Pick = { nodeId: string; value: number; id: string; d: number };
  let bestFree: Pick | null = null;
  let bestAny: Pick | null = null;
  const better = (a: Pick, b: Pick | null) => !b || a.value > b.value || (a.value === b.value && a.id < b.id);
  for (const c of open) {
    if (c.nodeId === boat.nodeId) continue;
    const d = ward.distance(boat.nodeId, c.nodeId);
    if (!Number.isFinite(d)) continue;
    const pick: Pick = { nodeId: c.nodeId, value: callUrgency(c, state.round).score / (1 + d), id: c.id, d };
    if (better(pick, bestAny)) bestAny = pick;
    if (peopleFor(state, ward, c, boat) > 0 && better(pick, bestFree)) bestFree = pick;
  }
  const best = bestFree ?? bestAny;

  // With people aboard, deliver unless a worthwhile call is next door; a full boat always delivers.
  const home = ward.distance(boat.nodeId, ward.nearestUnload(boat.nodeId, boat.passengers.some((p) => p.hospital)) ?? boat.nodeId);
  const roundsLeft = ward.scenario.rounds - state.round + 1;
  if (aboard > 0 && (space === 0 || !best || best.d > 1 || aboard >= 3 || roundsLeft <= home + 1)) return { type: 'return' };
  if (best && space > 0) {
    const next = ward.shortestPath(boat.nodeId, best.nodeId)?.[0];
    if (next) return { type: 'move', nodeId: next };
  }
  return aboard > 0 ? { type: 'return' } : { type: 'hold' };
}
