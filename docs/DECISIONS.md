# Relief Mesh — Phase 0 Decisions

Locked decisions for the build. Coding agents and teammates must follow these. If a later phase needs to break one, change this file first and tell the team.

Stack is unchanged: React + TypeScript + Vite + `vite-plugin-pwa` + `idb` + Leaflet on the phone/dashboard; Node 20+ + Express + `ws` + `better-sqlite3` + `zod` on the hub; Supabase as a backup only.

---

## D1. Topology: local relief hub, not a mesh

```
Volunteer PWAs ──(local Wi-Fi, no Internet)──> Laptop hub (Express + WS + SQLite) ──(when Internet returns)──> Supabase
   own IndexedDB outbox                          coordinator dashboard
```

- Star topology. No phone-to-phone traffic.
- The product name can stay "Relief Mesh", but never claim a mesh in the pitch. Say "local relief hub".
- Hard dependencies during an outage: the local Wi-Fi network and the laptop. Nothing else.

## D2. Network identity is fixed

The app origin is `https://<HUB_IP>:3443`. IndexedDB, the service worker and the installed PWA all belong to that exact origin. **If the IP changes, phones lose their queued reports and the installed app.** An IP change is a recovery event, not a routine step.

Pick one network setup, in this order of preference:

| Option | IP stability | Notes |
|---|---|---|
| A. Spare/travel router, DHCP reservation for the laptop | Fixed | Best. Router needs no Internet. |
| B. Windows Mobile Hotspot on the hub laptop | Laptop is always `192.168.137.1` | Test whether it starts with no upstream connection on *your* laptop. Max ~8 clients. |
| C. A teammate's phone hotspot | Can change | Last resort. Re-check the IP before every run. |

`HUB_IP` lives in `.env` and is baked into the certificate, the QR code and the printed URL.

## D3. HTTPS and certificates come first (Phase 1, not later)

- Service workers need a secure context. Without a trusted cert there is no offline app on the phone. Every later build gate that uses a phone depends on this.
- `mkcert` cert covering `localhost`, `127.0.0.1`, and `HUB_IP`.
- HTTP setup server on `:8080` serves only the setup page and `rootCA.pem`. Never `rootCA-key.pem` or `hub-key.pem`.
- Android Chrome trusts a user-installed CA. iPhone needs the profile installed **and** the toggle under Settings → General → About → Certificate Trust Settings.
- Tapping through the cert warning is **not** a supported path for offline use: the form works while the hub is reachable, but there is no service worker. That phone cannot be a demo phone.
- Test on the exact demo phones in the first hours.

## D4. Roles and authorization

There are still no user accounts. Two kinds of token:

**Device token (volunteers)**
1. The dashboard shows a join QR: `https://<HUB_IP>:3443/?join=<JOIN_CODE>`. The join code rotates when the coordinator presses "New code".
2. The phone calls `POST /api/pair { joinCode, deviceId, reporterName }` and receives a random 32-byte `deviceToken`, which it stores in IndexedDB. The hub stores only a SHA-256 hash.
3. Every phone request sends `Authorization: Bearer <deviceToken>`. The hub resolves the device from the token, not from a `deviceId` in the body.

**Coordinator token (dashboard)**
- `COORDINATOR_PASSCODE` in `.env`. `POST /api/dashboard/login { passcode }` returns a session token, which the dashboard keeps in `sessionStorage`.
- All `/api/dashboard/*` routes and dashboard WS subscriptions require it.

**WebSocket:** the client's first message is `{ type: "auth", token }`. The hub closes unauthenticated sockets after 5 s. Volunteer sockets receive only events for their own reports. Dashboard sockets receive everything.

## D5. Phones create; the hub decides

- **Phones only create reports. A phone never edits a report after submitting it.** This removes phone-side conflict resolution entirely. To correct a report, the volunteer submits a new one or the coordinator edits the note.
- An `id` is a UUID v4 generated on the phone. A repeated `POST` with the same `id` from the same device returns the stored row and changes nothing. The same `id` from a different device returns `409`.

