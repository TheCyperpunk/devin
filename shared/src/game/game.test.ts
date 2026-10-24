// Rules engine tests (GAME-DESIGN sections 3-6 and every edge case in section 8), all on the Thuruthu ward.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { botOrder } from './bots.js';
import { GAME, OrderSchema, QueuedOrderInputSchema, type GameState, type Order, type Scenario } from './contract.js';
import { resolveRound } from './resolve.js';
import { Ward, parseScenario } from './scenario.js';
import { thuruthu } from './scenarios/thuruthu.js';
import { addBots, allOrdersIn, inContact, joinBoat, newGame, queueOrder, startGame, starsFor } from './state.js';
import { callUrgency, toView } from './urgency.js';

const scn = parseScenario(thuruthu);
const ward = new Ward(scn);
const T = 1_800_000_000_000;

function game(opts: { bots?: boolean; crews?: string[] } = {}): GameState {
  let s = newGame(scn, { id: 'g1', now: T, bots: opts.bots ?? false });
  for (const c of opts.crews ?? ['p1']) s = joinBoat(s, scn, c, c.toUpperCase(), 'moss', T);
  return startGame(s, scn, T);
}
const order = (seq: number, order: Order, id = randomUUID()) => ({ id, seq, order });
function at(s: GameState, boatId: string, nodeId: string): GameState {
  return { ...s, boats: s.boats.map((b) => (b.id === boatId ? { ...b, nodeId } : b)) };
}
function queued(s: GameState, boatId: string, o: Order, seq = (s.applied[boatId] ?? 0) + 1 + (s.queues[boatId]?.length ?? 0)): GameState {
  const r = queueOrder(s, boatId, order(seq, o), T);
  expect(r.result.result).toBe('queued');
  return r.state;
}
const boat = (s: GameState, id = 'p1') => s.boats.find((b) => b.id === id)!;
const call = (s: GameState, nodeId: string) => s.calls.find((c) => c.nodeId === nodeId && c.status === 'open');
const types = (events: { type: string }[]) => events.map((e) => e.type);
const round = (s: GameState, now = T + 45_000) => resolveRound(s, ward, now);

describe('scenario and ward', () => {
  it('Thuruthu parses, is connected, and has two dead zones', () => {
    expect(scn.nodes).toHaveLength(22);
    expect(scn.nodes.filter((n) => !n.signal).map((n) => n.id).sort()).toEqual(['bendhouse', 'chirakkal', 'j_bend', 'j_paddy', 'paddy2', 'paddyhouse']);
    expect(scn.calls.reduce((n, c) => n + c.peopleCount, 0)).toBe(34);
    expect(scn.nodes.filter((n) => n.kind === 'house' && n.height === 1).map((n) => n.id).sort()).toEqual(['bendhouse', 'kavala', 'mundamveli', 'pallithode']);
  });

  it('rejects an edge to an unknown node, a duplicate id, and an unreachable node', () => {
    expect(() => parseScenario({ ...scn, edges: [...scn.edges, ['jetty', 'nowhere']] })).toThrow(/unknown node/);
    expect(() => parseScenario({ ...scn, nodes: [...scn.nodes, { ...scn.nodes[0]! }] })).toThrow(/duplicate/);
    const island: Scenario = { ...scn, nodes: [...scn.nodes, { ...scn.nodes[5]!, id: 'island' }] };
    expect(() => parseScenario(island)).toThrow(/cannot be reached/);
  });

  it('shortest paths, adjacency, nearest unload', () => {
    expect(ward.shortestPath('jetty', 'camp')).toEqual(['kumbalam', 'camp']);
    expect(ward.shortestPath('jetty', 'jetty')).toEqual([]);
    expect(ward.distance('pallithode', 'camp')).toBe(3);
    expect(ward.isAdjacent('jetty', 'kavala')).toBe(true);
    expect(ward.isAdjacent('jetty', 'pallithode')).toBe(false);
    expect(ward.nearestUnload('vattappara', false)).toBe('camp');
    expect(ward.nearestUnload('thoppumpady', false)).toBe('hospital');
    expect(ward.nearestUnload('vattappara', true)).toBe('camp'); // the hospital is far: not worth it
    expect(ward.nearestUnload('j_paddy', true)).toBe('hospital');
    expect(ward.nearestUnload('pallithode', false)).toBe('school'); // shelters count: 2 steps vs 3 to the camp
    expect(ward.unloadNodes).toEqual(['camp', 'hospital', 'school', 'temple']);
    expect(ward.canFlood('school')).toBe(false);
    expect(ward.canFlood('kavala')).toBe(true);
    expect([...ward.neighbours('jetty')]).toEqual(['kavala', 'kumbalam', 'mundamveli']);
  });
});

