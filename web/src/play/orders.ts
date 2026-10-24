// What a crew may order from where it stands (pure, from the view only), plus the ward and node names for the phone.
import { GAME, KITS, Ward, parseScenario, thuruthu, type Boat, type GameView, type Kit, type Order, type ScenarioNode } from '@pralayam/shared';

export const ward = new Ward(parseScenario(thuruthu));
export const NODES: Record<string, ScenarioNode> = Object.fromEntries(thuruthu.nodes.map((n) => [n.id, n]));
export const nodeName = (id: string, lang: 'en' | 'ml' = 'en') => (lang === 'ml' ? NODES[id]?.nameMl : NODES[id]?.name) ?? '?';

export type OptionKind = 'move' | 'rescue' | 'drop' | 'return' | 'hold';

export interface OrderOption {
  kind: OptionKind;
  order: Order;
  /** Where it leads (move) or where it happens. */
  nodeId: string;
  kit?: Kit;
  /** People waiting at the target, and whether it needs a kit this boat carries. */
  people: number;
  score: number;
  band: 'red' | 'orange' | 'yellow' | null;
  deadZone: boolean;
  /** For drop: the call there asked for this kit. */
  needed?: boolean;
  /** For return: steps to the nearest safe place. */
  steps?: number;
}

export function myBoat(view: GameView | null, deviceId: string | undefined): Boat | null {
  return (deviceId && view?.boats.find((b) => b.id === deviceId)) || null;
}

/** Legal orders for `boat` in `view`, in the order the screen lists them: moves, rescue, drops, return, hold. */
export function legalOrders(view: GameView, boat: Boat): OrderOption[] {
  const out: OrderOption[] = [];
  const callAt = (nodeId: string) => view.calls.find((c) => c.status === 'open' && c.nodeId === nodeId);
  const info = (nodeId: string) => {
    const c = callAt(nodeId);
    const u = c ? view.urgency[c.id] : undefined;
    return { people: c?.remaining ?? 0, score: u?.score ?? 0, band: u?.band ?? null, deadZone: !(NODES[nodeId]?.signal ?? true) };
  };
  const space = GAME.capacity - boat.passengers.length;

  for (const n of ward.neighbours(boat.nodeId)) out.push({ kind: 'move', order: { type: 'move', nodeId: n }, nodeId: n, ...info(n) });
  // most urgent first, then by name, so the top row is the obvious one
  out.sort((a, b) => b.score - a.score || nodeName(a.nodeId).localeCompare(nodeName(b.nodeId)));

  const here = callAt(boat.nodeId);
  if (here && here.remaining > 0 && space > 0) out.push({ kind: 'rescue', order: { type: 'rescue' }, nodeId: boat.nodeId, ...info(boat.nodeId) });
  if (here) {
    for (const kit of KITS) {
      if (boat.kits[kit] > 0) out.push({ kind: 'drop', order: { type: 'drop', kit }, kit, nodeId: boat.nodeId, needed: here.kitsNeeded.includes(kit), ...info(boat.nodeId) });
    }
  }
  const home = ward.nearestUnload(boat.nodeId, boat.passengers.some((p) => p.hospital));
  if (home && home !== boat.nodeId) {
    out.push({ kind: 'return', order: { type: 'return' }, nodeId: home, steps: ward.distance(boat.nodeId, home), ...info(home) });
  }
  out.push({ kind: 'hold', order: { type: 'hold' }, nodeId: boat.nodeId, ...info(boat.nodeId) });
  return out;
}

export interface Suggestion {
  kind: 'call' | 'return';
  nodeId: string;
  path: string[];
  people: number;
  priority: boolean;
  band: 'red' | 'orange' | 'yellow' | null;
}

/**
 * What the radio would tell this crew: the most urgent call it can reach before anyone else, or home when the
 * boat is full (or nothing is left to do). Same instincts as the bots, so a new player is never worse than one.
 */
export function suggest(view: GameView, boat: Boat): Suggestion | null {
  const space = GAME.capacity - boat.passengers.length;
  const open = view.calls.filter((c) => c.status === 'open' && c.remaining > 0 && c.nodeId !== boat.nodeId);
  const mine = (c: (typeof open)[number]) => ward.distance(boat.nodeId, c.nodeId);
  const home = ward.nearestUnload(boat.nodeId, boat.passengers.some((p) => p.hospital));
  const goHome = (): Suggestion | null => (home && home !== boat.nodeId ? { kind: 'return', nodeId: home, path: ward.shortestPath(boat.nodeId, home) ?? [], people: 0, priority: false, band: null } : null);
  if (boat.passengers.length > 0 && (space === 0 || open.length === 0)) return goHome();
  let best: { c: (typeof open)[number]; value: number } | null = null;
  for (const c of open) {
    const d = mine(c);
    if (!Number.isFinite(d)) continue;
    // someone else with room is already closer: let them have it
    const taken = view.boats.some((b) => b.id !== boat.id && b.passengers.length < GAME.capacity && ward.distance(b.nodeId, c.nodeId) < d);
    if (taken) continue;
    const value = (view.urgency[c.id]?.score ?? 0) / (1 + d);
    if (!best || value > best.value || (value === best.value && c.id < best.c.id)) best = { c, value };
  }
  if (!best) {
    // everything is covered: still name the most urgent one, or go home with what is aboard
    const fallback = open.map((c) => ({ c, value: (view.urgency[c.id]?.score ?? 0) / (1 + mine(c)) })).sort((a, b) => b.value - a.value)[0];
    if (!fallback) return goHome();
    best = fallback;
  }
  if (boat.passengers.length >= 3 && best.c.remaining <= 1 && mine(best.c) > 1) return goHome();
  const u = view.urgency[best.c.id];
  return { kind: 'call', nodeId: best.c.nodeId, path: ward.shortestPath(boat.nodeId, best.c.nodeId) ?? [], people: best.c.remaining, priority: best.c.hasChildren || best.c.hasElderlyOrSick, band: u?.band ?? null };
}

/** The moves that take the boat from where it stands to `to`, one per round. */
export function routeOrders(from: string, to: string): Order[] {
  return (ward.shortestPath(from, to) ?? []).map((nodeId) => ({ type: 'move', nodeId }));
}

/** Rounds since the last view, by the hub clock: what round it probably is while out of contact. */
export function estimatedRound(view: GameView, hubNow: number): number {
  if (view.phase !== 'playing' || view.deadlineAt === null) return view.round;
  if (hubNow <= view.deadlineAt) return view.round;
  const extra = 1 + Math.floor((hubNow - view.deadlineAt) / (view.roundSeconds * 1000));
  return Math.min(thuruthu.rounds, view.round + extra);
}
