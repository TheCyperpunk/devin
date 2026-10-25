// The Pralayam logo as a 32x32 pixel scene: a rescue boat with a lit lantern, a child, an elder and a person aboard, on
// dark flood water, with a child waving from a half-drowned roof, under rain. Same 16-colour palette and ramps as the
// map sprites. Pure functions: scripts/make-icons.ts renders them into icon.svg and every PNG icon.
// logoScene(40) is the same scene with a 4-cell margin all round, for maskable icons that launchers crop.
import { P, SPRITES, light, mix, shade, type Sprite } from './sprites.js';

type Layer = Map<string, string>;

const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
const WATER_Y = 19;
const GLOW = [mix(P.blueDark, P.orange, 0.2), mix(P.blueDark, P.orange, 0.4), mix(P.blueDark, P.orange, 0.62)] as const;

function blit(layer: Layer, s: Sprite, x: number, y: number): void {
  s.rows.forEach((row, ry) =>
    [...row].forEach((ch, rx) => {
      if (ch !== '.') layer.set(`${x + rx},${y + ry}`, s.palette[ch] ?? P.white);
    }),
  );
}

/** Black 1-pixel outline around the outside of a layer, then the layer itself. */
function stamp(g: string[][], layer: Layer, off: number): void {
  const put = (x: number, y: number, c: string) => {
    if (g[y + off]?.[x + off] !== undefined) g[y + off]![x + off] = c;
  };
  const cells = [...layer.keys()].map((k) => k.split(',').map(Number) as [number, number]);
  for (const [x, y] of cells)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (!layer.has(`${x + dx},${y + dy}`)) put(x + dx, y + dy, P.black);
  for (const [x, y] of cells) put(x, y, layer.get(`${x},${y}`)!);
}

