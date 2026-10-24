# Relief Mesh — Implementation Plan

Built for Devin Hacks Kochi, Track 3 (Works Anyway). Read with [DECISIONS.md](DECISIONS.md) (the rules) and [CONTRACT.md](CONTRACT.md) (the shapes).

**Pitch:** a local relief hub. Volunteers' phones and a coordinator laptop keep working over local Wi-Fi with no Internet and no mobile network. When the Internet returns, the hub backs everything up to the cloud.

## Repo layout

```
relief-mesh/            (this folder)
  AGENTS.md  CLAUDE.md  README.md  .env.example  .gitignore
  package.json          # npm workspaces: shared, server, web
  shared/               # contract.ts (zod + types), urgency.ts, i18n.ts — used by server and web
  server/src/           # index.ts, db.ts, auth.ts, routes/*.ts, ws.ts, cloudSync.ts, setupServer.ts
  server/data/          # hub.db (gitignored)
  web/                  # Vite: index.html (volunteer), dashboard.html (coordinator)
  web/src/volunteer/  web/src/dashboard/  web/src/lib/ (idb.ts, sync.ts, api.ts, ws.ts)
  scripts/              # make-certs.ts, seed.ts
  certs/                # gitignored
  docs/
```

## Phases

Each phase ends with a commit, passing `npm test` and `npm run build`, the manual gate below, and a short list of known limitations. Do not start the next phase until the gate passes.

### Phase 0 — Decisions ✅
DECISIONS.md, CONTRACT.md, this plan, AGENTS.md, `.env.example`, `.gitignore`.

### Phase 1 — Tooling, HTTPS and network ✅ (gate passed on a real Android phone, installed from Brave, offline + airplane mode)
- npm workspaces, TypeScript (strict) configs, Vitest, scripts: `dev`, `build`, `start`, `test`, `certs` (`seed` arrives with the DB in Phase 2).
- `scripts/make-certs.ts`: runs `mkcert` for `localhost 127.0.0.1 ::1 $HUB_IP $CERT_EXTRA_HOSTS` into `certs/` and copies `rootCA.pem`.
- Hub: HTTPS on `:3443` serving `web/dist` + `/api/health`; HTTP setup server on `:8080` serving the setup page and `rootCA.pem` only.
- Set up the chosen network (D2).
- **Gate:** each demo phone opens `https://HUB_IP:3443` with no certificate warning, and the volunteer page shows all three checks green (secure context, service worker, hub).
- Lessons from the first phone test (apply to every demo phone):
  - Install the CA from **Settings → CA certificate**, using the `.crt` (binary DER) download. Installing from the browser's "Open" button fails, and a plain download alone does nothing.
  - A phone browser that was ever tapped through the warning keeps a stale "not secure" verdict (Chrome blocked install). Use a fresh browser/profile or Settings → Site settings → All sites → Clear & reset for the hub IP.
  - Chrome only offers "Install app" with PNG icons (192 and 512); `npm run icons` generates them.
  - The laptop's Wi-Fi IP changed three times in an hour on a hotspot/guest Wi-Fi. Use the Windows hotspot (`192.168.137.1`) or a router before the demo; the IP is part of the app's origin.
- Known limitations: `hubId` is a placeholder until the DB exists (Phase 2); iPhone not yet tested.

### Phase 2 — Hub core ✅ (57 automated tests + live HTTPS end-to-end check)
- `shared/contract.ts`: zod schemas from CONTRACT §2–§6.
- SQLite schema (CONTRACT §7), revision counter, `hubId`, join code.
- Pairing, coordinator login, bearer auth middleware, rate limit, 64 KB body limit, error format.
- All REST endpoints except export. WS with auth handshake and role filtering.
- **Gate:** automated tests: same report posted twice → 1 row; another device's `id` → 409; device A cannot read device B's reports; dashboard routes without a token → 401; a WS device client receives only its own events. (Passed; the privacy tests were mutation-checked by deliberately breaking the filters.)
- Built: `shared/src/contract.ts` (strict zod schemas), `server/src/{db,auth,routes,ws,hub}.ts`, `scripts/seed.ts` (12 fictional reports, `npm run seed`), `baseScore` early (Phase 3 adds the wait bonus, bands and sorting).
- Known limitations: `GET /api/dashboard/export` and cloud sync are later phases (`cloud` status is always `not_configured`); sessions are never revoked early (24 h expiry, fine for a hub that restarts); the seed script writes straight to the database, so a running dashboard will not see seeded rows until it re-fetches.

### Phase 3 — Urgency ✅ (24 scoring tests, mutation-checked)
- `shared/urgency.ts`: `baseScore(input)`, `displayScore(report, hubNow)`, `band()`, `compareReports()`.
- Built in `shared/src/urgency.ts`: `baseScore`, `waitBonus`, `displayScore`, `band`, `bandOf` (returns `'done'` for finished reports), `compareReports`, `sortReports`, `clockOffset`/`hubNow` (estimates hub time from `serverTime` so a wrong phone clock cannot distort waiting time).
- Sort rule: not-done before done; then displayed score high to low; then older `reportedAt` first; then lower `revision`. Done reports use the same order among themselves.
- **Gate:** unit tests cover: medical above food-only; rescue; group size cap at 30; wait bonus capped at 20; food/water +10 only when no medical/rescue/urgent; done sorted last; ties broken by older `reportedAt`.

