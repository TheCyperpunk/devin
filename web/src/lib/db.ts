// IndexedDB on the phone: this phone's identity and settings. G4 adds the order outbox beside it.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BoatColor, Lang } from '@pralayam/shared';

export interface Settings {
  deviceId?: string;
  deviceToken?: string;
  hubId?: string;
  reporterName?: string;
  lang?: Lang;
  color?: BoatColor;
}
export type SettingKey = keyof Settings;

interface PralayamDB extends DBSchema {
  settings: { key: SettingKey; value: Settings[SettingKey] };
}

let handle: Promise<IDBPDatabase<PralayamDB>> | undefined;

export function db(): Promise<IDBPDatabase<PralayamDB>> {
  handle ??= openDB<PralayamDB>('pralayam', 1, {
    upgrade(d) {
      d.createObjectStore('settings');
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
