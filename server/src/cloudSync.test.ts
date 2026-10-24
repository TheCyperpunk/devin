// CloudSync against an in-memory hub database and a fake cloud: status transitions, chunking, column mapping,
// pushed-revision bookkeeping (an edit during upload stays pending), failure handling, persistence of lastSyncAt.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudStatus, PhoneReportInput } from '@relief-mesh/shared';
import { CloudSync, toCloudRow, type CloudClient, type CloudRow } from './cloudSync.js';
import { HubDb } from './db.js';
import { noEvents, type Events } from './ws.js';

class FakeCloud implements CloudClient {
  rows = new Map<string, CloudRow>();
  up = true;
  pings = 0;
  upserts: CloudRow[][] = [];
  failNext = 0;
  /** Called between receiving a batch and acknowledging it (to simulate an edit mid-upload). */
  during: (() => void) | null = null;
  async ping() {
    this.pings++;
    return this.up;
  }
  async upsert(rows: CloudRow[]) {
    if (!this.up || this.failNext > 0) {
      if (this.failNext > 0) this.failNext--;
      throw new Error('cloud down');
    }
    this.during?.();
    this.upserts.push(rows);
    for (const r of rows) this.rows.set(r.id, r);
  }
}

let db: HubDb;
let cloud: FakeCloud;
let statuses: CloudStatus[];
let sync: CloudSync;
let now: number;
const events: Events = { ...noEvents, cloudStatus: (s) => statuses.push(s) };
const device = { deviceId: 'dev-1', reporterName: 'Asha' };

const input = (over: Partial<PhoneReportInput> = {}): PhoneReportInput => ({
  id: randomUUID(),
  needs: ['water'],
  peopleCount: 3,
  hasChildren: false,
  hasElderlyOrSick: true,
  urgent: false,
  note: 'tank empty',
  lat: 10.1,
  lng: 76.3,
  accuracyM: 12,
  ageMs: 60_000,
  ...over,
});

beforeEach(() => {
  db = new HubDb(':memory:');
  db.upsertDevice(device.deviceId, device.reporterName, 'hash', 1);
  cloud = new FakeCloud();
  statuses = [];
  now = 1_800_000_000_000;
  sync = new CloudSync(db, cloud, events, () => now, 60_000);
});
afterEach(() => {
  sync.stop();
  db.close();
});

describe('status', () => {
  it('is not_configured without a client and never ticks', async () => {
    const s = new CloudSync(db, null, events);
    expect(s.current()).toEqual({ state: 'not_configured' });
    s.start();
    await s.tick();
    expect(statuses).toEqual([]);
  });

  it('starts as synced 0 on an empty hub, offline-with-pending once reports exist and the cloud is down', async () => {
    expect(sync.current()).toEqual({ state: 'synced', total: 0, lastSyncAt: 0 });
    db.submit(device, input(), now);
    cloud.up = false;
    await sync.tick();
    expect(sync.current()).toEqual({ state: 'offline', pending: 1, lastSyncAt: null });
    expect(cloud.pings).toBe(1);
  });

  it('goes syncing -> synced and broadcasts each change once', async () => {
    db.submit(device, input(), now);
    db.submit(device, input(), now);
    await sync.tick();
    expect(statuses.map((s) => s.state)).toEqual(['syncing', 'synced']);
    expect(sync.current()).toEqual({ state: 'synced', total: 2, lastSyncAt: now });
    expect(db.pendingCloudCount()).toBe(0);
    await sync.tick(); // nothing changed: no broadcast
    expect(statuses).toHaveLength(2);
  });

  it('after a successful sync, the cloud going away shows offline with the last sync time kept', async () => {
    db.submit(device, input(), now);
    await sync.tick();
    const first = now;
    now += 5000;
    db.submit(device, input(), now);
    cloud.up = false;
    await sync.tick();
    expect(sync.current()).toEqual({ state: 'offline', pending: 1, lastSyncAt: first });
    cloud.up = true;
    await sync.tick();
    expect(sync.current()).toEqual({ state: 'synced', total: 2, lastSyncAt: now });
  });
});

