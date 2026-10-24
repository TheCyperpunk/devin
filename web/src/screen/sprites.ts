// Pixel sprites for the map (GAME-VISUAL "pixel edition"): bitmaps as strings, one char per pixel, '.' = empty.
// Each sprite is drawn as SVG rects on the map's 4-unit pixel grid, anchored at its bottom centre.
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

const housePalette = { R: P.roof, W: P.wall, D: P.wood, Y: P.yellow, K: P.black };

export const SPRITES = {
  house: {
    rows: [
      '......R......',
      '.....RRR.....',
      '....RRRRR....',
      '...RRRRRRR...',
      '..RRRRRRRRR..',
      '.RRRRRRRRRRR.',
      '..WWWWWWWWW..',
      '..WYYWWWYYW..',
      '..WWWWWWWWW..',
      '..WWWWDDWWW..',
      '..WWWWDDWWW..',
    ],
    palette: housePalette,
  },
  houseDark: {
    rows: [
      '......R......',
      '.....RRR.....',
      '....RRRRR....',
      '...RRRRRRR...',
      '..RRRRRRRRR..',
      '.RRRRRRRRRRR.',
      '..WWWWWWWWW..',
      '..WKKWWWKKW..',
      '..WWWWWWWWW..',
      '..WWWWDDWWW..',
      '..WWWWDDWWW..',
    ],
    palette: housePalette,
  },
  houseFlooded: {
    rows: ['......R......', '.....RRR.....', '....RRRRR....', '...RRRRRRR...', '..RRRRRRRRR..', 'FRFRFRFRFRFRF', 'BBBBBBBBBBBBB', 'BBBBBBBBBBBBB'],
    palette: { R: P.roof, F: P.foam, B: P.water2 },
  },
  temple: {
    rows: ['.....Y.....', '....YYY....', '...YYYYY...', '....YYY....', '...WWWWW...', '..WWWWWWW..', '..WWWDWWW..', '..WWWDWWW..', 'YYYYYYYYYYY'],
    palette: { Y: P.yellow, W: P.wall, D: P.wood },
  },
  school: {
    rows: ['.R.........', '.RRRR......', '.R.........', '.R.........', 'WWWWWWWWWWW', 'WYYWWDDWWYYW', 'WWWWWWWWWWW', 'WYYWWDDWWYYW', 'WWWWWWWWWWW'],
    palette: { R: P.red, W: P.wall, Y: P.yellow, D: P.wood },
  },
  camp: {
    rows: ['.....G.....', '....GGG....', '...GGGGG...', '..GGGGGGG..', '.GGGGDGGGG.', 'GGGGDDDGGGG'],
    palette: { G: P.green, D: P.black },
  },
  hospital: {
    rows: ['WWWWWWWWWWW', 'W....R....W', 'W....R....W', 'W..RRRRR..W', 'W....R....W', 'W....R....W', 'WWWWWWWWWWW'],
    palette: { W: P.white, R: P.red },
  },
  jetty: {
    rows: ['DDDDDDDDDDDDD', '.D...D...D...', '.D...D...D...'],
    palette: { D: P.wood },
  },
  junction: {
    rows: ['.G.', 'GGG', '.G.'],
    palette: { G: P.grey },
  },
  boat: {
    rows: ['....KK....', '...KWWK...', 'CCCCCCCCCC', '.CCCCCCCC.', '..CCCCCC..'],
    palette: { K: P.black, W: P.white, C: '#000' },
  },
  palm: {
    rows: ['..G...G..', '.G.G.G.G.', 'G..GGG..G', '...GGG...', '.G.GDG.G.', '....D....', '....D....', '....D....', '...DD....', '...DD....'],
    palette: { G: '#2f9e7b', D: P.wood },
  },
  palmSmall: {
    rows: ['.G.G.', 'G.G.G', '..D..', '..D..', '..D..'],
    palette: { G: '#2f9e7b', D: P.wood },
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
