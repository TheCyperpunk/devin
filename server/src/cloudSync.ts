// Cloud backup (D10, CONTRACT section 9): every 10 s, push reports whose revision is ahead of what the cloud has.
// The cloud is a copy, never a source: nothing is ever read back. The client is injected so tests need no network.
import { TIMING, type CloudStatus, type Report } from '@relief-mesh/shared';
import type { HubDb } from './db.js';
import type { Events } from './ws.js';

/** One row of the Supabase `reports` table (snake_case, see CONTRACT section 9). */
export interface CloudRow {
  id: string;
  device_id: string;
  reporter_name: string;
  needs: string[];
  people_count: number;
  has_children: boolean;
  has_elderly_or_sick: boolean;
  urgent: boolean;
  note: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  received_at: number;
  reported_at: number;
  updated_at: number;
  revision: number;
  status: string;
  assignee: string | null;
  base_score: number;
  hub_id: string;
}

export interface CloudClient {
  /** A cheap request that proves the cloud is reachable and the table exists. */
  ping(): Promise<boolean>;
  /** Upsert by id. Throws on failure. */
  upsert(rows: CloudRow[]): Promise<void>;
}

export const CLOUD_CHUNK = 100;

export function toCloudRow(r: Report, hubId: string): CloudRow {
  return {
    id: r.id,
    device_id: r.deviceId,
    reporter_name: r.reporterName,
    needs: r.needs,
    people_count: r.peopleCount,
    has_children: r.hasChildren,
    has_elderly_or_sick: r.hasElderlyOrSick,
    urgent: r.urgent,
    note: r.note,
    lat: r.lat,
    lng: r.lng,
    accuracy_m: r.accuracyM,
    received_at: r.receivedAt,
    reported_at: r.reportedAt,
    updated_at: r.updatedAt,
    revision: r.revision,
    status: r.status,
    assignee: r.assignee,
    base_score: r.baseScore,
    hub_id: hubId,
  };
}

export class CloudSync {
  private status: CloudStatus = { state: 'not_configured' };
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  /** The cloud answered recently. Avoids a ping before every push. */
  private reachable = false;

  constructor(
    private db: HubDb,
    private client: CloudClient | null,
    private events: Events,
    private now: () => number = Date.now,
    private intervalMs: number = TIMING.cloudCheckIntervalMs,
  ) {
    if (client) this.status = this.idle();
  }

  current(): CloudStatus {
    return this.status;
  }

  start(): void {
    if (!this.client || this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass: ping if needed, push pending in chunks, mark what was pushed. Safe to call concurrently. */
  tick(): Promise<void> {
    if (!this.client) return Promise.resolve();
    this.running ??= this.pass().finally(() => (this.running = null));
    return this.running;
  }

  private async pass(): Promise<void> {
    const client = this.client!;
    let pending = this.db.pendingCloudCount();
    if (pending === 0) {
      this.set(this.idle());
      return;
    }
    if (!this.reachable) {
      this.reachable = await client.ping().catch(() => false);
      if (!this.reachable) {
        this.set({ state: 'offline', pending, lastSyncAt: this.db.lastCloudSyncAt });
        return;
      }
    }
    this.set({ state: 'syncing', pending, lastSyncAt: this.db.lastCloudSyncAt });
    const hubId = this.db.hubId;
    try {
      // Loop until nothing is pending; a row edited while uploading keeps a newer revision and comes round again.
      for (let guard = 0; guard < 1000; guard++) {
        const batch = this.db.pendingCloud(CLOUD_CHUNK);
        if (batch.length === 0) break;
        await client.upsert(batch.map((r) => toCloudRow(r, hubId)));
        this.db.markCloud(batch.map((r) => ({ id: r.id, revision: r.revision })));
        pending = this.db.pendingCloudCount();
        if (pending > 0) this.set({ state: 'syncing', pending, lastSyncAt: this.db.lastCloudSyncAt });
      }
      this.db.lastCloudSyncAt = this.now();
      this.set(this.idle());
    } catch (err) {
      // A failed push means the cloud is gone (or refusing us). Next tick pings again before retrying.
      this.reachable = false;
      console.error('[cloud] push failed:', err instanceof Error ? err.message : String(err));
      this.set({ state: 'offline', pending: this.db.pendingCloudCount(), lastSyncAt: this.db.lastCloudSyncAt });
    }
  }

  /** Nothing pending: "synced" if we ever synced, otherwise offline-with-zero is misleading, so report synced 0. */
  private idle(): CloudStatus {
    const last = this.db.lastCloudSyncAt;
    const { total } = this.db.cloudSummary();
    if (last === null && total > 0) return { state: 'offline', pending: this.db.pendingCloudCount(), lastSyncAt: null };
    return { state: 'synced', total, lastSyncAt: last ?? 0 };
  }

  private set(next: CloudStatus): void {
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.events.cloudStatus(next);
  }
}
