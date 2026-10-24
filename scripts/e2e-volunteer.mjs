// Real-browser check of the volunteer app against a RUNNING hub (Phases 4 + 5).
//   Phase 4: pair, go offline, reload, submit, close, reopen -> report still there.
//   Phase 5: online submit reaches the hub; 3 offline reports arrive exactly once within 10 s of reconnecting;
//            a coordinator assignment shows on the phone live; wrong-token/reset paths are unit-tested instead.
// Usage: npm run e2e                       (against the dev hub in server/data)
//        E2E_ORIGIN=https://localhost:3553 E2E_DB=/tmp/x/hub.db node scripts/e2e-volunteer.mjs   (a second hub)
// Needs Edge or Chrome. Screenshots go to $E2E_SHOTS (default: OS temp dir). Reads COORDINATOR_PASSCODE from .env.
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
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'relief-shots');
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
const joinCode = sql("select value from meta where key = 'join_code'")[0].value;
const passcode = (readFileSync(path.join(root, '.env'), 'utf8').match(/^COORDINATOR_PASSCODE=(.*)$/m) ?? [])[1]?.trim();

// The script's own calls to the hub (as the coordinator) trust the mkcert root explicitly, so no env setup is needed.
import https from 'node:https';
const rootCA = readFileSync(path.join(root, 'certs', 'rootCA.pem'));
const hubFetch = (p, init = {}) =>
  new Promise((resolve, reject) => {
    const u = new URL(ORIGIN + p);
    const req = https.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: init.method ?? 'GET', headers: init.headers, ca: rootCA },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(data) }));
      },
    );
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });

let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failed++;
};
const text = (page) => page.evaluate(() => document.body.innerText);
const waitText = (page, s, ms = 8000) =>
  page.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms }, s).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Click through the DOM: a mouse click can land on the sticky header when the element was just scrolled into view.
const tap = (page, sel) => page.$eval(sel, (el) => el.click());
const clickTab = (page, name) =>
  page.evaluate((n) => [...document.querySelectorAll('[role=tab]')].find((b) => b.innerText.includes(n))?.click(), name);
const clickLang = (page, name) =>
  page.evaluate((n) => [...document.querySelectorAll('.lang button')].find((b) => b.innerText === n)?.click(), name);
