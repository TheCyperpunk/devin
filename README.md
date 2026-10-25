# Pralayam (പ്രളയം)

A co-op flood-night rescue game for everyone in the room: the laptop projects a pixel-art ward, every phone becomes a
boat, and the signal dead zones on the map are real: your phone really loses the hub there and your orders queue until
you are back in range. Built for Devin Hacks Kochi, tracks 3 ("Works Anyway") and 4 ("Make Room for Play"). No Internet
is needed at any point: a local hub on the laptop runs the whole night over Wi-Fi or a hotspot.

- [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md) — the rules
- [docs/GAME-CONTRACT.md](docs/GAME-CONTRACT.md) — data, endpoints, WebSocket, phone storage
- [docs/GAME-VISUAL.md](docs/GAME-VISUAL.md) — the pixel design system
- [docs/GAME-PLAN.md](docs/GAME-PLAN.md) — phases and gates
- [docs/DECISIONS.md](docs/DECISIONS.md) — architecture and safety rules
- [docs/DESKTOP.md](docs/DESKTOP.md) — the laptop as a desktop app: one icon starts the hub and opens the big screen
- [AGENTS.md](AGENTS.md) — rules for coding agents

## Status

Done: rules engine with bots and a simulator (`npm run sim`), the hub game service (`/api/game/*`), the big screen
(`/screen.html`), and the phone's pairing, boat colour and lobby. Next: the phone's order picker through the outbox
(G4), real dead-zone play (G5), polish and playtests (G6).

## Run it

Needs Node 20+ and [mkcert](https://github.com/FiloSottile/mkcert) (`winget install FiloSottile.mkcert` /
`brew install mkcert`).

```
npm install
copy .env.example .env        # set HUB_IP to the laptop's fixed IP and a COORDINATOR_PASSCODE of 8+ characters
npm run certs                 # mkcert root CA + hub certificate for HUB_IP (service workers need HTTPS)
npm run build
npm start
```

- Big screen: `https://<HUB_IP>:3443/screen.html` on the laptop, host passcode from `.env`. Open the lobby, Start.
- Phones: join the same Wi-Fi, open `http://<HUB_IP>:8080` once to trust the hub certificate, then scan the QR on the
  big screen (or open `https://<HUB_IP>:3443` and type the join code). Add to the home screen.
- Watch bots play a night in the terminal: `npm run sim` (or `npm run sim 5` for five boats).

## Develop

```
npm test                 # unit tests across shared, server and web
npm run typecheck
npm run e2e:screen       # real-browser run of the big screen against a running hub (E2E_ORIGIN for a second hub)
npm run check:bundle     # proves the passcode is not in the web bundle
```

Never commit `certs/`, `.env` or `server/data/`.
