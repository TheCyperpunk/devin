// Entry point: starts the HTTPS hub on :3443 and the HTTP setup server on :8080.
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { assertCertsExist, certPaths, config } from './config.js';
import { createHubApp } from './hub.js';
import { createSetupApp } from './setupServer.js';

assertCertsExist();

const tls = { cert: readFileSync(certPaths.cert), key: readFileSync(certPaths.key) };

const hubServer = https.createServer(tls, createHubApp());
hubServer.listen(config.httpsPort, '0.0.0.0', () => {
  console.log(`[hub]   https://${config.hubIp}:${config.httpsPort}  (also https://localhost:${config.httpsPort})`);
});

const setupServer = http.createServer(createSetupApp());
setupServer.listen(config.setupPort, '0.0.0.0', () => {
  console.log(`[setup] http://${config.hubIp}:${config.setupPort}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    hubServer.close();
    setupServer.close();
    process.exit(0);
  });
}
