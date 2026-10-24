// React hooks: GPS capture with a 5 s budget, and a periodic hub reachability check.
import { useCallback, useEffect, useRef, useState } from 'react';
import { TIMING } from '@relief-mesh/shared';
import { checkHub } from './status.js';
import type { Position } from './report.js';

export type LocationState =
  | { status: 'getting'; position: null }
  | { status: 'ok'; position: Position }
  | { status: 'none'; position: null };

/**
 * Starts a fix on mount. After 5 s (or on denial) it reports "none" so the form never waits on GPS, but a fix that
 * arrives later still wins, because the phone may have been waiting on the permission prompt.
 */
export function useLocation(): { loc: LocationState; retry: () => void } {
  const [loc, setLoc] = useState<LocationState>({ status: 'getting', position: null });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const alive = useRef(true);

  const start = useCallback(() => {
    setLoc({ status: 'getting', position: null });
    clearTimeout(timer.current);
    if (!('geolocation' in navigator)) {
      setLoc({ status: 'none', position: null });
      return;
    }
    timer.current = setTimeout(
      () => setLoc((cur) => (cur.status === 'getting' ? { status: 'none', position: null } : cur)),
      TIMING.gpsTimeoutMs + 500,
    );
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!alive.current) return;
        clearTimeout(timer.current);
        setLoc({
          status: 'ok',
          position: { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy },
        });
      },
      () => {
        if (!alive.current) return;
        clearTimeout(timer.current);
        setLoc((cur) => (cur.status === 'ok' ? cur : { status: 'none', position: null }));
      },
      { enableHighAccuracy: true, timeout: TIMING.gpsTimeoutMs, maximumAge: 30_000 },
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    start();
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [start]);

  return { loc, retry: start };
}

/** true = hub answered /api/health recently. Phase 5 replaces this with the real sync status. */
export function useHubReachable(everyMs = 5000): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let stop = false;
    const ping = () =>
      void checkHub().then((h) => {
        if (!stop) setOk(h !== null);
      });
    ping();
    const id = setInterval(ping, everyMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [everyMs]);
  return ok;
}
