// Public and host endpoints: pairing (phones), host login, the join QR and its rotation. Game endpoints live in
// gameRoutes.ts. Identity always comes from the bearer token, never from the body.
import { Router, type Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { LoginRequestSchema, PairRequestSchema, type JoinInfo } from '@pralayam/shared';
import { SESSION_TTL_MS, fail, hashToken, keyByIp, newToken, rateLimit, requireRole, safeEqual } from './auth.js';
import type { HubDb } from './db.js';
import type { Events } from './ws.js';

export interface RoutesContext {
  db: HubDb;
  events: Events;
  coordinatorPasscode: string;
  /** Public base URL phones use, e.g. https://192.168.137.1:3443 */
  baseUrl: string;
  now: () => number;
  authRateLimitPerMin: number;
}

function parseOrFail<T extends z.ZodType>(schema: T, body: unknown, res: Response): z.infer<T> | undefined {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue?.path.length ? issue.path.join('.') + ': ' : '';
  fail(res, 400, 'invalid_body', where + (issue?.message ?? 'Invalid request'));
  return undefined;
}

export function createRoutes(ctx: RoutesContext): Router {
  const { db, events, now } = ctx;
  const r = Router();
  const host = requireRole(db, 'coordinator', now);
  // Pairing and login are the only guessable secrets, so they get a much tighter per-IP limit.
  const authLimit = rateLimit(ctx.authRateLimitPerMin, 60_000, keyByIp);

  r.post('/pair', authLimit, (req, res) => {
    const body = parseOrFail(PairRequestSchema, req.body, res);
    if (!body) return;
    if (!safeEqual(body.joinCode.toUpperCase(), db.joinCode)) {
      return fail(res, 403, 'bad_join_code', 'That join code is not valid');
    }
    const deviceToken = newToken();
    db.upsertDevice(body.deviceId, body.reporterName, hashToken(deviceToken), now());
    events.deviceRevoked(body.deviceId);
    res.json({ deviceToken, deviceId: body.deviceId, reporterName: body.reporterName, hubId: db.hubId });
  });

  r.post('/host/login', authLimit, (req, res) => {
    const body = parseOrFail(LoginRequestSchema, req.body, res);
    if (!body) return;
    if (!safeEqual(body.passcode, ctx.coordinatorPasscode)) {
      return fail(res, 401, 'unauthorized', 'Wrong passcode');
    }
    const sessionToken = newToken();
    db.createSession(hashToken(sessionToken), now() + SESSION_TTL_MS, now());
    res.json({ sessionToken });
  });

  const joinBody = async (): Promise<JoinInfo> => {
    const joinUrl = `${ctx.baseUrl}/?join=${db.joinCode}`;
    return { joinUrl, joinCode: db.joinCode, qrDataUrl: await QRCode.toDataURL(joinUrl, { margin: 1, width: 360 }) };
  };
  r.get('/host/join', host, (_req, res, next) => {
    joinBody().then((b) => res.json(b), next);
  });
  r.post('/host/join/rotate', host, (_req, res, next) => {
    db.rotateJoinCode();
    joinBody().then((b) => res.json(b), next);
  });

  return r;
}
