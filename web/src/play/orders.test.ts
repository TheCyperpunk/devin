// The order picker only offers legal orders, most urgent move first; the round estimate while out of contact.
import { describe, expect, it } from 'vitest';
import { Ward, joinBoat, newGame, parseScenario, resolveRound, startGame, thuruthu, toView } from '@pralayam/shared';
import { estimatedRound, legalOrders, myBoat } from './orders.js';

const scn = parseScenario(thuruthu);
const ward = new Ward(scn);
const T = 1_800_000_000_000;

function game() {
  return startGame(joinBoat(newGame(scn, { id: 'g', now: T, bots: false }), scn, 'p1', 'Asha', 'moss', T), scn, T);
}

describe('legalOrders', () => {
  it('at the jetty: the three neighbours (most urgent first), return, hold; no rescue, no drop', () => {
    const s = game();
    const view = toView(s, ward, T, 1, 'p1');
    const opts = legalOrders(view, myBoat(view, 'p1')!);
    expect(opts.map((o) => o.kind)).toEqual(['move', 'move', 'move', 'return', 'hold']);
    expect(opts.slice(0, 3).map((o) => o.nodeId)).toEqual(['kavala', 'kumbalam', 'mundamveli']); // no calls there yet: by name
    expect(opts.find((o) => o.kind === 'return')).toMatchObject({ nodeId: 'camp', steps: 2 });
  });

  it('standing at a call: rescue and the kits this boat carries, with whether they were asked for', () => {
    let s = game();
    s = { ...s, boats: s.boats.map((b) => ({ ...b, nodeId: 'pallithode' })) }; // 3 people, water kit needed
    const view = toView(s, ward, T, 1, 'p1');
    const opts = legalOrders(view, myBoat(view, 'p1')!);
    expect(opts.find((o) => o.kind === 'rescue')).toMatchObject({ people: 3, band: 'orange' });
    expect(opts.filter((o) => o.kind === 'drop').map((o) => [o.kit, o.needed])).toEqual([['water', true], ['food', false], ['medical', false]]);
    const toVattappara = opts.find((o) => o.kind === 'move' && o.nodeId === 'kavala');
    expect(toVattappara).toBeDefined();
  });

  it('a full boat gets no rescue; a boat with no kits gets no drops', () => {
    let s = game();
    s = { ...s, boats: s.boats.map((b) => ({ ...b, nodeId: 'vattappara', kits: { water: 0, food: 0, medical: 0 }, passengers: Array.from({ length: 4 }, () => ({ callId: 'x', priority: false, hospital: false })) })) };
    const view = toView(s, ward, T, 1, 'p1');
    const kinds = legalOrders(view, myBoat(view, 'p1')!).map((o) => o.kind);
    expect(kinds).not.toContain('rescue');
    expect(kinds).not.toContain('drop');
    expect(kinds).toContain('return');
  });

  it('moves into a dead zone say so, and the most urgent neighbour comes first', () => {
    let s = game();
    s = resolveRound(s, ward, T).state; // round 2 opens kavala and edakochi
    s = resolveRound(s, ward, T).state; // round 3 opens bendhouse
    s = { ...s, boats: s.boats.map((b) => ({ ...b, nodeId: 'j_mid' })) };
    const view = toView(s, ward, T, 1, 'p1');
    const moves = legalOrders(view, myBoat(view, 'p1')!).filter((o) => o.kind === 'move');
    expect(moves[0]).toMatchObject({ nodeId: 'edakochi', deadZone: false, band: 'red' }); // medical + elderly + urgent
    expect(moves.find((m) => m.nodeId === 'bendhouse')).toMatchObject({ deadZone: true, people: 2 });
  });
});

describe('estimatedRound', () => {
  it('counts rounds that must have passed since the deadline', () => {
    const s = game();
    const view = toView(s, ward, T, 1);
    expect(estimatedRound(view, T + 10_000)).toBe(1);
    expect(estimatedRound(view, T + 46_000)).toBe(2);
    expect(estimatedRound(view, T + 45_000 + 2 * 45_000 + 1)).toBe(4);
    expect(estimatedRound(view, T + 999_999_999)).toBe(10);
  });
});