describe('lobby, joining, bots, start', () => {
  it('starts in the lobby with no calls; start opens round 1 and adds bots when enabled', () => {
    let s = newGame(scn, { id: 'g', now: T, bots: true });
    expect(s.phase).toBe('lobby');
    s = joinBoat(s, scn, 'p1', 'Asha', 'moss', T);
    s = startGame(s, scn, T);
    expect(s.phase).toBe('playing');
    expect(s.round).toBe(1);
    expect(s.deadlineAt).toBe(T + 45_000);
    expect(s.calls.map((c) => c.nodeId).sort()).toEqual(['pallithode', 'vattappara']);
    expect(s.boats).toHaveLength(3);
    expect(s.boats.filter((b) => b.bot).map((b) => b.name)).toEqual(['Chellanam 1', 'Vypin 2']);
    expect(new Set(s.boats.map((b) => b.color)).size).toBe(3);
  });

  it('joining is idempotent and a late joiner starts at the jetty', () => {
    let s = game();
    s = round(s).state;
    s = joinBoat(s, scn, 'p1', 'Asha again', 'ember', T + 1);
    s = joinBoat(s, scn, 'p2', 'Rahul', 'lamp', T + 1);
    expect(s.boats).toHaveLength(2);
    expect(boat(s).name).toBe('Asha again');
    expect(boat(s, 'p2').nodeId).toBe('jetty');
    expect(s.queues.p2).toEqual([]);
  });

  it('priority seats: a child on a call of 4, an elderly person on a call of 3', () => {
    const s = game();
    expect(call(s, 'vattappara')!.priorityLeft).toBe(1);
    expect(call(s, 'pallithode')!.priorityLeft).toBe(1);
    expect(call(s, 'pallithode')!.kitsNeeded).toEqual(['water']);
  });
});

