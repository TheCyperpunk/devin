# Relief Mesh

A local relief hub for flood response in Kochi. Volunteers report needs from their phones, and a coordinator triages them on a laptop. Everything runs over local Wi-Fi with no Internet. When the Internet returns, the hub backs up to the cloud.

Status: **Phase 3 complete** — hub core (SQLite, pairing, login, reports API, WebSocket) and urgency scoring. Phone and dashboard screens come in Phases 4–6.

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

- Hub (phones + dashboard): `https://<HUB_IP>:3443` — dashboard at `/dashboard.html`
- Setup page for phones: `http://<HUB_IP>:8080` (download + trust the certificate, then open the hub)

`npm test` runs the tests (hub API + WebSocket + scoring). `npm run seed` loads 12 fictional practice reports. On start the hub prints a join code that phones need to pair. `npm run dev` runs Vite (HTTP, `:5173`, hot reload) next to the hub for laptop-only development; phones must use the HTTPS build.

### Layout

```
shared/   constants, zod contract, urgency scoring — used by server and web
server/   Express HTTPS hub on :3443, HTTP setup server on :8080
web/      Vite + React PWA: index.html (volunteer), dashboard.html (coordinator)
scripts/  make-certs.ts
certs/    mkcert output (gitignored)
```
