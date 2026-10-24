// IndexedDB on the phone (CONTRACT section 8): settings, reports (everything this phone created) and the outbox.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PhoneReportInput, Report } from '@relief-mesh/shared';

export type SyncState = 'saved' | 'sent' | 'rejected';
/** What the phone knows when the report is made. ageMs is added at send time (D7), never stored. */
export type ReportDraft = Omit<PhoneReportInput, 'ageMs'>;

export interface LocalReport {
  id: string;
  input: ReportDraft;
  createdAtLocal: number;
  syncState: SyncState;
  rejectReason?: string;
  /** The hub's copy, once it has acknowledged the report (Phase 5). */
  report?: Report;
}

export interface OutboxEntry {
  id: string;
  attempts: number;
  nextTryAt: number;
}

export interface Settings {
  deviceId?: string;
  reporterName?: string;
  lang?: 'en' | 'ml';
  deviceToken?: string;
  hubId?: string;
}
export type SettingKey = keyof Settings;

interface ReliefDB extends DBSchema {
  settings: { key: string; value: string };
  reports: { key: string; value: LocalReport; indexes: { byCreated: number } };
  outbox: { key: string; value: OutboxEntry };
}

const NAME = 'relief-mesh';
let opened: Promise<IDBPDatabase<ReliefDB>> | undefined;

export function db(): Promise<IDBPDatabase<ReliefDB>> {
  opened ??= openDB<ReliefDB>(NAME, 1, {
    upgrade(d) {
      d.createObjectStore('settings');
      d.createObjectStore('reports', { keyPath: 'id' }).createIndex('byCreated', 'createdAtLocal');
      d.createObjectStore('outbox', { keyPath: 'id' });
    },
  });
  return opened;
}

/** For tests: drop the cached connection so the next call reopens the database (like a page reload). */
export async function closeDb(): Promise<void> {
  if (!opened) return;
  const d = await opened;
  d.close();
  opened = undefined;
}

export async function getSettings(): Promise<Settings> {
  const d = await db();
  const [keys, values] = await Promise.all([d.getAllKeys('settings'), d.getAll('settings')]);
  const out: Record<string, string> = {};
  keys.forEach((k, i) => (out[k] = values[i] as string));
  return out as Settings;
}

export async function setSettings(patch: Settings): Promise<void> {
  const d = await db();
  const tx = d.transaction('settings', 'readwrite');
  // Await every request with tx.done: a failed write (e.g. storage full) must reject here, not vanish.
  await Promise.all([
    ...Object.entries(patch).map(([k, v]) => (v === undefined ? tx.store.delete(k) : tx.store.put(v, k))),
    tx.done,
  ]);
}

/** Submit step 2: the report and its outbox entry are written in ONE transaction, so neither can exist alone. */
export async function saveNewReport(local: LocalReport): Promise<void> {
  const d = await db();
  const tx = d.transaction(['reports', 'outbox'], 'readwrite');
  await Promise.all([
    tx.objectStore('reports').put(local),
    tx.objectStore('outbox').put({ id: local.id, attempts: 0, nextTryAt: 0 }),
    tx.done,
  ]);
}

/** Newest first. */
export async function listReports(): Promise<LocalReport[]> {
  const d = await db();
  return (await d.getAllFromIndex('reports', 'byCreated')).reverse();
}

export async function outboxCount(): Promise<number> {
  return (await db()).count('outbox');
}
