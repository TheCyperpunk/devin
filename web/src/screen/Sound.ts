// Tiny synthesized sounds (GAME-VISUAL §8): no audio files, nothing downloaded. Muted until the host taps the speaker.
// A filtered-noise rain bed runs while sound is on; a loss cuts the rain for a second.
import type { GameRoundPayload } from '@pralayam/shared';

const RAIN = 0.04; // about -28 dB

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

function tone(freq: number, at: number, ms: number, gain = 0.08, type: OscillatorType = 'sine', glideTo?: number): void {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + at);
  if (glideTo !== undefined) o.frequency.exponentialRampToValueAtTime(glideTo, a.currentTime + at + ms / 1000);
  g.gain.setValueAtTime(0, a.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + ms / 1000);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + at);
  o.stop(a.currentTime + at + ms / 1000 + 0.05);
}

let rain: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
function rainOn(): void {
  const a = audio();
  if (!a || rain) return;
  // two seconds of brown-ish noise, looped, under a low-pass: rain on a tin roof, far away
  const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = a.createGain();
  g.gain.setValueAtTime(0, a.currentTime);
  g.gain.linearRampToValueAtTime(RAIN, a.currentTime + 1.5);
  src.connect(lp).connect(g).connect(a.destination);
  src.start();
  rain = { src, gain: g };
}
function rainOff(): void {
  const a = audio();
  if (!a || !rain) return;
  rain.gain.gain.linearRampToValueAtTime(0, a.currentTime + 0.5);
  rain.src.stop(a.currentTime + 0.6);
  rain = null;
}
function rainDip(seconds: number): void {
  const a = audio();
  if (!a || !rain) return;
  rain.gain.gain.setTargetAtTime(0, a.currentTime, 0.05);
  rain.gain.gain.setTargetAtTime(RAIN, a.currentTime + seconds, 0.3);
}

export const sound = {
  /** The rain bed follows the speaker toggle. */
  rain: (on: boolean) => (on ? rainOn() : rainOff()),
  call: () => {
    tone(659, 0, 120);
    tone(988, 0.12, 160);
  },
  rescued: () => {
    tone(523, 0, 140, 0.06);
    tone(659, 0.09, 140, 0.06);
    tone(784, 0.18, 200, 0.06);
  },
  saved: () => {
    tone(523, 0, 400, 0.06);
    tone(659, 0, 400, 0.06);
    tone(784, 0, 400, 0.06);
  },
  flooded: () => tone(160, 0, 600, 0.07, 'triangle', 60),
  lost: () => {
    tone(80, 0, 300, 0.12, 'sine');
    rainDip(1);
  },
  bell: () => tone(1318, 0, 500, 0.04, 'triangle'),
  /** One pass over a round's events, loudest news first. */
  round(p: GameRoundPayload) {
    const types = new Set(p.events.map((e) => e.type));
    if (types.has('lost')) sound.lost();
    else if (types.has('saved')) sound.saved();
    else if (types.has('rescued')) sound.rescued();
    else sound.bell();
    if (types.has('flooded')) setTimeout(sound.flooded, 400);
    if (types.has('call_opened')) setTimeout(sound.call, 900);
  },
};
