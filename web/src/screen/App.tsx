// Big screen shell: passcode, then the map with its panels, and the lobby / end overlays. Plays sounds on rounds.
import { useEffect, useState, type FormEvent } from 'react';
import { WardMap, popsFor } from './Map.js';
import { BottomBar, TopBar } from './Bars.js';
import { EndScreen } from './EndScreen.js';
import { Lobby } from './Lobby.js';
import { Panel } from './Panel.js';
import { sound } from './Sound.js';
import type { ScreenStore } from './store.js';
import { useScreen, useTick } from './useStore.js';

export function App() {
  const { state, store } = useScreen();
  const now = useTick();

  useEffect(() => {
    if (!state.session) return;
    store.start();
    const wake = () => store.wake();
    const onVisible = () => {
      if (document.visibilityState === 'visible') store.wake();
    };
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', onVisible);
      store.stop();
    };
  }, [store, state.session]);

  useEffect(() => {
    store.onRound = (p) => {
      if (store.state.sound) sound.round(p);
    };
    return () => {
      store.onRound = null;
    };
  }, [store]);

  if (!state.session) return <Login store={store} notice={state.loginNotice} />;

  const view = state.view;
  const hubNow = now + state.clockOffset;
  const pops = state.lastRound && state.lastRoundAt && now - state.lastRoundAt < 2500 ? popsFor(state.lastRound.events, state.lastRoundAt) : [];
  const showLobby = state.noGame || view?.phase === 'lobby' || (!view && state.hub !== 'unknown');

  return (
    <div className="screen">
      <TopBar view={view} hubNow={hubNow} hub={state.hub} />
      <main className="stage">
        <div className="mapWrap">
          <WardMap view={view} dim={showLobby || view?.phase === 'ended'} pops={pops} outSince={state.outSince} />
          <Toasts toasts={state.toasts} />
          {state.notice && <div className="notice">{state.notice}</div>}
        </div>
        {view && <Panel view={view} outSince={state.outSince} />}
      </main>
      <BottomBar view={view} join={state.join} store={store} busy={state.busy} sound={state.sound} />
      {showLobby && <Lobby view={view?.phase === 'lobby' ? view : null} join={state.join} store={store} busy={state.busy} />}
      {view?.phase === 'ended' && <EndScreen view={view} store={store} busy={state.busy} />}
      {!view && state.hub === 'unknown' && <div className="overlay"><div className="display h1 rise">Connecting…</div></div>}
    </div>
  );
}

function Toasts({ toasts }: { toasts: { id: number; text: string; points: number; tone: string }[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast rise ' + t.tone}>
          <span className="dot" />
          <span>{t.text}</span>
          {t.points !== 0 && <span className={'num pts' + (t.points < 0 ? ' neg' : '')}>{t.points > 0 ? '+' : ''}{t.points}</span>}
        </div>
      ))}
    </div>
  );
}

function Login({ store, notice }: { store: ScreenStore; notice: string | null }) {
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
    <main className="loginWrap">
      <form className="panel login rise" onSubmit={submit}>
        <div className="display h1">Pralayam</div>
        <p className="muted">Big screen. Enter the coordinator passcode to host the night.</p>
        {notice && <p className="notice inline">{notice}</p>}
        <label className="field">
          <span>Passcode</span>
          <input type="password" name="passcode" autoComplete="current-password" autoFocus value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn lamp" type="submit" disabled={busy || !passcode}>
          {busy ? 'Checking…' : 'Open the big screen'}
        </button>
      </form>
    </main>
  );
}
