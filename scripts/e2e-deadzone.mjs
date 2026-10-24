// Real-browser check of the G5 gate against a RUNNING hub: a phone enters the bend (the hub goes quiet for it),
// queues two orders that wait on the phone, the night goes on without it, then the boat comes out and the orders
// play in sequence with no duplicate; then airplane mode (page offline) for two rounds and back, same outcome.
// Usage: npm run e2e:deadzone    (env: E2E_ORIGIN, E2E_DB, E2E_SHOTS, BROWSER)
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
const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'pralayam-shots-deadzone');
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
const waitGone = (page, sel, ms = 10000) => page.waitForSelector(sel, { hidden: true, timeout: ms }).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (page, sel) => page.$eval(sel, (el) => el.click());
const clickHost = (page, name) => page.$eval(`[data-host=${name}]`, (el) => el.click());
const myBoat = (id) => gameState().boats.find((b) => b.id === id);
const appliedSeq = (id) => gameState().applied[id] ?? 0;
const queueLen = (id) => (gameState().queues[id] ?? []).length;
/** Poll the hub's database until `fn` holds (the phone's "queued" count includes its own outbox). */
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

const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: mkdtempSync(path.join(os.tmpdir(), 'pralayam-profile-')) });
try {
  const screen = await browser.newPage();
  await screen.setViewport({ width: 1600, height: 900 });
  await screen.goto(ORIGIN + '/screen.html', { waitUntil: 'networkidle0' });
  await screen.type('input[name=passcode]', passcode);
  await screen.$eval('button[type=submit]', (el) => el.click());
  ok(await waitSel(screen, '[data-host=new]'), 'screen: logged in');
  await screen.select('select', '60'); // long rounds: nothing resolves unless we skip
  await clickHost(screen, 'new');
  ok(await waitText(screen, 'Crews at the jetty'), 'screen: lobby open');

  const ctx = await browser.createBrowserContext();
  const phone = await ctx.newPage();
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  phone.on('pageerror', (e) => ok(false, 'phone page error: ' + e.message));
  await phone.goto(`${ORIGIN}/?join=${joinCode()}`, { waitUntil: 'networkidle0' });
  await phone.type('input[name=name]', 'Rahul');
  await tap(phone, 'button[type=submit]');
  ok(await waitSel(phone, '[data-screen=pick]'), 'phone: paired');
  await tap(phone, '[data-color=ember]');
  ok(await waitSel(phone, '[data-screen=lobby]'), 'phone: joined');
  const me = gameState().boats.find((b) => !b.bot).id;
  await clickHost(screen, 'start');
  ok(await waitSel(phone, '[data-screen=order]'), 'phone: order screen');

  // ---- walk to the edge of the bend: jetty -> mundamveli -> j_mid (both in signal)
  for (const node of ['mundamveli', 'j_mid']) {
    await tap(phone, `[data-screen=order] .row[data-kind=move][data-node=${node}]`);
    await tap(phone, '[data-testid=send]');
    ok(await waitText(phone, '1 queued'), `phone: move to ${node} queued`);
    ok(await waitHub(() => queueLen(me) === 1), `hub: move to ${node} arrived`);
    await clickHost(screen, 'skip-round');
    const arrived = await phone.waitForFunction((n) => document.querySelector(`[data-screen=order] .row[data-kind=move][data-node=${n}]`) === null, { timeout: 8000, polling: 100 }, node).then(() => true, () => false);
    if (!arrived) console.log('  rows now:', await phone.$$eval('[data-screen=order] .row', (els) => els.map((e) => e.dataset.kind + ':' + e.dataset.node).join(' ')), '| hub boat at', myBoat(me).nodeId);
    ok(arrived, `phone: arrived at ${node} (view updated)`);
  }
  ok(myBoat(me).nodeId === 'j_mid', 'hub: boat at mid channel');

  // ---- into the bend: the prompt, "set Return and go"
  await tap(phone, '[data-screen=order] .row[data-kind=move][data-node=bendhouse]');
  await tap(phone, '[data-testid=send]');
  ok(await waitSel(phone, '[data-testid=dead-zone-warn]'), 'phone: warned about the dead zone');
  await tap(phone, '[data-testid=go-return]');
  ok(await waitText(phone, '1 queued'), 'phone: move into the bend queued, standing order set');
  ok(await waitHub(() => queueLen(me) === 1 && myBoat(me).standingOrder === 'return'), 'hub: the move and the standing order (Return) arrived');
  await clickHost(screen, 'skip-round');
  await sleep(300);
  ok(myBoat(me).nodeId === 'bendhouse', 'hub: boat is in the bend');

  // ---- in the bend: the hub goes quiet for this phone; orders wait on the phone
  ok(await waitSel(phone, '[data-testid=no-signal]', 12000), 'phone: NO SIGNAL banner (the hub answers nothing)');
  ok((await text(screen)).toLowerCase().includes('no signal since r'), 'screen: crew shown as out of contact since a round');
  await phone.screenshot({ path: path.join(shots, '1-no-signal.png') });
  const seqBefore = appliedSeq(me);
  await tap(phone, '[data-screen=order] .row[data-kind=hold]');
  await tap(phone, '[data-testid=send]');
  ok(await waitText(phone, 'queued'), 'phone: hold queued on the phone (nothing reaches the hub)');
  await tap(phone, '[data-screen=order] .row[data-kind=move][data-node=j_mid]');
  ok(await waitSel(phone, '[data-testid=queue-next]'), 'phone: queue-as-next offered while quiet');
  await tap(phone, '[data-testid=queue-next]');
  ok(await waitText(phone, '2 queued'), 'phone: two orders waiting on the phone');
  await sleep(1500);
  ok(queueLen(me) === 0, `hub: nothing reached the hub from the bend (queue ${queueLen(me)})`);

  // ---- the night goes on: the boat follows its standing order (return) and comes out of the bend
  await clickHost(screen, 'skip-round');
  await sleep(300);
  const outNode = myBoat(me).nodeId;
  ok(outNode !== 'bendhouse', `hub: standing order brought the boat out (${outNode})`);
  // back in range: the phone's two orders arrive and play in sequence
  ok(await waitGone(phone, '[data-testid=no-signal]', 15000), 'phone: signal back');
  ok(await waitHub(() => queueLen(me) === 2), `hub: both waiting orders arrived at once (queue ${queueLen(me)})`);
  await clickHost(screen, 'skip-round');
  await sleep(300);
  await clickHost(screen, 'skip-round');
  await sleep(300);
  ok(appliedSeq(me) === seqBefore + 2 && queueLen(me) === 0, `hub: exactly two orders played, none duplicated (applied ${appliedSeq(me)})`);

  // ---- airplane mode: the page goes offline for two rounds
  await phone.setOfflineMode(true);
  await sleep(200);
  await tap(phone, '[data-screen=order] .row[data-kind=hold]');
  await tap(phone, '[data-testid=send]');
  ok(await waitText(phone, 'queued'), 'phone (offline): order waits in the outbox');
  ok(await waitSel(phone, '[data-testid=no-signal]', 12000), 'phone (offline): banner says the hub is not reachable');
  const applied2 = appliedSeq(me);
  await clickHost(screen, 'skip-round');
  await sleep(300);
  await clickHost(screen, 'skip-round');
  await sleep(300);
  ok(appliedSeq(me) === applied2, 'hub: nothing arrived while the phone was offline');
  await phone.setOfflineMode(false);
  await tap(phone, '[data-testid=retry]');
  ok(await waitGone(phone, '[data-testid=no-signal]', 15000), 'phone: back online after airplane mode');
  ok(await waitHub(() => queueLen(me) === 1), `hub: the offline order arrived once (queue ${queueLen(me)})`);
  await clickHost(screen, 'skip-round');
  await sleep(300);
  ok(appliedSeq(me) === applied2 + 1, 'hub: played exactly once');
  await phone.screenshot({ path: path.join(shots, '2-back.png') });
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
console.log('Screenshots:', shots);
process.exit(failed ? 1 : 0);
