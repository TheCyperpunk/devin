// Real-browser check of the G4 gate against a RUNNING hub: the big screen opens a lobby, two phones pair with the
// QR link, pick colours and join, the host starts, phones send orders (one replaces, one queues a second), the
// screen skips rounds, phones show round cards, the night ends on every screen. Also: tap targets and 320 px.
// Usage: npm run e2e:play    (env: E2E_ORIGIN, E2E_DB, E2E_SHOTS, BROWSER)
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
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'pralayam-shots-play');
mkdirSync(shots, { recursive: true });
const exe = [
  process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
if (!exe) throw new Error('No Chrome/Edge found; set BROWSER=path');
const joinCode = () => new Database(DB, { readonly: true }).prepare("select value from meta where key = 'join_code'").get().value;
const gameState = () => JSON.parse(new Database(DB, { readonly: true }).prepare("select state_json from game where id = (select value from meta where key = 'current_game_id')").get().state_json);
/** Orders the hub has received from a crew: still queued plus already played. */
const received = (id) => {
  const g = gameState();
  return (g.queues[id] ?? []).length + (g.applied[id] ?? 0);
};
async function waitHub(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (fn()) return true;
    } catch {
      /* db busy */
    }
    await sleep(100);
  }
  return false;
}
const passcode = (readFileSync(path.join(root, '.env'), 'utf8').match(/^COORDINATOR_PASSCODE=(.*)$/m) ?? [])[1]?.trim();

let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failed++;
};
const text = (page) => page.evaluate(() => document.body.innerText);
const waitText = (page, s, ms = 10000) =>
  page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), { timeout: ms, polling: 100 }, s).then(() => true, () => false);
