// Volunteer app shell: loads settings from IndexedDB, then pairing screen or (New report | My reports).
import { useCallback, useEffect, useState } from 'react';
import { isLang, type Lang } from '@relief-mesh/shared';
import { getSettings, outboxCount, setSettings, type Settings } from '../lib/db.js';
import { useHubReachable } from '../lib/hooks.js';
import { LangProvider, LangToggle, useLang } from './lang.js';
import { MyReports } from './MyReports.js';
import { Pair } from './Pair.js';
import { ReportForm } from './ReportForm.js';

const defaultLang = (): Lang => (navigator.language?.toLowerCase().startsWith('ml') ? 'ml' : 'en');

export function App() {
  const [settings, setLocal] = useState<Settings | null>(null);

  useEffect(() => {
    void (async () => {
      let s = await getSettings();
      const first: Settings = {};
      if (!s.deviceId) first.deviceId = crypto.randomUUID(); // this phone's identity, made once
      if (!isLang(s.lang)) first.lang = defaultLang();
      if (Object.keys(first).length) {
        await setSettings(first);
        s = { ...s, ...first };
      }
      setLocal(s);
    })();
  }, []);

  const update = useCallback(async (patch: Settings) => {
    await setSettings(patch);
    setLocal((s) => ({ ...s, ...patch }));
  }, []);

  if (!settings) return <main className="splash">…</main>;

  return (
    <LangProvider lang={settings.lang ?? 'en'} setLang={(lang) => void update({ lang })}>
      <Shell settings={settings} update={update} />
    </LangProvider>
  );
}

function Shell({ settings, update }: { settings: Settings; update: (p: Settings) => Promise<void> }) {
  const { t } = useLang();
  const hub = useHubReachable();
  const [tab, setTab] = useState<'new' | 'mine'>('new');
  const [refresh, setRefresh] = useState(0);
  const [unsent, setUnsent] = useState(0);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const paired = Boolean(settings.deviceToken);

  useEffect(() => {
    void outboxCount().then(setUnsent);
  }, [refresh]);

  // Browser storage is "best effort" unless the app asks to keep it (D8).
  useEffect(() => {
    if (!paired || !navigator.storage?.persist) return;
    void navigator.storage.persisted().then((p) => (p ? true : navigator.storage.persist())).then(setPersisted);
  }, [paired]);

  return (
    <>
      <header className="top">
        <div>
          <h1 className="brand">{t('appName')}</h1>
          {paired && settings.reporterName && <div className="who">{settings.reporterName}</div>}
        </div>
        <LangToggle />
      </header>

      <main>
        {!paired ? (
          <>
            <p className="muted tagline">{t('tagline')}</p>
            <Pair settings={settings} onPaired={(p) => void update(p)} />
          </>
        ) : (
          <>
            <div className="status" aria-live="polite">
              <span className={'dot ' + (hub === null ? '' : hub ? 'ok' : 'bad')} aria-hidden="true" />
              {hub === null ? '…' : hub ? t('hubOnline') : t('hubOffline')}
              {unsent > 0 && <span className="unsent">· {t('waitingToSend', { n: unsent })}</span>}
            </div>
            {persisted === false && <p className="warn">{t('storageWarn')}</p>}

            <nav className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>
                {t('tabNew')}
              </button>
              <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
                {t('tabMine')}
              </button>
            </nav>

            {tab === 'new' ? (
              <ReportForm onSaved={() => setRefresh((n) => n + 1)} onShowMine={() => setTab('mine')} />
            ) : (
              <MyReports refreshKey={refresh} />
            )}
          </>
        )}
      </main>
    </>
  );
}
