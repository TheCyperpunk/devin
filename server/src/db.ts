// SQLite storage for the hub (CONTRACT section 7). All writes go through here and take the next global revision.
import Database from 'better-sqlite3';
import { randomInt, randomUUID } from 'node:crypto';
import {
  LIMITS,
  baseScore,
  type NeedType,
  type PatchReport,
  type PhoneReportInput,
  type Report,
  type Stats,
  type Status,
} from '@relief-mesh/shared';

const SCHEMA = `
create table if not exists meta (key text primary key, value text not null);
create table if not exists devices (
  device_id     text primary key,
  reporter_name text not null,
  token_hash    text not null,
  paired_at     integer not null
);
create index if not exists devices_token on devices(token_hash);
create table if not exists sessions (
  token_hash text primary key,
  expires_at integer not null
);
create table if not exists reports (
  id                  text primary key,
  device_id           text not null references devices(device_id),
  reporter_name       text not null,
  needs               text not null,
  people_count        integer not null,
  has_children        integer not null,
  has_elderly_or_sick integer not null,
  urgent              integer not null,
  note                text,
  lat real, lng real, accuracy_m real,
  received_at         integer not null,
  reported_at         integer not null,
  updated_at          integer not null,
  revision            integer not null unique,
  status              text not null default 'open',
  assignee            text,
  base_score          integer not null,
  cloud_revision      integer not null default 0
);
create index if not exists reports_device  on reports(device_id, revision);
create index if not exists reports_pending on reports(cloud_revision, revision);
`;

interface ReportRow {
  id: string;
  device_id: string;
  reporter_name: string;
  needs: string;
  people_count: number;
  has_children: number;
  has_elderly_or_sick: number;
  urgent: number;
  note: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  received_at: number;
  reported_at: number;
  updated_at: number;
  revision: number;
  status: Status;
  assignee: string | null;
  base_score: number;
}

function toReport(r: ReportRow): Report {
  return {
    id: r.id,
    deviceId: r.device_id,
    reporterName: r.reporter_name,
    needs: JSON.parse(r.needs) as NeedType[],
    peopleCount: r.people_count,
    hasChildren: r.has_children === 1,
    hasElderlyOrSick: r.has_elderly_or_sick === 1,
    urgent: r.urgent === 1,
    note: r.note,
    lat: r.lat,
    lng: r.lng,
    accuracyM: r.accuracy_m,
    receivedAt: r.received_at,
    reportedAt: r.reported_at,
    updatedAt: r.updated_at,
    revision: r.revision,
    status: r.status,
    assignee: r.assignee,
    baseScore: r.base_score,
  };
}

// No 0/O/1/I/L so a code read off a screen or printout cannot be mistyped.
const JOIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newJoinCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)];
  return s;
}

export type SubmitResult =
  | { result: 'created' | 'duplicate'; report: Report }
  | { result: 'conflict' };

export type PatchResult =
  | { ok: true; report: Report; changed: boolean }
  | { ok: false; reason: 'not_found' | 'invalid'; message?: string };

export interface DeviceRow {
  deviceId: string;
  reporterName: string;
}

