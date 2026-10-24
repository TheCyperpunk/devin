// GameSync against a fake hub that runs the real rules: outbox delivery, exactly-once on retry, replace and append,
// late orders, a new game clearing the outbox, pairing loss, socket pushes, restoring the last view.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Ward,
  joinBoat,
  newGame,
  parseScenario,
  queueOrder,
  resolveRound,
  startGame,
  thuruthu,
  toView,
  type BoatColor,
  type GameState,
  type GameView,
  type Order,
  type OrderResult,
} from '@pralayam/shared';
import { ApiFail } from './api.js';
import { closeDb, getSettings, outboxCount, pendingOrders, setSettings } from './db.js';
import { GameSync, type Env } from './gameSync.js';

const scn = parseScenario(thuruthu);
const ward = new Ward(scn);
const T = 1_800_000_000_000;
const ME = 'phone-1';

class FakeHub {
  hubId = 'hub-1';
  state: GameState | null = null;
  revision = 0;
  time = T;
  fail: 'network' | 'unauthorized' | 'no_game' | 'rate_limited' | 'network-after' | null = null;
  /** The boat is in a dead zone: the hub answers nothing useful (D16). */
  noSignal = false;
  failHealth = false;
  calls = { orders: [] as { id: string; seq: number; order: Order }[][], state: 0, join: 0 };
  opened = 0;

  open(opts: { start?: boolean } = {}) {
    this.state = joinBoat(newGame(scn, { id: 'game-' + ++this.opened, now: this.time, bots: false }), scn, ME, 'Asha', 'moss', this.time);
    if (opts.start !== false) this.state = startGame(this.state, scn, this.time);
    this.revision++;
  }
  resolve() {
    this.state = resolveRound(this.state!, ward, this.time).state;
    this.revision++;
  }
  view(you = true): GameView {
    return toView(this.state!, ward, this.time, this.revision, you ? ME : undefined);
  }
  private boom() {
    if (this.fail === 'network') throw new ApiFail('network', 'down');
    if (this.fail === 'unauthorized') throw new ApiFail('unauthorized', 'nope');
    if (this.fail === 'no_game') throw new ApiFail('no_game', 'none');
    if (this.fail === 'rate_limited') throw new ApiFail('rate_limited', 'slow', 7);
  }
  api(): Env['api'] {
    return {
      health: async () => {
        if (this.failHealth) throw new ApiFail('network', 'down');
        return { ok: true, time: this.time, hubId: this.hubId };
      },
      state: async (_t, after) => {
        this.calls.state++;
        this.boom();
        if (this.noSignal) return { noSignal: true as const };
        if (!this.state) throw new ApiFail('no_game', 'none');
        if (after >= this.revision) return { unchanged: true, revision: this.revision, serverTime: this.time };
        return { view: this.view() };
      },
      orders: async (_t, items) => {
        this.calls.orders.push(items);
        this.boom();
        if (this.noSignal) return { noSignal: true as const };
        if (!this.state) throw new ApiFail('no_game', 'none');
        const results: OrderResult[] = [];
        for (const it of items) {
          const r = queueOrder(this.state, ME, it, this.time);
          if (r.state !== this.state) this.revision++;
          this.state = r.state;
          results.push(r.result);
        }
        if (this.fail === 'network-after') {
          this.fail = null;
          throw new ApiFail('network', 'dropped on the way back');
        }
        return { results, view: this.view() };
      },
      join: async (_t, color: BoatColor) => {
        this.calls.join++;
        this.boom();
        if (!this.state) throw new ApiFail('no_game', 'none');
        this.state = joinBoat(this.state, scn, ME, 'Asha', color, this.time);
        this.revision++;
        return { view: this.view() };
      },
    };
  }
}

interface FakeSocket {
  h: Parameters<Env['openSocket']>[0];
  closed: boolean;
}
let hub: FakeHub;
let sockets: FakeSocket[];
let timers: { fn: () => void; ms: number }[];
let sync: GameSync;
let ids = 0;

beforeEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
  hub = new FakeHub();
  sockets = [];
  timers = [];
  ids = 0;
  await setSettings({ deviceId: ME, deviceToken: 'tok', hubId: 'hub-1', reporterName: 'Asha' });
  const env: Env = {
    api: hub.api(),
    now: () => hub.time,
    openSocket: (h) => {
      const s: FakeSocket = { h, closed: false };
      sockets.push(s);
      return { close: () => (s.closed = true) };
    },
    setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimeout: () => {},
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  };
  sync = new GameSync(env);
});
afterEach(() => sync.stop());

/** start() reads settings asynchronously; wait for it, then for the first flush. */
async function begin() {
  sync.start();
  await new Promise((r) => setTimeout(r, 20));
  await sync.kick();
}
const hubQueue = () => hub.state!.queues[ME]!.map((q) => q.seq);

