// Urgency score (D7). Phase 2 needs baseScore for storage; Phase 3 adds the wait bonus, bands and sorting.
import type { PhoneReportInput } from './contract.js';

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
