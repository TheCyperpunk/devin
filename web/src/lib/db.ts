// IndexedDB on the phone (CONTRACT section 8): settings, reports (everything this phone created) and the outbox.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { TIMING, type PhoneReportInput, type Report } from '@relief-mesh/shared';

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
  /** Highest hub revision applied through catch-up pages (as text, like every setting). */
  cursor?: string;
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

// ---------------- outbox and sync (Phase 5) ----------------

/** Wait before retry number `attempts` (1-based): 1 s, 2 s, 4 s ... capped at 30 s. */
export function backoffMs(attempts: number): number {
  return Math.min(TIMING.backoffStartMs * 2 ** Math.max(0, attempts - 1), TIMING.backoffMaxMs);
}

export async function getReport(id: string): Promise<LocalReport | undefined> {
  return (await db()).get('reports', id);
}

/** Oldest reports first, so a long queue delivers the longest-waiting reports before newer ones. */
export async function dueReports(now: number, limit: number): Promise<{ entry: OutboxEntry; local: LocalReport }[]> {
  const d = await db();
  const due = (await d.getAll('outbox')).filter((e) => e.nextTryAt <= now);
  const out: { entry: OutboxEntry; local: LocalReport }[] = [];
  const orphans: string[] = [];
  for (const entry of due) {
    const local = await d.get('reports', entry.id);
    if (local) out.push({ entry, local });
    else orphans.push(entry.id);
  }
  if (orphans.length) await dropOutbox(orphans);
  return out.sort((a, b) => a.local.createdAtLocal - b.local.createdAtLocal).slice(0, limit);
}

export async function dropOutbox(ids: string[]): Promise<void> {
  const tx = (await db()).transaction('outbox', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

/** The hub became reachable (D8): every queued report is due now and earlier failures are forgotten. */
export async function makeAllDue(): Promise<void> {
  const tx = (await db()).transaction('outbox', 'readwrite');
  const all = await tx.store.getAll();
  await Promise.all([...all.map((e) => tx.store.put({ ...e, attempts: 0, nextTryAt: 0 })), tx.done]);
}

/** A send failed: count the attempt and wait before trying these again. */
export async function backoffEntries(ids: string[], now: number, minDelayMs = 0): Promise<void> {
  const tx = (await db()).transaction('outbox', 'readwrite');
  const writes: Promise<unknown>[] = [tx.done];
  for (const id of ids) {
    const e = await tx.store.get(id);
    if (!e) continue;
    const attempts = e.attempts + 1;
    writes.push(tx.store.put({ ...e, attempts, nextTryAt: now + Math.max(backoffMs(attempts), minDelayMs) }));
  }
  await Promise.all(writes);
}

export type BatchUpdate =
  | { id: string; outcome: 'sent'; report: Report }
  | { id: string; outcome: 'rejected'; reason: string };

/** Records the hub's per-report answers and removes those reports from the outbox, all in one transaction. */
export async function completeBatch(updates: BatchUpdate[]): Promise<void> {
  const tx = (await db()).transaction(['reports', 'outbox'], 'readwrite');
  const reports = tx.objectStore('reports');
  const outbox = tx.objectStore('outbox');
  const writes: Promise<unknown>[] = [tx.done];
  for (const u of updates) {
    const local = await reports.get(u.id);
    if (local) {
      const next: LocalReport =
        u.outcome === 'sent'
          ? { ...local, syncState: 'sent', report: newer(local.report, u.report) }
          : { ...local, syncState: 'rejected', rejectReason: u.reason };
      writes.push(reports.put(next));
    }
    writes.push(outbox.delete(u.id));
  }
  await Promise.all(writes);
}

const newer = (a: Report | undefined, b: Report): Report => (a && a.revision >= b.revision ? a : b);

/**
 * Merge hub copies into local reports. A copy is kept only if its revision is higher than what we hold, so catch-up
 * pages and live pushes can arrive in any order (CONTRACT 2.3). A report the hub already has needs no more sending.
 */
export async function applyHubReports(incoming: Report[]): Promise<number> {
  const tx = (await db()).transaction(['reports', 'outbox'], 'readwrite');
  const reports = tx.objectStore('reports');
  const outbox = tx.objectStore('outbox');
  const writes: Promise<unknown>[] = [tx.done];
  let changed = 0;
  for (const r of incoming) {
    const local = await reports.get(r.id);
    if (!local || (local.report && local.report.revision >= r.revision)) continue;
    writes.push(reports.put({ ...local, report: r, syncState: local.syncState === 'rejected' ? 'rejected' : 'sent' }));
    writes.push(outbox.delete(r.id));
    changed++;
  }
  await Promise.all(writes);
  return changed;
}

/** After the hub was reset: forget what it acknowledged and queue every accepted report again (ids make this safe). */
export async function requeueAll(): Promise<number> {
  const tx = (await db()).transaction(['reports', 'outbox'], 'readwrite');
  const all = await tx.objectStore('reports').getAll();
  const writes: Promise<unknown>[] = [tx.done];
  let n = 0;
  for (const local of all) {
    if (local.syncState === 'rejected') continue;
    const { report: _dropped, ...rest } = local;
    writes.push(tx.objectStore('reports').put({ ...rest, syncState: 'saved' }));
    writes.push(tx.objectStore('outbox').put({ id: local.id, attempts: 0, nextTryAt: 0 }));
    n++;
  }
  await Promise.all(writes);
  return n;
}
