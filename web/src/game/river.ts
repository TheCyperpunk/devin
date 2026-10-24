// The river channel as a staircase polygon (shared by the big screen and the phone map): a polyline centre line
// keeps every house on a bank; the channel widens upward as the water level rises.
import { snap } from './sprites.js';

export const STEP = 16;
const HALF = 34;
/** The river's centre line, a polyline through waypoints that keeps every house on a bank. */
const CENTER: [number, number][] = [
  [0, 470], [140, 478], [260, 450], [360, 445], [460, 455], [560, 420], [660, 530], [760, 520], [880, 540], [1000, 520],
];
export function centerY(x: number): number {
  for (let i = 1; i < CENTER.length; i++) {
    const [x0, y0] = CENTER[i - 1]!;
    const [x1, y1] = CENTER[i]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return CENTER[CENTER.length - 1]![1];
}
/** Channel edges at a water level, as staircases. */
export function edges(level: number): { x: number; top: number; bottom: number }[] {
  const out: { x: number; top: number; bottom: number }[] = [];
  for (let x = 0; x <= 1000; x += STEP) {
    const c = centerY(x);
    out.push({ x, top: snap(c - HALF - 28 * level), bottom: snap(c + HALF + 14 * level) });
  }
  return out;
}
export function channelPath(e: { x: number; top: number; bottom: number }[]): string {
  const top = e.map((p) => `${p.x},${p.top} L${p.x + STEP},${p.top}`).join(' L');
  const bottom = [...e].reverse().map((p) => `${p.x + STEP},${p.bottom} L${p.x},${p.bottom}`).join(' L');
  return `M${top} L${bottom} Z`;
}

