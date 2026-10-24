// Phone storage: settings, atomic report+outbox save, and survival across a "page reload" (closing and reopening the DB).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, getSettings, listReports, outboxCount, saveNewReport, setSettings, type LocalReport } from './db.js';

const local = (id: string, createdAtLocal: number): LocalReport => ({
  id,
  createdAtLocal,
  syncState: 'saved',
  input: { id, needs: ['food'], peopleCount: 2, hasChildren: false, hasElderlyOrSick: false, urgent: false },
});

beforeEach(async () => {
  await closeDb();
  indexedDB.deleteDatabase('relief-mesh');
});
afterEach(closeDb);

describe('settings', () => {
  it('starts empty, stores values and can remove them', async () => {
    expect(await getSettings()).toEqual({});
    await setSettings({ deviceId: 'abc', lang: 'ml', reporterName: 'Asha' });
    expect(await getSettings()).toEqual({ deviceId: 'abc', lang: 'ml', reporterName: 'Asha' });
    await setSettings({ reporterName: undefined });
    expect((await getSettings()).reporterName).toBeUndefined();
    expect((await getSettings()).lang).toBe('ml');
  });
  it('survives a reload', async () => {
    await setSettings({ deviceToken: 'tok', hubId: 'hub-1' });
    await closeDb();
    expect(await getSettings()).toMatchObject({ deviceToken: 'tok', hubId: 'hub-1' });
  });
});

describe('saving a report', () => {
  it('writes the report and its outbox entry together', async () => {
    await saveNewReport(local('r1', 1000));
    expect(await outboxCount()).toBe(1);
    const d = await db();
    expect(await d.get('outbox', 'r1')).toEqual({ id: 'r1', attempts: 0, nextTryAt: 0 });
    expect((await listReports()).map((r) => r.id)).toEqual(['r1']);
  });
  it('keeps the report after a reload (airplane-mode gate)', async () => {
    await saveNewReport(local('r1', 1000));
    await saveNewReport(local('r2', 2000));
    await closeDb();
    expect((await listReports()).map((r) => r.id)).toEqual(['r2', 'r1']); // newest first
    expect(await outboxCount()).toBe(2);
  });
  it('saving the same id twice leaves one report and one outbox entry', async () => {
    await saveNewReport(local('r1', 1000));
    await saveNewReport(local('r1', 1000));
    expect(await listReports()).toHaveLength(1);
    expect(await outboxCount()).toBe(1);
  });
  it('is all-or-nothing: if the transaction aborts neither store changes', async () => {
    const d = await db();
    const tx = d.transaction(['reports', 'outbox'], 'readwrite');
    const writes = [
      tx.objectStore('reports').put(local('r9', 9)),
      tx.objectStore('outbox').put({ id: 'r9', attempts: 0, nextTryAt: 0 }),
    ];
    tx.abort();
    await expect(Promise.all([...writes, tx.done])).rejects.toBeTruthy();
    expect(await listReports()).toHaveLength(0);
    expect(await outboxCount()).toBe(0);
  });
});