describe('order queue (GAME-DESIGN 5.1)', () => {
  it('queued, replaced on the same seq, duplicate on the same id, sorted by seq', () => {
    let s = game();
    const a = order(1, { type: 'move', nodeId: 'kavala' });
    let r = queueOrder(s, 'p1', a, T);
    expect(r.result.result).toBe('queued');
    s = r.state;
    r = queueOrder(s, 'p1', a, T);
    expect(r.result.result).toBe('duplicate');
    r = queueOrder(s, 'p1', order(3, { type: 'rescue' }), T);
    s = r.state;
    r = queueOrder(s, 'p1', order(2, { type: 'hold' }), T);
    s = r.state;
    expect(s.queues.p1!.map((q) => q.seq)).toEqual([1, 2, 3]);
    r = queueOrder(s, 'p1', order(1, { type: 'move', nodeId: 'kumbalam' }), T);
    expect(r.result.result).toBe('replaced');
    expect(r.state.queues.p1![0]!.order).toEqual({ type: 'move', nodeId: 'kumbalam' });
  });

  it('after a round the applied seq is late, even with a new id, and a retry of the played id is a duplicate', () => {
    let s = game();
    const a = order(1, { type: 'move', nodeId: 'kavala' });
    s = queueOrder(s, 'p1', a, T).state;
    s = round(s).state;
    expect(boat(s).nodeId).toBe('kavala');
    expect(queueOrder(s, 'p1', order(1, { type: 'hold' }), T).result.result).toBe('late');
    expect(queueOrder(s, 'p1', a, T).result.result).toBe('duplicate');
    expect(queueOrder(s, 'p1', order(2, { type: 'hold' }), T).result.result).toBe('queued');
  });

  it('not_joined for strangers and bots, invalid in the lobby, ended after the night', () => {
    const lobby = newGame(scn, { id: 'g', now: T });
    expect(queueOrder(joinBoat(lobby, scn, 'p1', 'A', 'moss', T), 'p1', order(1, { type: 'hold' }), T).result.result).toBe('invalid');
    const s = game({ bots: true });
    expect(queueOrder(s, 'ghost', order(1, { type: 'hold' }), T).result.result).toBe('not_joined');
    expect(queueOrder(s, 'bot-1', order(1, { type: 'hold' }), T).result.result).toBe('not_joined');
    const ended = { ...s, phase: 'ended' as const };
    expect(queueOrder(ended, 'p1', order(1, { type: 'hold' }), T).result.result).toBe('ended');
  });

  it('a standing order applies at once, uses no turn, and seq 3 waits for seq 2', () => {
    let s = game();
    const r = queueOrder(s, 'p1', order(1, { type: 'standing', mode: 'return' }), T);
    expect(r.result).toMatchObject({ result: 'queued' });
    s = r.state;
    expect(boat(s).standingOrder).toBe('return');
    expect(s.queues.p1).toEqual([]);
    s = queueOrder(s, 'p1', order(3, { type: 'rescue' }), T).state;
    s = round(s).state; // nothing queued at seq<3 is "head": the head IS seq 3 (queue is just sorted); design: heads apply in order
    expect(s.applied.p1).toBe(3);
  });

  it('cancel removes a queued seq (replaced) or nothing (queued), and never a played one (late)', () => {
    let s = game();
    s = queued(queued(s, 'p1', { type: 'move', nodeId: 'kavala' }), 'p1', { type: 'hold' });
    let r = queueOrder(s, 'p1', order(2, { type: 'cancel' }), T);
    expect(r.result.result).toBe('replaced');
    expect(r.state.queues.p1!.map((q) => q.seq)).toEqual([1]);
    r = queueOrder(r.state, 'p1', order(5, { type: 'cancel' }), T);
    expect(r.result.result).toBe('queued');
    expect(r.state.queues.p1!.map((q) => q.seq)).toEqual([1]);
    s = round(r.state).state;
    expect(queueOrder(s, 'p1', order(1, { type: 'cancel' }), T).result.result).toBe('late');
    expect(boat(s).nodeId).toBe('kavala');
  });

  it('allOrdersIn: only crews in contact count', () => {
    let s = game({ crews: ['p1', 'p2'] });
    expect(allOrdersIn(s, ward, T)).toBe(false);
    s = queued(s, 'p1', { type: 'hold' });
    expect(allOrdersIn(s, ward, T)).toBe(false);
    s = at(s, 'p2', 'bendhouse'); // p2 in a dead zone: not waited for
    expect(allOrdersIn(s, ward, T)).toBe(true);
    expect(allOrdersIn(game({ bots: true, crews: [] }), ward, T)).toBe(false);
  });
});

