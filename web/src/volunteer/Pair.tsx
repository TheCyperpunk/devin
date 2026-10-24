// First-run screen: name + join code (prefilled from the QR link's ?join=) -> POST /api/pair -> device token.
import { useEffect, useState, type FormEvent } from 'react';
import { LIMITS } from '@relief-mesh/shared';
import { ApiFail, pair } from '../lib/api.js';
import type { Settings } from '../lib/db.js';
import { useLang } from './lang.js';

function joinCodeFromUrl(): string {
  return (new URLSearchParams(location.search).get('join') ?? '').trim().toUpperCase();
}

export function Pair({ settings, onPaired }: { settings: Settings; onPaired: (patch: Settings) => void }) {
  const { t } = useLang();
  const [name, setName] = useState(settings.reporterName ?? '');
  const [code, setCode] = useState(joinCodeFromUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The code is a secret: take it out of the address bar and history once it is in the form.
  useEffect(() => {
    if (new URLSearchParams(location.search).has('join')) history.replaceState(null, '', location.pathname);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanName) return setError(t('errName'));
    if (!cleanCode) return setError(t('errCode'));
    setError(null);
    setBusy(true);
    try {
      const r = await pair(cleanCode, settings.deviceId!, cleanName);
      onPaired({ deviceToken: r.deviceToken, hubId: r.hubId, reporterName: r.reporterName });
    } catch (err) {
      const c = err instanceof ApiFail ? err.code : 'internal';
      setError(c === 'bad_join_code' ? t('errBadCode') : c === 'network' ? t('errNoHub') : c === 'rate_limited' ? t('errTooMany') : t('errGeneric'));
      setBusy(false);
    }
  }

  return (
    <form className="card pad" onSubmit={submit} noValidate>
      <h1>{t('pairTitle')}</h1>
      <p className="muted">{t('pairHelp')}</p>
      <label className="field">
        <span>{t('yourName')}</span>
        <input
          name="name"
          autoComplete="name"
          maxLength={LIMITS.reporterNameMax}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('joinCode')}</span>
        <input
          name="joinCode"
          className="code"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={16}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? t('joining') : t('join')}
      </button>
    </form>
  );
}
