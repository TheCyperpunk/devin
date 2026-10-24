# Relief Mesh — Data and API Contract

The single source of truth for data shapes, endpoints and messages. The hub, the volunteer app and the dashboard are built against this file. Rules behind it are in [DECISIONS.md](DECISIONS.md) (referenced as D1–D12).

In Phase 2 this file becomes `shared/contract.ts` (zod schemas + inferred types), imported by both `server/` and `web/`. Until then, this file wins.

---

## 1. Enums and constants

```ts
type NeedType = 'food' | 'water' | 'medical' | 'rescue' | 'shelter';
type Status   = 'open' | 'assigned' | 'done';
type Role     = 'device' | 'coordinator';

const LIMITS = {
  peopleCount: [1, 500],
  noteMax: 280,
  reporterNameMax: 60,
  assigneeMax: 60,
  batchMax: 50,
  bodyMaxBytes: 64 * 1024,
  ageMsMax: 48 * 60 * 60 * 1000,      // D7 clamp
  rateLimitPerMin: 60,                // per token, or per IP if no token
};

const TIMING = {
  healthTimeoutMs: 2000,
  gpsTimeoutMs: 5000,
  backoffStartMs: 1000,
  backoffMaxMs: 30000,
  pollIntervalMs: 10000,              // only when WS is down
  wsAuthDeadlineMs: 5000,
  wsPingIntervalMs: 20000,
  cloudCheckIntervalMs: 10000,
};
```

## 2. Data shapes

### 2.1 `PhoneReportInput` (phone → hub)

Strict: unknown keys are rejected with `invalid_body`.

| Field | Type | Rule |
|---|---|---|
| `id` | string | UUID v4, generated on the phone |
| `needs` | `NeedType[]` | 1–5 items, unique |
| `peopleCount` | int | 1–500 |
| `hasChildren` | boolean | |
| `hasElderlyOrSick` | boolean | |
| `urgent` | boolean | |
| `note` | string? | trimmed, ≤ 280 chars, empty → omitted |
| `lat`, `lng` | number? | both present or both absent; valid ranges |
| `accuracyM` | number? | ≥ 0, only with `lat`/`lng` |
| `ageMs` | int | ≥ 0. `phoneNow − phoneCreatedAt`, computed **at send time** (D7) |

Not allowed from phones: `deviceId`, `reporterName`, `status`, `assignee`, `revision`, any timestamp or score. These come from the device token or the hub.

### 2.2 `Report` (hub → clients)

```ts
interface Report {
  id: string;
  deviceId: string;          // from the device token
  reporterName: string;      // from the device record
  needs: NeedType[];
  peopleCount: number;
  hasChildren: boolean;
  hasElderlyOrSick: boolean;
  urgent: boolean;
  note: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  receivedAt: number;        // hub clock, ms epoch
  reportedAt: number;        // receivedAt − clamp(ageMs, 0, 48h)
  updatedAt: number;         // hub clock, display only
  revision: number;          // global monotonic (D6) — the only ordering field
  status: Status;
  assignee: string | null;
  baseScore: number;         // D7, stored
}
```

Display score (computed by the client, using hub time):

```ts
hubNow   = Date.now() + (serverTime − clientTimeWhenResponseArrived)
waitMin  = (hubNow − reportedAt) / 60000
score    = round(baseScore + min(max(waitMin, 0) * 0.2, 20))
band     = score >= 80 ? 'red' : score >= 50 ? 'orange' : 'yellow'
sort     = status === 'done' last; otherwise score desc, then reportedAt asc
```

`baseScore` rules are in D7. The function lives in `shared/urgency.ts` and is unit tested.

### 2.3 Merge rule (all clients)

When a `Report` arrives from REST or WS, store it only if its `revision` is greater than the local copy's. This makes REST catch-up and WS events safe to apply in any order.

## 3. Authentication

