// Pralayam desktop app (Electron): starts the hub as a Node child process, opens the big screen in a window that
// trusts only the hub's own certificate, offers a setup window (hub IP, host passcode, certificate), and stops the
// hub it started when the window closes. The hub stays a Node process: its SQLite module is built for Node, not for
// Electron (DECISIONS D22). The passcode travels only through the child's environment, never a URL or an argument.
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const { X509Certificate } = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const DEV = !app.isPackaged;
const repoRoot = DEV ? path.resolve(__dirname, '..') : path.join(process.resourcesPath, 'hub');
if (process.env.PRALAYAM_USER_DATA) app.setPath('userData', process.env.PRALAYAM_USER_DATA);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const userData = app.getPath('userData');
const settingsFile = path.join(userData, 'settings.json');
const certsDir = process.env.PRALAYAM_CERTS_DIR ?? (DEV ? path.join(repoRoot, 'certs') : path.join(userData, 'certs'));
const dataDir = process.env.DATA_DIR ?? (DEV ? path.join(repoRoot, 'server', 'data') : path.join(userData, 'data'));
const serverIndex = path.join(repoRoot, 'server', 'dist', 'index.js');
const webDist = path.join(repoRoot, 'web', 'dist');
const iconFile = DEV ? path.join(repoRoot, 'web', 'public', 'icon-512.png') : path.join(process.resourcesPath, 'icon.png');

// ---- settings: the setup window's file, under .env defaults in dev, under the process environment always
function parseEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no file */
  }
  return out;
}
function loadSettings() {
  const env = DEV ? parseEnvFile(path.join(repoRoot, '.env')) : {};
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    /* first run */
  }
  const s = { hubIp: env.HUB_IP, passcode: env.COORDINATOR_PASSCODE, httpsPort: env.HTTPS_PORT, setupPort: env.SETUP_PORT, ...file };
  for (const [k, key] of [['HUB_IP', 'hubIp'], ['COORDINATOR_PASSCODE', 'passcode'], ['HTTPS_PORT', 'httpsPort'], ['SETUP_PORT', 'setupPort']]) if (process.env[k]) s[key] = process.env[k];
  return { hubIp: String(s.hubIp ?? ''), passcode: String(s.passcode ?? ''), httpsPort: Number(s.httpsPort) || 3443, setupPort: Number(s.setupPort) || 8080 };
}
function saveSettings(s) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2), { mode: 0o600 });
}

const localIps = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
function findExe(name, extra) {
  if (process.env['PRALAYAM_' + name.toUpperCase()] && fs.existsSync(process.env['PRALAYAM_' + name.toUpperCase()])) return process.env['PRALAYAM_' + name.toUpperCase()];
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8', windowsHide: true });
    const p = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l && fs.existsSync(l));
    if (p) return p;
  } catch {
    /* not on PATH */
  }
  return extra.find((p) => fs.existsSync(p)) ?? null;
}
const nodePath = () => findExe('node', ['C:/Program Files/nodejs/node.exe', '/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node']);
const mkcertPath = () => findExe('mkcert', [path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'mkcert.exe'), '/usr/local/bin/mkcert', '/opt/homebrew/bin/mkcert']);
const certsExist = () => fs.existsSync(path.join(certsDir, 'hub.pem')) && fs.existsSync(path.join(certsDir, 'hub-key.pem'));
const buildExists = () => fs.existsSync(serverIndex) && fs.existsSync(path.join(webDist, 'index.html'));

function problemsWith(s) {
  const out = [];
  if (!s.hubIp) out.push('Choose the hub IP: this laptop\'s address on the hotspot or Wi-Fi the phones will use.');
  if (s.passcode.length < 8 || s.passcode.startsWith('change-me')) out.push('Set a host passcode of 8 or more characters.');
  if (!certsExist()) out.push('Make the certificate (needs mkcert once).');
  if (!nodePath()) out.push('Node.js 20 or newer was not found. Install it from nodejs.org, then open Pralayam again.');
  if (!buildExists()) out.push(DEV ? 'Build the game first: npm run build' : 'This copy of Pralayam is missing its game files. Reinstall it.');
  return out;
}

