// IndexedDB on the phone: this phone's identity and settings, the last game view it saw, and the order outbox.
// Orders are written here first and sent by gameSync; an entry leaves the outbox only once the hub has answered.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BoatColor, GameView, Lang, Order } from '@pralayam/shared';

export interface Settings {
  deviceId?: string;
  deviceToken?: string;
  hubId?: string;
  reporterName?: string;
  lang?: Lang;
  color?: BoatColor;
  /** The game the outbox belongs to; a different id from the hub clears it. */
  gameId?: string;
  nextSeq?: number;
  lastView?: GameView;
  lastViewAt?: number;
}
export type SettingKey = keyof Settings;

export interface OutboxEntry {
  id: string;
  seq: number;
  order: Order;
  gameId: string;
  createdAtLocal: number;
  attempts: number;
  nextTryAt: number;
}

interface PralayamDB extends DBSchema {
  settings: { key: SettingKey; value: Settings[SettingKey] };
  gameOutbox: { key: string; value: OutboxEntry; indexes: { bySeq: number } };
}

let handle: Promise<IDBPDatabase<PralayamDB>> | undefined;

export function db(): Promise<IDBPDatabase<PralayamDB>> {
  handle ??= openDB<PralayamDB>('pralayam', 2, {
    upgrade(d, old) {
      if (old < 1) d.createObjectStore('settings');
      if (old < 2) d.createObjectStore('gameOutbox', { keyPath: 'id' }).createIndex('bySeq', 'seq');
    },
  });
  return handle;
}

export async function closeDb(): Promise<void> {
  if (!handle) return;
  (await handle).close();
  handle = undefined;
}

export async function getSettings(): Promise<Settings> {
  const d = await db();
  const out: Settings = {};
  const tx = d.transaction('settings');
  for (const key of (await tx.store.getAllKeys()) as SettingKey[]) {
    (out as Record<string, unknown>)[key] = await tx.store.get(key);
  }
  await tx.done;
  return out;
}

export async function setSettings(patch: Settings): Promise<void> {
  const d = await db();
  const tx = d.transaction('settings', 'readwrite');
  for (const [k, v] of Object.entries(patch) as [SettingKey, Settings[SettingKey]][]) {
    if (v === undefined) await tx.store.delete(k);
    else await tx.store.put(v, k);
  }
  await tx.done;
}

// ---- order outbox ----

export async function addOrder(entry: OutboxEntry): Promise<void> {
  await (await db()).put('gameOutbox', entry);
}

export async function pendingOrders(): Promise<OutboxEntry[]> {
  return (await (await db()).getAllFromIndex('gameOutbox', 'bySeq')) as OutboxEntry[];
}

export async function outboxCount(): Promise<number> {
  return (await db()).count('gameOutbox');
}

/** Entries whose backoff has elapsed, lowest seq first. */
export async function dueOrders(now: number, limit: number): Promise<OutboxEntry[]> {
  return (await pendingOrders()).filter((e) => e.nextTryAt <= now).slice(0, limit);
}

export async function dropOrders(ids: string[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('gameOutbox', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function clearOutbox(): Promise<void> {
  await (await db()).clear('gameOutbox');
}

export const BACKOFF_START_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_START_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

/** A send failed: wait longer before the next try (never less than `minDelayMs`, from a Retry-After). */
export async function backoffOrders(ids: string[], now: number, minDelayMs = 0): Promise<void> {
  const d = await db();
  const tx = d.transaction('gameOutbox', 'readwrite');
  for (const id of ids) {
    const e = await tx.store.get(id);
    if (!e) continue;
    const attempts = e.attempts + 1;
    await tx.store.put({ ...e, attempts, nextTryAt: now + Math.max(backoffMs(attempts), minDelayMs) });
  }
  await tx.done;
}

/** The hub is reachable again (or the crew pressed Retry): everything is due now. */
export async function makeAllDue(): Promise<void> {
  const d = await db();
  const tx = d.transaction('gameOutbox', 'readwrite');
  for (const e of await tx.store.getAll()) await tx.store.put({ ...e, nextTryAt: 0 });
  await tx.done;
}
