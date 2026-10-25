# Decisions

Pralayam grew out of "Relief Mesh", an offline relief-coordination hub built first for the same hackathon. On
2026-10-25 the team removed the relief tool entirely (git history keeps it) and kept the hub infrastructure the game
needs. These are the decisions that still stand.

## Infrastructure

| # | Decision | Why |
|---|---|---|
| D1 | Star topology: phones talk to one hub laptop over local Wi-Fi or a hotspot. Not a mesh. | Reliable, demoable, no Internet needed. |
| D2 | The hub has a fixed IP (Windows hotspot 192.168.137.1, or a router DHCP reservation). The origin `https://<IP>:3443` must not change: IndexedDB and the installed app are tied to it. | A changed IP breaks every paired phone. |
| D3 | HTTPS with an mkcert certificate; phones trust the root CA once from the setup page on port 8080. | Service workers and installability need a secure context. |
| D4 | Auth: device token via join code (`POST /api/pair`), host session via passcode (`POST /api/host/login`). SHA-256 hashes stored, bearer tokens, WebSocket handshake with close 4001, per-IP limits on pair/login. | Good enough for a room, nothing to leak. |
| D5 | Phone inputs are strict zod schemas; the hub owns every derived field and the revision counter. | Phones can be stale, offline or malicious; the hub never trusts them. |
| D6 | Secrets stay on the hub; the web bundle is checked for them (`npm run check:bundle`). | A secret in a static bundle is public. |
| D7 | Never log request bodies or names. | Privacy by default. |
| D8 | No remote URL at runtime: fonts, icons, map and sounds are bundled or synthesized. | "Works anyway." |

## Game

| # | Decision | Why |
|---|---|---|
| D13 | The game runs on the same hub, repo and database that paired the phones; one `/screen.html` on the laptop, one phone app at `/`. | One thing to run on demo day. |
| D14 | The map is an inline SVG of a fictional ward drawn from sprites. No map tiles. | Fully playable offline; a pixel map reads from 5 m. |
| D15 | Orders are the phone's writes: IndexedDB outbox → `POST /api/game/orders`, idempotent by id, per-boat `seq` queue semantics (GAME-DESIGN §5.1). | Exactly-once delivery; a player can line up orders while out of contact. |
| D16 | Dead zones are real: a boat in one gets no updates and its phone is expected to be offline in the demo. The boat follows a standing order meanwhile. | Makes the "works anyway" constraint a game mechanic. |
| D17 | Round resolution is one pure, deterministic function with a seeded RNG; scenarios are data. | Testable in milliseconds, replayable, tunable with bots. |
| D18 | Co-operative, team score only, stars from the bot baseline (`npm run sim`). | A room of strangers should not compete. |
| D19 | One pixel design system for the big screen and the phone (GAME-VISUAL §0): 16 colours, bitmap fonts, sprite map, stepped motion; sound synthesized with WebAudio. | Premium retro feel with zero assets to download. |
| D20 | Host controls live on the big screen page and use the host session; crews use the device token from pairing. | No new auth; the join QR is the same one. |
| D21 | The desktop app is a launcher script (`npm run app`, a Windows shortcut from `npm run app:shortcut`): it starts or reuses the hub and opens `/screen.html` in an Edge/Chrome app window with its own profile, trusting the hub certificate by SPKI fingerprint; closing the window stops a hub it started. No Electron, no new dependency. Phones stay a web app (PWA); there is no native mobile app. | Looks and starts like a program on the demo laptop without a second runtime, a native module rebuild, or app stores. See DESKTOP.md. |
