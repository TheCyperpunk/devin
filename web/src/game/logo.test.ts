// The logo scene is a full-bleed 32x32 pixel picture whose subject stays inside the area a launcher's crop keeps.
import { describe, expect, it } from 'vitest';
import { P, light } from './sprites.js';
import { logoRgba, logoScene, logoSvg } from './logo.js';

describe('logo', () => {
  it('is a full 32x32 grid of solid hex colours', () => {
    const g = logoScene(32);
    expect(g).toHaveLength(32);
    for (const row of g) {
      expect(row).toHaveLength(32);
      for (const c of row) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('is deterministic', () => {
    expect(logoScene(32)).toEqual(logoScene(32));
    expect(logoSvg(32)).toBe(logoSvg(32));
  });

  it('has the lantern core at its centre and the 40-cell scene is the same picture with a margin', () => {
    expect(logoScene(32)[9]![14]).toBe(light(P.yellow));
    expect(logoScene(40)[13]![18]).toBe(light(P.yellow));
    for (let y = 0; y < 32; y++) for (let x = 4; x < 28; x++) expect(logoScene(40)[y + 4]![x + 4]).toBe(logoScene(32)[y]![x]);
  });

  it('keeps every outline pixel of the subject inside the circle a launcher keeps (40% of the maskable icon)', () => {
    const g = logoScene(32);
    let farthest = 0;
    g.forEach((row, y) =>
      row.forEach((c, x) => {
        if (c === P.black) farthest = Math.max(farthest, Math.hypot(x + 0.5 - 16, y + 0.5 - 16));
      }),
    );
    expect(farthest).toBeLessThanOrEqual(16); // the maskable safe zone is a circle of radius 40% of the icon: 16 of 40 cells
  });

  it('renders to a small crisp SVG and to raw RGBA that is fully opaque', () => {
    const svg = logoSvg(32);
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('crispEdges');
    expect(svg.length).toBeLessThan(40_000);
    const rgba = logoRgba(32);
    expect(rgba).toHaveLength(32 * 32 * 4);
    for (let i = 3; i < rgba.length; i += 4) expect(rgba[i]).toBe(255);
  });
});
