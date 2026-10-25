// Phone feedback (GAME-VISUAL §6 and §8): a short vibration and a 60 ms tick. Best-effort, silent where unsupported.
export function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* no haptics here */
  }
}

let ctx: AudioContext | null = null;
export function tick(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.03, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.08);
  } catch {
    /* no audio here */
  }
}
