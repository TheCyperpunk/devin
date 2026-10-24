// Detail panel for one report: all fields, score breakdown, assign / done / reopen, note edit.
import { useEffect, useState } from 'react';
import { LIMITS, bandOf, displayScore, waitBonus, type Report } from '@relief-mesh/shared';
import { NEED_ICON, NEED_LABEL, ago, dateTime, flags } from './format.js';
import type { DashboardStore } from './store.js';

export function Detail({ report: r, hubNow, store, onClose }: { report: Report; hubNow: number; store: DashboardStore; onClose: () => void }) {
  const [assignee, setAssignee] = useState(r.assignee ?? '');
  const [note, setNote] = useState(r.note ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A different report was selected, or this one changed on the hub: reset the inputs to it.
  useEffect(() => {
    setAssignee(r.assignee ?? '');
    setNote(r.note ?? '');
    setError(null);
  }, [r.id, r.revision, r.assignee, r.note]);

  async function run(label: string, body: Parameters<DashboardStore['patch']>[1]) {
    if (busy) return;
    setBusy(label);
    setError(await store.patch(r.id, body));
    setBusy(null);
  }

  const score = displayScore(r, hubNow);
  const wait = Math.round(waitBonus(r.reportedAt, hubNow));
  const band = bandOf(r, hubNow);
  const assigneeClean = assignee.trim();

  return (
    <aside className={'detail band-' + band} aria-label="Report details">
      <header>
        <div>
          <span className="score big">{score}</span>
          <span className="muted"> = base {r.baseScore} + waiting {wait}</span>
        </div>
        <button type="button" className="link" onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </header>

      <h2>{r.needs.map((n) => NEED_ICON[n] + ' ' + NEED_LABEL[n]).join(' · ')}</h2>
      <dl className="facts">
        <dt>People</dt>
        <dd>
          {r.peopleCount}
          {flags(r).length > 0 && <> · {flags(r).join(' · ')}</>}
        </dd>
        <dt>Reported by</dt>
        <dd>
          {r.reporterName} <span className="muted">(device {r.deviceId.slice(0, 8)})</span>
        </dd>
        <dt>Reported</dt>
        <dd>
          {ago(r.reportedAt, hubNow)} <span className="muted">· {dateTime(r.reportedAt)}</span>
        </dd>
        <dt>Reached hub</dt>
        <dd>{dateTime(r.receivedAt)}</dd>
        <dt>Location</dt>
        <dd>
          {r.lat !== null && r.lng !== null ? (
            <>
              {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
              {r.accuracyM !== null && <span className="muted"> (±{Math.round(r.accuracyM)} m)</span>}{' '}
              <a href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=17/${r.lat}/${r.lng}`} target="_blank" rel="noreferrer">
                open map ↗
              </a>
            </>
          ) : (
            <span className="muted">not shared</span>
          )}
        </dd>
        <dt>Status</dt>
        <dd className={'s-' + r.status}>
          {r.status === 'done' ? 'Done' : r.status === 'assigned' ? `Assigned to ${r.assignee}` : 'Open'}
        </dd>
      </dl>

      <label className="field">
        <span>Note</span>
        <textarea name="note" rows={3} maxLength={LIMITS.noteMax} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {note.trim() !== (r.note ?? '') && (
        <button type="button" className="btn" disabled={busy !== null} onClick={() => run('note', { note: note.trim() || null })}>
          {busy === 'note' ? 'Saving…' : 'Save note'}
        </button>
      )}

      <div className="actions">
        <label className="field">
          <span>Team / person</span>
          <input
            name="assignee"
            maxLength={LIMITS.assigneeMax}
            placeholder="e.g. Boat team 2"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            disabled={r.status === 'done'}
          />
        </label>
        {r.status !== 'done' && (
          <button
            type="button"
            className="btn primary"
            data-action="assign"
            disabled={busy !== null || !assigneeClean || (r.status === 'assigned' && assigneeClean === r.assignee)}
            onClick={() => run('assign', { status: 'assigned', assignee: assigneeClean })}
          >
            {busy === 'assign' ? 'Assigning…' : r.status === 'assigned' ? 'Reassign' : 'Assign'}
          </button>
        )}
        {r.status !== 'done' && (
          <button type="button" className="btn done" data-action="done" disabled={busy !== null} onClick={() => run('done', { status: 'done' })}>
            {busy === 'done' ? 'Saving…' : 'Mark done'}
          </button>
        )}
        {r.status !== 'open' && (
          <button
            type="button"
            className="btn"
            data-action="reopen"
            disabled={busy !== null}
            onClick={() => run('reopen', { status: 'open', assignee: null })}
          >
            {busy === 'reopen' ? 'Saving…' : 'Reopen'}
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
