// REST endpoints of the game under /api/game (GAME-CONTRACT section 5). Crews use their device token, the host
// and the big screen the coordinator session. Identity always comes from the token, never from the body.
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { JoinRequestSchema, OrdersEnvelopeSchema } from '@pralayam/shared';
import { authOf, bearer, fail, requireRole, resolveToken } from './auth.js';
import type { HubDb } from './db.js';
import type { GameService } from './game.js';

export interface GameRoutesContext {
  db: HubDb;
  game: GameService;
  now: () => number;
}

const NewGameSchema = z.strictObject({
  roundSeconds: z.union([z.literal(30), z.literal(45), z.literal(60)]).optional(),
  bots: z.boolean().optional(),
});

export function createGameRoutes(ctx: GameRoutesContext): Router {
  const { db, game, now } = ctx;
  const r = Router();
  const crew = requireRole(db, 'device', now);
  const host = requireRole(db, 'coordinator', now);
  const anyone: RequestHandler = (req, res, next) => {
    const token = bearer(req);
    const auth = token ? resolveToken(db, token, now()) : null;
    if (!auth) return fail(res, 401, 'unauthorized', 'Missing or invalid token');
    res.locals.auth = auth;
    next();
  };

  // ---------- crew ----------

  r.post('/join', crew, (req, res) => {
    const body = JoinRequestSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_body', body.error.issues[0]?.message ?? 'Invalid request');
    const auth = authOf(res);
    if (auth.role !== 'device') return;
    const out = game.join(auth.deviceId, auth.reporterName, body.data.color);
    if ('error' in out) {
      return out.error === 'no_game' ? fail(res, 404, 'no_game', 'No game is open') : fail(res, 409, 'game_over', 'The night is over');
    }
    res.json({ view: out.view });
  });

  r.post('/orders', crew, (req, res) => {
    const env = OrdersEnvelopeSchema.safeParse(req.body);
    if (!env.success) return fail(res, 400, 'invalid_body', env.error.issues[0]?.message ?? 'Invalid request');
    const auth = authOf(res);
    if (auth.role !== 'device') return;
    if (!game.hasSignal(auth.deviceId)) return res.json({ noSignal: true }); // the orders stay in the phone's outbox
    const out = game.orders(auth.deviceId, env.data.orders);
    if ('error' in out) return fail(res, 404, 'no_game', 'No game is open');
    res.json(out);
  });

  // ---------- everyone with a token ----------

  r.get('/state', anyone, (req, res) => {
    const auth = authOf(res);
    const you = auth.role === 'device' ? auth.deviceId : undefined;
    if (you && !game.hasSignal(you)) return res.json({ noSignal: true }); // no news reaches the bend
    if (you) game.heard(you);
    const view = game.view(you);
    if (!view) return fail(res, 404, 'no_game', 'No game is open');
    const after = Number(req.query.after);
    if (Number.isInteger(after) && after >= view.revision) {
      return res.json({ unchanged: true, revision: view.revision, serverTime: view.serverTime });
    }
    res.json({ view });
  });

  // ---------- host ----------

  r.post('/new', host, (req, res) => {
    const body = NewGameSchema.safeParse(req.body ?? {});
    if (!body.success) return fail(res, 400, 'invalid_body', body.error.issues[0]?.message ?? 'Invalid request');
    res.json({ view: game.newGame(body.data) });
  });
  const hostAction = (fn: () => ReturnType<GameService['view']>): RequestHandler => (_req, res) => {
    const view = fn();
    if (!view) return fail(res, 404, 'no_game', 'No game is open');
    res.json({ view });
  };
  r.post('/start', host, hostAction(() => game.start()));
  r.post('/pause', host, hostAction(() => game.pause()));
  r.post('/resume', host, hostAction(() => game.resume()));
  r.post('/skip', host, hostAction(() => game.skip()));
  r.post('/end', host, hostAction(() => game.end()));

  r.get('/replay', host, (_req, res) => {
    const state = game.current();
    if (!state) return fail(res, 404, 'no_game', 'No game is open');
    res.json({ state, revision: game.revision });
  });

  return r;
}
