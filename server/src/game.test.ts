// G2 gate: the game over real HTTP and WebSocket with fake timers and a fake clock. Two crews and bots play rounds;
// late orders apply in sequence; duplicates are no-ops; a restart resumes mid-game; host controls work.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { GameView, Order, ServerMessage } from '@pralayam/shared';
import { HubDb } from './db.js';
import { EARLY_RESOLVE_MIN_MS, type Timers } from './game.js';
import { createHub } from './hub.js';

const PASS = 'correct horse battery';
const T0 = 1_800_000_000_000;

class FakeTimers implements Timers {
  pending: { fn: () => void; at: number }[] = [];
  constructor(private clock: () => number) {}
  setTimeout(fn: () => void, ms: number) {
    const t = { fn, at: this.clock() + ms };
    this.pending.push(t);
    return t;
  }
  clearTimeout(id: unknown) {
    this.pending = this.pending.filter((t) => t !== id);
  }
  /** Fire everything due at the current clock (a fired timer may arm a new one). */
  run() {
    for (let guard = 0; guard < 10; guard++) {
      const due = this.pending.filter((t) => t.at <= this.clock());
      if (due.length === 0) return;
      this.pending = this.pending.filter((t) => !due.includes(t));
      for (const t of due) t.fn();
    }
  }
  get next() {
    return this.pending[0]?.at ?? null;
  }
}

interface Env {
  db: HubDb;
  base: string;
  server: http.Server;
  hub: ReturnType<typeof createHub>;
  timers: FakeTimers;
}
let env: Env;
let clock = T0;

async function start(db = new HubDb(':memory:')): Promise<Env> {
  const timers = new FakeTimers(() => clock);
  const hub = createHub({
    db,
    coordinatorPasscode: PASS,
    baseUrl: 'https://hub.test:3443',
    webDist: null,
    now: () => clock,
    rateLimitPerMin: 100_000,
    authRateLimitPerMin: 100_000,
    wsAuthDeadlineMs: 300,
    gameTimers: timers,
  });
  const server = http.createServer(hub.app);
  hub.attach(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { db, base: `http://127.0.0.1:${port}`, server, hub, timers };
}
async function stop(e: Env) {
  e.hub.game.stop();
  await new Promise<void>((r) => e.server.close(() => r()));
  e.server.closeAllConnections?.();
}

beforeEach(async () => {
  clock = T0;
  env = await start();
});
afterEach(async () => {
  await stop(env);
  env.db.close();
});

async function call(method: string, url: string, opts: { token?: string; body?: unknown } = {}, e = env) {
  const res = await fetch(e.base + url, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: text ? (JSON.parse(text) as any) : undefined };
}
async function pair(name: string, deviceId: string) {
  const r = await call('POST', '/api/pair', { body: { joinCode: env.db.joinCode, deviceId, reporterName: name } });
  expect(r.status).toBe(200);
  return r.json.deviceToken as string;
}
async function login() {
  const r = await call('POST', '/api/host/login', { body: { passcode: PASS } });
  return r.json.sessionToken as string;
}
const ord = (seq: number, order: Order, id = randomUUID()) => ({ id, seq, order });
const view = async (token: string): Promise<GameView> => (await call('GET', '/api/game/state', { token })).json.view;
const boat = (v: GameView, id: string) => v.boats.find((b) => b.id === id)!;

/** A started game with one crew (Asha, "dev-asha") and two bots, host logged in. */
async function running() {
  const host = await login();
  const asha = await pair('Asha', 'dev-asha');
  await call('POST', '/api/game/new', { token: host, body: {} });
  await call('POST', '/api/game/join', { token: asha, body: { color: 'moss' } });
  const r = await call('POST', '/api/game/start', { token: host });
  return { host, asha, v: r.json.view as GameView };
}

async function socket(token: string) {
  const ws = new WebSocket(env.base.replace('http', 'ws') + '/ws');
  const msgs: ServerMessage[] = [];
  await new Promise<void>((r) => ws.on('open', r));
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString()) as ServerMessage));
  ws.send(JSON.stringify({ type: 'auth', payload: { token } }));
  await new Promise<void>((r) => ws.once('message', () => r()));
  return { ws, msgs, types: () => msgs.map((m) => m.type) };
}
const settle = () => new Promise((r) => setTimeout(r, 40));