Phone → hub input (`PhoneReportInput`):

```ts
{ id, needs, peopleCount, hasChildren, hasElderlyOrSick, urgent,
  note?, lat?, lng?, accuracyM?, ageMs }   // reporterName and deviceId come from the token
```

Hub-owned fields: `deviceId`, `reporterName`, `receivedAt`, `reportedAt`, `updatedAt`, `revision`, `status`, `assignee`, `baseScore`, `cloudRevision`.

Zod rejects any hub-owned field sent by a phone (`.strict()`).

## D6. Ordering uses one global revision counter

- SQLite keeps a single monotonic integer `revision`. Every insert or update takes the next value inside the same transaction.
- Sync cursor: `GET ...?after=<revision>`. Revisions are unique, so there are no ties and no lost same-millisecond updates.
- Wall-clock times are used only for display, never for ordering.

## D7. Time and urgency

**Report age without trusting phone clocks.** At send time the phone computes `ageMs = phoneNow - phoneCreatedAt`. Both values come from the same clock, so clock skew cancels out. The hub sets `reportedAt = receivedAt - clamp(ageMs, 0, 48h)`.

**Score is split, because waiting time changes every minute:**
- `baseScore` is stored and indexed. It is computed once on insert:
  - +40 medical, +35 rescue, +25 urgent, +20 children, +15 elderly/sick
  - + `min(peopleCount, 30) * 1.5`
  - +10 if needs include food or water **and** none of medical, rescue or urgent applies
- `waitBonus = min(minutesSince(reportedAt) * 0.2, 20)` is computed when sorting or rendering, using hub time.
- `score = round(baseScore + waitBonus)`. Bands: ≥80 red, 50–79 orange, <50 yellow. Done reports are grey and sorted last.

## D8. What "offline" actually guarantees

Say exactly this, and nothing stronger:

- A phone keeps **its own unsent reports** for as long as its browser data survives. The app calls `navigator.storage.persist()` and shows an unsent count on screen.
- Sync happens when the app is open or brought back to the foreground. Background sync while the app is closed is **not** promised.
- If the laptop dies, assignments and reports from other phones since the last cloud sync are lost unless the hub DB was backed up. A manual "Export DB" button on the dashboard is in scope. Automatic second-hub replication is not.
- When the hub becomes reachable (health OK, WS connect, `online` event, `visibilitychange` to visible), **all** outbox entries become due immediately and the backoff timer is reset.

## D9. The map is optional; the list is primary

- The sorted report list plus the detail panel must be fully usable without the map.
- Do not pre-seed or bulk-download standard OpenStreetMap tiles. Their usage policy forbids it. The map shows tiles only when they load, with OSM attribution, and is labelled "map needs Internet / cached tiles".
- Stretch only: a fully offline background using a single georeferenced image of the demo area (Leaflet `imageOverlay`) from a properly licensed source.

## D10. Cloud backup is visible, never silent

- Supabase is upserted from the hub only, using `SUPABASE_SECRET_KEY` (server-only, never in a `VITE_*` variable, never in the bundle).
- RLS is enabled on the Supabase table with no anon policies.
- Each row stores the `revision` that was last pushed to the cloud. Pending = rows where `revision > cloudRevision`.
- The dashboard banner always shows one of: `Cloud backup not configured` · `Offline — N waiting` · `Syncing…` · `Synced — all N backed up`.

## D11. Privacy

- Reports contain names, locations and health-related flags. Treat them as sensitive.
- All seed data is fictional and labelled as such. Seed locations come from checked Ernakulam-district places (Aluva, Paravur, Kalamassery, Fort Kochi, Eloor, Kadamakkudy). No "Kuttanad".
- Do not log request bodies, names, coordinates or notes. Log only IDs and counts.
- Rate limit: about 60 requests per minute per token/IP. Body limit 64 KB. Note max 280 characters.
- `certs/`, `.env` and `server/data/` are gitignored.

## D12. Demo wording

