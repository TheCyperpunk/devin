// Volunteer app entry. Phase 1: a hello page that proves HTTPS, the service worker and the hub all work.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '../styles.css';
import { checkHub, serviceWorkerState, type Check } from '../lib/status.js';

registerSW({ immediate: true });

function Pill({ state, labels }: { state: Check; labels: [string, string, string] }) {
  const cls = state === 'ok' ? 'pill ok' : state === 'fail' ? 'pill bad' : 'pill';
  const text = state === 'ok' ? labels[1] : state === 'fail' ? labels[2] : labels[0];
  return <span className={cls}>{text}</span>;
}

function App() {
  const secure: Check = window.isSecureContext ? 'ok' : 'fail';
  const [sw, setSw] = useState<Check>('pending');
  const [hub, setHub] = useState<Check>('pending');

  useEffect(() => {
    void serviceWorkerState().then(setSw);
    const ping = () => void checkHub().then((h) => setHub(h ? 'ok' : 'fail'));
    ping();
    const id = setInterval(ping, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <main>
      <h1>Relief Mesh</h1>
      <p className="muted">Phase 1 — connection check</p>
      <div className="card">
        <div className="row">
          <span>HTTPS (secure context)</span>
          <Pill state={secure} labels={['…', 'Yes', 'No']} />
        </div>
        <div className="row">
          <span>Service worker</span>
          <Pill state={sw} labels={['Installing…', 'Registered', 'Not available']} />
        </div>
        <div className="row">
          <span>Hub</span>
          <Pill state={hub} labels={['Checking…', 'Reachable', 'Unreachable']} />
        </div>
      </div>
      <p className="muted">
        Origin: <code>{location.origin}</code>
      </p>
      <p className="muted">
        If all three are green, use <strong>Add to Home Screen</strong>, then turn Wi-Fi off and reopen the app:
        this page should still load.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
