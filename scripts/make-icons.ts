// Renders web/public/icon.svg into the PNG icons Chrome needs before it will offer to install the PWA.
// Usage: npm run icons   (output is committed, so this only needs re-running if icon.svg changes)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public');
const svg = readFileSync(path.join(pub, 'icon.svg'));
const GREEN = '#0b6e4f';

async function plain(size: number, file: string) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(path.join(pub, file));
}

// Maskable icons are cropped by the launcher: keep the artwork inside the central 80% on a solid background.
async function maskable(size: number, file: string) {
  const inner = Math.round(size * 0.62);
  const art = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: GREEN } })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toFile(path.join(pub, file));
}

await plain(192, 'icon-192.png');
await plain(512, 'icon-512.png');
await plain(180, 'apple-touch-icon.png');
await maskable(512, 'icon-maskable-512.png');
console.log('Wrote icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png in web/public');
