// DashboardStore against a fake hub: session, catch-up, revision merge, pushes, patch, reconnect, logout paths.
import { beforeEach, describe, expect, it } from 'vitest';
import type { CloudStatus, PatchReport, Report } from '@relief-mesh/shared';
import { ApiFail, type ReportsPage } from '../lib/api.js';
import type { SocketHandlers } from '../lib/socket.js';
import type { DashApi } from './api.js';
import { DashboardStore, type DashEnv } from './store.js';

const NOW = 1_800_000_000_000;
let rev = 0;
const report = (over: Partial<Report> = {}): Report => ({
  id: `id-${++rev}`,
  deviceId: 'dev',
  reporterName: 'Asha',
  needs: ['food'],
  peopleCount: 2,
  hasChildren: false,
  hasElderlyOrSick: false,
  urgent: false,
  note: null,
  lat: null,
  lng: null,
  accuracyM: null,
  receivedAt: NOW,
  reportedAt: NOW,
  updatedAt: NOW,
  revision: rev,
  status: 'open',
  assignee: null,
  baseScore: 13,
  ...over,
});

class FakeHub {
  reports: Report[] = [];
  pageSize = 500;
  fail: 'network' | 'unauthorized' | 'rate_limited' | null = null;
  cloud: CloudStatus = { state: 'not_configured' };
  calls = { reports: [] as number[], patch: [] as [string, PatchReport][], login: [] as string[], join: 0, rotate: 0, export: [] as string[] };
  page(after: number): ReportsPage {
    const all = this.reports.filter((r) => r.revision > after).sort((a, b) => a.revision - b.revision);
    const reports = all.slice(0, this.pageSize);
    return { reports, hasMore: all.length > reports.length, maxRevision: reports.length ? reports[reports.length - 1]!.revision : after, serverTime: NOW + 5000 };
  }
  api(): DashApi {
    const boom = () => {
      if (this.fail) throw new ApiFail(this.fail, this.fail);
    };
    return {
      login: async (p) => {
        this.calls.login.push(p);
        if (p !== 'secret') throw new ApiFail('unauthorized', 'Wrong passcode');
        return { sessionToken: 'sess-1' };
      },
      reports: async (_t, after) => {
        this.calls.reports.push(after);
        boom();
        return this.page(after);
      },
      patch: async (_t, id, body) => {
        this.calls.patch.push([id, body]);
        boom();
        const cur = this.reports.find((r) => r.id === id)!;
        const next = { ...cur, ...body, assignee: body.assignee === undefined ? cur.assignee : body.assignee, revision: ++rev } as Report;
        this.reports = this.reports.map((r) => (r.id === id ? next : r));
        return { report: next };
      },
      stats: async () => {
        boom();
        return { open: 0, assigned: 0, done: 0, cloud: this.cloud };
      },
      join: async () => (this.calls.join++, { joinUrl: 'https://hub/?join=ABC', joinCode: 'ABC', qrDataUrl: 'data:image/png;base64,x' }),
      rotateJoin: async () => (this.calls.rotate++, { joinUrl: 'https://hub/?join=DEF', joinCode: 'DEF', qrDataUrl: 'data:image/png;base64,y' }),
      exportDb: async (t) => {
        this.calls.export.push(t);
        return { blob: new Blob(['SQLite format 3']), filename: 'relief-hub-20261025-1200.db' };
      },
    };
  }
}

interface FakeSocket {
  h: SocketHandlers;
  sent: string[];
  closed: boolean;
}
let hub: FakeHub;
let sockets: FakeSocket[];
let timers: { fn: () => void; ms: number }[];
let saved: string | null;
let now: number;
let store: DashboardStore;

function makeStore(initialSession: string | null = 'sess-0') {
  saved = initialSession;
  const env: DashEnv = {
    api: hub.api(),
    now: () => now,
    openSocket: (h) => {
      const s: FakeSocket = { h, sent: [], closed: false };
      sockets.push(s);
      return { close: () => (s.closed = true) };
    },
    setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimeout: () => {},
    loadSession: () => saved,
    saveSession: (t) => (saved = t),
  };
  return new DashboardStore(env);
}
const settled = () => (store as unknown as { refreshing: Promise<void> | null }).refreshing ?? Promise.resolve();
const authOk = (s: FakeSocket) => s.h.onMessage(JSON.stringify({ type: 'auth:ok', payload: { role: 'coordinator', serverTime: NOW + 5000 } }));

