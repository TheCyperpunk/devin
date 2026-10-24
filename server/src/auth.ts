// Tokens, bearer-auth middleware, error helper and in-memory rate limiting (D4, CONTRACT sections 3-4).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiErrorBody, ErrorCode } from '@pralayam/shared';
import type { HubDb } from './db.js';

export type Auth =
  | { role: 'device'; deviceId: string; reporterName: string; tokenHash: string }
  | { role: 'coordinator'; tokenHash: string };

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');

/** Constant-time string comparison (hash first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function resolveToken(db: HubDb, token: string, now: number): Auth | null {
  const tokenHash = hashToken(token);
  const device = db.deviceByTokenHash(tokenHash);
  if (device) return { role: 'device', ...device, tokenHash };
  if (db.sessionValid(tokenHash, now)) return { role: 'coordinator', tokenHash };
  return null;
}

export function fail(res: Response, status: number, code: ErrorCode, message: string): void {
  const body: ApiErrorBody = { error: { code, message } };
  res.status(status).json(body);
}

export function bearer(req: Request): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(req.header('authorization') ?? '');
  return m ? (m[1] as string) : null;
}

export function authOf(res: Response): Auth {
  return res.locals.auth as Auth;
}

/** 401 for a missing/unknown token, 403 for a valid token of the wrong role. */
export function requireRole(db: HubDb, role: Auth['role'], now: () => number): RequestHandler {
  return (req, res, next) => {
    const token = bearer(req);
    const auth = token ? resolveToken(db, token, now()) : null;
    if (!auth) return fail(res, 401, 'unauthorized', 'Missing or invalid token');
    if (auth.role !== role) return fail(res, 403, 'forbidden', 'This token cannot use this endpoint');
    res.locals.auth = auth;
    next();
  };
}

/** Fixed-window limiter. Key defaults to the caller's token (so one busy phone cannot starve others), else IP. */
export function rateLimit(max: number, windowMs: number, keyOf: (req: Request) => string): RequestHandler {
  const hits = new Map<string, { n: number; resetAt: number }>();
  const sweep = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
  }, windowMs);
  sweep.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const t = Date.now();
    const key = keyOf(req);
    let h = hits.get(key);
    if (!h || h.resetAt <= t) {
      h = { n: 0, resetAt: t + windowMs };
      hits.set(key, h);
    }
    h.n += 1;
    if (h.n > max) {
      res.setHeader('Retry-After', String(Math.ceil((h.resetAt - t) / 1000)));
      return fail(res, 429, 'rate_limited', 'Too many requests, slow down');
    }
    next();
  };
}

export const keyByTokenOrIp = (req: Request): string => {
  const t = bearer(req);
  return t ? 't:' + hashToken(t).slice(0, 16) : 'ip:' + (req.ip ?? 'unknown');
};
export const keyByIp = (req: Request): string => 'ip:' + (req.ip ?? 'unknown');
