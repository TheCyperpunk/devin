// Coordinator dashboard shell: login, header with counters + connection + cloud, tabs (Reports | Map | Join).
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { hubNow as hubClock, sortReports, type CloudStatus } from '@relief-mesh/shared';
import { Detail } from './Detail.js';
import { JoinPanel } from './JoinPanel.js';
import { Login } from './Login.js';
import { ReportList } from './ReportList.js';
import { clock } from './format.js';
import { useClock, useDashboard } from './useStore.js';

// The map (and Leaflet) is only downloaded when the tab is opened, so the list never depends on it (D9).
const MapView = lazy(() => import('./MapView.js'));

type Tab = 'reports' | 'map' | 'join';

export function App() {
  const { state, store } = useDashboard();
  const now = useClock();
  const [tab, setTab] = useState<Tab>('reports');
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const hubNow = hubClock(state.clockOffset, now);
  const sorted = useMemo(() => sortReports(state.reports, hubNow), [state.reports, hubNow]);
  const selected = selectedId ? state.reports.find((r) => r.id === selectedId) ?? null : null;
  const counts = useMemo(() => {
    const c = { open: 0, assigned: 0, done: 0 };
    for (const r of state.reports) c[r.status]++;
    return c;
  }, [state.reports]);

  if (!state.session) return <Login store={store} notice={state.loginNotice} />;

  return (
    <div className="dash">
      <header className="bar">
        <div className="brand">
          <strong>Relief Mesh</strong> <span className="muted">Coordinator</span>
        </div>
        <div className="counts" aria-label="Counts">
          <span className="count open">
            <b>{counts.open}</b> open
          </span>
          <span className="count assigned">
            <b>{counts.assigned}</b> assigned
          </span>
          <span className="count done">
            <b>{counts.done}</b> done
          </span>
        </div>
        <div className="conn" aria-live="polite">
          <span className={'dot ' + (state.hub === 'online' ? (state.socket ? 'ok' : 'warn') : state.hub === 'offline' ? 'bad' : '')} aria-hidden="true" />
          {state.hub === 'unknown' ? 'Connecting…' : state.hub === 'offline' ? 'Hub not reachable' : state.socket ? 'Live' : 'Polling'}
        </div>
        <button type="button" className="link" onClick={() => store.logout()}>
          Log out
        </button>
      </header>

      <Cloud cloud={state.cloud} />

      <nav className="tabs" role="tablist">
        {(['reports', 'map', 'join'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'reports' ? `Reports (${state.reports.length})` : t === 'map' ? 'Map' : 'Join'}
          </button>
        ))}
      </nav>

      <main className={'content' + (selected ? ' with-detail' : '')}>
        <section className="primary">
          {tab === 'reports' &&
            (state.loading ? (
              <p className="muted pad">Loading reports…</p>
            ) : (
              <ReportList sorted={sorted} hubNow={hubNow} now={now} selectedId={selectedId} onSelect={setSelectedId} store={store} />
            ))}
          {tab === 'map' && (
            <Suspense fallback={<p className="muted pad">Loading map…</p>}>
              <MapView reports={state.reports} hubNow={hubNow} selectedId={selectedId} onSelect={setSelectedId} />
            </Suspense>
          )}
          {tab === 'join' && <JoinPanel store={store} />}
        </section>
        {selected && tab !== 'join' && <Detail report={selected} hubNow={hubNow} store={store} onClose={() => setSelectedId(null)} />}
      </main>
    </div>
  );
}

function Cloud({ cloud }: { cloud: CloudStatus }) {
  const text =
    cloud.state === 'not_configured'
      ? 'Cloud backup not configured'
      : cloud.state === 'offline'
        ? `Offline — ${cloud.pending} report${cloud.pending === 1 ? '' : 's'} waiting for cloud backup`
        : cloud.state === 'syncing'
          ? `Syncing ${cloud.pending} to cloud…`
          : `Synced — ${cloud.total} backed up at ${clock(cloud.lastSyncAt)}`;
  return (
    <div className={'cloud ' + cloud.state} role="status">
      {text}
    </div>
  );
}
