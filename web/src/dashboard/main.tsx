// Coordinator dashboard entry. Phase 1: placeholder that shows the hub is reachable.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { checkHub, type HubHealth } from '../lib/status.js';

function App() {
  const [health, setHealth] = useState<HubHealth | null | undefined>(undefined);
  useEffect(() => {
    void checkHub().then(setHealth);
  }, []);
  return (
    <main>
      <h1>Relief Mesh — Coordinator</h1>
      <p className="muted">Phase 1 placeholder. The real dashboard arrives in Phase 6.</p>
      <div className="card">
        {health === undefined && 'Checking hub…'}
        {health === null && <span className="pill bad">Hub unreachable</span>}
        {health && (
          <>
            <span className="pill ok">Hub reachable</span>{' '}
            <span className="muted">
              hubId <code>{health.hubId}</code>, hub time {new Date(health.time).toLocaleTimeString()}
            </span>
          </>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
