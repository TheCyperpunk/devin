// Pralayam as a desktop app: checks the setup, starts the hub if it is not already running, opens the big screen in its
// own Edge/Chrome app window (no address bar, own profile, our certificate trusted by fingerprint), and stops the hub
// when that window closes. No new dependencies; see docs/DESKTOP.md.
// Usage: npm run app                  (flags: --check  --fullscreen  --keep-hub  --browser-arg=<flag>)
import { X509Certificate, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const extraBrowserArgs = args.filter((a) => a.startsWith('--browser-arg=')).map((a) => a.slice('--browser-arg='.length));

// ---- config: the process environment wins over .env, exactly as on the hub
const env = { ...process.env };
try {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .env: the checks below say so */
}
const hubIp = env.HUB_IP ?? '127.0.0.1';
const httpsPort = Number(env.HTTPS_PORT ?? 3443);
const setupPort = Number(env.SETUP_PORT ?? 8080);
const screenUrl = `https://localhost:${httpsPort}/screen.html`;

const say = (s = '') => console.log(s);
const problems = [];
const notes = [];

// ---- checks
const certFile = path.join(root, 'certs', 'hub.pem');
if (!existsSync(path.join(root, '.env'))) problems.push('No .env file. Copy .env.example to .env and set HUB_IP and COORDINATOR_PASSCODE.');
else if ((env.COORDINATOR_PASSCODE ?? '').length < 8 || (env.COORDINATOR_PASSCODE ?? '').startsWith('change-me')) problems.push('COORDINATOR_PASSCODE in .env is missing, shorter than 8 characters, or still the sample value.');
if (!existsSync(certFile) || !existsSync(path.join(root, 'certs', 'hub-key.pem'))) problems.push('No certificate. Run: npm run certs');
const ipv4 = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4').map((i) => i.address);
if (hubIp !== '127.0.0.1' && !ipv4.includes(hubIp)) notes.push(`HUB_IP ${hubIp} is not an address of this laptop right now (${ipv4.join(', ') || 'no network'}). The screen works here, but phones cannot reach the hub until the hotspot or Wi-Fi is up.`);

function findBrowser() {
  const pf = env['ProgramFiles'] ?? 'C:/Program Files';
  const pf86 = env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)';
  const local = env.LOCALAPPDATA ?? '';
  return [
    env.PRALAYAM_BROWSER,
    `${pf86}/Microsoft/Edge/Application/msedge.exe`,
    `${pf}/Microsoft/Edge/Application/msedge.exe`,
    `${pf}/Google/Chrome/Application/chrome.exe`,
    `${pf86}/Google/Chrome/Application/chrome.exe`,
    local && `${local}/Google/Chrome/Application/chrome.exe`,
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => p && existsSync(p));
}
const browser = findBrowser();
if (!browser) notes.push('No Edge or Chrome found. The hub will still start; open ' + screenUrl + ' in any browser, or set PRALAYAM_BROWSER=<path>.');

/** The fingerprint of the hub certificate's public key, so this app trusts our certificate and nothing else. */
function spki() {
  const cert = new X509Certificate(readFileSync(certFile));
  return createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
}

function health() {
  return new Promise((resolve) => {
    const req = https.get({ host: '127.0.0.1', port: httpsPort, path: '/api/health', rejectUnauthorized: false, timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => (req.destroy(), resolve(false)));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (has('--check')) {
  const running = !problems.length && (await health());
  say('Pralayam desktop app: setup check');
  say(`  screen    ${screenUrl}`);
  say(`  hub IP    ${hubIp}   setup page http://${hubIp}:${setupPort}`);
  say(`  browser   ${browser ?? 'none found'}`);
  say(`  hub       ${running ? 'already running on this laptop (the app will use it)' : 'not running (the app will start it)'}`);
  say(`  build     ${existsSync(path.join(root, 'server', 'dist', 'index.js')) && existsSync(path.join(root, 'web', 'dist', 'index.html')) ? 'present' : 'missing (the app will run npm run build)'}`);
  for (const n of notes) say('  note: ' + n);
  for (const p of problems) say('  PROBLEM: ' + p);
  process.exit(problems.length ? 1 : 0);
}

if (problems.length) {
  for (const p of problems) console.error('Cannot start: ' + p);
  process.exit(1);
}

// ---- build once if needed
if (!existsSync(path.join(root, 'server', 'dist', 'index.js')) || !existsSync(path.join(root, 'web', 'dist', 'index.html'))) {
  say('First run: building the game (about a minute)...');
  const r = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('The build failed. Fix it with: npm run build');
    process.exit(1);
  }
}

// ---- hub: reuse a running one, else start ours
let hub = null;
if (await health()) {
  say(`A hub is already running on port ${httpsPort}; using it.`);
} else {
  say('Starting the hub...');
  hub = spawn(process.execPath, [path.join(root, 'server', 'dist', 'index.js')], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
  let exited = false;
  hub.on('exit', (code) => {
    exited = true;
    if (!shuttingDown) {
      console.error(`The hub stopped (exit ${code}).`);
      process.exit(1);
    }
  });
  for (let i = 0; i < 60 && !exited && !(await health()); i++) await sleep(250);
  if (exited || !(await health())) {
    console.error('The hub did not come up. Read the messages above.');
    hub.kill();
    process.exit(1);
  }
}
let shuttingDown = false;
const stopHub = () => {
  shuttingDown = true;
  if (hub && !has('--keep-hub')) hub.kill();
};
process.on('SIGINT', () => (stopHub(), process.exit(0)));
process.on('SIGTERM', () => (stopHub(), process.exit(0)));

say('');
say('  Pralayam is running.');
say(`  Big screen   ${screenUrl}   (log in with the host passcode from .env)`);
say(`  Phones       join over the hotspot or Wi-Fi at https://${hubIp}:${httpsPort}  (new phones: http://${hubIp}:${setupPort} first)`);
for (const n of notes) say('  Note: ' + n);
say('  Closing the app window stops the hub' + (hub ? '.' : ' only if this launcher started it; it did not.'));
say('');

if (!browser) {
  say('Press Ctrl+C to stop.');
  await new Promise(() => {});
}

// ---- the app window: its own profile so these flags always apply, and so it never touches the user's browser
const profile = env.PRALAYAM_PROFILE_DIR ?? path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), '.config'), 'Pralayam', `app-profile-${httpsPort}`);
mkdirSync(profile, { recursive: true });
const flags = [
  `--app=${screenUrl}`,
  `--user-data-dir=${profile}`,
  `--ignore-certificate-errors-spki-list=${spki()}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  has('--fullscreen') ? '--start-fullscreen' : '--start-maximized',
  ...extraBrowserArgs,
];
const win = spawn(browser, flags, { stdio: 'ignore' });
win.on('exit', () => {
  say('The app window closed.');
  stopHub();
  process.exit(0);
});
win.on('error', (e) => {
  console.error('Could not open the app window: ' + e.message);
  stopHub();
  process.exit(1);
});
