// The HTTPS hub app: health endpoint + static web/dist. Phase 2 adds the API routes and WebSocket.
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { LIMITS } from '@relief-mesh/shared';
import { config } from './config.js';

export const hubId = 'phase1-placeholder'; // Phase 2: random id stored in SQLite meta

export function createHubApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: LIMITS.bodyMaxBytes }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: Date.now(), hubId });
  });

  // Never let the service worker or browser cache API responses
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint' } });
      return;
    }
    next();
  });

  if (existsSync(config.webDist)) {
    // sw.js and the manifest must always be revalidated or updates never reach phones
    app.use(
      express.static(config.webDist, {
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (base === 'sw.js' || base === 'index.html' || base === 'dashboard.html' || base.endsWith('.webmanifest')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('/dashboard', (_req, res) => res.sendFile(path.join(config.webDist, 'dashboard.html')));
  } else {
    app.get('*', (_req, res) => {
      res.status(503).type('text').send('web/dist not found. Run: npm run build');
    });
  }

  return app;
}