describe('orders through the outbox', () => {
  it('an order is written to the phone first, then delivered once; the hub queue and next seq follow', async () => {
    hub.open();
    await begin();
    expect(sync.state.view?.round).toBe(1);
    await sync.submit({ type: 'move', nodeId: 'kavala' });
    await sync.kick();
    expect(await outboxCount()).toBe(0);
    expect(hubQueue()).toEqual([1]);
    expect(sync.state.queued).toBe(1);
    expect(sync.state.nextSeq).toBe(2);
    expect((await getSettings()).nextSeq).toBe(2);
    expect(hub.calls.orders).toHaveLength(1);
  });

  it('a lost reply is retried with the same id and the hub answers duplicate: delivered exactly once', async () => {
    hub.open();
    await begin();
    hub.fail = 'network-after';
    await sync.submit({ type: 'move', nodeId: 'kavala' });
    await sync.kick(); // first flush: the reply is lost (hub offline, order kept); the follow-up flush retries at once
    expect(hub.calls.orders).toHaveLength(2);
    expect(hub.calls.orders[1]![0]!.id).toBe(hub.calls.orders[0]![0]!.id);
    expect(await outboxCount()).toBe(0);
    expect(hubQueue()).toEqual([1]);
    expect(sync.state.hub).toBe('online');
  });

  it('while unreachable the order waits with backoff, and Retry sends it at once', async () => {
    hub.open();
    await begin();
    hub.failHealth = true;
    await sync.submit({ type: 'hold' });
    await sync.kick();
    expect(sync.state.hub).toBe('offline');
    expect(sync.state.unsent).toBe(1);
    expect(hub.calls.orders).toHaveLength(0);
    hub.failHealth = false;
    await sync.retryNow();
    expect(await outboxCount()).toBe(0);
    expect(hubQueue()).toEqual([1]);
  });

  it('replace changes the order the hub has not played yet; append lines up another', async () => {
    hub.open();
    await begin();
    await sync.submit({ type: 'move', nodeId: 'kavala' });
    await sync.submit({ type: 'move', nodeId: 'kumbalam' }); // changed mind before it was sent
    expect((await pendingOrders()).map((e) => e.seq)).toEqual([1]);
    await sync.kick();
    expect(hub.state!.queues[ME]![0]!.order).toEqual({ type: 'move', nodeId: 'kumbalam' });
    await sync.submit({ type: 'hold' }); // hub holds seq 1: replace it there
    await sync.kick();
    expect(hubQueue()).toEqual([1]);
    expect(hub.state!.queues[ME]![0]!.order).toEqual({ type: 'hold' });
    await sync.submit({ type: 'move', nodeId: 'kavala' }, 'append');
    await sync.kick();
    expect(hubQueue()).toEqual([1, 2]);
    expect(sync.state.queued).toBe(2);
    expect(sync.state.nextSeq).toBe(3);
  });

  it('an order for a round already played is late: dropped, with a notice', async () => {
    hub.open();
    await begin();
    await sync.submit({ type: 'move', nodeId: 'kavala' });
    await sync.kick();
    hub.resolve(); // seq 1 played; the phone still thinks it is queued
    await sync.submit({ type: 'hold' }); // replace -> seq 1 again
    await sync.kick();
    expect(sync.state.notice).toBe('late');
    expect(await outboxCount()).toBe(0);
    expect(sync.state.view?.round).toBe(2);
    expect(sync.state.queued).toBe(0);
    expect(sync.state.nextSeq).toBe(2);
  });

  it('a plan replaces every unapplied order, cancels the surplus, and the boat follows it round by round', async () => {
    hub.open();
    await begin();
    await sync.plan([{ type: 'move', nodeId: 'kavala' }, { type: 'move', nodeId: 'vattappara' }, { type: 'return' }], 'vattappara');
    await sync.kick();
    expect(hubQueue()).toEqual([1, 2, 3]);
    expect(sync.state.plan).toEqual({ target: 'vattappara', steps: 3 });
    await sync.plan([{ type: 'move', nodeId: 'kumbalam' }], 'kumbalam'); // changed plan: shorter
    await sync.kick();
    expect(hubQueue()).toEqual([1]);
    expect(hub.state!.queues[ME]![0]!.order).toEqual({ type: 'move', nodeId: 'kumbalam' });
    expect(sync.state.notice).toBeNull(); // the cancels raised nothing
    await sync.plan([{ type: 'hold' }], null); // a third plan must replace seq 1 again, not land behind it
    await sync.kick();
    expect(hubQueue()).toEqual([1]);
    expect(hub.state!.queues[ME]![0]!.order).toEqual({ type: 'hold' });
    hub.resolve();
    await sync.kick();
    expect(sync.state.plan).toBeNull(); // nothing queued any more
    expect(hub.state!.boats[0]!.nodeId).toBe('jetty'); // the final plan was a hold
  });

  it('a standing order never replaces a queued move', async () => {
    hub.open();
    await begin();
    await sync.submit({ type: 'move', nodeId: 'kavala' });
    await sync.submit({ type: 'standing', mode: 'return' });
    await sync.kick();
    expect(hubQueue()).toEqual([1]);
    expect(hub.state!.boats[0]!.standingOrder).toBe('return');
    expect(sync.state.nextSeq).toBe(2); // the standing order used no seq
  });
});

