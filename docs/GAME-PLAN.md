# Pralayam — implementation plan

One phase per session, same discipline as `PLAN.md`: tests and build green, then the manual gate. Relief Mesh
(Phases 0–8) is untouched by every phase here; the game is added beside it on the same hub.
Design: `GAME-DESIGN.md` (rules), `GAME-CONTRACT.md` (data), `GAME-VISUAL.md` (look).
Visual mock: open `docs/design/pralayam-mock.html` in a browser (big screen round + end, three phone screens), or the
design canvas at https://claude.ai/artifact/Aa7Qrj4PnwupwLE5RwQBSx (six artboards: lobby, round, first light, phone order,
phone no-signal, phone result; private until shared from its Share menu).

## G0 — Design freeze ✅ (this commit)
- Rules, contract, visual system, mock, this plan. Decisions D13–D20 added to `DECISIONS.md`.
- **Gate:** the team reads `GAME-DESIGN.md` and can explain one round out loud without the doc.

## G1 — Rules engine (pure, no I/O) ✅ (33 tests; three bots play Thuruthu in 4 ms; rules tuned, see GAME-DESIGN §4-6)
- `shared/src/game/contract.ts` — zod schemas for `Scenario`, `Order`, `OrdersEnvelope` (strict), types for
  `GameState`, `GameView`, `GameEvent`.
- `shared/src/game/scenarios/thuruthu.json` + `scenario.ts` (load, validate, shortest paths, adjacency).
- `shared/src/game/state.ts` — `newGame(scenario, opts)`, `joinBoat`, `queueOrder` (seq/replace/duplicate/late),
  `addBots`.
- `shared/src/game/resolve.ts` — `resolveRound(state, rng)` exactly as GAME-DESIGN §4, returns `{ state, events }`.
- `shared/src/game/urgency.ts` — call score from the Relief Mesh engine + water bonus; `view(state, now)`.
- `shared/src/game/bots.ts` — greedy bot: nearest highest-urgency call, rescue, return when full.
- `shared/src/game/rng.ts` — seeded xorshift so games replay exactly.
- `scripts/sim.ts` — `npm run sim -- --bots 3 --seed 7` plays a full game in < 50 ms and prints the round log,
  score and star thresholds; `--games 200` prints the score distribution (used to tune rules and stars).
- Tests (≥ 40): every edge case in GAME-DESIGN §8, scoring table, queue semantics, determinism (same seed → same
  history), bots finish with a sane score, 200 games never throw.
- **Gate:** `npm run sim` output reads like a believable night; stars set from the bot baseline.
- Done: files as listed (the scenario is `thuruthu.ts`, not JSON). Tuning from the simulator: people board on arrival, shelters count for unloading, roof countdown 3, lost −15, four houses raised out of the first flood, 34 people. Bots: 3 → 170 (23 saved, 8 lost), 4 → 238, 5 → 343 (31 saved); 200 random nights with 3 bots: median 34, 47% saved. `starBase = 170`.

## G2 — Hub ✅ (10 HTTP/WS tests with fake timers: rounds, early resolve, out-of-contact catch-up, restart mid-round, host controls)
- `server/src/db.ts` — table `game (id, state_json, updated_at)` + meta `game_revision`; `saveGame`, `loadGame`.
- `server/src/game.ts` — `GameService`: holds the live state, round timer (`deadlineAt`), early resolve, applies
  orders, bumps revision, broadcasts; everything persisted after each change so a hub restart resumes mid-game.
- `server/src/gameRoutes.ts` — `/api/game/*` per GAME-CONTRACT §5 (crew via device token, host via session).
- `server/src/ws.ts` — `game:state`, `game:round`, `game:you` messages.
- Tests: two fake crews + bots play three rounds over HTTP with fake timers; offline crew's late orders apply in
  sequence; duplicate order ids are no-ops; restart mid-game resumes with the same revision; host controls.
- **Gate:** `curl` a whole round from two terminals; the hub log shows `[game] round N resolved`.
- Done: `game` table + `game_revision` meta in `db.ts`; `GameService` (`game.ts`) owns the one current game, persists after every change, arms the round timer from `deadlineAt`, resolves overdue rounds on boot, resolves early once every crew in contact has ordered and 10 s have passed, keeps heartbeats out of the revision; `gameRoutes.ts` serves GAME-CONTRACT §5; `ws.ts` pushes `game:state`, `game:round`, `game:you`. The `resolving` phase is not used by the hub: screens animate `game:round` on their own.

