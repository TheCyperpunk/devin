// Plain-HTTP onboarding server on :8080. Serves only the setup page and rootCA.pem (never any key).
import express from 'express';
import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { certPaths, config } from './config.js';

export function createSetupApp() {
  const app = express();
  app.disable('x-powered-by');

  const hubUrl = `https://${config.hubIp}:${config.httpsPort}`;
  const setupUrl = `http://${config.hubIp}:${config.setupPort}`;

  // Same public root certificate in two encodings. Android wants binary DER as .crt (its installer and
  // file picker are unreliable with PEM); iPhone profiles/desktops are fine with PEM.
  const sendRoot = (ext: 'pem' | 'crt') => (_req: express.Request, res: express.Response) => {
    if (!existsSync(certPaths.rootCA)) {
      res.status(404).type('text').send('rootCA.pem not found. Run: npm run certs');
      return;
    }
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', `attachment; filename="pralayam-rootCA.${ext}"`);
    const pem = readFileSync(certPaths.rootCA);
    res.send(ext === 'pem' ? pem : new X509Certificate(pem).raw);
  };
  app.get('/rootCA.pem', sendRoot('pem'));
  app.get('/rootCA.crt', sendRoot('crt'));

  app.get('*', (_req, res) => {
    res.type('html').send(renderSetupPage(hubUrl, setupUrl));
  });

  return app;
}

function renderSetupPage(hubUrl: string, setupUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pralayam setup</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; max-width: 560px; line-height: 1.5; }
  h1 { font-size: 1.5rem; }
  ol li { margin-bottom: 12px; }
  a.btn { display: block; text-align: center; padding: 16px; margin: 12px 0; border-radius: 10px;
          background: #0b6e4f; color: #fff; text-decoration: none; font-size: 1.1rem; font-weight: 600; }
  code { background: #f1f1f1; padding: 2px 6px; border-radius: 4px; word-break: break-all; }
  details { margin-top: 20px; }
</style>
</head>
<body>
<h1>Pralayam — connect this phone</h1>
<p>You are on <code>${setupUrl}</code>. Three steps:</p>
<ol>
  <li><a class="btn" href="/rootCA.crt">1. Download the certificate</a>
    <small>Android: use this one (.crt). iPhone: <a href="/rootCA.pem">.pem</a>.</small></li>
  <li><strong>Trust it</strong> (one time per phone). Downloading is not enough — you must install it:
    <details open><summary>Android</summary>
      Settings → search <strong>“CA certificate”</strong> (or Security &amp; privacy → More security settings → Install from device storage) →
      choose <strong>CA certificate</strong> (not “VPN &amp; app user” or “Wi-Fi”) → <strong>Install anyway</strong> →
      pick <code>pralayam-rootCA.crt</code> from Downloads. Then fully close Chrome and reopen it.
      Check: Settings → Trusted credentials → User tab should list <em>mkcert</em>.
    </details>
    <details><summary>iPhone</summary>
      Open Settings → a “Profile Downloaded” row appears → Install. Then Settings → General → About →
      <strong>Certificate Trust Settings</strong> → switch on <em>mkcert</em>. Both steps are required.
    </details>
  </li>
  <li><a class="btn" href="${hubUrl}">3. Open the hub: ${hubUrl}</a>
    Then use <strong>Add to Home Screen</strong>.</li>
</ol>
<p>No padlock or a warning? The certificate is not trusted yet — repeat step 2. Do not tap through the warning: the app will not work offline that way.</p>
</body>
</html>`;
}
