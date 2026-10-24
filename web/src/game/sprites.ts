// Pixel sprites for the map (GAME-VISUAL §0): bitmaps as strings, one char per pixel, '.' = empty, drawn as SVG rects
// on the 4-unit grid, anchored at the bottom centre. Every sprite is lit from the upper-left with one shadow step and
// one light step per material; ramps are hue-shifted (shadows cooler, lights warmer), never just darker or lighter.
import type { BoatColor } from '@pralayam/shared';

export const PX = 4;

export interface Sprite {
  rows: string[];
  palette: Record<string, string>;
}

/** The compact indexed palette (16 colours) every sprite and panel draws from. */
export const P = {
  black: '#0b0b14',
  navy: '#141b33',
  blueDark: '#1c2b55',
  blue: '#2a4ba3',
  water1: '#1f6f8b',
  water2: '#36a3c9',
  foam: '#9be7ff',
  wall: '#e8d9b5',
  roof: '#b5473a',
  wood: '#4a2f1f',
  yellow: '#ffd23f',
  orange: '#ff7b2e',
  red: '#ff3c5f',
  green: '#3fd6a0',
  grey: '#8a93a6',
  white: '#f4f1ea',
} as const;

/** The night ground: the ambient every lamp fades into. */
export const LAND = '#1a2a4d';
const LEAF = '#2f9e7b';

export const COLOR_PX: Record<BoatColor, string> = {
  moss: '#3fd6a0',
  ember: '#ff7b2e',
  lamp: '#ffd23f',
  water: '#36a3c9',
  rose: '#ff5c8a',
  lilac: '#b388ff',
  sand: '#e8c39e',
  sky: '#7cc7ff',
};

// ---- colour ramps (pure; tested in sprites.test.ts)
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}
function fromHsl([h, s, l]: [number, number, number]): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
/** Move a hue toward a target by at most `deg` along the shorter arc. */
function toward(h: number, target: number, deg: number): number {
  let d = ((target - h + 540) % 360) - 180;
  d = Math.max(-deg, Math.min(deg, d));
  return (h + d + 360) % 360;
}

/** Blend two colours (t = 0 → a, 1 → b). Used for solid dither colours so no pixel is ever translucent. */
export function mix(a: string, b: string, t: number): string {
  const A = rgb(a), B = rgb(b);
  return hex([0, 1, 2].map((i) => A[i]! + (B[i]! - A[i]!) * t) as [number, number, number]);
}
/** One shadow step: cooler (toward blue-purple), a little less saturated, darker. */
export function shade(c: string): string {
  const [h, s, l] = toHsl(rgb(c));
  return hex(fromHsl([toward(h, 250, 14), clamp(s - 0.08), clamp(l - 0.16)]));
}
/** One light step: warmer (toward yellow), a little more saturated, lighter. */
export function light(c: string): string {
  const [h, s, l] = toHsl(rgb(c));
  return hex(fromHsl([toward(h, 50, 10), clamp(s + 0.06), clamp(l + 0.14)]));
}

// Glyphs: capitals are a material's base, lower case its shadow, and H/L-style letters its light where named.
const house = { H: light(P.roof), R: P.roof, r: shade(P.roof), W: P.wall, w: shade(P.wall), D: P.wood, d: light(P.wood), Y: P.yellow, K: P.black };
const roofRows = ['......H......', '.....HRr.....', '....HRRRr....', '...HRRRRRr...', '..HRRRRRRRr..', '.HRRRRRRRRRr.'];

