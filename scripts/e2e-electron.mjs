// Real check of the Electron app: it starts a throwaway hub, opens the big screen in its own window with no certificate
// warning, closing the window quits the app and stops the hub; and the setup window opens when asked for.
// Usage: npm run e2e:electron
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(path.join(root, 'desktop', 'package.json'))('electron');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'pralayam-electron-'));
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'pralayam-shots-electron');
mkdirSync(shots, { recursive: true });
const PORT = 3753;
const DEBUG = 9334;

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
const until = async (fn, ms = 30000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
};
const kill = (p) => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else p.kill('SIGKILL');
};

const env = { ...process.env, HTTPS_PORT: String(PORT), SETUP_PORT: '8380', DATA_DIR: path.join(tmp, 'data'), PRALAYAM_USER_DATA: path.join(tmp, 'userdata') };
delete env.ELECTRON_RUN_AS_NODE;
const launch = (extraEnv = {}) => {
  const p = spawn(electron, [path.join(root, 'desktop'), `--remote-debugging-port=${DEBUG}`], { env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.out = '';
  p.stdout.on('data', (d) => (p.out += d));
  p.stderr.on('data', (d) => (p.out += d));
  p.exited = new Promise((r) => p.on('exit', r));
  return p;
};
const connect = () => puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG}`, defaultViewport: null });
const pageWith = async (browser, part) => (await browser.pages()).find((p) => p.url().includes(part));

// ---- 1. normal start: hub, screen window, close = quit
let app = launch();
try {
  ok(await until(up), 'app started the hub');
  ok(await until(() => fetch(`http://127.0.0.1:${DEBUG}/json/version`).then((r) => r.ok, () => false)), 'app exposes its window for the test');
  const browser = await connect();
  const page = await until(() => pageWith(browser, '/screen.html'), 10000) ? await pageWith(browser, '/screen.html') : null;
  ok(Boolean(page), 'the window is on /screen.html');
  if (page) {
    const shown = await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('enter the coordinator passcode'), { timeout: 20000 }).then(() => true, () => false);
    ok(shown, 'the big screen loaded through the app\'s certificate trust (host login shown)');
    ok(await page.evaluate(() => location.protocol === 'https:' && !document.body.innerText.includes('ERR_CERT')), 'served over https with no certificate error page');
    await page.screenshot({ path: path.join(shots, '1-screen-window.png') });
    const title = await page.title();
    ok(/pralayam/i.test(title), `window title is the game's (${title})`);
  }
  // close the window through the debugger, as a user closing it: the app must quit and stop its hub
  const target = (await browser.targets()).find((t) => t.url().includes('/screen.html'));
  const cdp = await target.createCDPSession();
  await cdp.send('Browser.close').catch(() => {});
  browser.disconnect();
  const code = await Promise.race([app.exited, sleep(15000).then(() => 'timeout')]);
  ok(code !== 'timeout', 'closing the window quits the app');
  ok(await until(async () => !(await up()), 10000), 'the hub the app started is stopped');
} finally {
  kill(app);
  await sleep(500);
}

// ---- 2. the setup window, on request
app = launch({ PRALAYAM_SETUP: '1' });
try {
  ok(await until(() => fetch(`http://127.0.0.1:${DEBUG}/json/version`).then((r) => r.ok, () => false)), 'setup mode: app window reachable');
  const browser = await connect();
  const page = (await until(() => pageWith(browser, 'setup.html'), 10000)) ? await pageWith(browser, 'setup.html') : null;
  ok(Boolean(page), 'setup mode opens setup.html');
  if (page) {
    const text = await page.waitForFunction(() => document.body.innerText.includes('Hub IP') && document.body.innerText.includes('Certificate'), { timeout: 15000 }).then(() => true, () => false);
    ok(text, 'setup shows the hub IP, passcode and certificate sections');
    const passVisible = await page.$eval('#passcode', (el) => el.type === 'password' && el.value.length >= 8);
    ok(passVisible, 'the passcode field is prefilled and masked');
    await page.screenshot({ path: path.join(shots, '2-setup-window.png'), fullPage: true });
    ok(await page.evaluate(() => typeof window.require === 'undefined' && typeof window.process === 'undefined'), 'the setup page has no Node access');
  }
  ok(!(await up()), 'setup mode did not start a hub');
  browser.disconnect();
} finally {
  kill(app);
  await sleep(500);
  rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.log(`${failed} CHECK(S) FAILED\n--- app output ---\n${app.out}`);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
