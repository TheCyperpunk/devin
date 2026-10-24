// Phase 2 gate: runs the real hub (in-memory SQLite) over HTTP and WebSocket and checks the contract's rules.
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { PhoneReportInput, Report } from '@relief-mesh/shared';
import { HubDb } from './db.js';
import { createHub } from './hub.js';

const PASS = 'correct horse battery';

interface Env {
  db: HubDb;
  base: string;
  server: http.Server;
  hub: ReturnType<typeof createHub>;
}

let env: Env;

async function start(db = new HubDb(':memory:'), over: Partial<Parameters<typeof createHub>[0]> = {}): Promise<Env> {
  const hub = createHub({
    db,
    coordinatorPasscode: PASS,
    baseUrl: 'https://hub.test:3443',
    webDist: null,
    rateLimitPerMin: 10_000,
    authRateLimitPerMin: 10_000,
    wsAuthDeadlineMs: 300,
    ...over,
  });
  const server = http.createServer(hub.app);
  hub.attach(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { db, base: `http://127.0.0.1:${port}`, server, hub };
}

beforeEach(async () => {
  env = await start();
});
afterEach(async () => {
  await new Promise<void>((r) => env.server.close(() => r()));
  env.server.closeAllConnections?.();
  env.db.close();
});

async function call(method: string, url: string, opts: { token?: string; body?: unknown; raw?: string } = {}) {
  const res = await fetch(env.base + url, {
    method,
    headers: {
      ...(opts.body !== undefined || opts.raw !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as any) : undefined };
}

async function pair(name = 'Asha', deviceId = 'dev-' + randomUUID().slice(0, 12)) {
  const r = await call('POST', '/api/pair', { body: { joinCode: env.db.joinCode, deviceId, reporterName: name } });
  expect(r.status).toBe(200);
  return { token: r.json.deviceToken as string, deviceId };
}

async function login() {
  const r = await call('POST', '/api/dashboard/login', { body: { passcode: PASS } });
  expect(r.status).toBe(200);
  return r.json.sessionToken as string;
}

function report(over: Partial<PhoneReportInput> = {}): PhoneReportInput {
  return {
    id: randomUUID(),
    needs: ['food'],
    peopleCount: 4,
    hasChildren: false,
    hasElderlyOrSick: false,
    urgent: false,
    ageMs: 0,
    ...over,
  };
}

describe('health and pairing', () => {
  it('health is public and returns a stable hubId', async () => {
    const a = await call('GET', '/api/health');
    expect(a.status).toBe(200);
    expect(a.json.ok).toBe(true);
    expect(a.json.hubId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await call('GET', '/api/health')).json.hubId).toBe(a.json.hubId);
  });

  it('rejects a wrong join code and accepts the right one (case-insensitive)', async () => {
    const bad = await call('POST', '/api/pair', { body: { joinCode: 'WRONG123', deviceId: 'device-0001', reporterName: 'A' } });
    expect(bad.status).toBe(403);
    expect(bad.json.error.code).toBe('bad_join_code');
    const ok = await call('POST', '/api/pair', {
      body: { joinCode: env.db.joinCode.toLowerCase(), deviceId: 'device-0001', reporterName: 'A' },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.deviceToken).toBeTruthy();
    expect(ok.json.hubId).toBe(env.db.hubId);
  });

  it('re-pairing replaces the token but the device keeps its reports', async () => {
    const first = await pair('Asha', 'device-same-01');
    const r = report();
    await call('POST', '/api/reports', { token: first.token, body: r });
    const second = await pair('Asha', 'device-same-01');
    expect((await call('GET', '/api/my-reports', { token: first.token })).status).toBe(401);
    const mine = await call('GET', '/api/my-reports', { token: second.token });
    expect(mine.json.reports.map((x: Report) => x.id)).toEqual([r.id]);
  });

  it('stores only a hash of the device token', async () => {
    const { token } = await pair();
    const raw = (env.db as any).db.prepare('select token_hash from devices').get().token_hash as string;
    expect(raw).not.toContain(token);
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('creating reports', () => {
  it('requires a device token', async () => {
    expect((await call('POST', '/api/reports', { body: report() })).status).toBe(401);
    expect((await call('POST', '/api/reports', { token: 'x'.repeat(43), body: report() })).status).toBe(401);
  });

  it('posting the same report twice stores one row (201 then 200)', async () => {
    const { token } = await pair();
    const r = report({ needs: ['medical'] });
    const a = await call('POST', '/api/reports', { token, body: r });
    const b = await call('POST', '/api/reports', { token, body: r });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json.report.revision).toBe(a.json.report.revision);
    const all = await call('GET', '/api/dashboard/reports', { token: await login() });
    expect(all.json.reports).toHaveLength(1);
  });

  it('the hub fills identity, status and score; the phone cannot', async () => {
    const { token, deviceId } = await pair('Ravi');
    const r = report({ needs: ['medical'], urgent: true, peopleCount: 2 });
    const { json } = await call('POST', '/api/reports', { token, body: r });
    expect(json.report).toMatchObject({
      deviceId,
      reporterName: 'Ravi',
      status: 'open',
      assignee: null,
      baseScore: 40 + 25 + 3,
    });
  });

  it.each([
    ['status', { status: 'done' }],
    ['assignee', { assignee: 'boat team' }],
    ['deviceId', { deviceId: 'someone-else-1' }],
    ['reporterName', { reporterName: 'Mallory' }],
    ['baseScore', { baseScore: 999 }],
    ['revision', { revision: 1 }],
  ])('rejects a phone sending hub-owned field %s', async (_name, extra) => {
    const { token } = await pair();
    const r = await call('POST', '/api/reports', { token, body: { ...report(), ...extra } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('invalid_body');
  });

  it.each([
    ['no needs', { needs: [] }],
    ['unknown need', { needs: ['pizza'] }],
    ['duplicate needs', { needs: ['food', 'food'] }],
    ['0 people', { peopleCount: 0 }],
    ['501 people', { peopleCount: 501 }],
    ['fractional people', { peopleCount: 2.5 }],
    ['long note', { note: 'x'.repeat(281) }],
    ['lat without lng', { lat: 10 }],
    ['bad latitude', { lat: 99, lng: 76 }],
    ['accuracy without position', { accuracyM: 5 }],
    ['negative age', { ageMs: -1 }],
    ['non-uuid id', { id: 'not-a-uuid' }],
  ])('rejects invalid input: %s', async (_name, extra) => {
    const { token } = await pair();
    const r = await call('POST', '/api/reports', { token, body: { ...report(), ...extra } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('invalid_body');
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const { token } = await pair();
    expect((await call('POST', '/api/reports', { token, raw: '{not json' })).status).toBe(400);
    const big = await call('POST', '/api/reports', { token, body: { ...report(), note: 'x'.repeat(70_000) } });
    expect(big.status).toBe(413);
    expect(big.json.error.code).toBe('too_large');
  });

  it('an id owned by another device is a 409 and leaks nothing', async () => {
    const a = await pair('A');
    const b = await pair('B');
    const r = report({ note: 'private note' });
    await call('POST', '/api/reports', { token: a.token, body: r });
    const hijack = await call('POST', '/api/reports', { token: b.token, body: r });
    expect(hijack.status).toBe(409);
    expect(JSON.stringify(hijack.json)).not.toContain('private note');
    expect((await call('GET', '/api/my-reports', { token: b.token })).json.reports).toHaveLength(0);
  });

  it('computes reportedAt from ageMs and clamps absurd ages to 48 hours', async () => {
    const { token } = await pair();
    const hour = 3_600_000;
    const old = await call('POST', '/api/reports', { token, body: report({ ageMs: 2 * hour }) });
    expect(old.json.report.receivedAt - old.json.report.reportedAt).toBe(2 * hour);
    const ancient = await call('POST', '/api/reports', { token, body: report({ ageMs: 900 * hour }) });
    expect(ancient.json.report.receivedAt - ancient.json.report.reportedAt).toBe(48 * hour);
  });

  it('drops an empty note and keeps a trimmed one', async () => {
    const { token } = await pair();
    expect((await call('POST', '/api/reports', { token, body: report({ note: '   ' }) })).json.report.note).toBeNull();
    expect((await call('POST', '/api/reports', { token, body: report({ note: '  need boat ' }) })).json.report.note).toBe('need boat');
  });
});

describe('batch', () => {
  it('reports each item separately: created, duplicate, conflict, invalid', async () => {
    const a = await pair('A');
    const b = await pair('B');
    const dup = report();
    const theirs = report();
    await call('POST', '/api/reports', { token: a.token, body: dup });
    await call('POST', '/api/reports', { token: b.token, body: theirs });
    const fresh = report();
    const bad = { ...report(), peopleCount: 0 };
    const r = await call('POST', '/api/reports/batch', { token: a.token, body: { reports: [fresh, dup, theirs, bad] } });
    expect(r.status).toBe(200);
    expect(r.json.results.map((x: { result: string }) => x.result)).toEqual(['created', 'duplicate', 'conflict', 'invalid']);
    expect(r.json.results[3].id).toBe(bad.id);
    expect((await call('GET', '/api/my-reports', { token: a.token })).json.reports).toHaveLength(2);
  });

  it('rejects more than 50 reports and an empty list', async () => {
    const { token } = await pair();
    const many = Array.from({ length: 51 }, () => report());
    expect((await call('POST', '/api/reports/batch', { token, body: { reports: many } })).status).toBe(413);
    expect((await call('POST', '/api/reports/batch', { token, body: { reports: [] } })).status).toBe(400);
    const fifty = Array.from({ length: 50 }, () => report());
    expect((await call('POST', '/api/reports/batch', { token, body: { reports: fifty } })).status).toBe(200);
  });
});

describe('who can read what', () => {
  it('a phone sees only its own reports', async () => {
    const a = await pair('A');
    const b = await pair('B');
    const ra = report();
    const rb = report();
    await call('POST', '/api/reports', { token: a.token, body: ra });
    await call('POST', '/api/reports', { token: b.token, body: rb });
    const seenA = await call('GET', '/api/my-reports', { token: a.token });
    const seenB = await call('GET', '/api/my-reports', { token: b.token });
    expect(seenA.json.reports.map((x: Report) => x.id)).toEqual([ra.id]);
    expect(seenB.json.reports.map((x: Report) => x.id)).toEqual([rb.id]);
  });

  it('dashboard routes need a coordinator token (401 without, 403 with a device token)', async () => {
    const { token } = await pair();
    const paths: [string, string][] = [
      ['GET', '/api/dashboard/reports'],
      ['PATCH', '/api/dashboard/reports/' + randomUUID()],
      ['GET', '/api/dashboard/stats'],
      ['GET', '/api/dashboard/join'],
      ['POST', '/api/dashboard/join/rotate'],
    ];
    for (const [m, p] of paths) {
      expect((await call(m, p, { body: m === 'PATCH' ? { status: 'done' } : undefined })).status, `${m} ${p} no token`).toBe(401);
      expect((await call(m, p, { token, body: m === 'PATCH' ? { status: 'done' } : undefined })).status, `${m} ${p} device`).toBe(403);
    }
  });

  it('a coordinator token cannot create or read device data', async () => {
    const session = await login();
    expect((await call('POST', '/api/reports', { token: session, body: report() })).status).toBe(403);
    expect((await call('GET', '/api/my-reports', { token: session })).status).toBe(403);
  });

  it('login rejects a wrong passcode', async () => {
    const r = await call('POST', '/api/dashboard/login', { body: { passcode: 'nope' } });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe('unauthorized');
  });

  it('the coordinator sees every phone and revisions strictly increase', async () => {
    const a = await pair('A');
    const b = await pair('B');
    for (const t of [a.token, b.token, a.token, b.token]) await call('POST', '/api/reports', { token: t, body: report() });
    const all = await call('GET', '/api/dashboard/reports', { token: await login() });
    const revs = all.json.reports.map((x: Report) => x.revision);
    expect(revs).toHaveLength(4);
    expect(revs).toEqual([...revs].sort((x, y) => x - y));
    expect(new Set(revs).size).toBe(4);
  });

  it('the ?after= cursor returns only newer revisions and reports maxRevision', async () => {
    const { token } = await pair();
    const session = await login();
    for (let i = 0; i < 3; i++) await call('POST', '/api/reports', { token, body: report() });
    const first = await call('GET', '/api/dashboard/reports', { token: session });
    const mid = first.json.reports[1].revision as number;
    const after = await call('GET', `/api/dashboard/reports?after=${mid}`, { token: session });
    expect(after.json.reports).toHaveLength(1);
    expect(after.json.maxRevision).toBe(first.json.maxRevision);
    const none = await call('GET', `/api/dashboard/reports?after=${first.json.maxRevision}`, { token: session });
    expect(none.json.reports).toHaveLength(0);
    expect(none.json.maxRevision).toBe(first.json.maxRevision);
    expect(none.json.hasMore).toBe(false);
  });
});

describe('coordinator edits', () => {
  async function seeded() {
    const dev = await pair('Meera');
    const session = await login();
    const r = report({ needs: ['rescue'] });
    const created = await call('POST', '/api/reports', { token: dev.token, body: r });
    return { dev, session, id: r.id, created: created.json.report as Report };
  }

  it('assign then done, each bump the revision and the phone sees it', async () => {
    const { dev, session, id, created } = await seeded();
    const assigned = await call('PATCH', `/api/dashboard/reports/${id}`, {
      token: session,
      body: { status: 'assigned', assignee: 'Boat team 2' },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.json.report).toMatchObject({ status: 'assigned', assignee: 'Boat team 2' });
    expect(assigned.json.report.revision).toBeGreaterThan(created.revision);

    const done = await call('PATCH', `/api/dashboard/reports/${id}`, { token: session, body: { status: 'done' } });
    expect(done.json.report.status).toBe('done');
    expect(done.json.report.assignee).toBe('Boat team 2');
    expect(done.json.report.revision).toBeGreaterThan(assigned.json.report.revision);

    const mine = await call('GET', `/api/my-reports?after=${created.revision}`, { token: dev.token });
    expect(mine.json.reports[0]).toMatchObject({ id, status: 'done', assignee: 'Boat team 2' });
    const stats = await call('GET', '/api/dashboard/stats', { token: session });
    expect(stats.json).toMatchObject({ open: 0, assigned: 0, done: 1, cloud: { state: 'not_configured' } });
  });

  it('"assigned" needs an assignee and clearing it from an assigned report is refused', async () => {
    const { session, id } = await seeded();
    const url = `/api/dashboard/reports/${id}`;
    expect((await call('PATCH', url, { token: session, body: { status: 'assigned' } })).status).toBe(400);
    await call('PATCH', url, { token: session, body: { status: 'assigned', assignee: 'Team A' } });
    expect((await call('PATCH', url, { token: session, body: { assignee: null } })).status).toBe(400);
    const reopened = await call('PATCH', url, { token: session, body: { status: 'open', assignee: null } });
    expect(reopened.json.report).toMatchObject({ status: 'open', assignee: null });
  });

  it('a change that changes nothing does not bump the revision', async () => {
    const { session, id, created } = await seeded();
    const r = await call('PATCH', `/api/dashboard/reports/${id}`, { token: session, body: { status: 'open' } });
    expect(r.status).toBe(200);
    expect(r.json.report.revision).toBe(created.revision);
  });

  it('validates the body and 404s unknown reports', async () => {
    const { session, id } = await seeded();
    expect((await call('PATCH', `/api/dashboard/reports/${id}`, { token: session, body: {} })).status).toBe(400);
    expect((await call('PATCH', `/api/dashboard/reports/${id}`, { token: session, body: { status: 'nope' } })).status).toBe(400);
    expect((await call('PATCH', `/api/dashboard/reports/${id}`, { token: session, body: { peopleCount: 1 } })).status).toBe(400);
    expect((await call('PATCH', `/api/dashboard/reports/${randomUUID()}`, { token: session, body: { status: 'done' } })).status).toBe(404);
  });

  it('the join code can be read and rotated; the old code stops working but paired phones keep working', async () => {
    const { dev, session } = await seeded();
    const before = await call('GET', '/api/dashboard/join', { token: session });
    expect(before.json.joinUrl).toBe(`https://hub.test:3443/?join=${before.json.joinCode}`);
    expect(before.json.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const after = await call('POST', '/api/dashboard/join/rotate', { token: session });
    expect(after.json.joinCode).not.toBe(before.json.joinCode);
    const old = await call('POST', '/api/pair', {
      body: { joinCode: before.json.joinCode, deviceId: 'device-late-01', reporterName: 'Late' },
    });
    expect(old.status).toBe(403);
    expect((await call('GET', '/api/my-reports', { token: dev.token })).status).toBe(200);
  });
});

describe('limits', () => {
  it('rate limits pairing attempts per IP', async () => {
    await new Promise<void>((r) => env.server.close(() => r()));
    env.db.close();
    env = await start(new HubDb(':memory:'), { authRateLimitPerMin: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await call('POST', '/api/pair', { body: { joinCode: 'GUESS' + i, deviceId: 'device-0001', reporterName: 'x' } });
      codes.push(r.status);
    }
    expect(codes).toEqual([403, 403, 403, 429, 429]);
  });

  it('rate limits a busy token without touching health', async () => {
    await new Promise<void>((r) => env.server.close(() => r()));
    env.db.close();
    env = await start(new HubDb(':memory:'), { rateLimitPerMin: 3 });
    const { token } = await pair();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await call('GET', '/api/my-reports', { token })).status);
    expect(codes.slice(-2)).toEqual([429, 429]);
    expect((await call('GET', '/api/health')).status).toBe(200);
  });

  it('unknown API paths are a JSON 404', async () => {
    const r = await call('GET', '/api/nope');
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('not_found');
  });
});

describe('persistence', () => {
  it('hubId, revision and data survive a restart', async () => {
    await new Promise<void>((r) => env.server.close(() => r()));
    env.db.close();
    const dir = mkdtempSync(path.join(tmpdir(), 'relief-'));
    const file = path.join(dir, 'hub.db');
    try {
      env = await start(new HubDb(file));
      const { token } = await pair('Persist', 'device-persist-1');
      const r = report();
      const created = await call('POST', '/api/reports', { token, body: r });
      const hubId = env.db.hubId;
      const code = env.db.joinCode;
      await new Promise<void>((res) => env.server.close(() => res()));
      env.db.close();

      env = await start(new HubDb(file));
      expect(env.db.hubId).toBe(hubId);
      expect(env.db.joinCode).toBe(code);
      expect((await call('GET', '/api/my-reports', { token })).json.reports.map((x: Report) => x.id)).toEqual([r.id]);
      const next = await call('POST', '/api/reports', { token, body: report() });
      expect(next.json.report.revision).toBe(created.json.report.revision + 1);
    } finally {
      await new Promise<void>((res) => env.server.close(() => res()));
      env.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------- WebSocket ----------------

interface Sock {
  ws: WebSocket;
  msgs: { type: string; payload: any }[];
  closed: Promise<number>;
  next(type: string, ms?: number): Promise<any>;
}

function connect(): Sock {
  const ws = new WebSocket(env.base.replace('http', 'ws') + '/ws');
  const msgs: Sock['msgs'] = [];
  const waiters: { type: string; resolve: (p: any) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.type === m.type);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(m.payload);
    else msgs.push(m);
  });
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  return {
    ws,
    msgs,
    closed,
    next(type, ms = 1500) {
      const i = msgs.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(msgs.splice(i, 1)[0]!.payload);
      return new Promise((resolve, reject) => {
        waiters.push({ type, resolve });
        setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), ms).unref();
      });
    },
  };
}

async function authed(token: string): Promise<Sock> {
  const s = connect();
  await new Promise((r) => s.ws.once('open', r));
  s.ws.send(JSON.stringify({ type: 'auth', payload: { token } }));
  await s.next('auth:ok');
  return s;
}

const quiet = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('websocket', () => {
  it('auth:ok tells each client its role', async () => {
    const dev = await pair();
    const s = connect();
    await new Promise((r) => s.ws.once('open', r));
    s.ws.send(JSON.stringify({ type: 'auth', payload: { token: dev.token } }));
    expect(await s.next('auth:ok')).toMatchObject({ role: 'device' });
    const c = connect();
    await new Promise((r) => c.ws.once('open', r));
    c.ws.send(JSON.stringify({ type: 'auth', payload: { token: await login() } }));
    expect(await c.next('auth:ok')).toMatchObject({ role: 'coordinator' });
    s.ws.close();
    c.ws.close();
  });

  it('closes with 4001 on a bad token, on garbage, and when no auth arrives in time', async () => {
    const bad = connect();
    await new Promise((r) => bad.ws.once('open', r));
    bad.ws.send(JSON.stringify({ type: 'auth', payload: { token: 'y'.repeat(43) } }));
    expect(await bad.closed).toBe(4001);

    const junk = connect();
    await new Promise((r) => junk.ws.once('open', r));
    junk.ws.send('not json');
    expect(await junk.closed).toBe(4001);

    const silent = connect();
    expect(await silent.closed).toBe(4001);
  });

  it('a phone only receives events for its own reports; the coordinator receives all', async () => {
    const a = await pair('A');
    const b = await pair('B');
    const sa = await authed(a.token);
    const sb = await authed(b.token);
    const sc = await authed(await login());

    const ra = report();
    const rb = report();
    await call('POST', '/api/reports', { token: a.token, body: ra });
    await call('POST', '/api/reports', { token: b.token, body: rb });

    expect((await sa.next('report:upserted')).report.id).toBe(ra.id);
    expect((await sb.next('report:upserted')).report.id).toBe(rb.id);
    const c1 = await sc.next('report:upserted');
    const c2 = await sc.next('report:upserted');
    expect([c1.report.id, c2.report.id].sort()).toEqual([ra.id, rb.id].sort());
    expect(await sc.next('stats')).toMatchObject({ open: expect.any(Number) });

    await quiet();
    expect(sa.msgs.filter((m) => m.type === 'report:upserted')).toHaveLength(0); // nothing of B's leaked to A
    expect(sb.msgs.filter((m) => m.type === 'report:upserted')).toHaveLength(0);
    expect(sa.msgs.find((m) => m.type === 'stats')).toBeUndefined(); // phones never get global counts
    [sa, sb, sc].forEach((s) => s.ws.close());
  });

  it('assigning a report pushes the update to its phone only', async () => {
    const a = await pair('A');
    const b = await pair('B');
    const session = await login();
    const r = report();
    await call('POST', '/api/reports', { token: a.token, body: r });
    await call('POST', '/api/reports', { token: b.token, body: report() });
    const sa = await authed(a.token);
    const sb = await authed(b.token);
    await call('PATCH', `/api/dashboard/reports/${r.id}`, { token: session, body: { status: 'assigned', assignee: 'Boat 1' } });
    expect((await sa.next('report:upserted')).report).toMatchObject({ id: r.id, status: 'assigned', assignee: 'Boat 1' });
    await quiet();
    expect(sb.msgs.filter((m) => m.type === 'report:upserted')).toHaveLength(0);
    sa.ws.close();
    sb.ws.close();
  });

  it('re-pairing closes the old token\'s socket', async () => {
    const first = await pair('A', 'device-socket-1');
    const s = await authed(first.token);
    await pair('A', 'device-socket-1');
    expect(await s.closed).toBe(4001);
  });

  it('a duplicate post broadcasts nothing', async () => {
    const a = await pair('A');
    const r = report();
    await call('POST', '/api/reports', { token: a.token, body: r });
    const s = await authed(a.token);
    await call('POST', '/api/reports', { token: a.token, body: r });
    await quiet();
    expect(s.msgs.filter((m) => m.type === 'report:upserted')).toHaveLength(0);
    s.ws.close();
  });
});