export const SPRITES = {
  house: {
    rows: [...roofRows, '..wwwwwwwww..', '..WYYWWWYYw..', '..WWWWWWWWw..', '..WWWWDdWWw..', '..WWWWDdWWw..'],
    palette: house,
  },
  houseDark: {
    rows: [...roofRows, '..wwwwwwwww..', '..WKKWWWKKw..', '..WWWWWWWWw..', '..WWWWDdWWw..', '..WWWWDdWWw..'],
    palette: house,
  },
  houseFlooded: {
    rows: [...roofRows.slice(0, 5), 'FBFBFBFBFBFBF', 'BBBBBBBBBBBBB', 'bbbbbbbbbbbbb'],
    palette: { H: light(P.roof), R: P.roof, r: shade(P.roof), F: P.foam, B: P.water2, b: P.water1 },
  },
  temple: {
    rows: ['.....L.....', '....LYy....', '...LYYYy...', '....LYy....', '...WWWWw...', '..WWWWWWw..', '..WWWDdWw..', '..WWWDdWw..', 'LYYYYYYYYyy'],
    palette: { L: light(P.yellow), Y: P.yellow, y: shade(P.yellow), W: P.wall, w: shade(P.wall), D: P.wood, d: light(P.wood) },
  },
  school: {
    rows: ['.R..........', '.RRRR.......', '.R..........', '.R..........', 'WWWWWWWWWWWw', 'WYYWWDdWWYYw', 'WWWWWWWWWWWw', 'WYYWWDdWWYYw', 'wwwwwwwwwwww'],
    palette: { R: P.red, W: P.wall, w: shade(P.wall), Y: P.yellow, D: P.wood, d: light(P.wood) },
  },
  camp: {
    rows: ['.....L.....', '....LGg....', '...LGGGg...', '..LGGGGGg..', '.LGGGDGGGg.', 'GGGGDDDGGgg'],
    palette: { L: light(P.green), G: P.green, g: shade(P.green), D: P.black },
  },
  hospital: {
    rows: ['WWWWWWWWWWg', 'WNNNNRNNNNg', 'WNNNNRNNNNg', 'WNNRRRRRNNg', 'WNNNNRNNNNg', 'WNNNNRNNNNg', 'ggggggggggg'],
    palette: { W: P.white, g: P.grey, N: P.navy, R: P.red },
  },
  jetty: {
    rows: ['ddddddddddddd', '.D...D...D...', '.k...k...k...'],
    palette: { d: light(P.wood), D: P.wood, k: shade(P.wood) },
  },
  junction: {
    rows: ['.G.', 'GGg', '.g.'],
    palette: { G: P.grey, g: shade(P.grey) },
  },
  /** C/L/c are the crew colour and its ramp, passed as an override; Y is the lantern. */
  boat: {
    rows: ['.....Y......', '.....M......', '....KKK.....', '...KWWWK....', 'LLLLLLLLLLLL', '.CCCCCCCCCC.', '..cccccccc..'],
    palette: { Y: P.yellow, M: P.wood, K: P.black, W: P.white, L: '#000', C: '#000', c: '#000' },
  },
  palm: {
    rows: ['..G...G..', '.G.G.G.G.', 'G..GGG..G', '...GgG...', '.g.GDg.g.', '....D....', '....D....', '....D....', '...dD....', '...dD....'],
    palette: { G: LEAF, g: shade(LEAF), D: P.wood, d: light(P.wood) },
  },
  palmSmall: {
    rows: ['.G.G.', 'G.G.G', '..D..', '..D..', '..D..'],
    palette: { G: LEAF, D: P.wood },
  },
  person: {
    rows: ['.W.', 'WWW', '.W.', 'W.W'],
    palette: { W: P.white },
  },
  child: {
    rows: ['.Y.', 'YYY', 'Y.Y'],
    palette: { Y: P.yellow },
  },
  elder: {
    rows: ['.W.D', 'WWWD', '.W.D', 'W.W.'],
    palette: { W: P.white, D: P.wood },
  },
  kitWater: {
    rows: ['..B..', '.BBB.', 'BBBBB', '.BFB.'],
    palette: { B: P.water2, F: P.foam },
  },
  kitFood: {
    rows: ['.....', 'WWWWW', '.WWW.', '..W..'],
    palette: { W: P.wall },
  },
  kitMed: {
    rows: ['.RRR.', 'RRWRR', 'RWWWR', 'RRWRR'],
    palette: { R: P.red, W: P.white },
  },
  star: {
    rows: ['....Y....', '...YYY...', 'YYYYYYYYY', '.YYYYYYY.', '..YYYYY..', '.YYY.YYY.', 'YY.....YY'],
    palette: { Y: P.yellow },
  },
  starOff: {
    rows: ['....G....', '...G.G...', 'GGGG.GGGG', '.G.....G.', '..G...G..', '.G.G.G.G.', 'GG.....GG'],
    palette: { G: P.grey },
  },
  radioOff: {
    rows: ['G...G', '.G.G.', '..G..', '.G.G.', 'G...G'],
    palette: { G: P.grey },
  },
} satisfies Record<string, Sprite>;

export type SpriteName = keyof typeof SPRITES;

/** Snap a map coordinate to the pixel grid. */
export const snap = (v: number) => Math.round(v / (PX * 2)) * (PX * 2);

/** The rects of a sprite, relative to its bottom-centre anchor. */
export function spriteRects(s: Sprite, px = PX, override?: Record<string, string>): { x: number; y: number; w: number; h: number; fill: string }[] {
  const out: { x: number; y: number; w: number; h: number; fill: string }[] = [];
  const width = Math.max(...s.rows.map((r) => r.length));
  const height = s.rows.length;
  s.rows.forEach((row, ry) => {
    // merge runs of the same colour into one rect to keep the DOM small
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      if (c === '.') {
        x++;
        continue;
      }
      let end = x;
      while (end + 1 < row.length && row[end + 1] === c) end++;
      const fill = override?.[c] ?? s.palette[c] ?? P.white;
      out.push({ x: (x - width / 2) * px, y: (ry - height) * px, w: (end - x + 1) * px, h: px, fill });
      x = end + 1;
    }
  });
  return out;
}
