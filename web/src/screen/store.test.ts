// ScreenStore against a fake hub: login, catch-up by revision, "unchanged", no game, socket pushes (state merged
// only when newer, rounds become toasts), host actions, session expiry.
import { beforeEach, describe, expect, it } from 'vitest';
import { Ward, joinBoat, newGame, parseScenario, resolveRound, startGame, thuruthu, toView, type GameRoundPayload, type GameState, type GameView } from '@relief-mesh/shared';
import { ApiFail } from '../lib/api.js';
import type { SocketHandlers } from '../lib/socket.js';
import type { ScreenApi } from './api.js';
import { MAX_TOASTS, ScreenStore, TOAST_MS, type ScreenEnv } from './store.js';

const scn = parseScenario(thuruthu);
const ward = new Ward(scn);
const T = 1_800_000_000_000;

class FakeHub {
  state: GameState | null = null;
  revision = 0;
  fail: 'network' | 'unauthorized' | null = null;
  calls = { state: [] as number[], host: [] as string[], new: 0, join: 0 };
  view(): GameView {
    return toView(this.state!, ward, T + 5000, this.revision);
  }
  bump(s: GameState) {
    this.state = s;
    this.revision++;
  }
  api(): ScreenApi {
    const boom = () => {
      if (this.fail) throw new ApiFail(this.fail, this.fail);
    };
    return {
      login: async (p) => {
        if (p !== 'secret') throw new ApiFail('unauthorized', 'Wrong passcode');
        return { sessionToken: 'sess-1' };
      },
      state: async (_t, after) => {
        this.calls.state.push(after);
        boom();
        if (!this.state) throw new ApiFail('no_game', 'No game is open');
        if (after >= this.revision) return { unchanged: true, revision: this.revision, serverTime: T + 5000 };
        return { view: this.view() };
      },
      join: async () => (this.calls.join++, { joinUrl: 'https://10.0.0.1:3443/?join=ABC', joinCode: 'ABC', qrDataUrl: 'data:image/png;base64,x' }),
      newGame: async (_t, body) => {
        this.calls.new++;
        boom();
        this.bump(newGame(scn, { id: 'g' + this.calls.new, now: T, bots: body.bots, roundSeconds: body.roundSeconds }));
        return { view: this.view() };
      },
      host: async (_t, action) => {
        this.calls.host.push(action);
        boom();
        if (action === 'start') this.bump(startGame(this.state!, scn, T));
        if (action === 'skip') this.bump(resolveRound(this.state!, ward, T).state);
        if (action === 'end') this.bump({ ...this.state!, phase: 'ended', deadlineAt: null });
        return { view: this.view() };
      },
    };
  }
}

interface FakeSocket {
  h: SocketHandlers;
  closed: boolean;
}
let hub: FakeHub;
let sockets: FakeSocket[];
let timers: { fn: () => void; ms: number }[];
let saved: string | null;
let now: number;
let store: ScreenStore;