export function logoScene(cells = 32): string[][] {
  const off = (cells - 32) / 2;
  const g: string[][] = Array.from({ length: cells }, () => Array<string>(cells).fill(P.navy));

  // sky above the waterline, water below; coordinates fx, fy are in the 32x32 frame of the subject
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      const fx = x - off;
      const fy = y - off;
      if (fy < WATER_Y) {
        g[y]![x] = fy <= 10 ? P.navy : fy <= 14 ? ((x + y) % 2 === 0 ? P.blueDark : P.navy) : P.blueDark;
        continue;
      }
      let c: string = fy === WATER_Y ? P.water2 : P.water1;
      if (fy >= 22 && (fy - 22) % 3 === 0 && (((fx + fy * 3) % 9) + 9) % 9 < 2) c = P.water2;
      if (fy >= 21 && hash(fx, fy) % 37 === 0) c = mix(c, P.foam, 0.5);
      if (fy >= 29) c = mix(c, P.navy, 0.4);
      g[y]![x] = c;
    }

  // the lantern's light on the sky: three rings, solid then two dithers, every colour a real mix (no transparency)
  const cx = 15 + off;
  const cy = 9.5 + off;
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      if (y - off >= WATER_Y) continue;
      const a = Math.abs(x + 0.5 - cx);
      const b = Math.abs(y + 0.5 - cy);
      const d = Math.max(a, b) + 0.4 * Math.min(a, b);
      const chk = (x + y) % 2 === 0;
      // a warm ramp (dusk brown, ember, burnt orange), not yellow mixed into navy, which goes khaki
      if (d <= 3.6) g[y]![x] = GLOW[2];
      else if (d <= 5.4) g[y]![x] = chk ? GLOW[2] : GLOW[1];
      else if (d <= 7.2) g[y]![x] = chk ? GLOW[1] : GLOW[0];
      else if (d <= 9 && chk) g[y]![x] = GLOW[0];
    }

  // rain: 2-pixel diagonal streaks
  for (let y = 0; y < cells - 1; y++)
    for (let x = 1; x < cells; x++) {
      const fx = x - off;
      const fy = y - off;
      if (fy >= WATER_Y - 2 || hash(fx, fy) % 59 !== 0) continue;
      if (Math.max(Math.abs(x + 0.5 - cx), Math.abs(y + 0.5 - cy)) <= 9.5) continue;
      g[y]![x] = mix(g[y]![x]!, P.foam, 0.45);
      g[y + 1]![x - 1] = mix(g[y + 1]![x - 1]!, P.foam, 0.45);
    }

  // reflections on the water: the hull in orange, the lantern in broken yellow dashes
  const tint = (fx: number, fy: number, c: string, t: number) => {
    const row = g[fy + off];
    if (row?.[fx + off] !== undefined) row[fx + off] = mix(row[fx + off]!, c, t);
  };
  for (let x = 5; x <= 18; x++) if ((x + 21) % 2 === 0) tint(x, 21, P.orange, 0.4);
  for (let x = 7; x <= 16; x += 2) tint(x, 22, P.orange, 0.25);
  tint(14, 22, P.yellow, 0.6); tint(15, 22, P.yellow, 0.6);
  tint(14, 24, P.yellow, 0.45); tint(15, 24, P.yellow, 0.45);
  tint(15, 26, P.yellow, 0.3);

  // foam where the roof meets the water
  for (let x = 22; x <= 30; x++) {
    tint(x, 19, P.foam, 0.9);
    if ((x + 20) % 2 === 0) tint(x, 20, P.foam, 0.5);
  }

  // the roof of a house in the flood, with a child waving from the ridge
  const roof: Layer = new Map();
  for (let r = 0; r <= 4; r++) {
    const y = 14 + r;
    for (let x = 26 - r; x <= 26 + r; x++) roof.set(`${x},${y}`, x === 26 - r ? light(P.roof) : x === 26 + r || r === 4 ? shade(P.roof) : P.roof);
  }
  blit(roof, SPRITES.child, 25, 11);
  stamp(g, roof, off);

  // the boat: hull in orange with a light deck edge and a shaded keel, a mast, one big lantern, a person and a child aboard
  const boat: Layer = new Map();
  for (let x = 2; x <= 21; x++) boat.set(`${x},18`, light(P.orange));
  for (let x = 3; x <= 20; x++) boat.set(`${x},19`, x % 4 < 2 ? P.orange : P.yellow);
  for (let x = 5; x <= 18; x++) boat.set(`${x},20`, shade(P.orange));
  for (let y = 11; y <= 17; y++) {
    boat.set(`14,${y}`, light(P.wood));
    boat.set(`15,${y}`, P.wood);
  }
  boat.set('14,7', P.wood);
  boat.set('15,7', P.wood);
  for (let y = 8; y <= 10; y++)
    for (let x = 12; x <= 17; x++) boat.set(`${x},${y}`, x >= 13 && x <= 16 && y >= 9 ? light(P.yellow) : P.yellow);
  // a red pennant on a short pole at the stern
  for (let y = 11; y <= 17; y++) boat.set(`4,${y}`, P.wood);
  for (const [x, y] of [[5, 11], [6, 11], [7, 11], [5, 12], [6, 12]] as const) boat.set(`${x},${y}`, y === 11 ? light(P.red) : P.red);
  stamp(g, boat, off);

  return g;
}

/** The scene as an SVG of rects on a cell grid; it scales to any size without blurring. */
export function logoSvg(cells = 32): string {
  const g = logoScene(cells);
  const rects: string[] = [];
  g.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      let e = x;
      while (e + 1 < row.length && row[e + 1] === row[x]) e++;
      rects.push(`<rect x="${x}" y="${y}" width="${e - x + 1}" height="1" fill="${row[x]}"/>`);
      x = e + 1;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cells} ${cells}" shape-rendering="crispEdges"><title>Pralayam</title>${rects.join('')}</svg>\n`;
}

/** The scene as raw RGBA bytes, one pixel per cell, for the PNG renderer. */
export function logoRgba(cells = 32): Uint8Array {
  const out = new Uint8Array(cells * cells * 4);
  logoScene(cells).forEach((row, y) =>
    row.forEach((hex, x) => {
      const i = (y * cells + x) * 4;
      out[i] = parseInt(hex.slice(1, 3), 16);
      out[i + 1] = parseInt(hex.slice(3, 5), 16);
      out[i + 2] = parseInt(hex.slice(5, 7), 16);
      out[i + 3] = 255;
    }),
  );
  return out;
}