describe('pushing', () => {
  it('maps every column and stamps the hub id', async () => {
    const i = input();
    const { report } = db.submit(device, i, now) as { report: import('@relief-mesh/shared').Report };
    await sync.tick();
    const row = cloud.rows.get(i.id)!;
    expect(row).toEqual({
      id: i.id,
      device_id: 'dev-1',
      reporter_name: 'Asha',
      needs: ['water'],
      people_count: 3,
      has_children: false,
      has_elderly_or_sick: true,
      urgent: false,
      note: 'tank empty',
      lat: 10.1,
      lng: 76.3,
      accuracy_m: 12,
      received_at: now,
      reported_at: now - 60_000,
      updated_at: now,
      revision: report.revision,
      status: 'open',
      assignee: null,
      base_score: report.baseScore,
      hub_id: db.hubId,
    });
    expect(toCloudRow(report, 'h')).toMatchObject({ hub_id: 'h' });
  });

  it('uploads in chunks of 100, oldest change first', async () => {
    for (let i = 0; i < 230; i++) db.submit(device, input(), now);
    await sync.tick();
    expect(cloud.upserts.map((b) => b.length)).toEqual([100, 100, 30]);
    const revs = cloud.upserts.flat().map((r) => r.revision);
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    expect(db.pendingCloudCount()).toBe(0);
  });

  it('a coordinator change makes the report pending again and only that report is re-pushed', async () => {
    const a = input();
    const b = input();
    db.submit(device, a, now);
    db.submit(device, b, now);
    await sync.tick();
    db.patch(a.id, { status: 'assigned', assignee: 'Boat 1' }, now);
    expect(db.pendingCloudCount()).toBe(1);
    await sync.tick();
    expect(cloud.upserts[1]!.map((r) => r.id)).toEqual([a.id]);
    expect(cloud.rows.get(a.id)).toMatchObject({ status: 'assigned', assignee: 'Boat 1' });
    expect(cloud.rows.get(b.id)).toMatchObject({ status: 'open' });
  });

  it('a report edited while its batch is in flight stays pending (only the pushed revision is marked)', async () => {
    const a = input();
    db.submit(device, a, now);
    cloud.during = () => {
      db.patch(a.id, { status: 'done' }, now);
      cloud.during = null;
    };
    await sync.tick();
    // first batch carried the "open" revision; the "done" edit happened meanwhile and was pushed in a second batch
    expect(cloud.upserts).toHaveLength(2);
    expect(cloud.upserts[0]![0]).toMatchObject({ status: 'open' });
    expect(cloud.upserts[1]![0]).toMatchObject({ status: 'done' });
    expect(cloud.rows.get(a.id)!.status).toBe('done');
    expect(db.pendingCloudCount()).toBe(0);
  });

  it('a failed upsert leaves everything pending, goes offline, and succeeds on a later tick', async () => {
    db.submit(device, input(), now);
    cloud.failNext = 1;
    await sync.tick();
    expect(sync.current()).toMatchObject({ state: 'offline', pending: 1 });
    expect(db.pendingCloudCount()).toBe(1);
    await sync.tick();
    expect(sync.current()).toMatchObject({ state: 'synced', total: 1 });
    expect(cloud.pings).toBe(2); // pinged again after the failure before pushing
  });

  it('concurrent ticks share one pass', async () => {
    db.submit(device, input(), now);
    await Promise.all([sync.tick(), sync.tick(), sync.tick()]);
    expect(cloud.upserts).toHaveLength(1);
  });

  it('remembers the last sync time across a hub restart (stored in the database)', async () => {
    const file = new HubDb(':memory:'); // same db object simulates "same file"; the value lives in meta
    file.upsertDevice('d', 'n', 'h', 1);
    file.submit({ deviceId: 'd', reporterName: 'n' }, input(), now);
    const s1 = new CloudSync(file, cloud, events, () => now);
    await s1.tick();
    const s2 = new CloudSync(file, cloud, events, () => now + 1);
    expect(s2.current()).toEqual({ state: 'synced', total: 1, lastSyncAt: now });
    file.close();
  });

  it('start() runs a pass right away and then on the interval', async () => {
    db.submit(device, input(), now);
    sync.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(sync.current()).toMatchObject({ state: 'synced', total: 1 });
    sync.stop();
  });
});
