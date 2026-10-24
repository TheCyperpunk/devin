// Phase 1 diagnostics shared by both pages: secure context, service worker, hub reachability.
import { TIMING } from '@relief-mesh/shared';

export type Check = 'pending' | 'ok' | 'fail';

export interface HubHealth {
  ok: boolean;
  time: number;
  hubId: string;
}

export async function checkHub(): Promise<HubHealth | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMING.healthTimeoutMs);
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as HubHealth;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function serviceWorkerState(): Promise<Check> {
  if (!('serviceWorker' in navigator)) return 'fail';
  try {
    const reg = await navigator.serviceWorker.ready;
    return reg.active ? 'ok' : 'pending';
  } catch {
    return 'fail';
  }
}
