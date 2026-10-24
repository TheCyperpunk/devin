// Smoke test so `npm test` has something to run before Phase 3 adds the urgency tests.
import { describe, expect, it } from 'vitest';
import { LIMITS, TIMING } from './index.js';

describe('shared constants', () => {
  it('keeps the contract limits', () => {
    expect(LIMITS.batchMax).toBe(50);
    expect(LIMITS.noteMax).toBe(280);
    expect(TIMING.backoffMaxMs).toBe(30000);
  });
});