export class HubDb {
  private db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.db.transaction(() => {
      if (this.getMeta('hub_id') === undefined) this.setMeta('hub_id', randomUUID());
      if (this.getMeta('revision') === undefined) this.setMeta('revision', '0');
      if (this.getMeta('join_code') === undefined) this.setMeta('join_code', newJoinCode());
    })();
  }

  close(): void {
    this.db.close();
  }

  // ---- meta ----
  private getMeta(key: string): string | undefined {
    const row = this.db.prepare('select value from meta where key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }
  private setMeta(key: string, value: string): void {
    this.db.prepare('insert into meta(key, value) values(?, ?) on conflict(key) do update set value = excluded.value').run(key, value);
  }
  get hubId(): string {
    return this.getMeta('hub_id')!;
  }
  get joinCode(): string {
    return this.getMeta('join_code')!;
  }
  rotateJoinCode(): string {
    const code = newJoinCode();
    this.setMeta('join_code', code);
    return code;
  }
  get maxRevision(): number {
    return Number(this.getMeta('revision'));
  }
  /** Must be called inside a transaction together with the row write (D6). */
  private bump(): number {
    const next = this.maxRevision + 1;
    this.setMeta('revision', String(next));
    return next;
  }

  // ---- devices ----
  /** Re-pairing the same deviceId replaces the token (the old one stops working) and keeps its reports. */
  upsertDevice(deviceId: string, reporterName: string, tokenHash: string, now: number): void {
    this.db
      .prepare(
        `insert into devices(device_id, reporter_name, token_hash, paired_at) values(?, ?, ?, ?)
         on conflict(device_id) do update set reporter_name = excluded.reporter_name,
           token_hash = excluded.token_hash, paired_at = excluded.paired_at`,
      )
      .run(deviceId, reporterName, tokenHash, now);
  }
  deviceByTokenHash(tokenHash: string): DeviceRow | undefined {
    const row = this.db.prepare('select device_id, reporter_name from devices where token_hash = ?').get(tokenHash) as
      | { device_id: string; reporter_name: string }
      | undefined;
    return row && { deviceId: row.device_id, reporterName: row.reporter_name };
  }

  // ---- coordinator sessions ----
  createSession(tokenHash: string, expiresAt: number, now: number): void {
    this.db.prepare('delete from sessions where expires_at <= ?').run(now);
    this.db.prepare('insert into sessions(token_hash, expires_at) values(?, ?)').run(tokenHash, expiresAt);
  }
  sessionValid(tokenHash: string, now: number): boolean {
    return this.db.prepare('select 1 from sessions where token_hash = ? and expires_at > ?').get(tokenHash, now) !== undefined;
  }

  // ---- reports ----
  getReport(id: string): Report | undefined {
    const row = this.db.prepare('select * from reports where id = ?').get(id) as ReportRow | undefined;
    return row && toReport(row);
  }

  /** Idempotent create (D5): same id from the same device is a no-op that returns the stored row. */
  submit(device: DeviceRow, input: PhoneReportInput, now: number): SubmitResult {
    return this.db.transaction((): SubmitResult => {
      const existing = this.getReport(input.id);
      if (existing) {
        return existing.deviceId === device.deviceId ? { result: 'duplicate', report: existing } : { result: 'conflict' };
      }
      const revision = this.bump();
      const age = Math.min(Math.max(input.ageMs, 0), LIMITS.ageMsMax);
      this.db
        .prepare(
          `insert into reports(id, device_id, reporter_name, needs, people_count, has_children, has_elderly_or_sick,
             urgent, note, lat, lng, accuracy_m, received_at, reported_at, updated_at, revision, status, base_score)
           values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
        )
        .run(
          input.id,
          device.deviceId,
          device.reporterName,
          JSON.stringify(input.needs),
          input.peopleCount,
          input.hasChildren ? 1 : 0,
          input.hasElderlyOrSick ? 1 : 0,
          input.urgent ? 1 : 0,
          input.note ?? null,
          input.lat ?? null,
          input.lng ?? null,
          input.accuracyM ?? null,
          now,
          now - age,
          now,
          revision,
          baseScore(input),
        );
      return { result: 'created', report: this.getReport(input.id)! };
    })();
  }

  /** Reports with revision > after, oldest revision first. deviceId limits it to one phone's own reports. */
  reportsAfter(after: number, limit: number, deviceId?: string): { reports: Report[]; hasMore: boolean } {
    const rows = (
      deviceId === undefined
        ? this.db.prepare('select * from reports where revision > ? order by revision asc limit ?').all(after, limit + 1)
        : this.db
            .prepare('select * from reports where device_id = ? and revision > ? order by revision asc limit ?')
            .all(deviceId, after, limit + 1)
    ) as ReportRow[];
    return { reports: rows.slice(0, limit).map(toReport), hasMore: rows.length > limit };
  }

  /** Coordinator edit. A request that changes nothing does not bump the revision. */
  patch(id: string, p: PatchReport, now: number): PatchResult {
    return this.db.transaction((): PatchResult => {
      const cur = this.getReport(id);
      if (!cur) return { ok: false, reason: 'not_found' };

      const status = p.status ?? cur.status;
      const assignee = p.assignee === undefined ? cur.assignee : p.assignee === '' ? null : p.assignee;
      const note = p.note === undefined ? cur.note : p.note === '' ? null : p.note;

      if (status === 'assigned' && assignee === null) {
        return { ok: false, reason: 'invalid', message: 'status "assigned" needs an assignee' };
      }
      if (status === cur.status && assignee === cur.assignee && note === cur.note) {
        return { ok: true, report: cur, changed: false };
      }
      const revision = this.bump();
      this.db
        .prepare('update reports set status = ?, assignee = ?, note = ?, updated_at = ?, revision = ? where id = ?')
        .run(status, assignee, note, now, revision, id);
      return { ok: true, report: this.getReport(id)!, changed: true };
    })();
  }

  stats(): Stats {
    const rows = this.db.prepare('select status, count(*) as n from reports group by status').all() as { status: Status; n: number }[];
    const out: Stats = { open: 0, assigned: 0, done: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }
}
