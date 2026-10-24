# Rules for coding agents

Read before any task: `docs/DECISIONS.md`, `docs/CONTRACT.md`, `docs/PLAN.md`.

- Implement one phase from `docs/PLAN.md` per session. Do not start the next phase.
- Offline-first: every feature must work with no Internet. The web app never calls an external URL. Only the hub talks to Supabase.
- Stack is fixed (DECISIONS.md). Do not add frameworks, services or UI libraries without updating DECISIONS.md first.
- Data shapes, endpoints, error codes and WS messages must match `docs/CONTRACT.md` (later `shared/contract.ts`). If a change is needed, update the contract in the same change.
- The hub owns `status`, `assignee`, `revision`, timestamps and `baseScore`. Phone input schemas are `.strict()`.
- Order by `revision`, never by wall-clock time. Merge incoming reports only if their `revision` is higher.
- Phone writes go through the IndexedDB outbox. Never POST from a button handler.
- Identity comes from the bearer token, never from IDs in the request body.
- Never log request bodies, names, coordinates or notes. Never put secrets in `VITE_*` variables or the web bundle.
- Never commit `certs/`, `.env`, or `server/data/`.
- TypeScript strict. Keep files small, with one short comment at the top of each file saying what it does.
- After each task, run `npm test` and `npm run build`, then report: files changed, commands to run, and the manual gate steps.

## Game (Pralayam) tasks
Read `docs/GAME-DESIGN.md`, `docs/GAME-CONTRACT.md`, `docs/GAME-VISUAL.md`, `docs/GAME-PLAN.md` too. Implement one G-phase per
session. Never change Relief Mesh behaviour in a game phase. Game logic goes in `shared/src/game/` as pure functions
with tests; the hub and the pages only call them. Orders go through the outbox like reports. No remote URL at runtime.
