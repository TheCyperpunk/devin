// SyncManager against a fake hub: delivery, batching, backoff, reconnect, re-pair, hub reset, cursor safety, pushes.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BatchItemResult, PhoneReportInput, Report } from '@relief-mesh/shared';
import { ApiFail, type Api, type ReportsPage } from './api.js';
import { closeDb, db, getReport, getSettings, outboxCount, saveNewReport, setSettings, type LocalReport } from './db.js';
import { SyncManager, type Env } from './sync.js';

// ---------- a tiny in-memory hub with the same rules as server/src/db.ts ----------
class FakeHub {
  id = 'hub-A';
  time = 1_800_000_000_000;
  revision = 0;
  reports = new Map<string, Report>();
  owners = new Map<string, string>();
  pageSize = 500;
  fail: 'network' | 'unauthorized' | 'rate_limited' | 'too_large' | 'internal' | null = null;
  failHealth = false;
  retryAfterS = 0;
  calls: { batch: PhoneReportInput[][]; my: number[]; health: number } = { batch: [], my: [], health: 0 };

  submit(device: string, input: PhoneReportInput): BatchItemResult {
    const existing = this.reports.get(input.id);
    if (existing) return this.owners.get(input.id) === device ? { id: input.id, result: 'duplicate', report: existing } : { id: input.id, result: 'conflict' };
    if (input.peopleCount < 1) return { id: input.id, result: 'invalid', message: 'peopleCount: too small' };
    const r: Report = {
      id: input.id, deviceId: device, reporterName: 'Asha', needs: input.needs, peopleCount: input.peopleCount,
      hasChildren: input.hasChildren, hasElderlyOrSick: input.hasElderlyOrSick, urgent: input.urgent, note: input.note ?? null,
      lat: input.lat ?? null, lng: input.lng ?? null, accuracyM: input.accuracyM ?? null, receivedAt: this.time,
      reportedAt: this.time - input.ageMs, updatedAt: this.time, revision: ++this.revision, status: 'open', assignee: null, baseScore: 10,
    };
    this.reports.set(r.id, r);
    this.owners.set(r.id, device);
    return { id: r.id, result: 'created', report: r };
  }
  patch(id: string, p: Partial<Pick<Report, 'status' | 'assignee'>>): Report {
    const r = { ...this.reports.get(id)!, ...p, revision: ++this.revision, updatedAt: this.time };
    this.reports.set(id, r);
    return r;
  }
  page(after: number): ReportsPage {
    const all = [...this.reports.values()].filter((r) => r.revision > after).sort((a, b) => a.revision - b.revision);
    const reports = all.slice(0, this.pageSize);
    return { reports, hasMore: all.length > reports.length, maxRevision: reports.length ? reports[reports.length - 1]!.revision : after, serverTime: this.time };
  }
  api(): Api {
    const boom = () => {
      if (this.fail) throw new ApiFail(this.fail, this.fail, this.retryAfterS || undefined);
    };
    return {
      health: async () => {
        this.calls.health++;
        if (this.failHealth) throw new ApiFail('network', 'down');
        return { ok: true, time: this.time, hubId: this.id };
      },
      pair: async () => ({ deviceToken: 'tok2', deviceId: 'dev', reporterName: 'Asha', hubId: this.id }),
      sendBatch: async (_t, reports) => {
        this.calls.batch.push(reports);
        if (reports.length > 50) throw new ApiFail('too_large', 'max 50');
        boom();
        return { results: reports.map((r) => this.submit('dev', r)) };
      },
      myReports: async (_t, after) => {
        this.calls.my.push(after);
        boom();
        return this.page(after);
      },
    };
  }
}

