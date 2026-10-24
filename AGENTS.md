# Rules for coding agents

Read before any task: `docs/GAME-DESIGN.md`, `docs/GAME-CONTRACT.md`, `docs/GAME-VISUAL.md`, `docs/GAME-PLAN.md`,
`docs/DECISIONS.md`.

- Implement one G-phase from `docs/GAME-PLAN.md` per session. Do not start the next phase.
- Offline-first: everything must work with no Internet. The web app never calls an external URL at runtime; fonts and
  all assets are bundled.
- Stack is fixed (DECISIONS.md): React + TypeScript + Vite + vite-plugin-pwa + idb on the web; Node 20 + Express + ws +
  better-sqlite3 + zod on the hub. No new frameworks, services or UI libraries without updating DECISIONS.md first.
- Game logic lives in `shared/src/game/` as pure functions with tests; the hub and the pages only call them. Round
  resolution is deterministic; orders are strict zod schemas; the hub owns every derived field.
- Phone writes go through the IndexedDB outbox (G4). Never POST from a button handler. Orders are idempotent by id.
- Identity comes from the bearer token, never from IDs in the request body.
- The look is the pixel edition (GAME-VISUAL §0): 16-colour palette, Press Start 2P + Pixelify Sans, sprites from
  `web/src/screen/sprites.ts`, square boxes with hard shadows, `steps()` motion. No gradients, blur, rounded corners
  or eased animation in the game.
- Never log request bodies or names. Never put secrets in `VITE_*` variables or the web bundle.
- Never commit `certs/`, `.env`, or `server/data/`.
- TypeScript strict. Keep files small, with one short comment at the top of each file saying what it does.
- After each task, run `npm test` and `npm run build`, then report: files changed, commands to run, and the manual
  gate steps.
