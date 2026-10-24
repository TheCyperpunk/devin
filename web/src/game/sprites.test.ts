// The sprite sheet obeys the pixel-art rules: no ragged rows, no glyph without a colour, and ramps that hue-shift.
import { describe, expect, it } from 'vitest';
import { P, SPRITES, light, mix, shade, spriteRects } from './sprites.js';

describe('sprite sheet', () => {
  for (const [name, s] of Object.entries(SPRITES)) {
    it(`${name}: every row is the same width and every glyph has a colour`, () => {
      const widths = new Set(s.rows.map((r) => r.length));
      expect(widths.size, `${name} has ragged rows`).toBe(1);
      for (const row of s.rows) for (const ch of row) if (ch !== '.') expect(s.palette, `${name}: glyph '${ch}' not in palette`).toHaveProperty(ch);
    });
  }

  it('merges runs into rects anchored at the bottom centre', () => {
    const r = spriteRects({ rows: ['.AA.', 'BBBB'], palette: { A: '#ff0000', B: '#00ff00' } }, 4);
    expect(r).toEqual([
      { x: -4, y: -8, w: 8, h: 4, fill: '#ff0000' },
      { x: -8, y: -4, w: 16, h: 4, fill: '#00ff00' },
    ]);
  });
});

describe('ramps', () => {
  it('mix blends toward the second colour', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('shade is darker and cooler, light is lighter and warmer', () => {
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    for (const c of [P.roof, P.wall, P.green, P.yellow, P.wood]) {
      expect(lum(shade(c))).toBeLessThan(lum(c));
      expect(lum(light(c))).toBeGreaterThan(lum(c));
    }
    // a red roof shades toward purple (more blue, relatively), not to a plain darker red
    const [r0, , b0] = [P.roof.slice(1, 3), 0, P.roof.slice(5, 7)].map((v) => parseInt(String(v), 16));
    const s = shade(P.roof);
    const [r1, , b1] = [s.slice(1, 3), 0, s.slice(5, 7)].map((v) => parseInt(String(v), 16));
    expect(b1! / r1!).toBeGreaterThan(b0! / r0!);
  });
});