beforeEach(() => {
  rev = 0;
  now = NOW;
  hub = new FakeHub();
  sockets = [];
  timers = [];
  store = makeStore();
});

describe('session', () => {
  it('restores the session from storage and starts with it', async () => {
    expect(store.state.session).toBe('sess-0');
    store.start();
    await settled();
    expect(sockets).toHaveLength(1);
    expect(JSON.parse(sockets[0]!.sent[0] ?? 'null')).toBeNull(); // nothing sent until open
    sockets[0]!.h.onOpen((m) => sockets[0]!.sent.push(m));
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: 'auth', payload: { token: 'sess-0' } });
  });

  it('login: wrong passcode gives a message, right one saves the session and starts', async () => {
    store = makeStore(null);
    expect(await store.login('nope')).toBe('Wrong passcode.');
    expect(store.state.session).toBeNull();
    expect(await store.login('secret')).toBeNull();
    expect(store.state.session).toBe('sess-1');
    expect(saved).toBe('sess-1');
    await settled();
    expect(sockets).toHaveLength(1);
  });

  it('logout clears everything and keeps a notice for the login screen', async () => {
    hub.reports.push(report());
    store.start();
    await settled();
    expect(store.state.reports).toHaveLength(1);
    store.logout('bye');
    expect(store.state).toMatchObject({ session: null, loginNotice: 'bye', reports: [], cursor: 0 });
    expect(saved).toBeNull();
    expect(sockets[0]!.closed).toBe(true);
  });

  it('a rejected session (401 on fetch) logs out with an explanation', async () => {
    hub.fail = 'unauthorized';
    store.start();
    await settled();
    expect(store.state.session).toBeNull();
    expect(store.state.loginNotice).toMatch(/expired/);
  });

  it('a socket refused before auth (4001) logs out', async () => {
    store.start();
    await settled();
    sockets[0]!.h.onClose(4001);
    expect(store.state.session).toBeNull();
    expect(store.state.loginNotice).toMatch(/expired/);
  });
});

describe('loading and merging', () => {
  it('loads all pages, sets the cursor and hub clock, does not flag the initial load as new', async () => {
    hub.pageSize = 2;
    for (let i = 0; i < 5; i++) hub.reports.push(report());
    store.start();
    await settled();
    expect(store.state.reports).toHaveLength(5);
    expect(store.state.cursor).toBe(5);
    expect(store.state.hub).toBe('online');
    expect(store.state.clockOffset).toBe(5000);
    expect(store.state.loading).toBe(false);
    expect(hub.calls.reports).toEqual([0, 2, 4]);
    expect(store.arrived('id-1')).toBeUndefined();
  });

  it('keeps only the newest revision of a report, whatever order copies arrive in', async () => {
    const a = report({ id: 'A' });
    hub.reports.push(a);
    store.start();
    await settled();
    const s = sockets[0]!;
    authOk(s);
    await settled();
    const newer = { ...a, status: 'assigned' as const, assignee: 'Boat 1', revision: 10 };
    const older = { ...a, status: 'done' as const, revision: 3 };
    s.h.onMessage(JSON.stringify({ type: 'report:upserted', payload: { report: newer } }));
    s.h.onMessage(JSON.stringify({ type: 'report:upserted', payload: { report: older } }));
    const got = store.state.reports.find((r) => r.id === 'A')!;
    expect(got).toMatchObject({ status: 'assigned', assignee: 'Boat 1', revision: 10 });
    expect(store.state.reports).toHaveLength(1);
  });

  it('a report pushed over the socket is flagged as newly arrived; a later fetch does not re-flag it', async () => {
    store.start();
    await settled();
    const s = sockets[0]!;
    authOk(s);
    await settled();
    now += 1000;
    const fresh = report({ id: 'P' });
    hub.reports.push(fresh);
    s.h.onMessage(JSON.stringify({ type: 'report:upserted', payload: { report: fresh } }));
    expect(store.arrived('P')).toBe(now);
    now += 1000;
    await store.kick();
    expect(store.arrived('P')).toBe(now - 1000);
  });

  it('catches up from the cursor after a reconnect and only asks for newer revisions', async () => {
    hub.reports.push(report());
    store.start();
    await settled();
    expect(store.state.cursor).toBe(1);
    hub.reports.push(report(), report());
    const s = sockets[0]!;
    authOk(s); // (re)connect triggers a catch-up
    await settled();
    expect(store.state.reports).toHaveLength(3);
    expect(hub.calls.reports.slice(-1)[0]).toBe(1);
    expect(store.state.cursor).toBe(3);
  });

  it('cloud status comes from stats and from the socket', async () => {
    hub.cloud = { state: 'offline', pending: 3, lastSyncAt: null };
    store.start();
    await settled();
    expect(store.state.cloud).toEqual({ state: 'offline', pending: 3, lastSyncAt: null });
    sockets[0]!.h.onMessage(JSON.stringify({ type: 'cloud:status', payload: { state: 'synced', total: 3, lastSyncAt: NOW } }));
    expect(store.state.cloud).toEqual({ state: 'synced', total: 3, lastSyncAt: NOW });
  });

  it('network failure marks the hub offline and keeps what it had', async () => {
    hub.reports.push(report());
    store.start();
    await settled();
    hub.fail = 'network';
    await store.kick();
    expect(store.state.hub).toBe('offline');
    expect(store.state.reports).toHaveLength(1);
    expect(store.state.session).toBe('sess-0');
  });

  it('coalesces concurrent kicks into one follow-up refresh', async () => {
    store.start();
    await settled();
    const n = hub.calls.reports.length;
    await Promise.all([store.kick(), store.kick(), store.kick()]);
    expect(hub.calls.reports.length).toBe(n + 2);
  });
});

