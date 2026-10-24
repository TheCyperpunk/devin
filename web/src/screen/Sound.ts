// Tiny synthesized sounds (GAME-VISUAL section 8): no audio files, nothing downloaded. Muted until the host taps the speaker.
import type { GameRoundPayload } from '@pralayam/shared';

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, at: number, ms: number, gain = 0.08, type: OscillatorType = 'sine'): void {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, a.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + ms / 1000);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + at);
  o.stop(a.currentTime + at + ms / 1000 + 0.05);
}

export const sound = {
  call: () => {
    tone(659, 0, 120);
    tone(988, 0.12, 160);
  },
  saved: () => {
    tone(523, 0, 400, 0.06);
    tone(659, 0, 400, 0.06);
    tone(784, 0, 400, 0.06);
  },
  lost: () => tone(80, 0, 300, 0.12, 'sine'),
  bell: () => tone(1318, 0, 500, 0.04, 'triangle'),
  /** One pass over a round's events, loudest news first. */
  round(p: GameRoundPayload) {
    const types = new Set(p.events.map((e) => e.type));
    if (types.has('lost')) sound.lost();
    else if (types.has('saved')) sound.saved();
    else sound.bell();
    if (types.has('call_opened')) setTimeout(sound.call, 500);
  },
};