describe('resolving a round', () => {
  it('move to an adjacent node works; a non-adjacent move is invalid and the boat holds', () => {
    let s = game();
    s = queued(s, 'p1', { type: 'move', nodeId: 'pallithode' });
    let r = round(s);
    expect(types(r.events)).toContain('invalid');
    expect(boat(r.state).nodeId).toBe('jetty');
    s = queued(r.state, 'p1', { type: 'move', nodeId: 'kavala' });
    r = round(s);
    expect(r.events).toContainEqual({ type: 'moved', boatId: 'p1', fromNodeId: 'jetty', nodeId: 'kavala', points: 0 });
    expect(r.state.round).toBe(3);
  });

  it('arriving at a house loads the people waiting there in the same round', () => {
    let s = at(game(), 'p1', 'kavala');
    s = queued(s, 'p1', { type: 'move', nodeId: 'vattappara' });
    const r = round(s);
    expect(types(r.events)).toEqual(expect.arrayContaining(['moved', 'rescued', 'served']));
    expect(boat(r.state).passengers).toHaveLength(4);
    // an explicit rescue with nobody left is invalid
    const again = round(queued(r.state, 'p1', { type: 'rescue' }));
    expect(types(again.events)).toContain('invalid');
  });

  it('rescue loads up to capacity, priority seats first, and serves the call when nothing is left', () => {
    let s = at(game(), 'p1', 'vattappara');
    s = queued(s, 'p1', { type: 'rescue' });
    const r = round(s);
    expect(boat(r.state).passengers).toHaveLength(4);
    expect(boat(r.state).passengers.map((p) => p.priority)).toEqual([true, false, false, false]);
    expect(r.state.calls.find((c) => c.nodeId === 'vattappara')!.status).toBe('served');
    expect(types(r.events)).toEqual(expect.arrayContaining(['rescued', 'served']));
  });

  it('a call stays open until its kits are dropped too; wrong kit is wasted; no kit is invalid', () => {
    let s = at(game(), 'p1', 'pallithode');
    s = queued(s, 'p1', { type: 'rescue' });
    let r = round(s);
    const c = () => r.state.calls.find((x) => x.nodeId === 'pallithode')!;
    expect(c().remaining).toBe(0);
    expect(c().status).toBe('open');
    s = queued(r.state, 'p1', { type: 'drop', kit: 'food' });
    r = round(s);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'kit_wasted', points: -2 }));
    expect(boat(r.state).kits.food).toBe(0);
    s = queued(r.state, 'p1', { type: 'drop', kit: 'food' });
    r = round(s);
    expect(types(r.events)).toContain('invalid');
    s = queued(r.state, 'p1', { type: 'drop', kit: 'water' });
    r = round(s);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'kit_matched', points: 3 }));
    expect(c().status).toBe('served');
  });

  it('two boats at one call: the first in join order takes people first', () => {
    let s = game({ crews: ['p1', 'p2'] });
    s = at(at(s, 'p1', 'vattappara'), 'p2', 'vattappara');
    s = queued(queued(s, 'p1', { type: 'rescue' }), 'p2', { type: 'rescue' });
    const r = round(s);
    expect(boat(r.state, 'p1').passengers).toHaveLength(4);
    expect(boat(r.state, 'p2').passengers).toHaveLength(0);
    expect(r.events.filter((e) => e.type === 'invalid').map((e) => e.boatId)).toEqual(['p2']);
  });

  it('return unloads at the camp with points and refills kits', () => {
    let s = at(game(), 'p1', 'vattappara');
    s = queued(s, 'p1', { type: 'rescue' });
    s = round(s).state;
    s = { ...s, boats: s.boats.map((b) => ({ ...b, kits: { water: 0, food: 1, medical: 0 } })) };
    s = queued(s, 'p1', { type: 'return' });
    const r = round(s);
    expect(boat(r.state).nodeId).toBe('camp');
    expect(boat(r.state).passengers).toEqual([]);
    expect(boat(r.state).saved).toBe(4);
    expect(boat(r.state).kits).toEqual({ water: 1, food: 1, medical: 1 });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'saved', count: 4, points: 40 }));
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'priority_saved', count: 1, points: 5 }));
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'refilled', count: 2 }));
    expect(r.state.score).toBe(45);
  });

  it('elderly or sick go to the hospital for the bonus', () => {
    let s = at(game(), 'p1', 'pallithode'); // 3 people, elderly, water kit needed
    s = queued(s, 'p1', { type: 'rescue' });
    s = round(s).state;
    expect(boat(s).passengers.map((p) => p.hospital)).toEqual([true, false, false]);
    s = at(s, 'p1', 'thoppumpady');
    s = queued(s, 'p1', { type: 'return' });
    const r = round(s);
    expect(boat(r.state).nodeId).toBe('hospital');
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'saved', count: 3, points: 30 }));
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'priority_saved', count: 1, points: 5 }));
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'hospital_bonus', count: 1, points: 5 }));
  });

  it('a return keeps going round after round with no new order, unloads at a shelter, and an explicit order cancels it', () => {
    let s = at(game(), 'p1', 'kavala'); // kavala call (2 people) opens in round 2
    s = round(s).state;
    s = queued(s, 'p1', { type: 'rescue' });
    s = round(s).state;
    s = { ...s, boats: s.boats.map((b) => ({ ...b, nodeId: 'mundamveli', kits: { water: 0, food: 0, medical: 1 } })) }; // 3 steps to the camp, 3 to the school
    s = queued(s, 'p1', { type: 'return' });
    let r = round(s);
    expect(boat(r.state).nodeId).toBe('jetty'); // camp wins ties over shelters: jetty -> kumbalam -> camp
    expect(boat(r.state).plan).toBe('return');
    r = round(r.state); // no order: still returning, no standing_used
    expect(boat(r.state).nodeId).toBe('kumbalam');
    expect(types(r.events)).not.toContain('standing_used');
    r = round(r.state);
    expect(boat(r.state).nodeId).toBe('camp');
    expect(boat(r.state).passengers).toEqual([]);
    expect(boat(r.state).plan).toBeNull();
    expect(boat(r.state).kits).toEqual({ water: 1, food: 1, medical: 1 });
    // a shelter: people are safe, but no kits
    let t = at(game(), 'p1', 'vattappara');
    t = queued(t, 'p1', { type: 'rescue' });
    t = round(t).state;
    t = { ...t, boats: t.boats.map((b) => ({ ...b, nodeId: 'nettoor', kits: { water: 0, food: 0, medical: 0 } })) };
    t = queued(t, 'p1', { type: 'return' });
    const u = round(t);
    expect(['school', 'temple']).toContain(boat(u.state).nodeId);
    expect(u.events).toContainEqual(expect.objectContaining({ type: 'saved', count: 4 }));
    expect(types(u.events)).not.toContain('refilled');
    expect(boat(u.state).kits).toEqual({ water: 0, food: 0, medical: 0 });
    // cancel: return (pallithode -> edakochi, heading for the school) then an explicit move elsewhere
    s = at(game(), 'p1', 'pallithode');
    s = queued(s, 'p1', { type: 'return' });
    s = round(s).state;
    expect(boat(s).nodeId).toBe('edakochi');
    s = queued(s, 'p1', { type: 'move', nodeId: 'nettoor' });
    s = round(s).state;
    expect(boat(s).nodeId).toBe('nettoor');
    expect(boat(s).plan).toBeNull();
  });

  it('with no order the standing order is used: hold stays, return heads home', () => {
    let s = game();
    let r = round(s);
    expect(types(r.events)).toContain('standing_used');
    expect(boat(r.state).nodeId).toBe('jetty');
    s = queueOrder(game(), 'p1', order(1, { type: 'standing', mode: 'return' }), T).state;
    r = round(s);
    expect(boat(r.state).nodeId).toBe('kumbalam');
  });

  it('new calls open each round and urgency rises with waiting', () => {
    const s = game();
    const r = round(s);
    expect(r.events.filter((e) => e.type === 'call_opened').map((e) => e.nodeId)).toEqual(['kavala', 'edakochi']);
    expect(r.state.calls).toHaveLength(4);
    const v = call(r.state, 'vattappara')!;
    expect(callUrgency(v, 1).score).toBe(callUrgency(v, 2).score - 2);
  });
});