### Phase 4 — Volunteer PWA ✅ (gate passed in a real browser; real-phone check pending)
- `vite-plugin-pwa`: manifest, icons, precache the app shell; never cache `/api/*`.
- Pairing screen (from QR `?join=` or manual code), name, language toggle (en/ml from `shared/i18n.ts`).
- Form: need buttons, people counter, three toggles, note, GPS with 5 s timeout, Submit.
- IndexedDB per CONTRACT §8. `navigator.storage.persist()`. "Saved on phone" shown immediately.
- **Gate:** load once → airplane mode → app reopens → submit → report shows "Saved on phone" after closing and reopening.
- Built: `shared/src/i18n.ts` (all strings, en + ml, parity-tested), `web/src/lib/{db,report,api,hooks,timeago}.ts`, `web/src/volunteer/{App,Pair,ReportForm,MyReports,lang}.tsx`. Reports are saved in IndexedDB with a matching outbox entry in ONE transaction; nothing is sent to the hub yet (Phase 5).
- Verified by `npm run e2e` (drives Edge/Chrome against the running hub): pairing from the QR link (code is removed from the address bar), wrong code error, service worker control, offline reload stays paired, offline submit, close + reopen keeps the report, GPS saved, no hub-owned fields stored, Malayalam, and no sideways scrolling at 320/360/390 px in both languages. Screenshots showed (and the check now prevents) a Malayalam layout overflow.
- Known limitations: the 12 agreed Malayalam labels are as written in this plan, the other ~35 strings are first drafts needing a native-speaker check; `storage.persist()` is denied in the headless test browser (the "browser may delete reports" warning shows), so confirm it is granted on an installed phone app; there is no way to re-pair or change name yet (Phase 5/8); a report that fails local validation is refused on the form, not queued.

### Phase 5 — Outbox sync and status
- `flushOutbox()`: health → batch ≤ 50 → handle per-item results (CONTRACT §4).
- Triggers: after submit, health OK, WS `auth:ok`, `online`, `visibilitychange` → visible, and a 5 s timer while the outbox is not empty. Hub reachable → all entries due now (D8).
- `hubId` change → pair again, re-send unsent reports.
- WS client with REST catch-up and a 10 s polling fallback. "My reports" screen with chips: Saved on phone / Sent to hub / Assigned to NAME / Done / Rejected.
- **Gate:** hub off, queue 3 reports → hub on, foreground the app → all 3 arrive exactly once within 10 s. Repeat with a hub restart in the middle of a batch.

### Phase 6 — Coordinator dashboard
- Passcode login. Counters. Top-3 critical strip. Sorted list (primary view). Detail panel: assign, mark done, reopen, edit note.
- Live updates over WS with catch-up on reconnect. New items flash. Join panel with QR and "New code".
- Leaflet map as a secondary tab: colored pins, OSM attribution, "map needs Internet" notice (D9).
- **Gate:** phone submit → shows on the dashboard in < 2 s → assign → phone shows "Assigned to NAME" → done → both update. Works with the map tab never opened.

### Phase 7 — Cloud backup
- `cloudSync.ts` per CONTRACT §9; `CloudStatus` banner on the dashboard.
- **Gate:** Internet off → banner "Offline — N waiting", N rises → Internet on → "Synced", rows in Supabase. `grep` of `web/dist` finds no Supabase key.

### Phase 8 — Hardening
- Error/empty/loading states, Retry button, double-submit guard, 48 px targets, contrast check, small-screen check.
- Dashboard "Export DB" (CONTRACT §5). No request bodies in logs.
- **Gate:** a non-technical teammate pairs and submits with no help.

### Phase 9 — Integration run
Run on the real network and phones: three phones paired → online reports → Internet off → offline reports → hub restart → reconnect → exactly-once check → assign/done reaches only the owning phone → Internet on → cloud synced → dashboard used without the map.

### Phase 10 — Demo prep
Rehearse 3× · backup video · spare laptop with the same certs, `.env` and a DB export · printed URL and QR · seed script for practice, clean DB for the live run · Malayalam labels checked by a native speaker on a low-end Android phone.

### Stretch (only after Phase 10)
Audit log · offline image-overlay map · CSV export · voice input.

## Malayalam labels (to be checked by a native speaker)

| Key | en | ml |
|---|---|---|
| food | Food | ഭക്ഷണം |
| water | Drinking water | കുടിവെള്ളം |
| medical | Medical help | വൈദ്യസഹായം |
| rescue | Rescue / boat | രക്ഷാപ്രവർത്തനം / ബോട്ട് |
| shelter | Shelter | അഭയം |
| children | Children present | കുട്ടികൾ ഉണ്ട് |
| elderly | Elderly or sick | പ്രായമായവർ / രോഗികൾ |
| urgent | Urgent | അടിയന്തരം |
| people | Number of people | ആളുകളുടെ എണ്ണം |
| submit | Submit | അയയ്ക്കുക |
| savedOnPhone | Saved on phone | ഫോണിൽ സേവ് ചെയ്തു |
| sentToHub | Sent to hub | ഹബ്ബിലേക്ക് അയച്ചു |

## Using coding agents

One phase per session. Prompt:

```
Read AGENTS.md, docs/DECISIONS.md, docs/CONTRACT.md and docs/PLAN.md.
Implement Phase <N> only. When done, list changed files, commands to run,
and the manual gate steps. Do not start the next phase.
```

Owners (suggested): hub = Phases 2, 3, 7 · phone = 4, 5 · dashboard = 6. Everyone works against CONTRACT.md, so the dashboard and phone app can use mock data until Phase 2 is done.
