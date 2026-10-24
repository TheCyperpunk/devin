// Smoke test for the shared constants.
import { describe, expect, it } from 'vitest';
import { GAME, LIMITS, TIMING } from './index.js';

describe('shared constants', () => {
  it('keeps the limits the hub and the phone agree on', () => {
    expect(LIMITS.nameMax).toBe(60);
    expect(TIMING.backoffMaxMs).toBe(30000);
    expect(GAME.capacity).toBe(4);
  });
});
