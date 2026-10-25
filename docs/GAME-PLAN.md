# Pralayam — implementation plan

One phase per session: tests and build green, then the manual gate. (Relief Mesh, the relief tool this grew from,
was removed on 2026-10-25; the hub infrastructure it built stays. The phone app at `/` already pairs, picks a boat colour
and joins the lobby; G4 adds the order picker.)
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
- `shared/src/game/urgency.ts` — call score from the shared urgency engine + water bonus; `view(state, now)`.
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

## G4 — Phone (`/`) ✅ (17 unit tests + 30 browser checks with two phones and the screen playing a full night)
- `web/src/lib/gameDb.ts` — `gameOutbox` store + `settings.game`; `gameSync.ts` — order flush with the same
  backoff/reconnect rules as reports; `useGame.ts`.
- `web/src/play/` — `Lobby.tsx` (crew colour), `Order.tsx` (status strip, mini map, order rows, standing order,
  Send), `Result.tsx` (round card), `End.tsx`; Malayalam strings in `shared/i18n.ts`.
- The phone app at `/` (`web/src/play/`) already pairs, picks a colour and joins; G4 adds the order picker and the outbox to it.
- Tests: gameSync against a fake hub (queue, replace, duplicate on retry, late, new gameId clears the outbox);
  order picker only offers legal orders (adjacent moves, rescue only where a call is).
- e2e: three phone tabs + screen play a full game.
- **Gate:** three real phones on the hotspot finish a game; every tap target ≥ 56 px; no overflow at 320 px.
- Done: `web/src/lib/db.ts` (settings + `gameOutbox` store, IndexedDB `pralayam` v2), `web/src/lib/gameSync.ts` (health → catch-up → send due orders in batches → merge the view; replace / append seq semantics, backoff 1→30 s, reconnect makes all due, `late`/`invalid` notices, a new game id clears the outbox, hub reset or replaced token → pair again; last view restored from the phone on reload), `web/src/play/` (`orders.ts` legal orders + round estimate, `Order.tsx` strip/mini map/rows/standing order/Send + Queue-as-next, `MiniMap.tsx`, `End.tsx`, `useGame.ts`). `npm run e2e:play` pairs two phones from the QR link and plays to first light. The gate on real phones is still to run by hand.

## G5 — Works Anyway for real ✅ (hub enforces dead zones; 3 hub + 1 sync tests; `npm run e2e:deadzone` walks a phone into the bend, queues two orders, comes out, then airplane mode)
- Dead-zone UX: banner, estimated round, greyed last-known map, queued count; standing order prompt when the
  next move enters a dead zone ("you will lose signal: standing order?").
- Hub: `contact` from signal × last-heard; "no signal since R" on the screen; `standing_used` events.
- Demo script in `docs/DEMO.md` (airplane-mode round and hotspot-off round), with the exact words.
- Tests: phone offline for two rounds then reconnect → orders apply to the next two rounds, zero duplicates
  (unit with fake env + e2e with `page.setOfflineMode`).
- **Gate:** the GAME-DESIGN §5.4 demo works three times in a row on real phones.
- Done: `GameService.hasSignal` + muted pushes (`ws.ts`), `{ noSignal: true }` answers in `gameRoutes.ts`; phone `gameSync` keeps orders with a 5 s retry while quiet and polls every 5 s; the order screen's banner shows the estimated round and the last update, the map dims, a prompt before entering a dead zone offers "Set Return and go"; the big screen shows "no signal since R<n>" in the crew list and on the boat; `docs/DEMO.md` has the words. The three-times-in-a-row gate on real phones is still to run by hand.

## G6 — Polish and playtest
- **Usability pass 1 (done, from the first real playtest: "the phone player is clueless where to go, cannot see the others, takes random steps").** Whole-ward map on the phone with every call and boat, a radio suggestion with one-tap Go that queues the route, tap-a-place-to-go, "on the way" status, single moves folded away. Engine gained a `cancel` order so a new plan replaces an old route. Tests: engine cancel, sync plan, suggestion; `npm run e2e:play` covers Go and tap-to-go.
- **Pixel pass 3 (done, 2026-10-25):** craft rules from the pixel-art guides, see GAME-VISUAL §0 third pass.
- **Polish (done, 2026-10-25):** screen sound now has a rain bed that follows the speaker toggle, a rescued
  arpeggio, a flooded sweep and a one-second rain cut on a loss; the phone vibrates on send (20 ms, with a 60 ms
  tick), on the round result (30 ms, or 60-40-60 when it cost you) and when the signal drops (40-40-40);
  `prefers-reduced-motion` now stops rain, bob, blink, lightning and foam on both surfaces; both end screens say
  how the night ended ("Everyone came home." / "Nobody was lost to the water tonight." / "N were still on their
  roofs at first light.") and ask "What would you do differently next time?"; Malayalam reviewed once more
  (`കുടിവെള്ള കിറ്റ്`, four new lines). Rehearsal checklist added to DEMO.md.
- **Usability pass 2 (2026-10-25, from the second playtest):** the radio suggestion card is gone ("we already have
  the move option, use that"); the phone's controls are tap-a-place on the map and the move list. Every place name
  now shows on the phone map, white, at a size that fits between houses.
- **Desktop app (2026-10-25):** `npm run app` and a desktop/Start menu icon start the hub and open the big screen
  in its own app window; closing it stops the hub (DECISIONS D21, docs/DESKTOP.md). `npm run e2e:desktop` covers
  the lifecycle. Phones stay a web app.
- **Stars, bot baseline (2026-10-25):** the fixed Thuruthu night scores 170 with 3 bots (exactly 1★), 238 with 4,
  343 with 5; 200 random nights with 3 bots have median 34. starBase stays 170 so that humans who beat the bots
  earn 2★ at 221 and 3★ at 272. Re-tune only from real games.
- Still to do by hand: Malayalam check by a native speaker; playtest with five strangers, fix the three worst
  confusions; rehearse the 5-minute demo three times (DEMO.md checklist). Cloud upload of the final score is
  dropped: the game is offline-first and the hub no longer talks to any cloud service (DECISIONS D13).
- **Gate:** strangers finish a game with no help and say what they would do differently next time.

## Commands (once G1 lands)
`npm test` · `npm run build` · `npm run sim` · `npm run e2e:screen` · `npm run e2e:play` (G4) · `npm start`
(serves `/`, `/dashboard.html`, `/screen.html`, `/play` from one hub).

## Fallback
If G5 is not done by demo day, demo G3 (a bot night on the screen) with phones joining the lobby.