## G3 — Big screen (`/screen.html`) ✅ (8 store tests + 25 browser checks: lobby, bot night to first light, pause/resume, no request leaves the hub)
- `web/src/game/theme.css` (tokens from GAME-VISUAL), `web/public/fonts/` via `scripts/fetch-fonts.mjs`
  (dev-time only; the page never loads a remote URL).
- `web/src/screen/` — `App.tsx` (lobby / playing / resolving / end), `Map.tsx` (SVG map, water clip, rain,
  boats with `offset-path` moves, call rings, dead zones), `Panel.tsx` (calls, crews, water), `Bars.tsx`,
  `EndScreen.tsx`, `Host.tsx` (new/start/skip/pause/end), `Sound.ts` (WebAudio, muted by default).
- Store: `screenStore.ts` mirrors the dashboard store (session, socket + catch-up by revision, animation queue
  that plays `game:round` events before applying the next view).
- Tests: store merge-by-revision, event queue ordering, `Map` geometry helpers.
- e2e: `scripts/e2e-screen.mjs` runs a bot-only game on a throwaway hub and screenshots lobby, a round, the end.
- **Gate:** a bot-only game is watchable on the projector from 5 m; nothing in the network tab leaves the hub.
- Done: `web/src/game/theme.css` (tokens shared with the phone), fonts bundled from `@fontsource` (Fraunces, Manrope, Noto Sans Malayalam; no `npm run fonts` needed), `web/src/screen/*` (store mirroring the dashboard store, SVG map with CSS-transitioned boat moves and a flood band that climbs with the water, side panel, bars with host controls and the join QR, lobby and first-light overlays, toasts, synthesized sound off by default). `npm run e2e:screen` plays a bot night in a real browser and asserts no external request. The host session is the dashboard's session key, so one passcode covers both pages. Restyled the same day as a 2D pixel game (GAME-VISUAL §0): sprites in `web/src/screen/sprites.ts`, Press Start 2P + Pixelify Sans, NES boxes, stepped motion, scanlines.

## G4 — Phone (`/play`)
- `web/src/lib/gameDb.ts` — `gameOutbox` store + `settings.game`; `gameSync.ts` — order flush with the same
  backoff/reconnect rules as reports; `useGame.ts`.
- `web/src/play/` — `Lobby.tsx` (crew colour), `Order.tsx` (status strip, mini map, order rows, standing order,
  Send), `Result.tsx` (round card), `End.tsx`; Malayalam strings in `shared/i18n.ts`.
- Reuses the Pair screen: an unpaired phone opening `/play` goes through the same join code.
- Tests: gameSync against a fake hub (queue, replace, duplicate on retry, late, new gameId clears the outbox);
  order picker only offers legal orders (adjacent moves, rescue only where a call is).
- e2e: three phone tabs + screen play a full game.
- **Gate:** three real phones on the hotspot finish a game; every tap target ≥ 56 px; no overflow at 320 px.

## G5 — Works Anyway for real
- Dead-zone UX: banner, estimated round, greyed last-known map, queued count; standing order prompt when the
  next move enters a dead zone ("you will lose signal: standing order?").
- Hub: `contact` from signal × last-heard; "no signal since R" on the screen; `standing_used` events.
- Demo script in `docs/DEMO.md` (airplane-mode round and hotspot-off round), with the exact words.
- Tests: phone offline for two rounds then reconnect → orders apply to the next two rounds, zero duplicates
  (unit with fake env + e2e with `page.setOfflineMode`).
- **Gate:** the GAME-DESIGN §5.4 demo works three times in a row on real phones.

## G6 — Polish and playtest
- Sound on the screen, haptics on the phone, rain and reduced-motion, end-screen lines, Malayalam check by a
  native speaker, optional cloud upload of the final score (`scores` table, same backup pattern).
- Playtest with five strangers; fix the three worst confusions; re-tune stars from real games.
- Rehearse the full 5-minute demo three times with the Relief Mesh switch at the end.
- **Gate:** strangers finish a game with no help and say what they would do differently next time.

## Commands (once G1 lands)
`npm test` · `npm run build` · `npm run sim` · `npm run e2e:screen` · `npm run e2e:play` (G4) · `npm start`
(serves `/`, `/dashboard.html`, `/screen.html`, `/play` from one hub).

## Fallback
If G5 is not done by demo day, demo G3 (bot game on the screen) + Relief Mesh. If G3 is not done, demo Relief
Mesh alone: it is complete.
