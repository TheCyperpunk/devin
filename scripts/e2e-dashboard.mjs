// Real-browser check of the Phase 6 gate with two windows against a RUNNING hub:
//   phone submits -> dashboard shows it in < 2 s -> coordinator assigns -> phone shows it -> done -> both update,
//   all without ever opening the map; then the map and join tabs, reload, logout, and layout at several widths.
// Usage: npm run e2e:dashboard    (same env vars as e2e-volunteer.mjs: E2E_ORIGIN, E2E_DB, E2E_SHOTS, BROWSER)
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = process.env.E2E_ORIGIN ?? 'https://localhost:3443';
const DB = process.env.E2E_DB ?? path.join(root, 'server', 'data', 'hub.db');
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'relief-shots-dash');
mkdirSync(shots, { recursive: true });

const exe = [
  process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
if (!exe) throw new Error('No Chrome/Edge found; set BROWSER=path');

const sql = (q, ...a) => new Database(DB, { readonly: true }).prepare(q).all(...a);
const joinCodeNow = () => sql("select value from meta where key = 'join_code'")[0].value;
const passcode = (readFileSync(path.join(root, '.env'), 'utf8').match(/^COORDINATOR_PASSCODE=(.*)$/m) ?? [])[1]?.trim();

let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failed++;
};
const text = (page) => page.evaluate(() => document.body.innerText);
const waitText = (page, s, ms = 8000) =>
  // Interval polling: the default (animation frames) never fires in a background tab, and this script keeps two open.
  page.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms, polling: 100 }, s).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (page, sel) => page.$eval(sel, (el) => el.click());
const clickTab = (page, name) =>
  page.evaluate((n) => [...document.querySelectorAll('[role=tab]')].find((b) => b.innerText.includes(n))?.click(), name);
