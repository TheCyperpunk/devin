// "My reports": everything this phone created, with a status chip. Phase 5 updates the chips from the hub.
import { useEffect, useState } from 'react';
import { listReports, type LocalReport } from '../lib/db.js';
import { timeAgo } from '../lib/timeago.js';
import { useLang } from './lang.js';

export function MyReports({ refreshKey }: { refreshKey: number }) {
  const { t } = useLang();
  const [items, setItems] = useState<LocalReport[] | null>(null);

  useEffect(() => {
    let live = true;
    void listReports().then((r) => live && setItems(r));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (items === null) return null;
  if (items.length === 0) return <p className="muted center">{t('noReports')}</p>;

  const now = Date.now();
  return (
    <ul className="reports">
      {items.map((r) => (
        <li key={r.id} className="card pad report" data-state={r.syncState}>
          <div className="row">
            <strong>{r.input.needs.map((n) => t(n)).join(' · ')}</strong>
            <Chip r={r} />
          </div>
          <div className="muted">
            {r.input.peopleCount} · {timeAgo(r.createdAtLocal, now, t)}
            {r.input.urgent ? ' · ' + t('urgent') : ''}
          </div>
          {/* Once the hub has the report, its copy of the note wins: the coordinator may have corrected it. */}
          {(r.report ? r.report.note : r.input.note) && <div className="note">{r.report ? r.report.note : r.input.note}</div>}
          {r.syncState === 'rejected' && r.rejectReason && (
            <div className="error">{t('rejectedWhy', { reason: r.rejectReason })}</div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Chip({ r }: { r: LocalReport }) {
  const { t } = useLang();
  const hub = r.report;
  if (r.syncState === 'rejected') return <span className="chip bad">{t('rejected')}</span>;
  if (hub?.status === 'done') return <span className="chip done">{t('done')}</span>;
  if (hub?.status === 'assigned') return <span className="chip assigned">{t('assignedTo', { name: hub.assignee ?? '' })}</span>;
  if (r.syncState === 'sent') return <span className="chip sent">{t('sentToHub')}</span>;
  return <span className="chip saved">{t('savedOnPhone')}</span>;
}
