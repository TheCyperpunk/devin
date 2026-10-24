// baseScore checks (D7). Phase 3 adds tests for waitBonus, bands and sorting next to these.
import { describe, expect, it } from 'vitest';
import { baseScore } from './urgency.js';

const base = { needs: ['food' as const], peopleCount: 1, urgent: false, hasChildren: false, hasElderlyOrSick: false };

describe('baseScore', () => {
  it('ranks medical above plain food', () => {
    expect(baseScore({ ...base, needs: ['medical'] })).toBeGreaterThan(baseScore(base));
  });
  it('adds each factor', () => {
    expect(baseScore({ ...base, needs: ['medical'], peopleCount: 2 })).toBe(40 + 3);
    expect(baseScore({ ...base, needs: ['rescue'], peopleCount: 2 })).toBe(35 + 3);
    expect(baseScore({ ...base, needs: ['shelter'], urgent: true, peopleCount: 2 })).toBe(25 + 3);
    expect(baseScore({ ...base, needs: ['shelter'], hasChildren: true, hasElderlyOrSick: true, peopleCount: 2 })).toBe(20 + 15 + 3);
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
});