| Caller | How | Header |
|---|---|---|
| Phone | `POST /api/pair` → `deviceToken` (32 random bytes, base64url). Hub stores SHA-256 only. | `Authorization: Bearer <deviceToken>` |
| Dashboard | `POST /api/dashboard/login` → `sessionToken`. Stored in `sessionStorage`. | `Authorization: Bearer <sessionToken>` |

- Re-pairing the same `deviceId` issues a new token and revokes the old one (its open WebSockets are closed with code 4001). The `deviceId` keeps ownership of its reports. Anyone holding the join code can re-pair any `deviceId`, so the join code is the secret to protect: rotate it after pairing.
- Rate limits: 60 requests/min per token (per IP when there is no token) on everything except `GET /api/health`; `POST /api/pair` and `POST /api/dashboard/login` are limited to 10/min per IP. Over the limit → `429 rate_limited` with `Retry-After`.
- A `PATCH` that changes nothing returns the report unchanged without bumping `revision` or broadcasting.
- Coordinator sessions are stored in SQLite and survive a hub restart. They expire after 24 h.

## 4. Error format

Every non-2xx response:

```json
{ "error": { "code": "invalid_body", "message": "peopleCount must be 1–500" } }
```

| HTTP | `code` | Phone outbox action |
|---|---|---|
| 400 | `invalid_body` | mark `rejected`, do not retry |
| 401 | `unauthorized` (missing, unknown, replaced or expired token) | stop sending, show "Pair again" |
| 403 | `forbidden` (valid token, wrong role) / `bad_join_code` | show message |
| 404 | `not_found` | — |
| 409 | `conflict` | mark `rejected`, do not retry |
| 413 | `too_large` | split batch, retry |
| 429 | `rate_limited` | back off, retry |
| 5xx / network | — | back off, retry |

## 5. REST endpoints

All endpoints are under `https://<HUB_IP>:3443`. JSON bodies only.

### Public

**`GET /api/health`** → `200 { ok: true, time: number, hubId: string }`
`hubId` is a random ID created with the database. If a phone sees a different `hubId` than the one saved with its pairing, the hub was reset: the phone pairs again and re-sends any report not in `sent` state.

**`POST /api/pair`** `{ joinCode, deviceId, reporterName }` (join code is 8 characters from `A-Z` and `2-9` without `I O L 0 1`, compared case-insensitively; `deviceId` is 8–64 of `A-Za-z0-9_-`) → `200 { deviceToken, deviceId, reporterName, hubId }`
Errors: `bad_join_code`, `invalid_body`.

### Device (device token)

**`POST /api/reports`** `PhoneReportInput` → `201 { report }` new · `200 { report }` duplicate from the same device · `409 conflict` if the `id` belongs to another device.

**`POST /api/reports/batch`** `{ reports: PhoneReportInput[] }` (1–50) →
```json
{ "results": [ { "id": "…", "result": "created" | "duplicate" | "conflict" | "invalid", "report"?: Report, "message"?: string } ] }
```
Items are validated one by one, so one bad report never blocks the rest of the outbox. The whole request fails only for auth, size (more than 50 items → `413 too_large`) or a malformed envelope. For an `invalid` item, `id` is the id the phone sent (empty if none).

**`GET /api/my-reports?after=<revision>`** → `200 { reports: Report[], maxRevision: number, hasMore: boolean, serverTime: number }`
Only this device's reports, ordered by `revision` ascending, at most 500 per page. `after` defaults to 0. When `hasMore` is true, call again with `after=maxRevision`. `maxRevision` is the last returned revision, or `after` when the page is empty.

### Coordinator (session token)

**`POST /api/dashboard/login`** `{ passcode }` → `200 { sessionToken }` · `401`. The only dashboard route that needs no token.

**`GET /api/dashboard/reports?after=<revision>`** → same shape as `my-reports`, all devices.

