// Real-browser check of the G3 gate against a RUNNING hub: the big screen logs in, opens a lobby, starts a bot
// night, watches rounds resolve (skip), reaches first light; nothing is loaded from outside the hub; fonts are local.
// Usage: npm run e2e:screen    (env: E2E_ORIGIN, E2E_SHOTS, BROWSER — same as the other e2e scripts)
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = process.env.E2E_ORIGIN ?? 'https://localhost:3443';
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'relief-shots-screen');
mkdirSync(shots, { recursive: true });
const exe = [
  process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
if (!exe) throw new Error('No Chrome/Edge found; set BROWSER=path');
const passcode = (readFileSync(path.join(root, '.env'), 'utf8').match(/^COORDINATOR_PASSCODE=(.*)$/m) ?? [])[1]?.trim();

let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failed++;
};
const text = (page) => page.evaluate(() => document.body.innerText);
// Case-insensitive: labels are uppercased by CSS and innerText reflects that.
const waitText = (page, s, ms = 8000) =>
  page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), { timeout: ms, polling: 100 }, s).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickHost = (page, name) => page.$eval(`[data-host=${name}]`, (el) => el.click());
const waitHost = (page, name, ms = 8000) => page.waitForSelector(`[data-host=${name}]`, { timeout: ms }).then(() => true, () => false);

const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: mkdtempSync(path.join(os.tmpdir(), 'relief-profile-')) });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  const external = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== ORIGIN && !u.href.startsWith('data:')) external.push(u.href);
  });
  page.on('pageerror', (e) => ok(false, 'page error: ' + e.message));

  // ---- login
  await page.goto(ORIGIN + '/screen.html', { waitUntil: 'networkidle0' });
  ok(await waitText(page, 'Enter the coordinator passcode'), 'screen: login shown');
  await page.type('input[name=passcode]', passcode);
  await page.$eval('button[type=submit]', (el) => el.click());
  ok(await waitHost(page, 'new'), 'screen: logged in, no game yet, "Open the lobby" offered');
  ok(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check("16px 'Press Start 2P'") && document.fonts.check("600 20px 'Pixelify Sans'"); }), 'fonts: Press Start 2P and Pixelify Sans loaded from the hub');
  await page.screenshot({ path: path.join(shots, '1-no-game.png') });

  // ---- lobby
  await page.select('select', '30');
  await clickHost(page, 'new');
  ok(await waitText(page, 'Crews at the jetty'), 'lobby: opened');
  ok(await page.$('img.bigqr') !== null, 'lobby: QR code shown');
  ok(await waitText(page, 'how to play'), 'lobby: one-line "how to play" for late arrivals');
  ok((await text(page)).includes('Scan to crew a boat'), 'lobby: join instructions');
  await page.screenshot({ path: path.join(shots, '2-lobby.png') });

  // ---- start: bots, round 1, map elements
  await clickHost(page, 'start');
  ok(await waitText(page, 'Calls by urgency'), 'playing: panel shown');
  await sleep(300);
  const boats = await page.$$eval('.map .boat', (els) => els.length);
  ok(boats === 3, `playing: three bot boats on the map (${boats})`);
  const calls = await page.$$eval('.map .call', (els) => els.length);
  ok(calls === 2, `playing: two call rings in round 1 (${calls})`);
  ok((await page.$eval('[data-testid=round]', (el) => el.innerText)) === '1', 'playing: round 1');
  const timer = await page.$eval('[data-testid=timer]', (el) => el.innerText);
  ok(/^0:[0-3]\d$/.test(timer), `playing: countdown running (${timer})`);
  ok((await text(page)).includes('NO SIGNAL'), 'map: dead zones labelled');
  await page.screenshot({ path: path.join(shots, '3-round1.png') });

  // ---- rounds: skip three times, boats move, toasts appear, water rises after round 3
  for (let i = 0; i < 3; i++) {
    await clickHost(page, 'skip-round');
    await sleep(250);
  }
  ok(await waitText(page, 'Water 1'), 'rounds: water rose after round 3');
  ok((await page.$eval('[data-testid=round]', (el) => el.innerText)) === '4', 'rounds: round 4 after three skips');
  const toasts = await page.$$eval('.toast', (els) => els.length);
  ok(toasts > 0, `rounds: event toasts shown (${toasts})`);
  const moved = await page.$$eval('.map .boat', (els) => new Set(els.map((e) => e.style.transform)).size);
  ok(moved >= 2, `rounds: boats spread out across the map (${moved} positions)`);
  await page.screenshot({ path: path.join(shots, '4-round4.png') });

  // ---- pause / resume
  await clickHost(page, 'pause');
  ok(await waitText(page, 'Paused'), 'host: pause shows Paused');
  await clickHost(page, 'resume');
  ok(await waitHost(page, 'pause'), 'host: resume');

  // ---- to first light
  for (let i = 0; i < 7; i++) {
    await clickHost(page, 'skip-round');
    await sleep(200);
  }
  ok(await waitText(page, 'First light'), 'end: first light screen');
  const score = await page.$eval('.endPanel .num.huge', (el) => el.innerText);
  ok(Number(score) === 170, `end: three bots score 170 (${score})`);
  ok((await text(page)).toLowerCase().includes('people saved'), 'end: stats with the 2018 lines');
  ok((await text(page)).includes('exactly once'), 'end: closing line');
  await page.screenshot({ path: path.join(shots, '5-first-light.png') });

  // ---- play again, and layout at a smaller projector
  await clickHost(page, 'new');
  ok(await waitText(page, 'Crews at the jetty'), 'end: Play again opens a fresh lobby');
  await page.setViewport({ width: 1280, height: 720 });
  await sleep(200);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, `layout: no horizontal overflow at 1280 px (${over})`);

  ok(external.length === 0, `offline: no request left the hub${external.length ? ' — ' + external.slice(0, 3).join(', ') : ''}`);
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
console.log('Screenshots:', shots);
process.exit(failed ? 1 : 0);