// ---------- fake environment: manual timers, manual socket ----------
interface FakeSocket {
  h: Parameters<Env['openSocket']>[0];
  sent: string[];
  closed: boolean;
}
function fakeEnv(hub: FakeHub) {
  const timers: { fn: () => void; ms: number }[] = [];
  const sockets: FakeSocket[] = [];
  const env: Env = {
    api: hub.api(),
    now: () => hub.time,
    setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimeout: () => {},
    openSocket: (h) => {
      const s: FakeSocket = { h, sent: [], closed: false };
      sockets.push(s);
      return { close: () => (s.closed = true) };
    },
  };
  return { env, timers, sockets };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const local = (n: number, createdAtLocal: number, over: Partial<LocalReport['input']> = {}): LocalReport => ({
  id: uuid(n),
  createdAtLocal,
  syncState: 'saved',
  input: { id: uuid(n), needs: ['food'], peopleCount: 2, hasChildren: false, hasElderlyOrSick: false, urgent: false, ...over },
});

let hub: FakeHub;
let env: Env;
let timers: { fn: () => void; ms: number }[];
let sockets: FakeSocket[];
let sync: SyncManager;

beforeEach(async () => {
  await closeDb();
  indexedDB.deleteDatabase('relief-mesh');
  hub = new FakeHub();
  ({ env, timers, sockets } = fakeEnv(hub));
  sync = new SyncManager(env);
  await setSettings({ deviceId: 'dev', deviceToken: 'tok', hubId: 'hub-A', reporterName: 'Asha' });
});
afterEach(async () => {
  sync.stop();
  await closeDb();
});

/** start() without opening the socket path: flush only. */
const flush = () => {
  (sync as unknown as { stopped: boolean }).stopped = false;
  return sync.kick();
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
/** start() opens the socket after an async settings read; wait for it. */
const started = async () => {
  sync.start();
  await tick();
  return sockets[sockets.length - 1]!;
};
const settled = () => (sync as unknown as { flushing: Promise<void> | null }).flushing ?? Promise.resolve();

describe('sending', () => {
  it('delivers queued reports oldest first, marks them sent and empties the outbox', async () => {
    await saveNewReport(local(2, 2000));
    await saveNewReport(local(1, 1000));
    await flush();
    expect(hub.calls.batch).toHaveLength(1);
    expect(hub.calls.batch[0]!.map((r) => r.id)).toEqual([uuid(1), uuid(2)]);
    expect(await outboxCount()).toBe(0);
    expect((await getReport(uuid(1)))!.syncState).toBe('sent');
    expect((await getReport(uuid(1)))!.report?.revision).toBe(1);
    expect(sync.state).toMatchObject({ hub: 'online', unsent: 0, sending: false, needsPairing: false });
    expect(sync.state.version).toBeGreaterThan(0);
  });

  it('computes ageMs from the phone clock at send time, so a wrong clock cancels out', async () => {
    hub.time = 5_000_000;
    await saveNewReport(local(1, 5_000_000 - 90_000)); // 90 s ago by the same clock
    await flush();
    expect(hub.calls.batch[0]![0]!.ageMs).toBe(90_000);
  });

  it('sends at most 50 per request', async () => {
    for (let i = 1; i <= 120; i++) await saveNewReport(local(i, i));
    await flush();
    expect(hub.calls.batch.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(await outboxCount()).toBe(0);
  });

  it('handles every per-item result: created, duplicate -> sent; invalid, conflict -> rejected', async () => {
    await saveNewReport(local(1, 1));
    await saveNewReport(local(2, 2));
    await saveNewReport(local(3, 3, { peopleCount: 0 }));
    await saveNewReport(local(4, 4));
    hub.submit('someone-else', { ...local(2, 2).input, ageMs: 0 }); // id 2 already taken by another phone
    hub.submit('dev', { ...local(4, 4).input, ageMs: 0 }); // id 4 already ours on the hub (earlier send lost its answer)
    await flush();
    expect((await getReport(uuid(1)))!.syncState).toBe('sent');
    expect((await getReport(uuid(2)))).toMatchObject({ syncState: 'rejected', rejectReason: 'conflict' });
    expect((await getReport(uuid(3)))).toMatchObject({ syncState: 'rejected', rejectReason: 'peopleCount: too small' });
    expect((await getReport(uuid(4)))!.syncState).toBe('sent');
    expect(await outboxCount()).toBe(0);
    expect(hub.reports.size).toBe(3);
  });

  it('coalesces kicks: a kick during a flush causes exactly one more flush', async () => {
    await saveNewReport(local(1, 1));
    const a = flush();
    const b = sync.kick();
    const c = sync.kick();
    await Promise.all([a, b, c]);
    expect(hub.calls.health).toBe(2);
  });
});

describe('failures and retry', () => {
  it('network failure on send: hub offline, report kept and queued', async () => {
    await saveNewReport(local(1, 1));
    hub.fail = 'network';
    await flush();
    expect(sync.state.hub).toBe('offline');
    expect((await getReport(uuid(1)))!.syncState).toBe('saved');
    expect(await outboxCount()).toBe(1);
    expect(sync.state.unsent).toBe(1);
  });

  it('hub answers with errors (5xx): stays online, reports kept, exponential backoff capped at 30 s', async () => {
    await saveNewReport(local(1, 1));
    hub.fail = 'internal';
    const expectNext = async (attempt: number, delay: number) => {
      await flush();
      const e = await (await db()).get('outbox', uuid(1));
      expect(e).toMatchObject({ attempts: attempt, nextTryAt: hub.time + delay });
      hub.time += delay; // let it become due again
    };
    await expectNext(1, 1000);
    await expectNext(2, 2000);
    await expectNext(3, 4000);
    await expectNext(4, 8000);
    await expectNext(5, 16000);
    await expectNext(6, 30000);
    await expectNext(7, 30000);
    expect(sync.state.hub).toBe('online');
    expect((await getReport(uuid(1)))!.syncState).toBe('saved');
    expect(sync.state.unsent).toBe(1);
    hub.fail = null;
    hub.time += 30000;
    await flush();
    expect(await outboxCount()).toBe(0);
  });

  it('a report that is not yet due is not sent', async () => {
    await saveNewReport(local(1, 1));
    hub.fail = 'internal';
    await flush(); // backed off 1 s, hub still online
    hub.fail = null;
    await flush();
    expect(hub.calls.batch).toHaveLength(1); // the failed one only; the retry waits for nextTryAt
    hub.time += 1000;
    await flush();
    expect(hub.calls.batch).toHaveLength(2);
  });

  it('when the hub becomes reachable again every queued report is sent at once, ignoring backoff (D8)', async () => {
    for (let i = 1; i <= 3; i++) await saveNewReport(local(i, i));
    hub.failHealth = true;
    await flush();
    expect(sync.state.hub).toBe('offline');
    hub.fail = 'network';
    hub.failHealth = false;
    await flush(); // health ok, send fails -> backoff 1 s
    expect(sync.state.hub).toBe('offline');
    hub.fail = null;
    await flush(); // reachable again: due now regardless of nextTryAt
    expect(await outboxCount()).toBe(0);
    expect(hub.reports.size).toBe(3);
    expect(sync.state.unsent).toBe(0);
  });

  it('honours Retry-After on 429', async () => {
    await saveNewReport(local(1, 1));
    hub.fail = 'rate_limited';
    hub.retryAfterS = 7;
    await flush();
    expect((await (await db()).get('outbox', uuid(1)))!.nextTryAt).toBe(hub.time + 7000);
    expect(sync.state.hub).toBe('online'); // rate limited is not "unreachable"
  });

  it('halves the batch on 413 and delivers everything', async () => {
    for (let i = 1; i <= 10; i++) await saveNewReport(local(i, i));
    let tooLargeUntil = 3; // hub pretends 10 and 5 are too large, 2 is fine
    const real = env.api.sendBatch;
    env.api.sendBatch = async (t, reports) => {
      if (reports.length > tooLargeUntil) throw new ApiFail('too_large', 'nope');
      return real(t, reports);
    };
    await flush();
    expect(await outboxCount()).toBe(0);
    expect(hub.reports.size).toBe(10);
    expect(hub.calls.batch.every((b) => b.length <= 3)).toBe(true);
    tooLargeUntil = 100;
  });

  it('401: stops, clears the token, asks to pair again, keeps the reports queued', async () => {
    await saveNewReport(local(1, 1));
    hub.fail = 'unauthorized';
    await flush();
    expect(sync.state.needsPairing).toBe('unauthorized');
    expect((await getSettings()).deviceToken).toBeUndefined();
    expect(await outboxCount()).toBe(1);
    expect((await getReport(uuid(1)))!.syncState).toBe('saved');
    hub.fail = null;
    await sync.kick(); // ignored while pairing is needed
    expect(hub.calls.batch).toHaveLength(1);
  });

  it('new hubId (hub database replaced): re-queues everything, resets the cursor, asks to pair again', async () => {
    await saveNewReport(local(1, 1));
    await saveNewReport(local(2, 2));
    await flush();
    expect(await outboxCount()).toBe(0);
    await setSettings({ cursor: '99' });
    hub.id = 'hub-B';
    await flush();
    expect(sync.state.needsPairing).toBe('reset');
    expect(await outboxCount()).toBe(2);
    expect((await getReport(uuid(1)))).toMatchObject({ syncState: 'saved' });
    expect((await getReport(uuid(1)))!.report).toBeUndefined();
    const after = await getSettings();
    expect(after.cursor).toBe('0');
    expect(after.deviceToken).toBeUndefined();
  });

  it('paired() after a reset sends the old reports to the new hub; same hub keeps acknowledgements', async () => {
    await saveNewReport(local(1, 1));
    await flush();
    hub.id = 'hub-B';
    hub.reports.clear();
    hub.revision = 0;
    await flush();
    expect(sync.state.needsPairing).toBe('reset');
    await sync.paired({ deviceToken: 'tok2', deviceId: 'dev', reporterName: 'Asha', hubId: 'hub-B' });
    await (sync as unknown as { flushing: Promise<void> | null }).flushing;
    expect(hub.reports.has(uuid(1))).toBe(true);
    expect((await getReport(uuid(1)))!.syncState).toBe('sent');
    expect((await getSettings()).hubId).toBe('hub-B');

    const batches = hub.calls.batch.length;
    await sync.paired({ deviceToken: 'tok3', deviceId: 'dev', reporterName: 'Asha', hubId: 'hub-B' });
    await (sync as unknown as { flushing: Promise<void> | null }).flushing;
    expect(hub.calls.batch.length).toBe(batches); // same hub: nothing to resend
  });
});

describe('status coming back', () => {
  it('catch-up applies coordinator changes and moves the cursor', async () => {
    await saveNewReport(local(1, 1));
    await flush();
    hub.patch(uuid(1), { status: 'assigned', assignee: 'Boat 2' });
    await flush();
    expect((await getReport(uuid(1)))!.report).toMatchObject({ status: 'assigned', assignee: 'Boat 2', revision: 2 });
    expect((await getSettings()).cursor).toBe('2');
    hub.patch(uuid(1), { status: 'done' });
    await flush();
    expect((await getReport(uuid(1)))!.report?.status).toBe('done');
    expect(hub.calls.my.slice(-1)[0]).toBe(2); // asked only for what is newer than the cursor
  });

  it('never loses an update: the cursor moves only from catch-up pages, not from upload answers', async () => {
    await saveNewReport(local(1, 1));
    await flush(); // report 1 = revision 1, cursor 1
    expect((await getSettings()).cursor).toBe('1');
    // Coordinator assigns report 1 (revision 2) and then this phone sends report 2 (revision 3) in the same flush.
    hub.patch(uuid(1), { status: 'assigned', assignee: 'Team X' });
    await saveNewReport(local(2, 2));
    await flush();
    // If the cursor had jumped to 3 from the batch answer, revision 2 would have been skipped forever.
    expect((await getReport(uuid(1)))!.report).toMatchObject({ status: 'assigned', assignee: 'Team X' });
    expect((await getSettings()).cursor).toBe('3');
  });

  it('pages through a long catch-up', async () => {
    hub.pageSize = 2;
    for (let i = 1; i <= 5; i++) await saveNewReport(local(i, i));
    await flush();
    for (let i = 1; i <= 5; i++) hub.patch(uuid(i), { status: 'done' });
    await flush();
    for (let i = 1; i <= 5; i++) expect((await getReport(uuid(i)))!.report?.status).toBe('done');
    expect((await getSettings()).cursor).toBe('10');
  });

  it('a live push is merged by revision and a stale push is ignored', async () => {
    await saveNewReport(local(1, 1));
    await flush();
    const s = await started();
    s.h.onOpen((m) => s.sent.push(m));
    expect(JSON.parse(s.sent[0]!)).toEqual({ type: 'auth', payload: { token: 'tok' } });
    s.h.onMessage(JSON.stringify({ type: 'auth:ok', payload: { role: 'device', serverTime: hub.time } }));
    await settled();
    expect(sync.state.socket).toBe(true);

    const v = sync.state.version;
    const fresh = hub.patch(uuid(1), { status: 'assigned', assignee: 'Boat 1' });
    s.h.onMessage(JSON.stringify({ type: 'report:upserted', payload: { report: fresh } }));
    await new Promise((r) => setTimeout(r, 20));
    expect((await getReport(uuid(1)))!.report?.assignee).toBe('Boat 1');
    expect(sync.state.version).toBeGreaterThan(v);

    const stale = { ...fresh, revision: 1, status: 'open' as const, assignee: null };
    s.h.onMessage(JSON.stringify({ type: 'report:upserted', payload: { report: stale } }));
    await new Promise((r) => setTimeout(r, 20));
    expect((await getReport(uuid(1)))!.report?.assignee).toBe('Boat 1');
    s.h.onMessage('garbage');
  });

  it('a push for a report the hub already has removes it from the outbox', async () => {
    // The send succeeded on the hub but the answer never arrived (network cut mid-response).
    await saveNewReport(local(1, 1));
    const created = hub.submit('dev', { ...local(1, 1).input, ageMs: 0 });
    hub.failHealth = true; // so start()'s own flush cannot be the thing that delivers it
    const s = await started();
    s.h.onMessage(JSON.stringify({ type: 'report:upserted', payload: { report: (created as { report: Report }).report } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(await outboxCount()).toBe(0);
    expect((await getReport(uuid(1)))!.syncState).toBe('sent');
  });

  it('socket refused before auth (4001) -> flush decides: hub reset means pair again, no reconnect storm', async () => {
    const s = await started();
    await settled();
    hub.id = 'hub-B';
    s.h.onClose(4001);
    await tick(30);
    await settled();
    expect(sync.state.needsPairing).toBe('reset');
    expect(sockets).toHaveLength(1);
  });

  it('socket drop after auth reconnects with growing delay; wake() reconnects at once', async () => {
    const s = await started();
    s.h.onMessage(JSON.stringify({ type: 'auth:ok', payload: { role: 'device', serverTime: hub.time } }));
    await settled();
    s.h.onClose(1006);
    expect(sync.state.socket).toBe(false);
    const delays = timers.filter((t) => t.ms <= 30000 && t.ms >= 1000).map((t) => t.ms);
    expect(delays).toContain(1000);
    timers[timers.length - 1]!.fn(); // fire the reconnect timer
    await tick();
    expect(sockets).toHaveLength(2);
    sockets[1]!.h.onClose(1006);
    expect(timers[timers.length - 1]!.ms).toBe(2000);
    sync.wake();
    await tick();
    expect(sockets).toHaveLength(3);
  });

  it('polls every 5 s while something is unsent, every 10 s without a socket, rarely with one', async () => {
    await saveNewReport(local(1, 1));
    hub.fail = 'network';
    await flush();
    expect(timers[timers.length - 1]!.ms).toBe(5000);
    hub.fail = null;
    await flush();
    expect(timers[timers.length - 1]!.ms).toBe(10000);
    (sync as unknown as { state: { socket: boolean } }).state.socket = true;
    await flush();
    expect(timers[timers.length - 1]!.ms).toBe(60000);
  });
});