describe('lobby and start', () => {
  it('no game: 404 no_game for crews and host alike; host opens a lobby, crews join, host starts', async () => {
    const host = await login();
    const asha = await pair('Asha', 'dev-asha');
    expect((await call('GET', '/api/game/state', { token: asha })).json.error.code).toBe('no_game');
    expect((await call('POST', '/api/game/join', { token: asha, body: { color: 'moss' } })).status).toBe(404);
    expect((await call('POST', '/api/game/new', { token: asha, body: {} })).status).toBe(403); // crews are not hosts

    const lobby = (await call('POST', '/api/game/new', { token: host, body: { roundSeconds: 30 } })).json.view as GameView;
    expect(lobby.phase).toBe('lobby');
    expect(lobby.roundSeconds).toBe(30);
    expect(lobby.revision).toBe(1);

    const joined = (await call('POST', '/api/game/join', { token: asha, body: { color: 'ember' } })).json.view as GameView;
    expect(joined.boats.map((b) => [b.id, b.name, b.color])).toEqual([['dev-asha', 'Asha', 'ember']]);
    expect(joined.you).toEqual({ boatId: 'dev-asha', queued: 0, nextSeq: 1 });
    expect(joined.revision).toBe(2);
    expect((await call('POST', '/api/game/join', { token: asha, body: { color: 'ember', extra: 1 } })).status).toBe(400);

    const started = (await call('POST', '/api/game/start', { token: host })).json.view as GameView;
    expect(started.phase).toBe('playing');
    expect(started.round).toBe(1);
    expect(started.deadlineAt).toBe(T0 + 30_000);
    expect(started.boats).toHaveLength(3);
    expect(started.calls).toHaveLength(2);
    expect(started.you).toBeUndefined(); // the host's view has no "you"
    expect(env.timers.next).toBe(T0 + 30_000);

    // state?after= returns "unchanged" when nothing moved
    const same = (await call('GET', `/api/game/state?after=${started.revision}`, { token: host })).json;
    expect(same).toEqual({ unchanged: true, revision: started.revision, serverTime: clock });
    expect((await call('GET', `/api/game/state?after=${started.revision - 1}`, { token: host })).json.view.revision).toBe(started.revision);
  });
});

describe('orders over HTTP', () => {
  it('each item answers on its own: queued, replaced, duplicate, invalid shape; "you" counts the queue', async () => {
    const { asha } = await running();
    const a = ord(1, { type: 'move', nodeId: 'kavala' });
    const r = await call('POST', '/api/game/orders', {
      token: asha,
      body: { orders: [a, a, ord(1, { type: 'hold' }), { id: 'bad', seq: 2, order: { type: 'hold' } }, ord(2, { type: 'drop', kit: 'rum' }), ord(3, { type: 'rescue' })] },
    });
    expect(r.status).toBe(200);
    expect(r.json.results.map((x: { result: string }) => x.result)).toEqual(['queued', 'duplicate', 'replaced', 'invalid', 'invalid', 'queued']);
    expect(r.json.results[3].id).toBe('bad');
    expect(r.json.view.you).toEqual({ boatId: 'dev-asha', queued: 2, nextSeq: 4 });
    expect((await call('POST', '/api/game/orders', { token: asha, body: { orders: [] } })).status).toBe(400);
  });

  it('a standing order applies at once and a stranger cannot order', async () => {
    const { asha } = await running();
    const r = await call('POST', '/api/game/orders', { token: asha, body: { orders: [ord(1, { type: 'standing', mode: 'return' })] } });
    expect(r.json.results[0].result).toBe('queued');
    expect(boat(r.json.view, 'dev-asha').standingOrder).toBe('return');
    const rahul = await pair('Rahul', 'dev-rahul'); // paired but never joined
    const s = await call('POST', '/api/game/orders', { token: rahul, body: { orders: [ord(1, { type: 'hold' })] } });
    expect(s.json.results[0].result).toBe('not_joined');
  });
});