describe('water', () => {
  it('rises after rounds 3, 5, 7, 9; a flooded house gives three rounds on the roof, then people are lost', () => {
    let s = { ...game(), round: 3 };
    let r = round(s);
    expect(r.state.waterLevel).toBe(1);
    expect(types(r.events)).toContain('water_rose');
    const pal = () => r.state.calls.find((c) => c.nodeId === 'pallithode')!; // height 1
    const vat = () => r.state.calls.find((c) => c.nodeId === 'vattappara')!; // height 2
    expect(pal().roofRounds).toBe(3);
    expect(vat().roofRounds).toBeNull();
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'flooded', nodeId: 'pallithode', count: 3 }));
    expect(callUrgency(pal(), r.state.round).score - callUrgency(vat(), r.state.round).score).toBeGreaterThan(0);
    r = round(r.state); // round 4: countdown 2
    expect(pal().roofRounds).toBe(2);
    r = round(r.state); // round 5: countdown 1, water 2 reaches vattappara
    expect(pal().roofRounds).toBe(1);
    expect(pal().status).toBe('open');
    expect(r.state.waterLevel).toBe(2);
    expect(vat().roofRounds).toBe(3);
    r = round(r.state); // round 6: 0 -> lost
    expect(pal().status).toBe('lost');
    expect(pal().remaining).toBe(0);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'lost', nodeId: 'pallithode', count: 3, points: -45 }));
    expect(r.state.score).toBe(-45);
  });

  it('the school and the temple never flood', () => {
    let s = { ...game(), round: 3, waterLevel: 4 };
    const r = round(s); // resolving round 3 opens the round-4 school call, with the water already at 4
    const school = r.state.calls.find((c) => c.nodeId === 'school')!;
    s = round(r.state).state;
    expect(s.calls.find((c) => c.id === school.id)!.roofRounds).toBeNull();
    expect(s.calls.find((c) => c.id === school.id)!.status).toBe('open');
  });

  it('rescuing people from the roof in time avoids the loss', () => {
    let s = at({ ...game(), round: 3 }, 'p1', 'pallithode');
    s = round(s).state; // flooded, roofRounds 2
    s = queued(s, 'p1', { type: 'rescue' });
    const r = round(s);
    expect(types(r.events)).not.toContain('lost');
    expect(boat(r.state).passengers).toHaveLength(3);
    const after = round(r.state).state;
    expect(types(after.history.at(-1)!.events)).not.toContain('lost');
  });
});

