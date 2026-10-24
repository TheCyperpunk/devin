// Phone shell: pair with the hub, pick a boat colour, join, then play the night from this phone through the outbox.
import { useCallback, useEffect, useState } from 'react';
import { BOAT_COLORS, isLang, type BoatColor, type Lang, type PairResponse } from '@pralayam/shared';
import { COLOR_PX } from '../game/sprites.js';
import { clearOutbox, getSettings, setSettings, type Settings } from '../lib/db.js';
import { EndScreen } from './End.js';
import { LangProvider, LangToggle, useLang } from './lang.js';
import { OrderScreen } from './Order.js';
import { myBoat } from './orders.js';
import { Pair } from './Pair.js';
import { useGame, useGameTriggers } from './useGame.js';

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
  const reload = useCallback(async () => setLocal(await getSettings()), []);
  if (!settings) return <main className="splash display">…</main>;
  return (
    <LangProvider lang={settings.lang ?? 'en'} setLang={(lang) => void update({ lang })}>
      <Shell settings={settings} update={update} reload={reload} />
    </LangProvider>
  );
}

function Shell({ settings, update, reload }: { settings: Settings; update: (p: Settings) => Promise<void>; reload: () => Promise<void> }) {
  const { t } = useLang();
  const { state, sync } = useGame();
  const [joining, setJoining] = useState<string | null>(null);
  const paired = Boolean(settings.deviceToken) && !state.needsPairing;
  useGameTriggers(paired);

  async function onPaired(r: PairResponse) {
    const old = await getSettings();
    if (old.hubId && old.hubId !== r.hubId) {
      await clearOutbox();
      await update({ gameId: undefined, nextSeq: undefined, lastView: undefined, lastViewAt: undefined, color: undefined });
    }
    await update({ deviceToken: r.deviceToken, hubId: r.hubId, reporterName: r.reporterName });
    await reload();
  }

  async function join(color: BoatColor) {
    if (joining) return;
    setJoining(color);
    const err = await sync.join(color);
    setJoining(null);
    if (err) setNotice(err);
  }
  const [notice, setNotice] = useState<string | null>(null);

  const view = state.view;
  const boat = myBoat(view, settings.deviceId);
  const statusText = state.hub === 'unknown' ? '…' : state.hub === 'online' ? t('hubOnline') : t('hubOffline');

  return (
    <>
      <header className="top">
        <span className="display logo">{t('appName')}</span>
        {paired && (
          <span className="status" aria-live="polite">
            <i className={'dot ' + (state.hub === 'online' ? 'ok' : state.hub === 'offline' ? 'bad' : '')} />
            {statusText}
          </span>
        )}
        <LangToggle />
      </header>
      <main className="stack">
        {!paired ? (
          <>
            {state.needsPairing ? (
              <p className="notice" role="alert">
                {state.needsPairing === 'reset' ? t('pairAgainReset') : t('pairAgainToken')}
              </p>
            ) : (
              <p className="muted center">{t('tagline')}</p>
            )}
            <Pair settings={settings} onPaired={onPaired} />
          </>
        ) : state.noGame && !view ? (
          <p className="panel pad muted" data-screen="no-game">
            {t('noGame')}
          </p>
        ) : !view ? (
          <p className="muted center">{state.hub === 'offline' ? t('hubOffline') : t('loading')}</p>
        ) : view.phase === 'ended' ? (
          <EndScreen view={view} boat={boat} />
        ) : !boat ? (
          <section className="panel pad stack" data-screen="pick">
            <h1 className="display h2">{t('pickColour')}</h1>
            {notice && (
              <p className="notice" role="alert">
                {notice === 'no_game' ? t('noGame') : notice === 'game_over' ? t('nightOver') : notice === 'network' ? t('errNoHub') : t('errGeneric')}
              </p>
            )}
            <div className="swatches">
              {BOAT_COLORS.map((c) => {
                const taken = view.boats.some((b) => b.color === c);
                return (
                  <button key={c} type="button" className={'swatch' + (taken ? ' taken' : '')} disabled={taken || joining !== null} style={{ background: COLOR_PX[c] }} onClick={() => void join(c)} aria-label={c} data-color={c} />
                );
              })}
            </div>
            <p className="hint">{t('crewBoat')}</p>
          </section>
        ) : view.phase === 'lobby' ? (
          <section className="panel pad stack" data-screen="lobby">
            <div className="boatRow">
              <span className="hull" style={{ background: COLOR_PX[boat.color] }} />
              <span className="display">{boat.name}</span>
            </div>
            <p>{t('aboard', { name: boat.name })}</p>
            <p className="muted blinkText">{t('waitingHost')}</p>
            <ul className="crews">
              {view.boats.map((b) => (
                <li key={b.id}>
                  <span className="hull small" style={{ background: COLOR_PX[b.color] }} />
                  {b.name}
                  {b.bot ? ' · bot' : ''}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <OrderScreen view={view} boat={boat} state={state} sync={sync} />
        )}
      </main>
    </>
  );
}
