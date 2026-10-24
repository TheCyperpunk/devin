// Join tab: the QR code and join code volunteers use to pair, and a button to rotate the code.
import { useEffect, useState } from 'react';
import type { JoinInfo } from './api.js';
import type { DashboardStore } from './store.js';

export function JoinPanel({ store }: { store: DashboardStore }) {
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    store.join().then(setInfo, () => setError('Could not load the join code.'));
  }, [store]);

  async function rotate() {
    if (busy) return;
    if (!window.confirm('Make a new join code? Phones that are already paired keep working; the old code stops working.')) return;
    setBusy(true);
    try {
      setInfo(await store.rotateJoin());
      setError(null);
    } catch {
      setError('Could not change the code.');
    }
    setBusy(false);
  }

  return (
    <section className="join">
      <div className="card">
        <h2>Volunteers join here</h2>
        {info ? (
          <>
            <img className="qr" src={info.qrDataUrl} alt={'QR code for ' + info.joinUrl} width={360} height={360} />
            <p className="muted">Scan the code, or open the hub and type:</p>
            <p className="code" data-testid="join-code">
              {info.joinCode}
            </p>
            <p className="muted url">{info.joinUrl}</p>
          </>
        ) : (
          <p className="muted">{error ?? 'Loading…'}</p>
        )}
        <button type="button" className="btn" onClick={rotate} disabled={busy || !info}>
          {busy ? 'Changing…' : 'New code'}
        </button>
        {error && info && <p className="error">{error}</p>}
      </div>
      <div className="card">
        <h2>How a phone joins</h2>
        <ol>
          <li>Connect to the relief Wi-Fi.</li>
          <li>
            Trust the hub certificate once, from the setup page on port <code>8080</code>.
          </li>
          <li>Scan the QR code (or open the hub and type the join code) and enter a name.</li>
          <li>Add the app to the home screen so it opens without Internet.</li>
        </ol>
        <p className="muted">
          Anyone with the join code can pair a phone, so change it after your volunteers have joined.
        </p>
      </div>
    </section>
  );
}
