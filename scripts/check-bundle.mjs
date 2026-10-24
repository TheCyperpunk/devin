// Fails if the host passcode (or a secret-looking marker) appears in the built web app: secrets stay on the hub.
// Usage: npm run check:bundle   (after npm run build)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web', 'dist');
if (!existsSync(dist)) {
  console.error('web/dist not found. Run: npm run build');
  process.exit(1);
}

const env = existsSync(path.join(root, '.env')) ? readFileSync(path.join(root, '.env'), 'utf8') : '';
const secrets = [];
for (const key of ['COORDINATOR_PASSCODE']) {
  const m = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
  if (m && m[1].trim().length >= 8) secrets.push({ name: key, value: m[1].trim() });
}
const markers = [{ name: 'secret key prefix', value: 'sb_secret_' }];

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html|json|webmanifest|map)$/.test(f)) files.push(p);
  }
})(dist);

let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const s of [...secrets, ...markers]) {
    if (text.includes(s.value)) {
      console.error(`LEAK: ${s.name} found in ${path.relative(root, f)}`);
      bad++;
    }
  }
}
console.log(`${files.length} files checked, ${secrets.length} secret value(s) from .env + ${markers.length} markers: ${bad ? bad + ' LEAK(S)' : 'clean'}`);
process.exit(bad ? 1 : 0);
