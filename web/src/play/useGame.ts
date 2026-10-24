// One GameSync for the phone, exposed to React as live state, plus the browser wiring (fetch, socket, timers).
import { useEffect, useState } from 'react';
import type { BoatColor, GameView, Order, OrderResult } from '@pralayam/shared';
import { api, request } from '../lib/api.js';
import { GameSync, type Env, type GameSyncState } from '../lib/gameSync.js';
import { openBrowserSocket } from '../lib/socket.js';

function browserEnv(): Env {
  return {
    api: {
      health: () => api.health(),
      state: (token, after) => request<{ view: GameView } | { unchanged: true; revision: number; serverTime: number }>('GET', `/api/game/state?after=${after}`, { token }),
      orders: (token, items) => request<{ results: OrderResult[]; view: GameView }>('POST', '/api/game/orders', { token, body: { orders: items }, timeoutMs: 15_000 }),
      join: (token, color: BoatColor) => request<{ view: GameView }>('POST', '/api/game/join', { token, body: { color } }),
    },
    now: () => Date.now(),
    openSocket: openBrowserSocket,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    uuid: () => crypto.randomUUID(),
  };
}

let sync: GameSync | undefined;
export function gameSync(): GameSync {
  sync ??= new GameSync(browserEnv());
  return sync;
}

export function useGame(): { state: GameSyncState; sync: GameSync } {
  const s = gameSync();
  const [state, setState] = useState<GameSyncState>(s.state);
  useEffect(() => s.subscribe(setState), [s]);
  return { state, sync: s };
}

/** Wire the browser's "something changed" events to the sync while the phone is paired. */
export function useGameTriggers(active: boolean): void {
  useEffect(() => {
    const s = gameSync();
    if (!active) return;
    s.start();
    const wake = () => s.wake();
    const onVisible = () => {
      if (document.visibilityState === 'visible') s.wake();
    };
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', onVisible);
      s.stop();
    };
  }, [active]);
}

/** Re-render every `ms` (the countdown). */
export function useTick(ms = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export type { Order };