// ---- the hub, a Node child; reused if one is already up on the port
let hub = null;
let quitting = false;
const hubLog = [];
const log = (chunk) => {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line) continue;
    hubLog.push(line);
    if (hubLog.length > 200) hubLog.shift();
    console.log('[hub] ' + line);
    setupWin?.webContents.send('setup:log', line);
  }
};
const health = (port) =>
  new Promise((resolve) => {
    const req = https.get({ host: '127.0.0.1', port, path: '/api/health', rejectUnauthorized: false, timeout: 1500 }, (res) => (res.resume(), resolve(res.statusCode === 200)));
    req.on('error', () => resolve(false));
    req.on('timeout', () => (req.destroy(), resolve(false)));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startHub(s) {
  if (await health(s.httpsPort)) {
    log(`A hub is already running on port ${s.httpsPort}; using it.`);
    return;
  }
  const env = { ...process.env, HUB_IP: s.hubIp, HTTPS_PORT: String(s.httpsPort), SETUP_PORT: String(s.setupPort), COORDINATOR_PASSCODE: s.passcode, DATA_DIR: dataDir, CERTS_DIR: certsDir, WEB_DIST: webDist };
  delete env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(dataDir, { recursive: true });
  hub = spawn(nodePath(), [serverIndex], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  hub.stdout.on('data', log);
  hub.stderr.on('data', log);
  hub.on('exit', (code) => {
    hub = null;
    if (!quitting) {
      log(`The hub stopped (exit code ${code}).`);
      if (win && !win.isDestroyed()) openSetup([], `The hub stopped (exit code ${code}). The last lines it printed are below.`);
    }
  });
  for (let i = 0; i < 80; i++) {
    if (await health(s.httpsPort)) return;
    if (!hub) break;
    await sleep(250);
  }
  hub?.kill();
  hub = null;
  throw new Error('The hub did not start. The last lines it printed are below.');
}
function stopHub() {
  if (hub) hub.kill();
  hub = null;
}

// ---- trust exactly our certificate, by fingerprint, and only for the local hub
function hubFingerprint() {
  try {
    const cert = new X509Certificate(fs.readFileSync(path.join(certsDir, 'hub.pem')));
    return 'sha256/' + Buffer.from(cert.fingerprint256.replace(/:/g, ''), 'hex').toString('base64');
  } catch {
    return null;
  }
}
app.on('certificate-error', (event, _wc, url, _error, certificate, callback) => {
  const host = new URL(url).hostname;
  const ours = (host === 'localhost' || host === '127.0.0.1') && certificate.fingerprint === hubFingerprint();
  if (ours) event.preventDefault();
  callback(ours);
});

// ---- windows
let win = null;
let setupWin = null;
let current = loadSettings();

function openScreen(s) {
  if (win && !win.isDestroyed()) return win.focus();
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0b14',
    title: 'Pralayam',
    icon: iconFile,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const origin = `https://localhost:${s.httpsPort}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin + '/')) event.preventDefault();
  });
  win.once('ready-to-show', () => {
    win.show();
    win.maximize();
    if (process.env.PRALAYAM_FULLSCREEN === '1') win.setFullScreen(true);
  });
  win.on('closed', () => {
    win = null;
    if (!setupWin) app.quit();
  });
  void win.loadURL(origin + '/screen.html');
}

function setupState(problems, error) {
  return {
    dev: DEV,
    settings: current,
    ips: localIps(),
    node: nodePath(),
    mkcert: mkcertPath() !== null,
    certs: { exists: certsExist(), dir: certsDir },
    build: buildExists(),
    problems: problems ?? problemsWith(current),
    error: error ?? '',
    log: hubLog.slice(-40),
    setupUrl: current.hubIp ? `http://${current.hubIp}:${current.setupPort}` : '',
    settingsFile,
  };
}
function openSetup(problems, error) {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.webContents.send('setup:state', setupState(problems, error));
    return setupWin.focus();
  }
  setupWin = new BrowserWindow({
    width: 780,
    height: 760,
    minWidth: 640,
    minHeight: 560,
    backgroundColor: '#0b0b14',
    title: 'Pralayam setup',
    icon: iconFile,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  setupWin.webContents.once('did-finish-load', () => setupWin?.webContents.send('setup:state', setupState(problems, error)));
  setupWin.on('closed', () => {
    setupWin = null;
    if (!win) app.quit();
  });
  void setupWin.loadFile(path.join(__dirname, 'setup.html'));
}

// ---- setup window IPC
const asSettings = (s) => ({
  hubIp: String(s?.hubIp ?? '').trim().slice(0, 64),
  passcode: String(s?.passcode ?? '').slice(0, 200),
  httpsPort: Math.min(65535, Math.max(1024, Number(s?.httpsPort) || 3443)),
  setupPort: Math.min(65535, Math.max(1024, Number(s?.setupPort) || 8080)),
});
ipcMain.handle('setup:state', () => setupState());
ipcMain.handle('setup:save', (_e, s) => {
  current = asSettings(s);
  saveSettings(current);
  return setupState();
});
ipcMain.handle('setup:certs', (_e, s) => {
  current = asSettings(s);
  saveSettings(current);
  const mkcert = mkcertPath();
  if (!mkcert) return { ok: false, message: 'mkcert is not installed. Windows: winget install FiloSottile.mkcert · macOS: brew install mkcert. Then try again.' };
  if (!current.hubIp) return { ok: false, message: 'Choose the hub IP first.' };
  const run = (args) => execFileSync(mkcert, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, TRUST_STORES: 'system' } });
  try {
    fs.mkdirSync(certsDir, { recursive: true });
    log('mkcert: making sure the local CA exists (Windows may ask for permission once)');
    run(['-install']);
    const hosts = [...new Set(['localhost', '127.0.0.1', '::1', current.hubIp])];
    log('mkcert: issuing the hub certificate for ' + hosts.join(', '));
    run(['-cert-file', path.join(certsDir, 'hub.pem'), '-key-file', path.join(certsDir, 'hub-key.pem'), ...hosts]);
    const caRoot = run(['-CAROOT']).trim();
    // only the public root certificate is copied; its key stays in CAROOT and is never served
    fs.copyFileSync(path.join(caRoot, 'rootCA.pem'), path.join(certsDir, 'rootCA.pem'));
    log('certificate written to ' + certsDir);
    return { ok: true, message: 'Certificate made. Phones trust it once from the setup page.', state: setupState() };
  } catch (e) {
    const detail = String(e.stderr || e.message || e).split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
    return { ok: false, message: 'mkcert failed: ' + detail, state: setupState() };
  }
});
ipcMain.handle('setup:start', async (_e, s) => {
  current = asSettings(s);
  saveSettings(current);
  const problems = problemsWith(current);
  if (problems.length) return { ok: false, state: setupState(problems) };
  try {
    await startHub(current);
  } catch (e) {
    return { ok: false, state: setupState([], e.message) };
  }
  buildMenu();
  openScreen(current);
  setupWin?.close();
  return { ok: true };
});
ipcMain.handle('setup:open-url', (_e, url) => {
  if (/^https?:\/\//.test(String(url))) void shell.openExternal(String(url));
});

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Pralayam',
        submenu: [
          { label: 'Full screen', accelerator: 'F11', click: () => win?.setFullScreen(!win.isFullScreen()) },
          { label: 'Reload the screen', accelerator: 'CmdOrCtrl+R', click: () => win?.reload() },
          { type: 'separator' },
          { label: 'Setup…', click: () => openSetup() },
          { label: 'Phone setup page', enabled: Boolean(current.hubIp), click: () => void shell.openExternal(`http://${current.hubIp}:${current.setupPort}`) },
          { type: 'separator' },
          ...(DEV ? [{ role: 'toggleDevTools' }] : []),
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
    ]),
  );
}

// ---- lifecycle
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => (win ?? setupWin)?.focus());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  stopHub();
});
app.whenReady().then(async () => {
  buildMenu();
  const problems = problemsWith(current);
  if (problems.length || process.env.PRALAYAM_SETUP === '1') return openSetup(problems);
  try {
    await startHub(current);
    openScreen(current);
  } catch (e) {
    openSetup([], e.message);
  }
});
