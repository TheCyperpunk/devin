// Entry point: opens the database, starts the HTTPS hub on :3443 and the HTTP setup server on :8080.
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CloudSync } from './cloudSync.js';
import { assertCertsExist, assertPasscode, certPaths, config } from './config.js';
import { HubDb } from './db.js';
import { createHub } from './hub.js';
import { createSetupApp } from './setupServer.js';
import { supabaseClient } from './supabase.js';

assertCertsExist();
assertPasscode();

mkdirSync(config.dataDir, { recursive: true });
const db = new HubDb(path.join(config.dataDir, 'hub.db'));

const baseUrl = `https://${config.hubIp}:${config.httpsPort}`;

// Cloud backup is optional: without both settings the dashboard shows "not configured" and nothing leaves the hub.
const cloudConfigured = Boolean(config.supabaseUrl && config.supabaseSecretKey);
let cloud: CloudSync;
const hub = createHub({
  db,
  coordinatorPasscode: config.coordinatorPasscode,
  baseUrl,
  webDist: config.webDist,
  cloudStatus: () => cloud.current(),
});
cloud = new CloudSync(db, cloudConfigured ? supabaseClient(config.supabaseUrl, config.supabaseSecretKey) : null, hub.ws);

const tls = { cert: readFileSync(certPaths.cert), key: readFileSync(certPaths.key) };
const hubServer = https.createServer(tls, hub.app);
hub.attach(hubServer);
hubServer.listen(config.httpsPort, '0.0.0.0', () => {
  console.log(`[hub]   ${baseUrl}  (also https://localhost:${config.httpsPort})   hubId ${db.hubId}`);
  console.log(`[hub]   join code ${db.joinCode}   (phones join via ${baseUrl}/?join=${db.joinCode})`);
  console.log(cloudConfigured ? `[cloud] backup to ${new URL(config.supabaseUrl).host} every 10 s` : '[cloud] not configured (SUPABASE_URL / SUPABASE_SECRET_KEY unset)');
  cloud.start();
});

const setupServer = http.createServer(createSetupApp());
setupServer.listen(config.setupPort, '0.0.0.0', () => {
  console.log(`[setup] http://${config.hubIp}:${config.setupPort}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    cloud.stop();
    hubServer.close();
    setupServer.close();
    db.close();
    process.exit(0);
  });
}
