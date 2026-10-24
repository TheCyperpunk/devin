// Phase 3 gate: base score, wait bonus, bands, sorting and the hub-clock helpers (D7).
import { describe, expect, it } from 'vitest';
import type { Report } from './contract.js';
import {
  band,
  bandOf,
  baseScore,
  clockOffset,
  compareReports,
  displayScore,
  hubNow,
  sortReports,
  waitBonus,
} from './urgency.js';

const MIN = 60_000;
const NOW = 1_800_000_000_000;

const base = { needs: ['food' as const], peopleCount: 1, urgent: false, hasChildren: false, hasElderlyOrSick: false };

type R = Pick<Report, 'baseScore' | 'reportedAt' | 'status' | 'revision'>;
let rev = 0;
const rep = (over: Partial<R> = {}): R => ({ baseScore: 50, reportedAt: NOW, status: 'open', revision: ++rev, ...over });

describe('baseScore', () => {
  it('ranks medical above plain food', () => {
    expect(baseScore({ ...base, needs: ['medical'] })).toBeGreaterThan(baseScore(base));
  });
  it('ranks rescue above plain water and below medical + rescue together', () => {
    const water = baseScore({ ...base, needs: ['water'] });
    const rescue = baseScore({ ...base, needs: ['rescue'] });
    const both = baseScore({ ...base, needs: ['medical', 'rescue'] });
    expect(rescue).toBeGreaterThan(water);
    expect(both).toBeGreaterThan(rescue);
  });
  it('adds each factor', () => {
    expect(baseScore({ ...base, needs: ['medical'], peopleCount: 2 })).toBe(40 + 3);
    expect(baseScore({ ...base, needs: ['rescue'], peopleCount: 2 })).toBe(35 + 3);
    expect(baseScore({ ...base, needs: ['shelter'], urgent: true, peopleCount: 2 })).toBe(25 + 3);
    expect(baseScore({ ...base, needs: ['shelter'], hasChildren: true, hasElderlyOrSick: true, peopleCount: 2 })).toBe(20 + 15 + 3);
  });
  it('gives larger groups a higher score, up to 30 people', () => {
    const small = baseScore({ ...base, needs: ['shelter'], peopleCount: 5 });
    const large = baseScore({ ...base, needs: ['shelter'], peopleCount: 20 });
    expect(large).toBeGreaterThan(small);
  });
  it('gives food/water +10 only when nothing more serious applies', () => {
    expect(baseScore({ ...base, needs: ['water'], peopleCount: 2 })).toBe(10 + 3);
    expect(baseScore({ ...base, needs: ['water', 'medical'], peopleCount: 2 })).toBe(40 + 3);
    expect(baseScore({ ...base, needs: ['food'], urgent: true, peopleCount: 2 })).toBe(25 + 3);
  });
  it('caps group size at 30 people and rounds to an integer', () => {
    expect(baseScore({ ...base, needs: ['shelter'], peopleCount: 30 })).toBe(45);
    expect(baseScore({ ...base, needs: ['shelter'], peopleCount: 500 })).toBe(45);
    expect(baseScore({ ...base, needs: ['shelter'], peopleCount: 1 })).toBe(2); // 1.5 rounds up
    expect(Number.isInteger(baseScore({ ...base, peopleCount: 7 }))).toBe(true);
  });
  it('has a maximum: every factor at once with a big group', () => {
    const max = baseScore({
      needs: ['medical', 'rescue', 'food'],
      peopleCount: 500,
      urgent: true,
      hasChildren: true,
      hasElderlyOrSick: true,
    });
    expect(max).toBe(40 + 35 + 25 + 20 + 15 + 45); // 180
  });
});

describe('waitBonus', () => {
  it('grows 0.2 points per minute', () => {
    expect(waitBonus(NOW, NOW)).toBe(0);
    expect(waitBonus(NOW - 10 * MIN, NOW)).toBeCloseTo(2);
    expect(waitBonus(NOW - 50 * MIN, NOW)).toBeCloseTo(10);
  });
  it('is capped at 20, reached after 100 minutes', () => {
    expect(waitBonus(NOW - 100 * MIN, NOW)).toBeCloseTo(20);
    expect(waitBonus(NOW - 101 * MIN, NOW)).toBe(20);
    expect(waitBonus(NOW - 48 * 60 * MIN, NOW)).toBe(20);
  });
  it('never goes negative when the clock estimate says the report is from the future', () => {
    expect(waitBonus(NOW + 5 * MIN, NOW)).toBe(0);
  });
});