**`PATCH /api/dashboard/reports/:id`** `{ status?, assignee?, note? }` → `200 { report }`
- `assignee: null` clears it. Setting `status: 'assigned'` requires a non-empty assignee (existing or in the same request).
- Any status → any status is allowed (the coordinator can reopen).
- Bumps `revision` and `updatedAt`, then broadcasts.

**`GET /api/dashboard/stats`** → `200 { open, assigned, done, cloud: CloudStatus }`

**`GET /api/dashboard/join`** → `200 { joinUrl, joinCode, qrDataUrl }`
**`POST /api/dashboard/join/rotate`** → same shape, with a new code. Already-paired devices are unaffected.

**`GET /api/dashboard/export`** → SQLite backup file (`application/octet-stream`). Phase 8.

## 6. WebSocket `/ws`

Every message is `{ type, payload }`.

**Handshake**
1. Client → `{ type: 'auth', payload: { token } }` within 5 s, or the hub closes with code `4001`.
2. Hub → `{ type: 'auth:ok', payload: { role, serverTime } }`, or closes with `4001`.
3. Client then catches up through REST using `after=<highest local revision>`, and applies WS events with the merge rule (§2.3).

**Hub → device**
- `report:upserted` `{ report }`: only reports owned by this device.

**Hub → coordinator**
- `report:upserted` `{ report }`: every report.
- `stats` `{ open, assigned, done }`: after any change.
- `cloud:status` `CloudStatus`: on change.

```ts
type CloudStatus =
  | { state: 'not_configured' }
  | { state: 'offline';  pending: number; lastSyncAt: number | null }
  | { state: 'syncing';  pending: number; lastSyncAt: number | null }
  | { state: 'synced';   total: number;   lastSyncAt: number };
```

Clients send nothing after `auth`. All writes go through REST. The hub pings every 20 s and drops dead sockets.

## 7. Hub storage (SQLite)

```sql
create table meta (key text primary key, value text not null);
-- keys: hub_id, revision (integer as text), join_code

create table devices (
  device_id     text primary key,
  reporter_name text not null,
  token_hash    text not null,
  paired_at     integer not null
);

create table sessions (
  token_hash  text primary key,
  expires_at  integer not null
);

create table reports (
  id                  text primary key,
  device_id           text not null references devices(device_id),
  reporter_name       text not null,
  needs               text not null,          -- JSON array
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
create index reports_revision on reports(revision);
create index reports_device   on reports(device_id, revision);
create index reports_pending  on reports(cloud_revision, revision);
```

Every write runs in one transaction: read `meta.revision`, add 1, write it back, write the row. Use WAL mode.

## 8. Phone storage (IndexedDB, database `relief-mesh`, version 1)

| Store | Key | Value |
|---|---|---|
| `settings` | key | `deviceId`, `reporterName`, `lang` (`'en' \| 'ml'`), `deviceToken`, `hubId` |
| `reports` | `id` | `{ id, input: Omit<PhoneReportInput,'ageMs'>, createdAtLocal, syncState: 'saved' \| 'sent' \| 'rejected', rejectReason?, report?: Report }` |
| `outbox` | `id` | `{ id, attempts, nextTryAt }` |

Submitting writes to `reports` and `outbox` in a single transaction. `ageMs` is computed when sending: `Date.now() − createdAtLocal`.

## 9. Supabase (backup)

```sql
create table public.reports (
  id text primary key,
  device_id text not null,
  reporter_name text,
  needs jsonb not null,
  people_count int not null,
  has_children boolean not null,
  has_elderly_or_sick boolean not null,
  urgent boolean not null,
  note text,
  lat double precision, lng double precision, accuracy_m double precision,
  received_at bigint not null,
  reported_at bigint not null,
  updated_at bigint not null,
  revision bigint not null,
  status text not null,
  assignee text,
  base_score int not null,
  hub_id text not null
);
alter table public.reports enable row level security;
-- No policies: anon/authenticated clients get nothing. The hub uses the secret key.
```

The hub upserts on `id` in chunks of 100 and then sets `cloud_revision = revision` for those rows.
