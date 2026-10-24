// Seeded xorshift32 so a game replays exactly: same seed, same calls, same night. Pure: state in, state out.
export function rngNext(state: number): { value: number; state: number } {
  let x = state >>> 0 || 0x9e3779b9;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return { value: x / 0x1_0000_0000, state: x };
}

/** Integer in [min, max], both inclusive. */
export function rngInt(state: number, min: number, max: number): { value: number; state: number } {
  const r = rngNext(state);
  return { value: min + Math.floor(r.value * (max - min + 1)), state: r.state };
}

export function rngPick<T>(state: number, items: readonly T[]): { value: T | undefined; state: number } {
  if (items.length === 0) return { value: undefined, state };
  const r = rngInt(state, 0, items.length - 1);
  return { value: items[r.value], state: r.state };
}