describe('displayScore', () => {
  it('is baseScore plus the wait bonus, rounded', () => {
    expect(displayScore(rep({ baseScore: 43, reportedAt: NOW }), NOW)).toBe(43);
    expect(displayScore(rep({ baseScore: 43, reportedAt: NOW - 10 * MIN }), NOW)).toBe(45);
    expect(displayScore(rep({ baseScore: 43, reportedAt: NOW - 500 * MIN }), NOW)).toBe(63); // capped at +20
  });
  it('rises as time passes for the same report', () => {
    const r = rep({ baseScore: 40, reportedAt: NOW });
    expect(displayScore(r, NOW + 60 * MIN)).toBeGreaterThan(displayScore(r, NOW));
  });
});

describe('band', () => {
  it('switches exactly at 80 and 50', () => {
    expect(band(100)).toBe('red');
    expect(band(80)).toBe('red');
    expect(band(79)).toBe('orange');
    expect(band(50)).toBe('orange');
    expect(band(49)).toBe('yellow');
    expect(band(0)).toBe('yellow');
  });
  it('a waiting report can climb a band', () => {
    const r = rep({ baseScore: 62, reportedAt: NOW });
    expect(bandOf(r, NOW)).toBe('orange');
    expect(bandOf(r, NOW + 100 * MIN)).toBe('red'); // 62 + 20 = 82
  });
  it('finished reports are "done" whatever their score', () => {
    expect(bandOf(rep({ baseScore: 150, status: 'done' }), NOW)).toBe('done');
    expect(bandOf(rep({ baseScore: 150, status: 'assigned' }), NOW)).toBe('red');
  });
});

describe('sorting', () => {
  it('puts the highest score first', () => {
    const a = rep({ baseScore: 30 });
    const b = rep({ baseScore: 90 });
    const c = rep({ baseScore: 60 });
    expect(sortReports([a, b, c], NOW)).toEqual([b, c, a]);
  });
  it('puts done reports last, even the highest-scoring ones', () => {
    const done = rep({ baseScore: 200, status: 'done' });
    const low = rep({ baseScore: 5 });
    const mid = rep({ baseScore: 50, status: 'assigned' });
    expect(sortReports([done, low, mid], NOW)).toEqual([mid, low, done]);
  });
  it('breaks equal scores by who has waited longest', () => {
    const newer = rep({ baseScore: 60, reportedAt: NOW - 1 * MIN });
    const older = rep({ baseScore: 60, reportedAt: NOW - 1 * MIN - 2000 });
    // both round to the same displayed score, so the older report wins the tie
    expect(displayScore(newer, NOW)).toBe(displayScore(older, NOW));
    expect(sortReports([newer, older], NOW)).toEqual([older, newer]);
  });
  it('lets a long wait overtake a slightly higher base score', () => {
    const fresh = rep({ baseScore: 60, reportedAt: NOW });
    const waiting = rep({ baseScore: 50, reportedAt: NOW - 100 * MIN }); // 50 + 20 = 70
    expect(sortReports([fresh, waiting], NOW)[0]).toBe(waiting);
  });
  it('keeps the order fully deterministic via revision', () => {
    const a = rep({ baseScore: 60, reportedAt: NOW, revision: 7 });
    const b = rep({ baseScore: 60, reportedAt: NOW, revision: 3 });
    expect(compareReports(a, b, NOW)).toBeGreaterThan(0);
    expect(sortReports([a, b], NOW)).toEqual([b, a]);
    expect(sortReports([b, a], NOW)).toEqual([b, a]);
  });
  it('does not change the array it was given', () => {
    const input = [rep({ baseScore: 10 }), rep({ baseScore: 90 })];
    const copy = [...input];
    sortReports(input, NOW);
    expect(input).toEqual(copy);
  });
  it('handles empty and single-item lists', () => {
    expect(sortReports([], NOW)).toEqual([]);
    const one = rep();
    expect(sortReports([one], NOW)).toEqual([one]);
  });
});

describe('hub clock estimate', () => {
  it('corrects a phone whose clock is wrong', () => {
    const hubTime = NOW;
    const phoneClockAhead = NOW + 3 * 60 * MIN; // phone thinks it is 3 hours later
    const offset = clockOffset(hubTime, phoneClockAhead);
    expect(hubNow(offset, phoneClockAhead)).toBe(hubTime);
    // 10 minutes later by the phone's own clock => 10 minutes later by the hub's clock
    expect(hubNow(offset, phoneClockAhead + 10 * MIN)).toBe(hubTime + 10 * MIN);
  });
  it('gives the same wait bonus on a skewed phone as on the hub', () => {
    const r = rep({ baseScore: 40, reportedAt: NOW - 30 * MIN });
    const skewedPhone = NOW - 2 * 60 * MIN;
    const est = hubNow(clockOffset(NOW, skewedPhone), skewedPhone);
    expect(displayScore(r, est)).toBe(displayScore(r, NOW));
  });
});
