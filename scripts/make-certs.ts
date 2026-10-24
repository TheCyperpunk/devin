// Generates certs/hub.pem + hub-key.pem with mkcert for HUB_IP (+ CERT_EXTRA_HOSTS) and copies rootCA.pem.
// Usage: npm run certs      (reads .env in the repo root)
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certsDir = path.join(repoRoot, 'certs');

const hubIp = process.env.HUB_IP;
if (!hubIp) {
  console.error('HUB_IP is not set. Copy .env.example to .env and set HUB_IP to the laptop IP on the demo network.');
  process.exit(1);
}
const extra = (process.env.CERT_EXTRA_HOSTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const hosts = Array.from(new Set(['localhost', '127.0.0.1', '::1', hubIp, ...extra]));

function mkcert(args: string[]): string {
  try {
    return execFileSync('mkcert', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      // Only the OS trust store matters here. Without this, mkcert also tries the Java keystore
      // (when a JDK is installed) and fails with "Access is denied" on Windows.
      env: { ...process.env, TRUST_STORES: 'system' },
    });
  } catch (err) {
    console.error('mkcert failed. Is it installed? (winget install FiloSottile.mkcert / brew install mkcert)');
    throw err;
  }
}

mkdirSync(certsDir, { recursive: true });

console.log('Installing the local CA into this laptop\'s trust store (no-op if already done)…');
mkcert(['-install']);

console.log('Issuing hub certificate for: ' + hosts.join(', '));
mkcert(['-cert-file', path.join(certsDir, 'hub.pem'), '-key-file', path.join(certsDir, 'hub-key.pem'), ...hosts]);

const caRoot = mkcert(['-CAROOT']).trim();
const rootCA = path.join(caRoot, 'rootCA.pem');
if (!existsSync(rootCA)) {
  console.error('rootCA.pem not found in ' + caRoot);
  process.exit(1);
}
// Only the public root certificate is copied. rootCA-key.pem stays in CAROOT and is never served.
copyFileSync(rootCA, path.join(certsDir, 'rootCA.pem'));

console.log(`
Done.
  certs/hub.pem, certs/hub-key.pem  -> used by the HTTPS hub on :3443
  certs/rootCA.pem                  -> served to phones by the setup page on :8080
Re-run this script whenever HUB_IP changes (and remember: phones then also need the new URL).`);
