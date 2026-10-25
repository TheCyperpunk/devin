// Draws the Pralayam logo (web/src/game/logo.ts) into icon.svg and every PNG icon the phone app and the desktop app use.
// Usage: npm run icons   (output is committed, so this only needs re-running if the logo changes)
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { logoRgba, logoSvg } from '../web/src/game/logo.js';

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public');
const scene = (cells: number) => sharp(Buffer.from(logoRgba(cells)), { raw: { width: cells, height: cells, channels: 4 } });

writeFileSync(path.join(pub, 'icon.svg'), logoSvg(32));

// whole-number scaling keeps every pixel square: 32 cells -> 192 (6x) and 512 (16x)
await scene(32).resize(192, 192, { kernel: 'nearest' }).png().toFile(path.join(pub, 'icon-192.png'));
const big = await scene(32).resize(512, 512, { kernel: 'nearest' }).png().toBuffer();
await sharp(big).png().toFile(path.join(pub, 'icon-512.png'));
// Apple wants 180: scale the crisp 512 down once
await sharp(big).resize(180, 180).png().toFile(path.join(pub, 'apple-touch-icon.png'));
// Maskable: the same scene with a 4-cell margin all round, so a launcher can crop to a circle and keep the boat
const wide = await scene(40).resize(1280, 1280, { kernel: 'nearest' }).png().toBuffer();
await sharp(wide).resize(512, 512).png().toFile(path.join(pub, 'icon-maskable-512.png'));
console.log('Wrote icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png in web/public');