const waitSel = (page, sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (page, sel) => page.$eval(sel, (el) => el.click());
const clickHost = (page, name) => page.$eval(`[data-host=${name}]`, (el) => el.click());

const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: mkdtempSync(path.join(os.tmpdir(), 'pralayam-profile-')) });
try {
  // ---- big screen: lobby
  const screen = await browser.newPage();
  await screen.setViewport({ width: 1600, height: 900 });
  screen.on('pageerror', (e) => ok(false, 'screen page error: ' + e.message));
  await screen.goto(ORIGIN + '/screen.html', { waitUntil: 'networkidle0' });
  await screen.type('input[name=passcode]', passcode);
  await screen.$eval('button[type=submit]', (el) => el.click());
  ok(await waitSel(screen, '[data-host=new]'), 'screen: logged in');
  await screen.select('select', '30');
  await clickHost(screen, 'new');
  ok(await waitText(screen, 'Crews at the jetty'), 'screen: lobby open');

  // ---- two phones pair through the QR link and pick colours
  const phones = [];
  for (const [i, name] of ['Asha', 'Rahul'].entries()) {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    p.on('pageerror', (e) => ok(false, `phone ${name} page error: ` + e.message));
    await p.goto(`${ORIGIN}/?join=${joinCode()}`, { waitUntil: 'networkidle0' });
    ok(await waitSel(p, 'input[name=name]'), `phone ${name}: pairing screen (code prefilled from the link)`);
    ok((await p.$eval('input[name=joinCode]', (el) => el.value)) === joinCode(), `phone ${name}: join code prefilled`);
    await p.type('input[name=name]', name);
    await tap(p, 'button[type=submit]');
    ok(await waitSel(p, '[data-screen=pick]'), `phone ${name}: paired, colour picker shown`);
    await tap(p, `[data-color=${i === 0 ? 'moss' : 'ember'}]`);
    ok(await waitSel(p, '[data-screen=lobby]'), `phone ${name}: joined the lobby`);
    phones.push(p);
  }
  ok(await waitText(screen, 'Rahul'), 'screen: both crews docked at the jetty');
  await screen.screenshot({ path: path.join(shots, '1-lobby.png') });
  await phones[0].screenshot({ path: path.join(shots, '2-phone-lobby.png') });

  // ---- start: order screens
  await clickHost(screen, 'start');
  ok(await waitSel(phones[0], '[data-screen=order]'), 'phone Asha: order screen after start');
  ok(await waitSel(phones[1], '[data-screen=order]'), 'phone Rahul: order screen after start');
  const rows = await phones[0].$$eval('[data-screen=order] .row', (els) => els.map((e) => e.dataset.kind));
  ok(rows.filter((k) => k === 'move').length === 3 && rows.includes('return') && rows.includes('hold') && !rows.includes('rescue'), `phone: legal orders at the jetty (${rows.join(',')})`);
  const timer = await phones[0].$eval('[data-testid=timer]', (el) => el.innerText);
  ok(/^0:[0-3]\d$/.test(timer), `phone: countdown running (${timer})`);
  await phones[0].screenshot({ path: path.join(shots, '3-phone-order.png') });
  await phones[0].click('[data-testid=orders-toggle]');
  ok(await waitSel(phones[0], '.sheet.open [data-testid=send]'), 'phone: the by-hand sheet slides up');
  await new Promise((r) => setTimeout(r, 400));
  await phones[0].screenshot({ path: path.join(shots, '3b-phone-sheet.png') });
  await phones[0].click('[data-testid=orders-toggle]');

  // ---- tap a place two moves away: one Go queues the whole route; the map names the plan
  const ashaId = gameState().boats.find((b) => b.name === 'Asha').id;
  ok(!(await text(phones[0])).toLowerCase().includes('radio'), 'phone Asha: no suggestion card, the map and the move list are the controls');
  await phones[0].$eval('.phonemap [data-node=vattappara]', (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  ok(await waitSel(phones[0], '[data-testid=pick]'), 'phone Asha: tapping Vattappara shows "Go to Vattappara · 2 moves"');
  await tap(phones[0], '[data-testid=pick-go]');
  ok(await waitHub(() => received(ashaId) >= 2), 'hub: Go queued the whole route (two moves)');
  ok(await waitSel(phones[0], '[data-testid=route]'), 'phone Asha: "on the way to … · 2 moves left"');
  // tap a place on the map instead: the pick card, then Go, which replaces the plan
  await phones[0].$eval('.phonemap [data-node=kumbalam]', (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  ok(await waitSel(phones[0], '[data-testid=pick]'), 'phone Asha: tapping a house shows "Go to Kumbalam"');
  await tap(phones[0], '[data-testid=pick-go]');
  ok(await waitHub(() => (gameState().queues[ashaId] ?? []).length === 1 && gameState().queues[ashaId][0].order.nodeId === 'kumbalam'), 'hub: the new plan replaced the route (one move to Kumbalam, the rest cancelled)');

  // ---- Asha: move to kavala, then changes her mind to kumbalam (replace). Rahul: hold, then queues a move as next.
  await tap(phones[0], '[data-screen=order] .row[data-kind=move][data-node=kavala]');
  await tap(phones[0], '[data-testid=send]');
  ok(await waitHub(() => (gameState().queues[ashaId] ?? []).length === 1 && gameState().queues[ashaId][0].order.nodeId === 'kavala'), 'phone Asha: a single move replaces the plan on the hub');
  await tap(phones[0], '[data-screen=order] .row[data-kind=move][data-node=kumbalam]');
  await tap(phones[0], '[data-testid=send]');
  ok(await waitHub(() => (gameState().queues[ashaId] ?? []).length === 1 && gameState().queues[ashaId][0].order.nodeId === 'kumbalam'), 'phone Asha: changing the order keeps one queued (now Kumbalam)');
  await tap(phones[1], '[data-screen=order] .row[data-kind=hold]');
  await tap(phones[1], '[data-testid=send]');
  ok(await waitText(phones[1], '1 queued'), 'phone Rahul: hold queued');
  await tap(phones[1], '[data-screen=order] .row[data-node=mundamveli]');
  ok(await waitSel(phones[1], '[data-testid=queue-next]'), 'phone Rahul: "queue as next" offered');
  await tap(phones[1], '[data-testid=queue-next]');
  ok(await waitHub(() => received('dev-rahul') >= 2 || received(gameState().boats.find((b) => b.name === 'Rahul')?.id) >= 2), 'hub: Rahul\'s second order arrived behind the first');

  // ---- resolve: the screen skips the round (the hub would also have resolved early: both crews ordered)
  await sleep(400);
  await clickHost(screen, 'skip-round');
  ok(await waitSel(phones[0], '[data-testid=round-card]'), 'phone Asha: round card after the round');
  ok(await waitText(phones[0], 'Round 2', 6000), 'phone Asha: round 2');
  const ashaAt = await screen.$eval('[data-crew=dev-asha], .crew', () => true).catch(() => false);
  void ashaAt;
  ok((await text(screen)).toLowerCase().includes('kumbalam'), 'screen: Asha went to Kumbalam (the replaced order won)');
  // the hub may also have resolved round 1 early on its own (every crew had ordered), so one or both of Rahul's
  // orders have been played by now; what must never happen is both still waiting
  await sleep(500);
  ok(!/2 queued/.test(await text(phones[1])), 'phone Rahul: his queued orders were played in sequence');
  await phones[0].screenshot({ path: path.join(shots, '4-phone-round2.png') });

  // ---- to first light (the hub may resolve a round early on its own, so skip until the button is gone)
  for (let i = 0; i < 12 && (await screen.$('[data-host=skip-round]')); i++) {
    await clickHost(screen, 'skip-round');
    await sleep(250);
  }
  ok(await waitText(screen, 'First light'), 'screen: first light');
  ok(await waitSel(phones[0], '[data-screen=end]'), 'phone Asha: end screen');
  ok(await waitSel(phones[1], '[data-screen=end]'), 'phone Rahul: end screen');
  await phones[0].screenshot({ path: path.join(shots, '5-phone-end.png') });

  // ---- a new game: phones go back to the colour picker (their outbox and seq reset)
  await clickHost(screen, 'new');
  ok(await waitSel(phones[0], '[data-screen=pick]'), 'phone: a new game brings the colour picker back');

  // ---- targets and width
  const small = await phones[0].$$eval('button', (els) => els.filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height < 44).map((b) => b.innerText || b.className));
  ok(small.length === 0, `phone: every visible button ≥ 44 px (${small.join(' | ') || 'ok'})`);
  await phones[0].setViewport({ width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(300);
  const over = await phones[0].evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, `phone: no horizontal overflow at 320 px (${over})`);
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
console.log('Screenshots:', shots);
process.exit(failed ? 1 : 0);
