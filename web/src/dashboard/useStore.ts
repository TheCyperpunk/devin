// One DashboardStore for the page, exposed to React as live state. Session token lives in sessionStorage.
import { useEffect, useState } from 'react';
import { openBrowserSocket } from '../lib/socket.js';
import { dashApi } from './api.js';
import { DashboardStore, SESSION_KEY, type DashEnv, type DashState } from './store.js';

function browserEnv(): DashEnv {
  return {
    api: dashApi,
    now: () => Date.now(),
    openSocket: openBrowserSocket,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    loadSession: () => {
      try {
        return sessionStorage.getItem(SESSION_KEY);
      } catch {
        return null;
      }
    },
    saveSession: (t) => {
      try {
        if (t) sessionStorage.setItem(SESSION_KEY, t);
        else sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* private mode: the session simply does not survive a reload */
      }
    },
  };
}

let store: DashboardStore | undefined;
export function dashboardStore(): DashboardStore {
  store ??= new DashboardStore(browserEnv());
  return store;
}

export function useDashboard(): { state: DashState; store: DashboardStore } {
  const s = dashboardStore();
  const [state, setState] = useState<DashState>(s.state);
  useEffect(() => s.subscribe(setState), [s]);
  return { state, store: s };
}

/** Re-render every `ms` so "x min ago" and the waiting bonus stay current. */
export function useClock(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