- Problem statement: "During the 2018 Kerala floods, phone and Internet services were disrupted in several areas, and rescue coordination suffered." Do not say "towers failed".
- Airplane-mode step: "Airplane mode on → submit → airplane mode off → reopen the app → it syncs on its own."
- "What if the laptop dies?" → "Each phone keeps its own unsent reports, and the coordinator can export the hub database; a second hub is the next step."

---

## Phase order (corrected)

| # | Phase | Must-have / stretch |
|---|---|---|
| 0 | Decisions (this file) | Must |
| 1 | Repo, tooling, **HTTPS + network + a phone loads a hello page with a green lock** | Must |
| 2 | Hub: SQLite, revision counter, pairing, coordinator login, idempotent create, role-scoped reads, WS auth | Must |
| 3 | Urgency `baseScore` + `waitBonus` with unit tests | Must |
| 4 | Volunteer PWA: pairing, form, IndexedDB, offline shell, `persist()` | Must |
| 5 | Outbox sync, reconnect flush, status updates via WS + polling fallback | Must |
| 6 | Dashboard: login, list-first UI, detail/assign/done, live updates, join QR, optional map | Must |
| 7 | Cloud backup + status banner | Must |
| 8 | Hardening: limits, error states, Retry, 48px targets, Export DB | Must |
| 9 | Integration test run on real phones (hub restart, airplane mode, cleared caches) | Must |
| 10 | Demo prep: rehearsals, backup video, spare laptop, printed URL/QR, native-speaker label check | Must |
| — | Audit log, offline image map, CSV export, voice input | Stretch |

Each phase ends with: a commit, passing tests, the manual check from its gate, and a short list of known limitations.

## Open questions for the team

1. Which network option from D2 (A, B or C)?
2. Will any iPhone be a demo phone, or Android only?
3. How many hours are left in the hackathon? If under ~20, move Phase 7 (cloud) and the Export DB button to stretch.
4. Who owns which phases? (Suggested: hub = 2, 3, 7; phone = 4, 5; dashboard = 6.)

## Game decisions (Pralayam, Track 3 + 4) — 2026-10-25

| # | Decision | Why |
|---|---|---|
| D13 | The game is a module on the same hub, repo and database as Relief Mesh. Relief Mesh code is not changed by game phases. | One demo story ("the same hub runs the tool and the game"); the tool stays a finished fallback. |
| D14 | The map is an inline SVG of a fictional ward. No map tiles, no remote URL at runtime, fonts self-hosted. | The game must be fully playable with no Internet; tiles are the one thing Relief Mesh could not promise offline. |
| D15 | Orders are the game's reports: phone → IndexedDB `gameOutbox` → `POST /api/game/orders`, idempotent by id, with per-boat `seq` queue semantics (GAME-DESIGN §5.1). | Reuses the proven exactly-once path; lets a player line up orders while out of contact. |
| D16 | Dead zones are real: a boat in one gets no updates and its phone is expected to be offline in the demo. The boat follows a standing order meanwhile. | Makes the Track 3 constraint a game mechanic instead of a failure case. |
| D17 | Round resolution is one pure, deterministic function with a seeded RNG; scenarios are JSON. | Unit-testable in milliseconds; replayable for the demo video; bots can tune the rules before any UI exists. |
| D18 | Co-operative, team score only, three stars tuned from the bot baseline. | A room of strangers should not compete; the fantasy is a ward working together. |
| D19 | One dark "monsoon night" design system for the big screen and the phone (GAME-VISUAL.md), restyled after G3 as a 2D pixel game: 16-colour palette, bitmap fonts, sprite map, stepped motion (GAME-VISUAL §0); sound is synthesized with WebAudio, no audio files. | Premium feel on a projector and an old phone with zero assets to download; the pixel look reads from 5 m and suits a "room of phones" party game. |
| D20 | Host controls live on the big screen page and use the coordinator session; crews use the device token from the Relief Mesh pairing. | No new auth; the join QR is the same one. |
