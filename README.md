# Relief Mesh

A local relief hub for flood response in Kochi. Volunteers report needs from their phones, and a coordinator triages them on a laptop. Everything runs over local Wi-Fi with no Internet. When the Internet returns, the hub backs up to the cloud.

Status: **Phase 8 built** — the whole loop works: volunteers report (even offline), reports reach the hub on reconnect, the coordinator sees them live, assigns and closes them, the phone shows the outcome, and when the Internet is up the hub backs every change up to Supabase (verified live). The dashboard's **Export DB** button downloads the whole database as a SQLite file for a spare laptop. Left: the Phase 8 usability gate with a teammate, the Phase 9 integration run on real phones, and demo prep.

**Pralayam** (Track 3 + 4): a co-op flood-night rescue game on the same hub, where signal dead zones are real offline play. Design in `docs/GAME-*.md`. Done: rules engine (`npm run sim`), hub game service (`/api/game/*`), big screen at `https://<HUB_IP>:3443/screen.html` (coordinator passcode; open a lobby, start a bot night, skip rounds). Next: the phone play screens.

- [docs/DECISIONS.md](docs/DECISIONS.md) — architecture and safety rules
- [docs/CONTRACT.md](docs/CONTRACT.md) — data model, API, WebSocket, storage
- [docs/PLAN.md](docs/PLAN.md) — phases and test gates
- [AGENTS.md](AGENTS.md) — rules for coding agents

## Run it

Needs Node 20+ and [mkcert](https://github.com/FiloSottile/mkcert) (`winget install FiloSottile.mkcert` / `brew install mkcert`).

```sh
npm install
cp .env.example .env        # set HUB_IP to the laptop's IP, and COORDINATOR_PASSCODE to a real secret (8+ chars)
npm run certs               # one-time per IP; Windows shows a dialog — click Yes
npm run build
npm start
```

- Hub (phones + dashboard): `https://<HUB_IP>:3443` — dashboard at `/dashboard.html` (needs `COORDINATOR_PASSCODE`; the Join tab shows the QR and join code for phones)
- Setup page for phones: `http://<HUB_IP>:8080` (download + trust the certificate, then open the hub)

### Cloud backup (optional)

Create a Supabase project, run the SQL from [docs/CONTRACT.md](docs/CONTRACT.md) section 9 in its SQL editor, then put the project URL and a **secret** key (never the anon/publishable one) in `.env` as `SUPABASE_URL` and `SUPABASE_SECRET_KEY` and restart the hub. The dashboard header then shows `Offline — N waiting` / `Syncing…` / `Synced`. Without the keys it says `Cloud backup not configured` and nothing leaves the hub. `npm run check:bundle` proves no secret is in the web app.

`npm test` runs the tests (hub API + WebSocket + scoring). `npm run e2e` drives a real browser through pairing, offline reporting, reconnect delivery and live assignment, and `npm run e2e:dashboard` runs a phone window and a dashboard window together through the full assign/done loop, both against the running hub (needs Edge or Chrome; set `E2E_ORIGIN`/`E2E_DB` to point it at a second hub started with `HTTPS_PORT=3553 DATA_DIR=... node server/dist/index.js`). `npm run seed` loads 12 fictional practice reports. On start the hub prints a join code that phones need to pair. `npm run dev` runs Vite (HTTP, `:5173`, hot reload) next to the hub for laptop-only development; phones must use the HTTPS build.

### Layout

```
shared/   constants, zod contract, urgency scoring — used by server and web
server/   Express HTTPS hub on :3443, HTTP setup server on :8080
web/      Vite + React PWA: index.html (volunteer), dashboard.html (coordinator)
scripts/  make-certs.ts
certs/    mkcert output (gitignored)
```
