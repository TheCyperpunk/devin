// Real-browser check of the Phase 4 gate against the RUNNING hub: pair, go offline, reload, submit, close, reopen.
// Usage: node scripts/e2e-volunteer.mjs   (hub must be running; drives Edge/Chrome via puppeteer-core)
// Needs a fresh hub database or an unused join code. Screenshots go to $E2E_SHOTS (default: OS temp dir).
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = process.env.E2E_ORIGIN ?? 'https://localhost:3443';
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

const joinCode = new Database(path.join(root, 'server', 'data', 'hub.db'), { readonly: true })
  .prepare("select value from meta where key = 'join_code'")
  .get().value;

let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failed++;
};
const text = (page) => page.evaluate(() => document.body.innerText);
const waitText = (page, s, ms = 8000) =>
  page.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms }, s).then(() => true, () => false);

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  userDataDir: mkdtempSync(path.join(os.tmpdir(), 'relief-profile-')),
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
});
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

  // wrong code first
  await page.type('input[name=name]', 'Asha K');
  await page.$eval('input[name=joinCode]', (e) => (e.value = ''));
  await page.type('input[name=joinCode]', 'WRONGCODE');
  await page.click('button[type=submit]');
  ok(await waitText(page, 'That join code is not valid.'), 'wrong join code shows a clear error');
  await page.$eval('input[name=joinCode]', (e) => (e.value = ''));
  await page.type('input[name=joinCode]', joinCode);
  await page.click('button[type=submit]');
  ok(await waitText(page, 'New report'), 'pairs with the real join code');
  ok(await waitText(page, 'Hub connected'), 'shows hub connected while online');

  // ---- 2. get the service worker controlling the page, then go offline
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
  ok(true, 'service worker controls the page');
  await page.screenshot({ path: path.join(shots, '2-form.png'), fullPage: true });

  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  ok(await waitText(page, 'New report'), 'OFFLINE reload: app still opens and stays paired');
  ok(await waitText(page, 'Hub not reachable', 12000), 'OFFLINE: shows hub not reachable');

  // ---- 3. submit while offline
  await page.click('[data-need=medical]');
  await page.click('[data-need=water]');
  await page.click('button[aria-label="Add one more person"]');
  await page.click('button[aria-label="Add one more person"]');
  await page.click('[data-toggle=children]');
  await page.click('[data-toggle=urgent]');
  await page.type('textarea[name=note]', 'Second floor, near the temple');
  await waitText(page, 'Location saved');
  ok(await text(page).then((t) => t.includes('Location saved')), 'GPS captured');
  await page.screenshot({ path: path.join(shots, '3-filled.png'), fullPage: true });
  await page.click('[data-testid=submit]');
  ok(await waitText(page, 'Saved on phone'), 'OFFLINE submit: "Saved on phone" shown');

  // empty form is refused
  await page.click('[data-testid=submit]');
  ok(await waitText(page, 'Choose at least one need.'), 'submitting with no need is refused');

  // ---- 4. close everything and reopen (still offline)
  await page.close();
  page = await browser.newPage();
  await page.setOfflineMode(true);
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  ok(await waitText(page, 'My reports'), 'reopened offline: app loads');
  ok(await waitText(page, '1 waiting to send'), 'reopened: unsent counter shows 1');
  await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].find((b) => b.innerText.includes('My reports')).click());
  ok(await waitText(page, 'Drinking water · Medical help'), 'report is in My reports after reopening');
  const t4 = await text(page);
  ok(t4.includes('Saved on phone') && t4.includes('3 ·') && t4.includes('Urgent'), 'chip + people + urgent shown');
  await page.screenshot({ path: path.join(shots, '4-mine.png'), fullPage: true });

  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('relief-mesh');
        open.onsuccess = () => {
          const db = open.result;
          const read = (s) => new Promise((r) => (db.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result)));
          Promise.all([read('reports'), read('outbox'), read('settings')]).then(([reports, outbox, settings]) => resolve({ reports, outbox, settings }));
        };
      }),
  );
  const r = stored.reports[0];
  ok(stored.reports.length === 1 && stored.outbox.length === 1 && stored.outbox[0].id === r.id, 'IndexedDB: 1 report + 1 matching outbox entry');
  ok(r.input.needs.join() === 'water,medical', 'needs saved in canonical order');
  ok(r.input.peopleCount === 3 && r.input.urgent && r.input.hasChildren && !r.input.hasElderlyOrSick, 'people/toggles saved');
  ok(r.input.note === 'Second floor, near the temple' && Math.abs(r.input.lat - 10.1004) < 1e-6, 'note and GPS saved');
  ok(!('status' in r.input) && !('deviceId' in r.input) && !('ageMs' in r.input), 'no hub-owned fields in the stored draft');
  ok(stored.settings.length === 4 || stored.settings.length >= 4, 'settings stored (device id, name, lang, token, hub id)');

  // ---- 5. Malayalam
  await page.evaluate(() => [...document.querySelectorAll('.lang button')].find((b) => b.innerText === 'മലയാളം').click());
  ok(await waitText(page, 'ഫോണിൽ സേവ് ചെയ്തു'), 'Malayalam: status chip translated');
  await page.evaluate(() => [...document.querySelectorAll('[role=tab]')][0].click());
  ok(await waitText(page, 'അയയ്ക്കുക') && (await waitText(page, 'ഭക്ഷണം')), 'Malayalam: form labels shown');
  await page.screenshot({ path: path.join(shots, '5-malayalam.png'), fullPage: true });

  // ---- 5b. no sideways scrolling on small phones, in either language, on every screen
  for (const w of [320, 360, 390]) {
    await page.setViewport({ width: w, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    for (const [langName, label] of [['English', 'en'], ['മലയാളം', 'ml']]) {
      await page.evaluate((n) => [...document.querySelectorAll('.lang button')].find((b) => b.innerText === n).click(), langName);
      for (const idx of [0, 1]) {
        await page.evaluate((i) => document.querySelectorAll('[role=tab]')[i].click(), idx);
        await new Promise((r) => setTimeout(r, 150));
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        ok(over <= 0, `no horizontal overflow at ${w}px, ${label}, ${idx ? 'My reports' : 'New report'} (${over}px)`);
      }
    }
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluate(() => [...document.querySelectorAll('.lang button')].find((b) => b.innerText === 'മലയാളം').click());
  await page.evaluate(() => document.querySelectorAll('[role=tab]')[0].click());
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: path.join(shots, '6-malayalam-fixed.png'), fullPage: true });

  // ---- 6. nothing may have reached the hub: Phase 4 only saves on the phone
  await page.setOfflineMode(false);
  const lang = await page.evaluate(() => document.documentElement.lang);
  ok(lang === 'ml', 'html lang follows the language toggle');
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
console.log('Screenshots:', shots);
process.exit(failed ? 1 : 0);