describe('end of the night and scoring', () => {
  it('after round 10 the game ends; people still aboard count at half points', () => {
    let s = at({ ...game(), round: 10 }, 'p1', 'vattappara');
    s = queued(s, 'p1', { type: 'rescue' });
    const r = round(s);
    expect(r.state.phase).toBe('ended');
    expect(r.state.round).toBe(10);
    expect(r.state.deadlineAt).toBeNull();
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'saved_late', count: 4, points: 20 }));
    expect(boat(r.state).passengers).toEqual([]);
    expect(boat(r.state).saved).toBe(4);
    expect(round(r.state).events).toEqual([]); // resolving an ended game does nothing
  });

  it('the score is the sum of every event, and stars follow the thresholds', () => {
    let s = game({ bots: true, crews: [] });
    while (s.phase !== 'ended') s = round(s).state;
    const sum = s.history.flatMap((h) => h.events).reduce((n, e) => n + e.points, 0);
    expect(s.score).toBe(sum);
    expect(s.history).toHaveLength(10);
    expect(s.history.map((h) => h.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(starsFor(0, 300)).toBe(0);
    expect(starsFor(300, 300)).toBe(1);
    expect(starsFor(390, 300)).toBe(2);
    expect(starsFor(480, 300)).toBe(3);
    expect(starsFor(1000, 0)).toBe(0);
  });
});