const typeInto = async (page, sel, value) => {
  await page.$eval(sel, (el) => (el.value = ''));
  await page.type(sel, value);
};

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  userDataDir: mkdtempSync(path.join(os.tmpdir(), 'relief-profile-')),
});
const who = 'Dash E2E ' + Date.now().toString(36);
try {
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(ORIGIN, ['geolocation']);

  // ---- dashboard: login
  const dash = await browser.newPage();
  await dash.setViewport({ width: 1280, height: 860 });
  dash.on('pageerror', (e) => ok(false, 'dashboard page error: ' + e.message));
  await dash.goto(ORIGIN + '/dashboard.html', { waitUntil: 'networkidle0' });
  ok(await waitText(dash, 'Coordinator'), 'dashboard: login screen');
  await typeInto(dash, 'input[name=passcode]', 'wrong-passcode');
  await tap(dash, 'button[type=submit]');
  ok(await waitText(dash, 'Wrong passcode.'), 'dashboard: wrong passcode is refused');
  await typeInto(dash, 'input[name=passcode]', passcode);
  await tap(dash, 'button[type=submit]');
  ok(await waitText(dash, 'Reports ('), 'dashboard: logged in');
  ok(await waitText(dash, 'Live', 8000), 'dashboard: live socket connected');
  const leafletLoaded = () => dash.evaluate(() => performance.getEntriesByType('resource').some((r) => /MapView|leaflet/i.test(r.name)));
  ok(!(await leafletLoaded()), 'dashboard: map code NOT downloaded until the Map tab is opened');
  await dash.screenshot({ path: path.join(shots, '1-login-done.png') });

  // ---- phone: pair
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.setGeolocation({ latitude: 10.1076, longitude: 76.3516, accuracy: 20 });
  phone.on('pageerror', (e) => ok(false, 'phone page error: ' + e.message));
  await phone.goto(`${ORIGIN}/?join=${joinCodeNow()}`, { waitUntil: 'networkidle0' });
  await phone.type('input[name=name]', who);
  await tap(phone, 'button[type=submit]');
  ok(await waitText(phone, 'New report'), 'phone: paired');
  await waitText(phone, 'Location saved');

  // ---- gate 1: phone submit -> dashboard in < 2 s
  const submit = async (needs, people, note) => {
    await clickTab(phone, 'New report');
    for (const n of needs) await tap(phone, `[data-need=${n}]`);
    for (let i = 1; i < people; i++) await tap(phone, 'button[aria-label="Add one more person"]');
    await phone.type('textarea[name=note]', note);
    const t0 = Date.now();
    await tap(phone, '[data-testid=submit]');
    const seen = await waitText(dash, note, 2000);
    return { seen, ms: Date.now() - t0 };
  };
  await tap(phone, '[data-toggle=urgent]');
  const r1 = await submit(['medical', 'rescue'], 3, 'from phone ' + who + ' one');
  ok(r1.seen, `dashboard shows the phone's report within 2 s (${r1.ms} ms)`);
  ok(await dash.$('.row.new') !== null, 'dashboard: new report is highlighted');
  const rowSel = `.row[data-id]`;
  const firstRow = await dash.$eval(rowSel, (el) => el.innerText);
  ok(/Medical/.test(firstRow) && /Rescue/.test(firstRow) && /3 people/.test(firstRow) && /Urgent/.test(firstRow), 'dashboard: row shows needs, people, urgent flag');
  ok((await dash.$eval(rowSel, (el) => el.className)).includes('band-red'), 'dashboard: medical+rescue+urgent is red');
  ok(await waitText(dash, '1 open'), 'dashboard: counter shows 1 open');
  await dash.screenshot({ path: path.join(shots, '2-arrived.png') });

  // ---- gate 2: assign on the dashboard -> phone shows it
  await tap(dash, rowSel);
  ok(await waitText(dash, 'base'), 'dashboard: detail panel opens with the score breakdown');
  ok(await dash.$eval('[data-action=assign]', (b) => b.disabled), 'dashboard: Assign is disabled until a team is typed');
  await dash.type('input[name=assignee]', 'Boat team 1');
  const t1 = Date.now();
  await tap(dash, '[data-action=assign]');
  ok(await waitText(dash, 'Assigned to Boat team 1'), 'dashboard: detail shows the assignment');
  ok(await waitText(phone, 'My reports'), 'phone: still up');
  await clickTab(phone, 'My reports');
  ok(await waitText(phone, 'Assigned to Boat team 1', 5000), `phone shows "Assigned to Boat team 1" (${Date.now() - t1} ms)`);
  ok(await waitText(dash, '1 assigned'), 'dashboard: counter shows 1 assigned');
  await dash.screenshot({ path: path.join(shots, '3-assigned.png') });

  // ---- gate 3: done -> both update; done sorts last
  const r2 = await submit(['water'], 6, 'from phone ' + who + ' two');
  ok(r2.seen, `second report shows within 2 s (${r2.ms} ms)`);
  await tap(dash, `.row[data-id]`); // top row = most urgent = the red one
  await tap(dash, '[data-action=done]');
  ok(await waitText(dash, '1 done'), 'dashboard: counter shows 1 done');
  await clickTab(phone, 'My reports');
  ok(await waitText(phone, 'Done', 5000), 'phone shows "Done"');
  const order = await dash.$$eval('.row[data-id]', (els) => els.map((e) => e.className.includes('band-done')));
  ok(order.length === 2 && order[0] === false && order[1] === true, 'dashboard: done report sorted last and greyed');
  ok(await dash.$('[data-action=reopen]') !== null, 'dashboard: done report offers Reopen');
  await dash.screenshot({ path: path.join(shots, '4-done.png') });

  // ---- note edit from the dashboard reaches the phone
  await tap(dash, '.row[data-id]:not(.band-done)');
  await typeInto(dash, 'textarea[name=note]', 'edited by coordinator');
  await dash.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText === 'Save note')?.click());
  ok(await waitText(phone, 'edited by coordinator', 5000), 'phone shows the note edited on the dashboard');

  // ---- map tab: loaded lazily, pins for both reports, honest notice
  await clickTab(dash, 'Map');
  await dash.waitForSelector('.leaflet-container', { timeout: 10000 }).catch(() => {});
  ok(await dash.$('.leaflet-container') !== null, 'map: Leaflet map rendered when the tab is opened');
  ok(await leafletLoaded(), 'map: map code downloaded only now');
  await sleep(500);
  const pins = await dash.$$eval('.leaflet-interactive', (els) => els.length);
  ok(pins === 2, `map: one pin per located report (${pins})`);
  ok((await text(dash)).includes('Internet'), 'map: notice says tiles need Internet');
  ok((await text(dash)).includes('OpenStreetMap'), 'map: OpenStreetMap attribution shown');
  await dash.screenshot({ path: path.join(shots, '5-map.png') });

  // ---- join tab: QR + code, rotate works, old code stops working
  await clickTab(dash, 'Join');
  await dash.waitForSelector('[data-testid=join-code]', { timeout: 8000 });
  const shown = await dash.$eval('[data-testid=join-code]', (el) => el.innerText.trim());
  const before = joinCodeNow();
  ok(shown === before, `join: code on screen matches the hub (${shown})`);
  ok(await dash.$eval('img.qr', (i) => i.src.startsWith('data:image/png')), 'join: QR image present');
  await dash.evaluate(() => (window.confirm = () => true));
  await dash.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText === 'New code')?.click());
  await dash.waitForFunction((old) => document.querySelector('[data-testid=join-code]')?.innerText.trim() !== old, { timeout: 8000, polling: 100 }, before).catch(() => {});
  const after = joinCodeNow();
  ok(after !== before && (await dash.$eval('[data-testid=join-code]', (el) => el.innerText.trim())) === after, 'join: New code rotates the code on the hub and on screen');
  ok(await waitText(phone, 'Hub connected'), 'phone: still paired after the code changed');
  await dash.screenshot({ path: path.join(shots, '6-join.png') });

  // ---- reload keeps the session and the data; logout clears it
  await dash.reload({ waitUntil: 'networkidle0' });
  ok(await waitText(dash, 'Reports (2)'), 'reload: still logged in with both reports');
  await dash.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText === 'Log out')?.click());
  ok(await waitText(dash, 'Open dashboard'), 'logout: back to the login screen');
  await dash.reload({ waitUntil: 'networkidle0' });
  ok(await waitText(dash, 'Open dashboard'), 'logout: stays logged out after reload');

  // ---- layout at common widths (logged in again)
  await typeInto(dash, 'input[name=passcode]', passcode);
  await tap(dash, 'button[type=submit]');
  await waitText(dash, 'Reports (2)');
  await tap(dash, '.row[data-id]');
  let overflow = 0;
  for (const w of [1366, 1024, 768, 390]) {
    await dash.setViewport({ width: w, height: 900 });
    await sleep(200);
    const over = await dash.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) {
      overflow++;
      ok(false, `horizontal overflow at ${w}px (${over}px)`);
    }
  }
  ok(overflow === 0, 'no horizontal overflow at 1366/1024/768/390 px with the detail open');
  await dash.setViewport({ width: 1280, height: 860 });
  await sleep(200);
  await dash.screenshot({ path: path.join(shots, '7-final.png'), fullPage: true });
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
console.log('Screenshots:', shots);
process.exit(failed ? 1 : 0);