describe('rounds', () => {
  it('the deadline resolves the round; everyone gets game:round then game:state, the crew also game:you', async () => {
    const { host, asha } = await running();
    const hostWs = await socket(host);
    const crewWs = await socket(asha);
    await call('POST', '/api/game/orders', { token: asha, body: { orders: [ord(1, { type: 'move', nodeId: 'kavala' })] } });
    await settle();
    expect(crewWs.types()).toContain('game:you');
    expect(hostWs.types()).not.toContain('game:you');

    clock = T0 + 45_000;
    env.timers.run();
    await settle();
    const v = await view(host);
    expect(v.round).toBe(2);
    expect(boat(v, 'dev-asha').nodeId).toBe('kavala');
    const types = hostWs.types();
    const round = types.lastIndexOf('game:round');
    expect(round).toBeGreaterThan(-1);
    expect(types[round + 1]).toBe('game:state');
    const payload = (hostWs.msgs[round] as { payload: { round: number; events: { type: string }[] } }).payload;
    expect(payload.round).toBe(1);
    expect(payload.events.some((e) => e.type === 'moved')).toBe(true);
    expect(crewWs.types().filter((t) => t === 'game:you').length).toBeGreaterThanOrEqual(2);
    expect(env.timers.next).toBe(T0 + 90_000);
    hostWs.ws.close();
    crewWs.ws.close();
  });

  it('resolves early once every crew in contact has ordered and 10 s have passed', async () => {
    const { host, asha } = await running();
    clock = T0 + EARLY_RESOLVE_MIN_MS - 1000;
    await call('POST', '/api/game/orders', { token: asha, body: { orders: [ord(1, { type: 'hold' })] } });
    expect((await view(host)).round).toBe(1); // too early
    clock = T0 + EARLY_RESOLVE_MIN_MS;
    await call('POST', '/api/game/orders', { token: asha, body: { orders: [ord(1, { type: 'move', nodeId: 'kumbalam' })] } }); // replaces
    expect((await view(host)).round).toBe(2);
    expect(boat(await view(host), 'dev-asha').nodeId).toBe('kumbalam');
  });

  it('a crew that was out of contact: queued orders arrive together and play out one per round, no duplicates', async () => {
    const { host, asha } = await running();
    const rahul = await pair('Rahul', 'dev-rahul');
    await call('POST', '/api/game/join', { token: rahul, body: { color: 'lamp' } });
    // Rahul goes quiet. Asha keeps ordering; rounds pass on the clock.
    for (let round = 1; round <= 2; round++) {
      await call('POST', '/api/game/orders', { token: asha, body: { orders: [ord(round, { type: 'hold' })] } });
      clock += 45_000;
      env.timers.run();
    }
    let v = await view(host);
    expect(v.round).toBe(3);
    expect(v.contact['dev-rahul']).toBe(false); // last heard > 20 s ago
    expect(boat(v, 'dev-rahul').nodeId).toBe('jetty');
    // Back in range: two orders at once, plus a retry of the first (same id)
    const o1 = ord(1, { type: 'move', nodeId: 'kavala' });
    const o2 = ord(2, { type: 'move', nodeId: 'vattappara' });
    const r = await call('POST', '/api/game/orders', { token: rahul, body: { orders: [o1, o2, o1] } });
    expect(r.json.results.map((x: { result: string }) => x.result)).toEqual(['queued', 'queued', 'duplicate']);
    expect(r.json.view.you).toEqual({ boatId: 'dev-rahul', queued: 2, nextSeq: 3 });
    expect(r.json.view.contact['dev-rahul']).toBe(true);
    clock += 45_000;
    env.timers.run();
    v = await view(host);
    expect(boat(v, 'dev-rahul').nodeId).toBe('kavala');
    clock += 45_000;
    env.timers.run();
    v = await view(host);
    expect(boat(v, 'dev-rahul').nodeId).toBe('vattappara');
    expect(boat(v, 'dev-rahul').passengers.length).toBeGreaterThan(0); // people climbed aboard on arrival
    // the retry after they were played is still a duplicate, a new id on an old seq is late
    const again = await call('POST', '/api/game/orders', { token: rahul, body: { orders: [o2, ord(2, { type: 'hold' })] } });
    expect(again.json.results.map((x: { result: string }) => x.result)).toEqual(['duplicate', 'late']);
  });
});

