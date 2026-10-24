// Urgency of a call: a base score from what is asked and who is there, a bonus for waiting, colour bands,
// and the hub-clock estimate. Pure functions, so a call ranks the same on the hub, the screen and every phone.
import type { NeedType } from './contract.js';

export interface ScoreInput {
  needs: NeedType[];
  peopleCount: number;
  urgent: boolean;
  hasChildren: boolean;
  hasElderlyOrSick: boolean;
}

export function baseScore(r: ScoreInput): number {
  const medical = r.needs.includes('medical');
  const rescue = r.needs.includes('rescue');
  let score = 0;
  if (medical) score += 40;
  if (rescue) score += 35;
  if (r.urgent) score += 25;
  if (r.hasChildren) score += 20;
  if (r.hasElderlyOrSick) score += 15;
  score += Math.min(r.peopleCount, 30) * 1.5;
  const basic = r.needs.includes('food') || r.needs.includes('water');
  if (basic && !medical && !rescue && !r.urgent) score += 10;
  return Math.round(score);
}

export const WAIT_BONUS_PER_MIN = 0.2;
export const WAIT_BONUS_MAX = 20;

/** Points earned by waiting: 0.2 per minute, capped at 20 (reached after 100 minutes). Negative waits count as 0. */
export function waitBonus(since: number, hubNow: number): number {
  const minutes = Math.max(0, (hubNow - since) / 60_000);
  return Math.min(minutes * WAIT_BONUS_PER_MIN, WAIT_BONUS_MAX);
}

export type Band = 'red' | 'orange' | 'yellow';
export const BAND_RED_MIN = 80;
export const BAND_ORANGE_MIN = 50;

export function band(score: number): Band {
  return score >= BAND_RED_MIN ? 'red' : score >= BAND_ORANGE_MIN ? 'orange' : 'yellow';
}

/** Phone clocks drift: offset = serverTime - localNowWhenItArrived, then hubNow = localNow + offset. */
export function clockOffset(serverTime: number, localNowWhenReceived: number): number {
  return serverTime - localNowWhenReceived;
}
export function hubNow(offset: number, localNow: number): number {
  return localNow + offset;
}
