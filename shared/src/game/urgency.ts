// A call's live urgency (GAME-DESIGN 2.3): the Relief Mesh base score + wait bonus (one round = ten minutes)
// + a water bonus once the house is flooded. Plus the GameView builder shared by the hub for phones and screens.
import { band, baseScore, waitBonus } from '../urgency.js';
import { GAME, type Call, type CallUrgency, type GameState, type GameView } from './contract.js';
import { inContact } from './state.js';
import type { Ward } from './scenario.js';

const MS_PER_ROUND = GAME.minutesPerRound * 60_000;

export function callUrgency(call: Call, round: number): CallUrgency {
  const base = baseScore({ needs: call.needs, peopleCount: call.peopleCount, urgent: call.urgent, hasChildren: call.hasChildren, hasElderlyOrSick: call.hasElderlyOrSick });
  const wait = waitBonus(call.appearedRound * MS_PER_ROUND, round * MS_PER_ROUND);
  const water = call.roofRounds !== null ? GAME.waterBonus : 0;
  const score = Math.round(base + wait + water);
  return { score, band: band(score) };
}

export function toView(state: GameState, ward: Ward, now: number, revision: number, youBoatId?: string): GameView {
  const { queues, applied, recent, rng, ...rest } = state;
  void recent;
  void rng;
  const contact: Record<string, boolean> = {};
  for (const b of state.boats) contact[b.id] = inContact(state, ward, b.id, now);
  const urgency: Record<string, CallUrgency> = {};
  for (const c of state.calls) if (c.status === 'open') urgency[c.id] = callUrgency(c, state.round);
  const view: GameView = { ...rest, revision, serverTime: now, contact, urgency };
  if (youBoatId && state.boats.some((b) => b.id === youBoatId)) {
    const q = queues[youBoatId] ?? [];
    const last = Math.max(applied[youBoatId] ?? 0, ...q.map((o) => o.seq));
    view.you = { boatId: youBoatId, queued: q.length, nextSeq: last + 1, queuedSeqs: q.map((o) => o.seq) };
  }
  return view;
}
