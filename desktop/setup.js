// Setup window logic: shows the state the main process sends, saves settings, makes the certificate, starts the hub.
const $ = (id) => document.getElementById(id);
const api = window.pralayam;
let state = null;

function form() {
  return { hubIp: $('ip').value.trim(), passcode: $('passcode').value, httpsPort: Number($('httpsPort').value) || 3443, setupPort: Number($('setupPort').value) || 8080 };
}
function fill(s) {
  state = s;
  const ips = [...new Set([...(s.ips ?? []), ...(s.settings.hubIp ? [s.settings.hubIp] : [])])];
  $('ipSelect').replaceChildren(...ips.map((ip) => Object.assign(document.createElement('option'), { value: ip, textContent: ip })), Object.assign(document.createElement('option'), { value: '', textContent: ips.length ? 'other…' : 'no network found: type the IP' }));
  if (!$('ip').value) $('ip').value = s.settings.hubIp || ips[0] || '';
  $('ipSelect').value = ips.includes($('ip').value) ? $('ip').value : '';
  if (!$('passcode').value) $('passcode').value = s.settings.passcode || '';
  if (!$('httpsPort').value) $('httpsPort').value = s.settings.httpsPort;
  if (!$('setupPort').value) $('setupPort').value = s.settings.setupPort;

  const rows = [
    [s.certs.exists, s.certs.exists ? 'Certificate ready (' + s.certs.dir + ')' : 'No certificate yet'],
    [Boolean(s.node), s.node ? 'Node.js found: ' + s.node : 'Node.js not found'],
    [s.build, s.build ? 'Game files present' : s.dev ? 'Game not built: run npm run build' : 'Game files missing: reinstall Pralayam'],
    [s.mkcert || s.certs.exists, s.mkcert ? 'mkcert installed' : s.certs.exists ? 'mkcert not found (only needed to make a new certificate)' : 'mkcert not installed (needed once, to make the certificate)'],
  ];
  $('status').replaceChildren(
    ...rows.flatMap(([ok, text]) => {
      const i = Object.assign(document.createElement('i'), { textContent: ok ? '✓' : '✕' });
      const span = Object.assign(document.createElement('span'), { textContent: text });
      const wrap = document.createElement('div');
      wrap.className = ok ? 'ok' : 'bad';
      wrap.append(i);
      const w2 = document.createElement('div');
      w2.className = ok ? 'ok' : 'bad';
      w2.append(span);
      return [wrap, w2];
    }),
  );
  $('certsHint').textContent = s.mkcert ? 'Needs this laptop\'s IP above. Phones then trust it once from the setup page.' : 'Install mkcert first: winget install FiloSottile.mkcert (Windows) · brew install mkcert (macOS)';
  $('problems').replaceChildren(...(s.problems ?? []).map((p) => Object.assign(document.createElement('div'), { textContent: '• ' + p })));
  $('where').textContent = s.setupUrl ? 'Phones: ' + s.setupUrl + ' first, then the QR on the screen' : '';
  if (s.error) say(s.error, 'bad');
  if (s.log?.length) {
    $('log').hidden = false;
    $('log').textContent = s.log.join('\n');
  }
}
function say(text, tone = '') {
  $('msg').textContent = text;
  $('msg').className = 'msg ' + tone;
}
function busy(on) {
  for (const id of ['certs', 'save', 'start']) $(id).disabled = on;
}

$('ipSelect').addEventListener('change', () => {
  if ($('ipSelect').value) $('ip').value = $('ipSelect').value;
});
$('showPass').addEventListener('click', () => {
  const p = $('passcode');
  p.type = p.type === 'password' ? 'text' : 'password';
  $('showPass').textContent = p.type === 'password' ? 'Show' : 'Hide';
});
$('save').addEventListener('click', async () => {
  fill(await api.save(form()));
  say('Saved to ' + state.settingsFile, 'ok');
});
$('certs').addEventListener('click', async () => {
  busy(true);
  say('Making the certificate… Windows may ask for permission once.');
  const r = await api.makeCerts(form());
  busy(false);
  if (r.state) fill(r.state);
  say(r.message, r.ok ? 'ok' : 'bad');
});
$('start').addEventListener('click', async () => {
  busy(true);
  say('Starting the hub…');
  const r = await api.start(form());
  busy(false);
  if (!r.ok) {
    fill(r.state);
    say(r.state.error || 'Fix the items above, then start again.', 'bad');
  }
});
api.onLog((line) => {
  $('log').hidden = false;
  $('log').textContent += (($('log').textContent && '\n') || '') + line;
  $('log').scrollTop = $('log').scrollHeight;
});
api.onState(fill);
void api.state().then(fill);
