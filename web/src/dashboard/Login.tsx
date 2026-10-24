// Passcode screen. The passcode is COORDINATOR_PASSCODE from the hub's .env.
import { useState, type FormEvent } from 'react';
import type { DashboardStore } from './store.js';

export function Login({ store, notice }: { store: DashboardStore; notice: string | null }) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !passcode) return;
    setBusy(true);
    setError(await store.login(passcode));
    setBusy(false);
  }

  return (
    <main className="login">
      <form className="card" onSubmit={submit}>
        <h1>Relief Mesh — Coordinator</h1>
        <p className="muted">Enter the coordinator passcode to see and assign reports.</p>
        {notice && <p className="notice">{notice}</p>}
        <label className="field">
          <span>Passcode</span>
          <input
            type="password"
            name="passcode"
            autoComplete="current-password"
            autoFocus
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy || !passcode}>
          {busy ? 'Checking…' : 'Open dashboard'}
        </button>
      </form>
    </main>
  );
}