async function submitReport(page, { needs, people = 1, note }) {
  await clickTab(page, 'New report');
  for (const n of needs) await tap(page, `[data-need=${n}]`);
  for (let i = 1; i < people; i++) await tap(page, 'button[aria-label="Add one more person"]');
  if (note) await page.type('textarea[name=note]', note);
  await tap(page, '[data-testid=submit]');
  return waitText(page, 'Saved on phone');
}

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  userDataDir: mkdtempSync(path.join(os.tmpdir(), 'relief-profile-')),
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
});
const deviceName = 'E2E ' + Date.now().toString(36);
try {
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(ORIGIN, ['geolocation']);
  let page = await browser.newPage();
  await page.setGeolocation({ latitude: 10.1004, longitude: 76.357, accuracy: 30 });
  page.on('pageerror', (e) => ok(false, 'page error: ' + e.message));

  // ---- 1. first load with the QR link: code prefilled, then cleaned from the address bar
  await page.goto(`${ORIGIN}/?join=${joinCode.toLowerCase()}`, { waitUntil: 'networkidle0' });
  ok(await waitText(page, 'Join the relief hub'), 'pairing screen shown');
  ok((await page.$eval('input[name=joinCode]', (e) => e.value)) === joinCode, 'join code prefilled (uppercased) from the link');
  ok(!page.url().includes('join='), 'join code removed from the address bar');
  await page.screenshot({ path: path.join(shots, '1-pair.png') });

  await page.type('input[name=name]', deviceName);
  await page.$eval('input[name=joinCode]', (e) => (e.value = ''));
  await page.type('input[name=joinCode]', 'WRONGCODE');
  await page.click('button[type=submit]');
  ok(await waitText(page, 'That join code is not valid.'), 'wrong join code shows a clear error');
  await page.$eval('input[name=joinCode]', (e) => (e.value = ''));
  await page.type('input[name=joinCode]', joinCode);
  await page.click('button[type=submit]');
  ok(await waitText(page, 'New report'), 'pairs with the real join code');
  ok(await waitText(page, 'Hub connected'), 'shows hub connected while online');

  // ---- 2. Phase 5: an online submit reaches the hub and the chip turns to "Sent to hub"
  await waitText(page, 'Location saved');
  ok(await submitReport(page, { needs: ['food'], people: 2, note: 'online one' }), 'online submit saved');
  await clickTab(page, 'My reports');
  ok(await waitText(page, 'Sent to hub', 10000), 'online submit: chip shows "Sent to hub"');
  const onHub = () =>
    sql('select r.id, r.note, r.status, r.assignee from reports r join devices d on d.device_id = r.device_id where d.reporter_name = ?', deviceName);
  ok(onHub().length === 1 && onHub()[0].note === 'online one', 'hub database has exactly that report');
  await page.screenshot({ path: path.join(shots, '2-sent.png'), fullPage: true });

  // ---- 3. get the service worker controlling the page, then go offline
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
  ok(true, 'service worker controls the page');
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  ok(await waitText(page, 'New report'), 'OFFLINE reload: app still opens and stays paired');
  ok(await waitText(page, 'Hub not reachable', 12000), 'OFFLINE: shows hub not reachable');

  // ---- 4. three reports while offline (the Phase 5 gate)
  ok(await submitReport(page, { needs: ['medical', 'water'], people: 3, note: 'offline A' }), 'OFFLINE submit A');
  ok(await submitReport(page, { needs: ['rescue'], people: 4, note: 'offline B' }), 'OFFLINE submit B');
  ok(await submitReport(page, { needs: ['shelter'], note: 'offline C' }), 'OFFLINE submit C');
  ok(await waitText(page, '3 waiting to send'), 'unsent counter shows 3');
  await tap(page, '[data-testid=submit]');
  ok(await waitText(page, 'Choose at least one need.'), 'submitting with no need is refused');
  await page.screenshot({ path: path.join(shots, '3-queued.png'), fullPage: true });

  // ---- 5. close everything and reopen (still offline): all three still there
  await page.close();
  page = await browser.newPage();
  await page.setOfflineMode(true);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  ok(await waitText(page, '3 waiting to send'), 'reopened offline: 3 still waiting');
  await clickTab(page, 'My reports');
  const t5 = await text(page);
  ok(['offline A', 'offline B', 'offline C'].every((n) => t5.includes(n)), 'all three in My reports after reopening');
  ok((t5.match(/Saved on phone/g) ?? []).length === 3 && (t5.match(/Sent to hub/g) ?? []).length === 1, '3 saved chips + 1 sent chip');
  ok(onHub().length === 1, 'hub still has only the online report');

  // ---- 6. back online: all three arrive exactly once within 10 s, without any tap
  const t0 = Date.now();
  await page.setOfflineMode(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !document.body.innerText.includes('Saved on phone'), { timeout: 10000 }).catch(() => {});
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const rows = onHub();
  ok(rows.length === 4, `hub has 4 reports after reconnect (${secs} s)`);
  ok(Number(secs) < 10, 'queue delivered within 10 s of reconnecting');
  ok(new Set(rows.map((r) => r.id)).size === 4 && new Set(rows.map((r) => r.note)).size === 4, 'each report exactly once (no duplicates)');
  ok((await text(page).then((t) => (t.match(/Sent to hub/g) ?? []).length)) === 4, 'all four chips show "Sent to hub"');
  ok(!(await text(page)).includes('waiting to send'), 'unsent counter gone');
  await page.screenshot({ path: path.join(shots, '4-synced.png'), fullPage: true });

  // ---- 7. a second reconnect must not create duplicates
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await sleep(1500);
  ok(onHub().length === 4, 'another reconnect creates no duplicates');

  // ---- 8. coordinator assigns -> phone shows it live (WebSocket), then done
  const login = await hubFetch('/api/dashboard/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  ok(login.ok, 'coordinator login for the test');
  const session = (await login.json()).sessionToken;
  const target = rows.find((r) => r.note === 'offline B');
  const patch = (body) =>
    hubFetch('/api/dashboard/reports/' + target.id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session },
      body: JSON.stringify(body),
    });
  ok((await patch({ status: 'assigned', assignee: 'Boat team 1' })).ok, 'assign via dashboard API');
  ok(await waitText(page, 'Assigned to Boat team 1', 5000), 'phone shows "Assigned to Boat team 1" live');
  ok((await patch({ status: 'done' })).ok, 'mark done via dashboard API');
  ok(await waitText(page, 'Done', 5000), 'phone shows "Done" live');
  await page.screenshot({ path: path.join(shots, '5-assigned.png'), fullPage: true });

  // ---- 9. status survives a reload (came from IndexedDB, not just from the socket)
  await page.reload({ waitUntil: 'networkidle0' });
  await clickTab(page, 'My reports');
  ok(await waitText(page, 'Done'), 'status still shown after reload');

  // ---- 10. Malayalam and layout
  await clickLang(page, 'മലയാളം');
  ok(await waitText(page, 'ഹബ്ബിലേക്ക് അയച്ചു'), 'Malayalam: "Sent to hub" chip');
  let overflow = 0;
  for (const w of [320, 360, 390]) {
    await page.setViewport({ width: w, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    for (const [langName, label] of [['English', 'en'], ['മലയാളം', 'ml']]) {
      await clickLang(page, langName);
      for (const idx of [0, 1]) {
        await page.evaluate((i) => document.querySelectorAll('[role=tab]')[i]?.click(), idx);
        await sleep(120);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 0) {
          overflow++;
          ok(false, `horizontal overflow at ${w}px, ${label}, tab ${idx} (${over}px)`);
        }
      }
    }
  }
  ok(overflow === 0, 'no horizontal overflow at 320/360/390 px in both languages, both tabs');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await clickLang(page, 'മലയാളം');
  await page.evaluate(() => document.querySelectorAll('[role=tab]')[1]?.click());
  await sleep(200);
  await page.screenshot({ path: path.join(shots, '6-malayalam.png'), fullPage: true });
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
console.log('Screenshots:', shots);
process.exit(failed ? 1 : 0);
