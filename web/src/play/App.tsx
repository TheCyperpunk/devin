// Phone shell: pair with the hub, pick a boat colour, join the night, then follow it (G4 adds the order picker).
import { useCallback, useEffect, useState } from 'react';
import { BOAT_COLORS, isLang, type BoatColor, type GameView, type Lang, type PairResponse } from '@pralayam/shared';
import { ApiFail, request } from '../lib/api.js';
import { getSettings, setSettings, type Settings } from '../lib/db.js';
import { LangProvider, LangToggle, useLang } from './lang.js';
import { Pair } from './Pair.js';

const COLOR_PX: Record<BoatColor, string> = {
  moss: '#3fd6a0', ember: '#ff7b2e', lamp: '#ffd23f', water: '#36a3c9', rose: '#ff5c8a', lilac: '#b388ff', sand: '#e8c39e', sky: '#7cc7ff',
};
const defaultLang = (): Lang => (navigator.language?.toLowerCase().startsWith('ml') ? 'ml' : 'en');

export function App() {
  const [settings, setLocal] = useState<Settings | null>(null);
  useEffect(() => {
    void (async () => {
      let s = await getSettings();
      const first: Settings = {};
      if (!s.deviceId) first.deviceId = crypto.randomUUID();
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
  if (!settings) return <main className="splash display">…</main>;
  return (
    <LangProvider lang={settings.lang ?? 'en'} setLang={(lang) => void update({ lang })}>
      <Shell settings={settings} update={update} />
    </LangProvider>
  );
}

type Follow = { kind: 'loading' } | { kind: 'noGame' } | { kind: 'offline' } | { kind: 'view'; view: GameView };

function Shell({ settings, update }: { settings: Settings; update: (p: Settings) => Promise<void> }) {
  const { t } = useLang();
  const [notice, setNotice] = useState<string | null>(null);
  const [follow, setFollow] = useState<Follow>({ kind: 'loading' });
  const [joining, setJoining] = useState(false);
  const paired = Boolean(settings.deviceToken);

  async function onPaired(r: PairResponse) {
    const old = await getSettings();
    await update({ deviceToken: r.deviceToken, hubId: r.hubId, reporterName: r.reporterName, ...(old.hubId && old.hubId !== r.hubId ? { color: undefined } : {}) });
    setNotice(null);
  }

  // Follow the game: poll the state (the socket comes with G4) and drop the token when the hub no longer knows it.
  useEffect(() => {
    if (!paired) return;
    let live = true;
    let rev = 0;
    const tick = async () => {
      try {
        const res = await request<{ view: GameView } | { unchanged: true }>('GET', `/api/game/state?after=${rev}`, { token: settings.deviceToken });
        if (!live) return;
        if ('view' in res) {
          rev = res.view.revision;
          setFollow({ kind: 'view', view: res.view });
        } else setFollow((f) => (f.kind === 'view' ? f : { kind: 'loading' }));
      } catch (err) {
        if (!live) return;
        const code = err instanceof ApiFail ? err.code : 'network';
        if (code === 'no_game') setFollow({ kind: 'noGame' });
        else if (code === 'unauthorized') {
          await update({ deviceToken: undefined });
          setNotice(t('pairAgainToken'));
        } else if (code === 'network') setFollow({ kind: 'offline' });
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [paired, settings.deviceToken, update, t]);

  async function join(color: BoatColor) {
    if (joining) return;
    setJoining(true);
    try {
      const { view } = await request<{ view: GameView }>('POST', '/api/game/join', { token: settings.deviceToken, body: { color } });
      await update({ color });
      setFollow({ kind: 'view', view });
    } catch (err) {
      const code = err instanceof ApiFail ? err.code : 'network';
      setNotice(code === 'no_game' ? t('noGame') : code === 'game_over' ? t('nightOver') : code === 'network' ? t('errNoHub') : t('errGeneric'));
    } finally {
      setJoining(false);
    }
  }

  const view = follow.kind === 'view' ? follow.view : null;
  const mine = view?.boats.find((b) => b.id === settings.deviceId) ?? null;

  return (
    <>
      <header className="top">
        <span className="display logo">{t('appName')}</span>
        <LangToggle />
      </header>
      <main className="stack">
        {notice && (
          <p className="notice" role="alert">
            {notice}
          </p>
        )}
        {!paired ? (
          <>
            <p className="muted center">{t('tagline')}</p>
            <Pair settings={settings} onPaired={onPaired} />
          </>
        ) : follow.kind === 'noGame' ? (
          <p className="panel pad muted">{t('noGame')}</p>
        ) : follow.kind === 'offline' ? (
          <p className="panel pad bad">{t('hubOffline')}</p>
        ) : !view ? (
          <p className="muted center">{t('loading')}</p>
        ) : view.phase === 'ended' ? (
          <p className="panel pad">{t('nightOver')}</p>
        ) : !mine ? (
          <section className="panel pad stack">
            <h1 className="display h2">{t('pickColour')}</h1>
            <div className="swatches">
              {BOAT_COLORS.map((c) => {
                const taken = view.boats.some((b) => b.color === c);
                return (
                  <button key={c} type="button" className={'swatch' + (taken ? ' taken' : '')} disabled={taken || joining} style={{ background: COLOR_PX[c] }} onClick={() => void join(c)} aria-label={c} />
                );
              })}
            </div>
            <p className="hint">{t('crewBoat')}</p>
          </section>
        ) : (
          <section className="panel pad stack">
            <div className="boatRow">
              <span className="hull" style={{ background: COLOR_PX[mine.color] }} />
              <span className="display">{mine.name}</span>
            </div>
            <p>{t('aboard', { name: mine.name })}</p>
            {view.phase === 'lobby' ? (
              <p className="muted blinkText">{t('waitingHost')}</p>
            ) : (
              <>
                <p className="display h2">{t('roundN', { n: view.round })}</p>
                <p className="muted">{t('ordersSoon')}</p>
              </>
            )}
          </section>
        )}
      </main>
    </>
  );
}