describe('restart', () => {
  it('a new hub on the same database resumes the game at the same revision and round', async () => {
    const { host, asha } = await running();
    await call('POST', '/api/game/orders', { token: asha, body: { orders: [ord(1, { type: 'move', nodeId: 'kavala' })] } });
    const before = await view(host);
    await stop(env);
    env = await start(env.db);
    const after = await view(host);
    expect(after.revision).toBe(before.revision);
    expect(after.round).toBe(1);
    expect(after.deadlineAt).toBe(before.deadlineAt);
    expect(env.timers.next).toBe(before.deadlineAt);
    clock = before.deadlineAt! ;
    env.timers.run();
    expect(boat(await view(host), 'dev-asha').nodeId).toBe('kavala'); // the queued order survived the restart
  });

  it('a hub that comes back after the deadline resolves the overdue round on boot', async () => {
    const { host } = await running();
    const before = await view(host);
    await stop(env);
    clock = before.deadlineAt! + 5000;
    env = await start(env.db);
    const after = await view(host);
    expect(after.round).toBe(2);
    expect(after.deadlineAt).toBe(clock + 45_000);
  });
});

describe('host controls', () => {
  it('pause stops the clock, resume continues it, skip resolves now, end finishes, replay has the history', async () => {
    const { host, asha } = await running();
    clock = T0 + 20_000;
    let v = (await call('POST', '/api/game/pause', { token: host })).json.view as GameView;
    expect(v.phase).toBe('paused');
    expect(v.deadlineAt).toBeNull();
    expect(env.timers.next).toBeNull();
    // orders still queue while paused, nothing resolves
    expect((await call('POST', '/api/game/orders', { token: asha, body: { orders: [ord(1, { type: 'hold' })] } })).json.results[0].result).toBe('queued');
    clock = T0 + 120_000;
    env.timers.run();
    expect((await view(host)).round).toBe(1);
    v = (await call('POST', '/api/game/resume', { token: host })).json.view as GameView;
    expect(v.phase).toBe('playing');
    expect(v.deadlineAt).toBe(clock + 25_000); // 25 s were left
    v = (await call('POST', '/api/game/skip', { token: host })).json.view as GameView;
    expect(v.round).toBe(2);
    v = (await call('POST', '/api/game/end', { token: host })).json.view as GameView;
    expect(v.phase).toBe('ended');
    expect((await call('POST', '/api/game/join', { token: asha, body: { color: 'sky' } })).json.error.code).toBe('game_over');
    expect((await call('POST', '/api/game/orders', { token: asha, body: { orders: [ord(5, { type: 'hold' })] } })).json.results[0].result).toBe('ended');
    const replay = (await call('GET', '/api/game/replay', { token: host })).json;
    expect(replay.state.history).toHaveLength(1);
    expect(replay.state).toHaveProperty('queues');
    expect((await call('GET', '/api/game/replay', { token: asha })).status).toBe(403);
  });

  it('a bot-only night runs to first light with skip, and a new game replaces it', async () => {
    const host = await login();
    await call('POST', '/api/game/new', { token: host, body: {} });
    let v = (await call('POST', '/api/game/start', { token: host })).json.view as GameView;
    expect(v.boats.filter((b) => b.bot)).toHaveLength(3);
    for (let i = 0; i < 10; i++) v = (await call('POST', '/api/game/skip', { token: host })).json.view as GameView;
    expect(v.phase).toBe('ended');
    expect(v.round).toBe(10);
    expect(v.score).toBe(170);
    expect(v.stars).toBe(1);
    expect(env.timers.next).toBeNull();
    const fresh = (await call('POST', '/api/game/new', { token: host, body: { bots: false } })).json.view as GameView;
    expect(fresh.phase).toBe('lobby');
    expect(fresh.id).not.toBe(v.id);
    expect(fresh.revision).toBe(v.revision + 1);
  });
});
