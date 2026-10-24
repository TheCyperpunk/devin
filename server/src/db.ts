// SQLite storage for the hub: meta (hub id, join code, game revision), paired devices, host sessions, the game.
import Database from 'better-sqlite3';
import { randomInt, randomUUID } from 'node:crypto';
import type { GameState } from '@pralayam/shared';

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
create table if not exists game (
  id         text primary key,
  state_json text not null,
  updated_at integer not null
);
`;

// No 0/O/1/I/L so a code read off a screen cannot be mistyped.
const JOIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newJoinCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)];
  return s;
}

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

  // ---- devices ----
  /** Re-pairing the same deviceId replaces the token (the old one stops working). */
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

  // ---- host sessions ----
  createSession(tokenHash: string, expiresAt: number, now: number): void {
    this.db.prepare('delete from sessions where expires_at <= ?').run(now);
    this.db.prepare('insert into sessions(token_hash, expires_at) values(?, ?)').run(tokenHash, expiresAt);
  }
  sessionValid(tokenHash: string, now: number): boolean {
    return this.db.prepare('select 1 from sessions where token_hash = ? and expires_at > ?').get(tokenHash, now) !== undefined;
  }

  // ---- game (GAME-CONTRACT sections 2 and 4.1): one current game, whole state as JSON, its own revision ----
  get gameRevision(): number {
    return Number(this.getMeta('game_revision') ?? '0');
  }
  /** Persists the state and returns the new game revision. Every change goes through here. */
  saveGame(state: GameState, now: number): number {
    return this.db.transaction((): number => {
      const rev = this.gameRevision + 1;
      this.setMeta('game_revision', String(rev));
      this.setMeta('current_game_id', state.id);
      this.db
        .prepare('insert into game(id, state_json, updated_at) values(?, ?, ?) on conflict(id) do update set state_json = excluded.state_json, updated_at = excluded.updated_at')
        .run(state.id, JSON.stringify(state), now);
      return rev;
    })();
  }
  loadGame(): GameState | null {
    const id = this.getMeta('current_game_id');
    if (!id) return null;
    const row = this.db.prepare('select state_json from game where id = ?').get(id) as { state_json: string } | undefined;
    return row ? (JSON.parse(row.state_json) as GameState) : null;
  }
}
