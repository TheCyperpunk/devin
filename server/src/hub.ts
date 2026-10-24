// Builds the hub: Express app (API + static web/dist) and the WebSocket hub, wired to one HubDb.
import express, { type ErrorRequestHandler } from 'express';
import type http from 'node:http';
import type https from 'node:https';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { LIMITS, TIMING, type CloudStatus } from '@relief-mesh/shared';
import { fail, keyByTokenOrIp, rateLimit } from './auth.js';
import type { HubDb } from './db.js';
import { createRoutes } from './routes.js';
import { WsHub } from './ws.js';

export interface HubOptions {
  db: HubDb;
  coordinatorPasscode: string;
  baseUrl: string;
  /** Folder with the built web app, or null to serve the API only (tests). */
  webDist: string | null;
  now?: () => number;
  rateLimitPerMin?: number;
  authRateLimitPerMin?: number;
  wsAuthDeadlineMs?: number;
  cloudStatus?: () => CloudStatus;
}

export function createHub(opts: HubOptions) {
  const now = opts.now ?? Date.now;
  const ws = new WsHub(opts.db, now, opts.wsAuthDeadlineMs ?? TIMING.wsAuthDeadlineMs);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: LIMITS.bodyMaxBytes }));

  // Never let a browser or the service worker cache API responses.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Health is public and polled often by phones, so it sits before the rate limiter.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: now(), hubId: opts.db.hubId });
  });

  app.use('/api', rateLimit(opts.rateLimitPerMin ?? LIMITS.rateLimitPerMin, 60_000, keyByTokenOrIp));
  app.use(
    '/api',
    createRoutes({
      db: opts.db,
      events: ws,
      coordinatorPasscode: opts.coordinatorPasscode,
      baseUrl: opts.baseUrl,
      now,
      cloudStatus: opts.cloudStatus ?? (() => ({ state: 'not_configured' })),
      authRateLimitPerMin: opts.authRateLimitPerMin ?? 10,
    }),
  );
  app.use('/api', (_req, res) => fail(res, 404, 'not_found', 'No such endpoint'));

  if (opts.webDist && existsSync(opts.webDist)) {
    const dist = opts.webDist;
    // sw.js, the manifest and the HTML shells must always revalidate or updates never reach phones.
    app.use(
      express.static(dist, {
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (base === 'sw.js' || base.endsWith('.html') || base.endsWith('.webmanifest')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('/dashboard', (_req, res) => res.sendFile(path.join(dist, 'dashboard.html')));
  } else if (opts.webDist) {
    app.get('*', (_req, res) => {
      res.status(503).type('text').send('web/dist not found. Run: npm run build');
    });
  }

  // Last: map body-parser failures to the contract's error format. Never log request bodies (D11).
  const onError: ErrorRequestHandler = (err: { type?: string }, _req, res, _next) => {
    if (err.type === 'entity.too.large') return fail(res, 413, 'too_large', 'Request body is too large');
    if (err.type === 'entity.parse.failed') return fail(res, 400, 'invalid_body', 'Body is not valid JSON');
    console.error('[hub] unhandled error:', err instanceof Error ? err.message : String(err));
    fail(res, 500, 'internal', 'Something went wrong');
  };
  app.use(onError);

  return {
    app,
    ws,
    attach(server: http.Server | https.Server) {
      ws.attach(server);
    },
  };
}
