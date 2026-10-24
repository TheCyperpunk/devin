// Volunteer app shell: loads settings from IndexedDB, then pairing screen or (New report | My reports) with live sync.
import { useCallback, useEffect, useState } from 'react';
import { isLang, type Lang } from '@relief-mesh/shared';
import type { PairResponse } from '../lib/api.js';
import { getSettings, setSettings, type Settings } from '../lib/db.js';
import { useSync, useSyncTriggers } from '../lib/useSync.js';
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

  const reload = useCallback(async () => setLocal(await getSettings()), []);

  if (!settings) return <main className="splash">…</main>;

  return (
    <LangProvider lang={settings.lang ?? 'en'} setLang={(lang) => void update({ lang })}>
      <Shell settings={settings} update={update} reload={reload} />
    </LangProvider>
  );
}

function Shell({ settings, update, reload }: { settings: Settings; update: (p: Settings) => Promise<void>; reload: () => Promise<void> }) {
  const { t } = useLang();
  const { state, sync } = useSync();
  const [tab, setTab] = useState<'new' | 'mine'>('new');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const paired = Boolean(settings.deviceToken) && !state.needsPairing;

  useSyncTriggers(paired);

  // Browser storage is "best effort" unless the app asks to keep it (D8).
  useEffect(() => {
    if (!paired || !navigator.storage?.persist) return;
    void navigator.storage.persisted().then((p) => (p ? true : navigator.storage.persist())).then(setPersisted);
  }, [paired]);

  async function onPaired(r: PairResponse) {
    await sync.paired(r);
    await reload();
  }

  const statusText = state.hub === 'unknown' ? '…' : state.hub === 'online' ? t('hubOnline') : t('hubOffline');

  return (
    <>
      <header className="top">
        <div>
          <h1 className="brand">{t('appName')}</h1>
          {settings.reporterName && <div className="who">{settings.reporterName}</div>}
        </div>
        <LangToggle />
      </header>

      <main>
        {!paired ? (
          <>
            {state.needsPairing ? (
              <p className="warn" role="alert">
                {state.needsPairing === 'reset' ? t('pairAgainReset') : t('pairAgainToken')}
              </p>
            ) : (
              <p className="muted tagline">{t('tagline')}</p>
            )}
            <Pair settings={settings} onPaired={onPaired} />
          </>
        ) : (
          <>
            <div className="status" aria-live="polite">
              <span className={'dot ' + (state.hub === 'unknown' ? '' : state.hub === 'online' ? 'ok' : 'bad')} aria-hidden="true" />
              {statusText}
              {state.sending && <span className="unsent">· {t('sending')}</span>}
              {!state.sending && state.unsent > 0 && <span className="unsent">· {t('waitingToSend', { n: state.unsent })}</span>}
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
              <ReportForm onSaved={() => void sync.kick()} onShowMine={() => setTab('mine')} />
            ) : (
              <MyReports refreshKey={state.version} />
            )}
          </>
        )}
      </main>
    </>
  );
}