describe('dead zones', () => {
  it('while the hub answers noSignal the orders wait on the phone (hub online, noSignal set) and go when it answers again', async () => {
    hub.open();
    await begin();
    hub.noSignal = true;
    await sync.kick();
    expect(sync.state.noSignal).toBe(true);
    expect(sync.state.hub).toBe('online');
    expect(sync.state.view?.round).toBe(1); // last known view kept
    await sync.submit({ type: 'rescue' });
    await sync.submit({ type: 'move', nodeId: 'j_mid' }, 'append');
    await sync.kick();
    expect(await outboxCount()).toBe(2);
    expect(hubQueue()).toEqual([]);
    const sent = hub.calls.orders.length;
    hub.noSignal = false;
    hub.time += 5000; // the 5 s backoff from the noSignal answer has passed
    await sync.kick();
    expect(sync.state.noSignal).toBe(false);
    expect(await outboxCount()).toBe(0);
    expect(hubQueue()).toEqual([1, 2]);
    expect(hub.calls.orders.length).toBe(sent + 1);
  });
});

describe('games, hubs and pairing', () => {
  it('a new game on the hub clears the outbox and restarts the seq counter', async () => {
    hub.open();
    await begin();
    await sync.submit({ type: 'move', nodeId: 'kavala' });
    await sync.kick();
    hub.failHealth = true;
    await sync.submit({ type: 'hold' }, 'append'); // stuck in the outbox
    await sync.kick();
    hub.failHealth = false;
    hub.open(); // game-2
    await sync.kick();
    expect(sync.state.view?.id).toBe('game-2');
    expect(await outboxCount()).toBe(0);
    expect(sync.state.nextSeq).toBe(1);
    expect(sync.state.queued).toBe(0);
  });

  it('no game yet: noGame is set and the first view arrives later', async () => {
    await begin();
    expect(sync.state.noGame).toBe(true);
    hub.open({ start: false });
    await sync.kick();
    expect(sync.state.view?.phase).toBe('lobby');
    expect(sync.state.noGame).toBe(false);
  });

  it('join picks a colour and merges the view', async () => {
    hub.open({ start: false });
    await begin();
    expect(await sync.join('ember')).toBeNull();
    expect(sync.state.view?.boats[0]?.color).toBe('ember');
    expect((await getSettings()).color).toBe('ember');
  });

  it('a replaced token asks to pair again; a different hub resets everything', async () => {
    hub.open();
    await begin();
    hub.fail = 'unauthorized';
    await sync.submit({ type: 'hold' });
    await sync.kick();
    expect(sync.state.needsPairing).toBe('unauthorized');
    expect((await getSettings()).deviceToken).toBeUndefined();

    hub.fail = null;
    await setSettings({ deviceToken: 'tok2' });
    hub.hubId = 'hub-2';
    const s2 = new GameSync({ ...(sync as unknown as { env: Env }).env });
    s2.start();
    await new Promise((r) => setTimeout(r, 20));
    await s2.kick();
    expect(s2.state.needsPairing).toBe('reset');
    expect(await outboxCount()).toBe(0);
    expect((await getSettings()).gameId).toBeUndefined();
    s2.stop();
  });
});

describe('socket and restore', () => {
  it('pushes update the view, the queue and the last round', async () => {
    hub.open();
    await begin();
    const s = sockets.at(-1)!;
    s.h.onOpen(() => {});
    s.h.onMessage(JSON.stringify({ type: 'auth:ok', payload: { role: 'device', serverTime: hub.time } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(sync.state.socket).toBe(true);
    s.h.onMessage(JSON.stringify({ type: 'game:you', payload: { boatId: ME, queued: 1, nextSeq: 2, queuedSeqs: [1] } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(sync.state.queued).toBe(1);
    expect(sync.state.nextSeq).toBe(2);
    hub.resolve();
    s.h.onMessage(JSON.stringify({ type: 'game:round', payload: { round: 1, events: [], scoreAfter: 0, waterLevel: 0 } }));
    s.h.onMessage(JSON.stringify({ type: 'game:state', payload: { view: hub.view(false) } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(sync.state.lastRound?.round).toBe(1);
    expect(sync.state.view?.round).toBe(2);
    expect(sync.state.queued).toBe(1); // a view without "you" leaves our queue count alone
  });

  it('after a reload the last view and the seq come back from the phone before the hub answers', async () => {
    hub.open();
    await begin();
    await sync.submit({ type: 'move', nodeId: 'kavala' });
    await sync.kick();
    sync.stop();
    hub.failHealth = true;
    const again = new GameSync((sync as unknown as { env: Env }).env);
    again.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(again.state.view?.round).toBe(1);
    expect(again.state.nextSeq).toBe(2);
    again.stop();
  });
});
