// Urgency (D7): stored baseScore + live wait bonus, colour bands, sort order, and a hub-clock estimate.
// Pure functions shared by the hub and every screen, so a report ranks the same everywhere.
import type { PhoneReportInput, Report } from './contract.js';

type ScoreInput = Pick<PhoneReportInput, 'needs' | 'peopleCount' | 'urgent' | 'hasChildren' | 'hasElderlyOrSick'>;

/** Stored once at insert. Never trusts the phone: the hub calls this itself. */
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
export function waitBonus(reportedAt: number, hubNow: number): number {
  const minutes = Math.max(0, (hubNow - reportedAt) / 60_000);
  return Math.min(minutes * WAIT_BONUS_PER_MIN, WAIT_BONUS_MAX);
}

type Scored = Pick<Report, 'baseScore' | 'reportedAt'>;

/** What the screens show and sort by. Uses hub time, never the viewer's clock (see hubClock). */
export function displayScore(r: Scored, hubNow: number): number {
  return Math.round(r.baseScore + waitBonus(r.reportedAt, hubNow));
}

export type Band = 'red' | 'orange' | 'yellow';
export const BAND_RED_MIN = 80;
export const BAND_ORANGE_MIN = 50;

export function band(score: number): Band {
  return score >= BAND_RED_MIN ? 'red' : score >= BAND_ORANGE_MIN ? 'orange' : 'yellow';
}

/** Finished reports are shown greyed out instead of by urgency. */
export function bandOf(r: Scored & Pick<Report, 'status'>, hubNow: number): Band | 'done' {
  return r.status === 'done' ? 'done' : band(displayScore(r, hubNow));
}

/**
 * Sort order for the list: open and assigned reports first by score (highest first), then the one waiting
 * longest, and finished reports last. The final tiebreak is revision, so the order is fully deterministic.
 */
export function compareReports(
  a: Scored & Pick<Report, 'status' | 'revision'>,
  b: Scored & Pick<Report, 'status' | 'revision'>,
  hubNow: number,
): number {
  const aDone = a.status === 'done' ? 1 : 0;
  const bDone = b.status === 'done' ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;
  return (
    displayScore(b, hubNow) - displayScore(a, hubNow) || a.reportedAt - b.reportedAt || a.revision - b.revision
  );
}

/** Returns a sorted copy; the input array is left alone. */
export function sortReports<T extends Scored & Pick<Report, 'status' | 'revision'>>(reports: readonly T[], hubNow: number): T[] {
  return [...reports].sort((a, b) => compareReports(a, b, hubNow));
}

/**
 * Phone clocks drift, so a screen estimates hub time from the hub's `serverTime` in an API response:
 * offset = serverTime - localNowWhenItArrived, then hubNow = localNow + offset.
 * (Network delay of a few ms is irrelevant against a 0.2-points-per-minute bonus.)
 */
export function clockOffset(serverTime: number, localNowWhenReceived: number): number {
  return serverTime - localNowWhenReceived;
}
export function hubNow(offset: number, localNow: number): number {
  return localNow + offset;
}