function makeStore(session: string | null = 'sess-0') {
  saved = session;
  const env: ScreenEnv = {
    api: hub.api(),
    now: () => now,
    openSocket: (h) => {
      const s: FakeSocket = { h, closed: false };
      sockets.push(s);
      return { close: () => (s.closed = true) };
    },
    setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimeout: () => {},
    loadSession: () => saved,
    saveSession: (t) => (saved = t),
  };
  return new ScreenStore(env);
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const push = (msg: unknown) => sockets.at(-1)!.h.onMessage(JSON.stringify(msg));
async function authSocket() {
  sockets.at(-1)!.h.onOpen(() => {});
  push({ type: 'auth:ok', payload: { role: 'coordinator', serverTime: T } });
  await flush();
}

beforeEach(() => {
  hub = new FakeHub();
  sockets = [];
  timers = [];
  now = T;
  store = makeStore();
});

describe('session and catch-up', () => {
  it('login stores the session and starts; a wrong passcode is a message', async () => {
    store = makeStore(null);
    expect(await store.login('nope')).toBe('Wrong passcode.');
    expect(await store.login('secret')).toBeNull();
    expect(saved).toBe('sess-1');
    await flush();
    expect(sockets).toHaveLength(1);
  });

  it('no game yet: noGame is set and the join QR is loaded; a game appears on the next kick', async () => {
    store.start();
    await flush();
    expect(store.state.noGame).toBe(true);
    expect(store.state.view).toBeNull();
    expect(store.state.hub).toBe('online');
    hub.bump(newGame(scn, { id: 'g', now: T }));
    await store.kick();
    expect(store.state.noGame).toBe(false);
    expect(store.state.view?.phase).toBe('lobby');
    expect(store.state.join?.joinCode).toBe('ABC');
    expect(store.state.clockOffset).toBe(5000);
  });

  it('asks only for what is newer and accepts "unchanged"', async () => {
    hub.bump(newGame(scn, { id: 'g', now: T }));
    store.start();
    await flush();
    const rev = store.state.view!.revision;
    await store.kick();
    expect(hub.calls.state.at(-1)).toBe(rev);
    expect(store.state.view!.revision).toBe(rev);
    expect(store.state.hub).toBe('online');
  });

  it('an unreachable hub is offline and keeps the last view; an expired session logs out with a notice', async () => {
    hub.bump(newGame(scn, { id: 'g', now: T }));
    store.start();
    await flush();
    hub.fail = 'network';
    await store.kick();
    expect(store.state.hub).toBe('offline');
    expect(store.state.view).not.toBeNull();
    hub.fail = 'unauthorized';
    await store.kick();
    expect(store.state.session).toBeNull();
    expect(store.state.loginNotice).toMatch(/expired/);
    expect(saved).toBeNull();
  });
});

describe('socket', () => {
  it('merges a pushed view only when it is newer, and turns a round into toasts', async () => {
    let s = startGame(joinBoat(newGame(scn, { id: 'g', now: T, bots: true }), scn, 'p1', 'Asha', 'moss', T), scn, T);
    hub.bump(s);
    store.start();
    await flush();
    await authSocket();
    expect(store.state.socket).toBe(true);
    const rev = store.state.view!.revision;
    push({ type: 'game:state', payload: { view: { ...hub.view(), revision: rev - 1, round: 99 } } });
    expect(store.state.view!.round).toBe(1); // stale push ignored
    const r = resolveRound(s, ward, T + 45_000);
    s = r.state;
    const payload: GameRoundPayload = { round: 1, events: r.events, scoreAfter: s.score, waterLevel: s.waterLevel };
    const rounds: GameRoundPayload[] = [];
    store.onRound = (p) => rounds.push(p);
    push({ type: 'game:round', payload });
    hub.bump(s);
    push({ type: 'game:state', payload: { view: hub.view() } });
    expect(store.state.view!.round).toBe(2);
    expect(store.state.lastRound?.round).toBe(1);
    expect(rounds).toHaveLength(1);
    expect(store.state.toasts.length).toBeGreaterThan(0);
    expect(store.state.toasts.length).toBeLessThanOrEqual(MAX_TOASTS);
    expect(store.state.toasts.some((t) => /Call from/.test(t.text))).toBe(true);
    // toasts expire
    now = T + TOAST_MS + 2000;
    timers.filter((t) => t.ms === 1000).at(-1)!.fn();
    expect(store.state.toasts).toEqual([]);
  });

  it('a socket refused before auth means the session is gone', async () => {
    hub.bump(newGame(scn, { id: 'g', now: T }));
    store.start();
    await flush();
    sockets.at(-1)!.h.onClose(4001);
    expect(store.state.session).toBeNull();
  });
});

describe('host actions', () => {
  it('new game, start, skip and end each merge the returned view; busy guards double taps', async () => {
    store.start();
    await flush();
    await store.newGame({ roundSeconds: 30, bots: true });
    expect(store.state.view?.phase).toBe('lobby');
    expect(store.state.view?.roundSeconds).toBe(30);
    await store.host('start');
    expect(store.state.view?.phase).toBe('playing');
    expect(store.state.view?.boats).toHaveLength(3);
    await store.host('skip');
    expect(store.state.view?.round).toBe(2);
    await store.host('end');
    expect(store.state.view?.phase).toBe('ended');
    expect(hub.calls.host).toEqual(['start', 'skip', 'end']);
    expect(store.state.busy).toBe(false);
  });

  it('a failed host action leaves a notice and the view as it was', async () => {
    hub.bump(newGame(scn, { id: 'g', now: T }));
    store.start();
    await flush();
    hub.fail = 'network';
    await store.host('start');
    expect(store.state.notice).toBe('Cannot reach the hub.');
    expect(store.state.view?.phase).toBe('lobby');
    expect(store.state.hub).toBe('offline');
  });
});
