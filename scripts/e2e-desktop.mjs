// Real check of the desktop app: the launcher starts a throwaway hub, opens the big screen in its own app window without
// a certificate warning, and closing the window stops the hub. Uses its own ports, data and browser profile.
// Usage: npm run e2e:desktop
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'pralayam-desktop-'));
const PORT = 3653;
const DEBUG = 9333;

let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = () =>
  new Promise((resolve) => {
    const req = https.get({ host: '127.0.0.1', port: PORT, path: '/api/health', rejectUnauthorized: false, timeout: 1000 }, (res) => (res.resume(), resolve(res.statusCode === 200)));
    req.on('error', () => resolve(false));
    req.on('timeout', () => (req.destroy(), resolve(false)));
  });
const until = async (fn, ms = 20000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
};

const env = { ...process.env, HTTPS_PORT: String(PORT), SETUP_PORT: '8280', DATA_DIR: path.join(tmp, 'data'), PRALAYAM_PROFILE_DIR: path.join(tmp, 'profile') };

// --check never starts anything
const check = spawn(process.execPath, [path.join(root, 'scripts', 'desktop.mjs'), '--check'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let checkOut = '';
check.stdout.on('data', (d) => (checkOut += d));
const checkCode = await new Promise((r) => check.on('exit', r));
ok(checkCode === 0 && /not running \(the app will start it\)/.test(checkOut), '--check reports the setup and that the hub is not running');
ok(!(await up()), '--check did not start a hub');

const app = spawn(process.execPath, [path.join(root, 'scripts', 'desktop.mjs'), `--browser-arg=--remote-debugging-port=${DEBUG}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let appOut = '';
app.stdout.on('data', (d) => (appOut += d));
app.stderr.on('data', (d) => (appOut += d));
const exited = new Promise((r) => app.on('exit', r));

try {
  ok(await until(up), 'launcher started the hub');
  ok(await until(async () => (await fetch(`http://127.0.0.1:${DEBUG}/json/version`).then((r) => r.ok, () => false))), 'launcher opened the app window');
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes('/screen.html'));
  ok(Boolean(page), 'the window is on /screen.html');
  if (page) {
    const shown = await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('enter the coordinator passcode'), { timeout: 15000 }).then(() => true, () => false);
    ok(shown, 'the big screen loaded with no certificate warning (host login is shown)');
    const standalone = await page.evaluate(() => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches);
    ok(standalone, 'the window is an app window (no tabs, no address bar)');
  }
  ok(/Pralayam is running/.test(appOut) && /screen\.html/.test(appOut), 'launcher printed the screen address');
  await browser.close().catch(() => {});
  const code = await Promise.race([exited, sleep(15000).then(() => 'timeout')]);
  ok(code !== 'timeout', 'the launcher exits when the window closes');
  ok(await until(async () => !(await up()), 10000), 'the hub it started is stopped');
} finally {
  app.kill();
  await sleep(500);
  rmSync(tmp, { recursive: true, force: true });
}
if (failed) {
  console.log(`${failed} CHECK(S) FAILED\n--- launcher output ---\n${appOut}`);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