describe('actions', () => {
  it('patch sends the body and merges the hub answer', async () => {
    hub.reports.push(report({ id: 'A' }));
    store.start();
    await settled();
    expect(await store.patch('A', { status: 'assigned', assignee: 'Boat 2' })).toBeNull();
    expect(hub.calls.patch).toEqual([['A', { status: 'assigned', assignee: 'Boat 2' }]]);
    expect(store.state.reports[0]).toMatchObject({ status: 'assigned', assignee: 'Boat 2', revision: 2 });
  });

  it('patch failures: network keeps the session, 401 ends it', async () => {
    hub.reports.push(report({ id: 'A' }));
    store.start();
    await settled();
    hub.fail = 'network';
    expect(await store.patch('A', { status: 'done' })).toMatch(/not saved/);
    expect(store.state.hub).toBe('offline');
    expect(store.state.reports[0]!.status).toBe('open');
    hub.fail = 'unauthorized';
    expect(await store.patch('A', { status: 'done' })).toMatch(/expired/i);
    expect(store.state.session).toBeNull();
  });

  it('join and rotate call the hub', async () => {
    expect((await store.join()).joinCode).toBe('ABC');
    expect((await store.rotateJoin()).joinCode).toBe('DEF');
    expect(hub.calls).toMatchObject({ join: 1, rotate: 1 });
    const exp = await store.exportDb();
    expect(exp.filename).toBe('relief-hub-20261025-1200.db');
    expect(hub.calls.export).toEqual([store.state.session]);
  });
});

describe('socket resilience', () => {
  it('reconnects with growing delay after a drop; wake() reconnects at once', async () => {
    store.start();
    await settled();
    const s = sockets[0]!;
    authOk(s);
    await settled();
    expect(store.state.socket).toBe(true);
    s.h.onClose(1006);
    expect(store.state.socket).toBe(false);
    expect(timers[timers.length - 1]!.ms).toBe(1000);
    timers[timers.length - 1]!.fn();
    expect(sockets).toHaveLength(2);
    sockets[1]!.h.onClose(1006);
    expect(timers[timers.length - 1]!.ms).toBe(2000);
    store.wake();
    expect(sockets).toHaveLength(3);
  });

  it('polls every 10 s without a socket and every 60 s with one', async () => {
    store.start();
    await settled();
    expect(timers.some((t) => t.ms === 10000)).toBe(true);
    authOk(sockets[0]!);
    await settled();
    expect(timers[timers.length - 1]!.ms).toBe(60000);
  });
});
