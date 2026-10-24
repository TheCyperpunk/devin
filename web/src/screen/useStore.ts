// One ScreenStore for the page, exposed to React as live state. The host session is the dashboard's session key,
// so a coordinator already logged in on /dashboard.html in the same tab session needs no second passcode.
import { useEffect, useState } from 'react';
import { SESSION_KEY } from '../dashboard/store.js';
import { openBrowserSocket } from '../lib/socket.js';
import { screenApi } from './api.js';
import { ScreenStore, type ScreenEnv, type ScreenState } from './store.js';

function browserEnv(): ScreenEnv {
  return {
    api: screenApi,
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
        /* private mode */
      }
    },
  };
}

let store: ScreenStore | undefined;
export function screenStore(): ScreenStore {
  store ??= new ScreenStore(browserEnv());
  return store;
}

export function useScreen(): { state: ScreenState; store: ScreenStore } {
  const s = screenStore();
  const [state, setState] = useState<ScreenState>(s.state);
  useEffect(() => s.subscribe(setState), [s]);
  return { state, store: s };
}

/** Re-render every `ms` (the countdown ticks four times a second). */
export function useTick(ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Animates a number towards `target` over `ms` (the score count-up). */
export function useTween(target: number, ms = 600): number {
  const [value, setValue] = useState(target);
  useEffect(() => {
    const from = value;
    if (from === target) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms]);
  return value;
}
