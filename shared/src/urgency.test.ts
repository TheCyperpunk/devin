// Base score, wait bonus, bands and the hub-clock helpers.
import { describe, expect, it } from 'vitest';
import { band, baseScore, clockOffset, hubNow, waitBonus, type ScoreInput } from './urgency.js';

const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({ needs: ['food'], peopleCount: 1, urgent: false, hasChildren: false, hasElderlyOrSick: false, ...over });

describe('baseScore', () => {
  it('ranks medical above plain food and rescue in between', () => {
    expect(baseScore(input({ needs: ['medical'] }))).toBeGreaterThan(baseScore(input({ needs: ['rescue'] })));
    expect(baseScore(input({ needs: ['rescue'] }))).toBeGreaterThan(baseScore(input({ needs: ['food'] })));
  });
  it('adds each factor', () => {
    expect(baseScore(input({ needs: ['medical', 'rescue'], urgent: true, hasChildren: true, hasElderlyOrSick: true, peopleCount: 2 }))).toBe(138);
  });
  it('gives food/water +10 only when nothing more serious applies, and caps the group at 30', () => {
    expect(baseScore(input({ needs: ['water'], peopleCount: 2 }))).toBe(13);
    expect(baseScore(input({ needs: ['water'], urgent: true, peopleCount: 2 }))).toBe(28);
    expect(baseScore(input({ peopleCount: 30 }))).toBe(baseScore(input({ peopleCount: 300 })));
  });
});

describe('waitBonus', () => {
  it('grows 0.2 per minute, capped at 20, never negative', () => {
    expect(waitBonus(0, 5 * 60_000)).toBe(1);
    expect(waitBonus(0, 200 * 60_000)).toBe(20);
    expect(waitBonus(60_000, 0)).toBe(0);
  });
});

describe('band', () => {
  it('switches exactly at 80 and 50', () => {
    expect(band(80)).toBe('red');
    expect(band(79)).toBe('orange');
    expect(band(50)).toBe('orange');
    expect(band(49)).toBe('yellow');
  });
});

describe('hub clock estimate', () => {
  it('corrects a phone whose clock is wrong', () => {
    const offset = clockOffset(1_000_000, 1_030_000); // phone 30 s ahead
    expect(hubNow(offset, 1_040_000)).toBe(1_010_000);
  });
});
