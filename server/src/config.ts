// Loads .env from the repo root and resolves the paths the hub needs. Fails fast on missing certs or passcode.
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS } from '@relief-mesh/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from both server/src (tsx) and server/dist (node)
export const repoRoot = path.resolve(here, '..', '..');

// Always read the root .env, regardless of the cwd npm workspaces run us from (server/).
dotenv.config({ path: path.join(repoRoot, '.env') });

export const config = {
  hubIp: process.env.HUB_IP ?? '127.0.0.1',
  httpsPort: Number(process.env.HTTPS_PORT ?? PORTS.https),
  setupPort: Number(process.env.SETUP_PORT ?? PORTS.setup),
  coordinatorPasscode: process.env.COORDINATOR_PASSCODE ?? '',
  // Server-only. Never exposed to the web app (D10).
  supabaseUrl: (process.env.SUPABASE_URL ?? '').trim(),
  supabaseSecretKey: (process.env.SUPABASE_SECRET_KEY ?? '').trim(),
  certsDir: path.join(repoRoot, 'certs'),
  webDist: path.join(repoRoot, 'web', 'dist'),
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(repoRoot, 'server', 'data'),
};

export const certPaths = {
  cert: path.join(config.certsDir, 'hub.pem'),
  key: path.join(config.certsDir, 'hub-key.pem'),
  rootCA: path.join(config.certsDir, 'rootCA.pem'),
};

export function assertCertsExist(): void {
  const missing = [certPaths.cert, certPaths.key].filter((p) => !existsSync(p));
  if (missing.length) {
    console.error('Missing certificate files:\n  ' + missing.join('\n  '));
    console.error('Run: npm run certs');
    process.exit(1);
  }
}

/** The dashboard passcode guards every report on the hotspot, so a missing or sample value is refused. */
export function assertPasscode(): void {
  const p = config.coordinatorPasscode;
  if (p.length < 8 || p.startsWith('change-me')) {
    console.error('COORDINATOR_PASSCODE in .env is missing, shorter than 8 characters, or still the sample value.');
    console.error('Set it to something only the coordinators know, then start again.');
    process.exit(1);
  }
}
