# Relief Mesh

A local relief hub for flood response in Kochi. Volunteers report needs from their phones, and a coordinator triages them on a laptop. Everything runs over local Wi-Fi with no Internet. When the Internet returns, the hub backs up to the cloud.

Status: **Phase 1 complete** — tooling, HTTPS hub, setup server, PWA shell. No reports yet (Phase 2+).

- [docs/DECISIONS.md](docs/DECISIONS.md) — architecture and safety rules
- [docs/CONTRACT.md](docs/CONTRACT.md) — data model, API, WebSocket, storage
- [docs/PLAN.md](docs/PLAN.md) — phases and test gates
- [AGENTS.md](AGENTS.md) — rules for coding agents

## Run it

Needs Node 20+ and [mkcert](https://github.com/FiloSottile/mkcert) (`winget install FiloSottile.mkcert` / `brew install mkcert`).

```sh
npm install
cp .env.example .env        # set HUB_IP to the laptop's IP on the demo network
npm run certs               # one-time per IP; Windows shows a dialog — click Yes
npm run build
npm start
```

- Hub (phones + dashboard): `https://<HUB_IP>:3443` — dashboard at `/dashboard.html`
- Setup page for phones: `http://<HUB_IP>:8080` (download + trust the certificate, then open the hub)

`npm test` runs unit tests. `npm run dev` runs Vite (HTTP, `:5173`, hot reload) next to the hub for laptop-only development; phones must use the HTTPS build.

### Layout

```
shared/   constants (Phase 2: zod contract, urgency) — used by server and web
server/   Express HTTPS hub on :3443, HTTP setup server on :8080
web/      Vite + React PWA: index.html (volunteer), dashboard.html (coordinator)
scripts/  make-certs.ts
certs/    mkcert output (gitignored)
```
