// The primary view: every report sorted by urgency, with the top three critical ones pinned above the list.
import { bandOf, displayScore, type Report } from '@relief-mesh/shared';
import { NEED_ICON, NEED_LABEL, ago, flags, statusLabel } from './format.js';
import { FLASH_MS, type DashboardStore } from './store.js';

interface Props {
  sorted: Report[];
  hubNow: number;
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  store: DashboardStore;
}

export function ReportList({ sorted, hubNow, now, selectedId, onSelect, store }: Props) {
  if (sorted.length === 0) {
    return (
      <div className="empty">
        <h2>No reports yet</h2>
        <p className="muted">Reports from volunteers appear here the moment they reach the hub. Share the join code from the Join tab.</p>
      </div>
    );
  }
  const critical = sorted.filter((r) => r.status !== 'done').slice(0, 3);
  const isNew = (r: Report) => {
    const t = store.arrived(r.id);
    return t !== undefined && now - t < FLASH_MS;
  };
  return (
    <>
      {critical.length > 0 && (
        <section className="critical" aria-label="Most urgent">
          {critical.map((r) => (
            <button key={r.id} type="button" className={'crit band-' + bandOf(r, hubNow)} onClick={() => onSelect(r.id)}>
              <span className="score">{displayScore(r, hubNow)}</span>
              <span className="what">{r.needs.map((n) => NEED_ICON[n] + ' ' + NEED_LABEL[n]).join(' · ')}</span>
              <span className="meta">
                {r.peopleCount} people · {ago(r.reportedAt, hubNow)}
              </span>
            </button>
          ))}
        </section>
      )}
      <ol className="rows" aria-label="All reports">
        {sorted.map((r) => {
          const band = bandOf(r, hubNow);
          return (
            <li key={r.id}>
              <button
                type="button"
                data-id={r.id}
                className={'row band-' + band + (r.id === selectedId ? ' selected' : '') + (isNew(r) ? ' new' : '')}
                aria-pressed={r.id === selectedId}
                onClick={() => onSelect(r.id)}
              >
                <span className="stripe" aria-hidden="true" />
                <span className="score" title="Urgency score">
                  {displayScore(r, hubNow)}
                </span>
                <span className="main">
                  <span className="what">{r.needs.map((n) => NEED_ICON[n] + ' ' + NEED_LABEL[n]).join(' · ')}</span>
                  <span className="meta">
                    {r.peopleCount} people
                    {flags(r).map((f) => (
                      <span key={f} className={'flag' + (f === 'Urgent' ? ' urgent' : '')}>
                        {f}
                      </span>
                    ))}
                    · {r.reporterName} · {ago(r.reportedAt, hubNow)}
                  </span>
                  {r.note && <span className="note">{r.note}</span>}
                </span>
                <span className={'status s-' + r.status}>{statusLabel(r)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