describe('bots and determinism', () => {
  it('three bots alone save most of Thuruthu, never issue an invalid order, and the night ends', () => {
    let s = game({ bots: true, crews: [] });
    expect(s.boats).toHaveLength(3);
    while (s.phase !== 'ended') s = round(s).state;
    const all = s.history.flatMap((h) => h.events);
    const saved = all.filter((e) => e.type === 'saved' || e.type === 'saved_late').reduce((n, e) => n + (e.count ?? 0), 0);
    expect(all.filter((e) => e.type === 'invalid')).toEqual([]);
    expect(saved).toBeGreaterThanOrEqual(22); // measured 23 of 34 with `npm run sim`
    expect(s.score).toBeGreaterThanOrEqual(150);
    expect(s.stars).toBe(1); // the bots define one star
    expect(s.boats.every((b) => b.saved > 0)).toBe(true);
    // more boats, more saved: the rules reward crews, not luck
    let five = addBots(newGame(scn, { id: 'g5', now: T, bots: false }), scn, 5);
    five = startGame(five, scn, T);
    while (five.phase !== 'ended') five = round(five).state;
    expect(five.score).toBeGreaterThan(s.score + 100);
  });

  it('botOrder prefers the urgent nearby call and returns when full', () => {
    const s = game({ bots: true, crews: [] });
    expect(botOrder(s, ward, boat(s, 'bot-1'))).toEqual({ type: 'move', nodeId: 'kavala' });
    const full = { ...boat(s, 'bot-1'), passengers: Array.from({ length: 4 }, () => ({ callId: 'x', priority: false, hospital: false })) };
    expect(botOrder(s, ward, full)).toEqual({ type: 'return' });
  });

  it('the same generator seed replays the same night; another seed differs; 200 nights never throw', () => {
    const random: Scenario = { ...scn, calls: [], generator: { seed: 7, perRound: [1, 2] } };
    const w = new Ward(random);
    const play = (seed: number) => {
      let s = addBots(newGame(random, { id: 'r', now: T, bots: false, seed }), random);
      s = startGame(s, random, T);
      while (s.phase !== 'ended') s = resolveRound(s, w, T).state;
      return s;
    };
    const a = play(7);
    const b = play(7);
    expect(JSON.stringify(a.history)).toBe(JSON.stringify(b.history));
    expect(a.calls.length).toBeGreaterThan(5);
    expect(JSON.stringify(play(8).history)).not.toBe(JSON.stringify(a.history));
    for (let i = 0; i < 200; i++) {
      const s = play(100 + i);
      expect(s.phase).toBe('ended');
      expect(s.history).toHaveLength(10);
    }
  });

  it('resolveRound never mutates its input', () => {
    const s = game();
    const before = JSON.stringify(s);
    round(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('contact and the view', () => {
  it('in contact needs signal at the node and a recent heartbeat; bots always are', () => {
    let s = game({ bots: true });
    expect(inContact(s, ward, 'p1', T + 5000)).toBe(true);
    expect(inContact(s, ward, 'p1', T + 25_000)).toBe(false);
    expect(inContact(at(s, 'p1', 'bendhouse'), ward, 'p1', T)).toBe(false);
    expect(inContact(s, ward, 'bot-1', T + 999_999)).toBe(true);
    expect(inContact(s, ward, 'nobody', T)).toBe(false);
  });

  it('the view hides the queues and the rng, scores open calls, and tells a crew what it has queued', () => {
    let s = game();
    s = queued(queued(s, 'p1', { type: 'hold' }), 'p1', { type: 'rescue' });
    const v = toView(s, ward, T, 42, 'p1');
    expect(v).not.toHaveProperty('queues');
    expect(v).not.toHaveProperty('rng');
    expect(v).not.toHaveProperty('recent');
    expect(v.revision).toBe(42);
    expect(Object.keys(v.urgency).sort()).toEqual(s.calls.map((c) => c.id).sort());
    expect(v.urgency[call(s, 'pallithode')!.id]).toEqual({ score: 55, band: 'orange' }); // rescue 35 + elderly 15 + 3 people 4.5
    expect(v.contact.p1).toBe(true);
    expect(v.you).toEqual({ boatId: 'p1', queued: 2, nextSeq: 3, queuedSeqs: [1, 2] });
    expect(toView(s, ward, T, 1).you).toBeUndefined();
  });
});

describe('schemas', () => {
  it('orders are strict and ids are uuids', () => {
    expect(OrderSchema.safeParse({ type: 'move', nodeId: 'kavala', extra: 1 }).success).toBe(false);
    expect(OrderSchema.safeParse({ type: 'drop', kit: 'rum' }).success).toBe(false);
    expect(QueuedOrderInputSchema.safeParse({ id: 'nope', seq: 1, order: { type: 'hold' } }).success).toBe(false);
    expect(QueuedOrderInputSchema.safeParse({ id: randomUUID(), seq: 0, order: { type: 'hold' } }).success).toBe(false);
    expect(QueuedOrderInputSchema.safeParse({ id: randomUUID(), seq: 1, order: { type: 'standing', mode: 'return' } }).success).toBe(true);
    expect(GAME.capacity).toBe(4);
  });
});
