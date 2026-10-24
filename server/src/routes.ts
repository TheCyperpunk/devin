// REST endpoints (CONTRACT section 5). Identity always comes from the bearer token, never from the body.
import { Router, type Request, type Response } from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  LIMITS,
  BatchEnvelopeSchema,
  LoginRequestSchema,
  PairRequestSchema,
  PatchReportSchema,
  PhoneReportInputSchema,
  type BatchItemResult,
  type CloudStatus,
} from '@relief-mesh/shared';
import {
  SESSION_TTL_MS,
  authOf,
  fail,
  hashToken,
  keyByIp,
  newToken,
  rateLimit,
  requireRole,
  safeEqual,
} from './auth.js';
import type { HubDb } from './db.js';
import type { Events } from './ws.js';

export interface RoutesContext {
  db: HubDb;
  events: Events;
  coordinatorPasscode: string;
  /** Public base URL phones use, e.g. https://192.168.137.1:3443 */
  baseUrl: string;
  now: () => number;
  cloudStatus: () => CloudStatus;
  authRateLimitPerMin: number;
}

const PAGE = 500;

function parseOrFail<T extends z.ZodType>(schema: T, body: unknown, res: Response): z.infer<T> | undefined {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue?.path.length ? issue.path.join('.') + ': ' : '';
  fail(res, 400, 'invalid_body', where + (issue?.message ?? 'Invalid request'));
  return undefined;
}

function afterParam(req: Request): number {
  const n = Number(req.query.after);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function createRoutes(ctx: RoutesContext): Router {
  const { db, events, now } = ctx;
  const r = Router();
  const device = requireRole(db, 'device', now);
  const coordinator = requireRole(db, 'coordinator', now);
  // Pairing and login are the only guessable secrets, so they get a much tighter per-IP limit.
  const authLimit = rateLimit(ctx.authRateLimitPerMin, 60_000, keyByIp);

  // ---------- public ----------

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

  r.post('/dashboard/login', authLimit, (req, res) => {
    const body = parseOrFail(LoginRequestSchema, req.body, res);
    if (!body) return;
    if (!safeEqual(body.passcode, ctx.coordinatorPasscode)) {
      return fail(res, 401, 'unauthorized', 'Wrong passcode');
    }
    const sessionToken = newToken();
    db.createSession(hashToken(sessionToken), now() + SESSION_TTL_MS, now());
    res.json({ sessionToken });
  });

  // ---------- device ----------

  r.post('/reports', device, (req, res) => {
    const input = parseOrFail(PhoneReportInputSchema, req.body, res);
    if (!input) return;
    const auth = authOf(res);
    if (auth.role !== 'device') return;
    const out = db.submit(auth, input, now());
    if (out.result === 'conflict') return fail(res, 409, 'conflict', 'That report id belongs to another device');
    if (out.result === 'created') events.reportUpserted(out.report);
    res.status(out.result === 'created' ? 201 : 200).json({ report: out.report });
  });

  r.post('/reports/batch', device, (req, res) => {
    const env = parseOrFail(BatchEnvelopeSchema, req.body, res);
    if (!env) return;
    if (env.reports.length > LIMITS.batchMax) {
      return fail(res, 413, 'too_large', `At most ${LIMITS.batchMax} reports per batch`);
    }
    const auth = authOf(res);
    if (auth.role !== 'device') return;

    // Each item stands alone: one invalid report never blocks the rest of a phone's outbox.
    const results: BatchItemResult[] = env.reports.map((raw): BatchItemResult => {
      const id = typeof (raw as { id?: unknown } | null)?.id === 'string' ? (raw as { id: string }).id : '';
      const parsed = PhoneReportInputSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.length ? issue.path.join('.') + ': ' : '';
        return { id, result: 'invalid', message: where + (issue?.message ?? 'Invalid report') };
      }
      const out = db.submit(auth, parsed.data, now());
      if (out.result === 'conflict') return { id: parsed.data.id, result: 'conflict', message: 'id belongs to another device' };
      if (out.result === 'created') events.reportUpserted(out.report);
      return { id: parsed.data.id, result: out.result, report: out.report };
    });
    res.json({ results });
  });

  r.get('/my-reports', device, (req, res) => {
    const auth = authOf(res);
    if (auth.role !== 'device') return;
    const after = afterParam(req);
    const page = db.reportsAfter(after, PAGE, auth.deviceId);
    res.json(listBody(page, after, now()));
  });

  // ---------- coordinator ----------

  r.get('/dashboard/reports', coordinator, (req, res) => {
    const after = afterParam(req);
    res.json(listBody(db.reportsAfter(after, PAGE), after, now()));
  });

  r.patch('/dashboard/reports/:id', coordinator, (req, res) => {
    const body = parseOrFail(PatchReportSchema, req.body, res);
    if (!body) return;
    const out = db.patch(String(req.params.id), body, now());
    if (!out.ok) {
      return out.reason === 'not_found'
        ? fail(res, 404, 'not_found', 'No such report')
        : fail(res, 400, 'invalid_body', out.message ?? 'Invalid change');
    }
    if (out.changed) events.reportUpserted(out.report);
    res.json({ report: out.report });
  });

  r.get('/dashboard/stats', coordinator, (_req, res) => {
    res.json({ ...db.stats(), cloud: ctx.cloudStatus() });
  });

  const joinBody = async () => {
    const joinUrl = `${ctx.baseUrl}/?join=${db.joinCode}`;
    return { joinUrl, joinCode: db.joinCode, qrDataUrl: await QRCode.toDataURL(joinUrl, { margin: 1, width: 360 }) };
  };
  r.get('/dashboard/join', coordinator, (_req, res, next) => {
    joinBody().then((b) => res.json(b), next);
  });
  r.post('/dashboard/join/rotate', coordinator, (_req, res, next) => {
    db.rotateJoinCode();
    joinBody().then((b) => res.json(b), next);
  });

  // The whole database as a file (Phase 8): a snapshot via SQLite's backup API, written to a temp dir and
  // deleted once sent. Lets a coordinator move to a spare laptop or keep a copy with no Internet at all.
  r.get('/dashboard/export', coordinator, (_req, res, next) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'relief-export-'));
    const file = path.join(dir, 'hub.db');
    const cleanup = () => rmSync(dir, { recursive: true, force: true });
    db.backupTo(file).then(
      () => {
        res.type('application/octet-stream');
        res.download(file, `relief-hub-${stamp(now())}.db`, { cacheControl: false }, cleanup);
      },
      (err: unknown) => {
        cleanup();
        next(err);
      },
    );
  });

  return r;
}

/** Local time as YYYYMMDD-HHMM for the export filename. */
function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function listBody(page: { reports: { revision: number }[]; hasMore: boolean }, after: number, serverTime: number) {
  const last = page.reports[page.reports.length - 1];
  return { ...page, maxRevision: last ? last.revision : after, serverTime };
}
