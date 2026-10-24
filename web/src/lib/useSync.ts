// One SyncManager for the whole app, exposed to React as live state plus the manager for kick()/paired().
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { SyncManager, browserEnv, type SyncState } from './sync.js';

let manager: SyncManager | undefined;
export function syncManager(): SyncManager {
  manager ??= new SyncManager(browserEnv(api));
  return manager;
}

export function useSync(): { state: SyncState; sync: SyncManager } {
  const sync = syncManager();
  const [state, setState] = useState<SyncState>(sync.state);
  useEffect(() => sync.subscribe(setState), [sync]);
  return { state, sync };
}

/** Wire the browser's "something changed" events to the manager while the app is paired. */
export function useSyncTriggers(active: boolean): void {
  useEffect(() => {
    const sync = syncManager();
    if (!active) return;
    sync.start();
    const wake = () => sync.wake();
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync.wake();
    };
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', onVisible);
      sync.stop();
    };
  }, [active]);
}
