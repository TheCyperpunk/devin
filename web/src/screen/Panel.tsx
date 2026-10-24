// Right column of the big screen: calls by urgency, crews, water level.
import { GAME, thuruthu, type GameView } from '@relief-mesh/shared';
import { COLOR_HEX, KIT_WORD, NEED_WORD, nodeName } from './format.js';

export function Panel({ view }: { view: GameView }) {
  const open = view.calls
    .filter((c) => c.status === 'open')
    .map((c) => ({ c, u: view.urgency[c.id] ?? { score: 0, band: 'yellow' as const } }))
    .sort((a, b) => b.u.score - a.u.score || a.c.id.localeCompare(b.c.id));
  const nextRise = thuruthu.riseAfterRounds.find((r) => r >= view.round);

  return (
    <aside className="side">
      <section className="calls">
        <div className="head">
          <span className="label">Calls by urgency</span>
          <span className="hint">{open.length} open</span>
        </div>
        {open.length === 0 && <p className="hint quiet">No calls yet. The radio is quiet.</p>}
        {open.slice(0, 6).map(({ c, u }) => (
          <div key={c.id} className={'call band-' + u.band} data-call={c.id}>
            <span className="score num">{u.score}</span>
            <span className="what">
              <span className="t">{nodeName(c.nodeId)}</span>
              <span className="m">
                {c.remaining > 0 ? `${c.remaining} ${c.remaining === 1 ? 'person' : 'people'}` : 'everyone aboard'}
                {c.hasChildren ? ' · child' : ''}
                {c.hasElderlyOrSick ? ' · elderly' : ''}
                {c.urgent ? ' · urgent' : ''}
                {c.kitsNeeded.length ? ' · needs ' + c.kitsNeeded.map((k) => KIT_WORD[k]).join(', ') : ''}
                {c.roofRounds !== null ? ` · on the roof, ${c.roofRounds} ${c.roofRounds === 1 ? 'round' : 'rounds'} left` : ''}
              </span>
            </span>
          </div>
        ))}
        {open.length > 6 && <p className="hint">+{open.length - 6} more on the map</p>}
      </section>

      <section className="crews">
        <span className="label">Crews</span>
        {view.boats.map((b) => {
          const contact = view.contact[b.id] ?? true;
          return (
            <div key={b.id} className={'crew' + (contact ? '' : ' off')} data-crew={b.id}>
              <span className="chip" style={{ background: COLOR_HEX[b.color], opacity: contact ? 1 : 0.6 }} />
              <span className="name">{b.name}</span>
              {b.bot && <span className="tag">bot</span>}
              {!contact && (
                <svg aria-label="no signal" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8A93A6" strokeWidth="1.75" strokeLinecap="round">
                  <path d="M2 2l20 20M5 12.5a9 9 0 0 1 3-2.5M8.5 16a5 5 0 0 1 3-1.5M12 19.5h.01M2 9a14 14 0 0 1 5.5-3.5M16 11a9 9 0 0 1 3 1.5" />
                </svg>
              )}
              <span className="r">
                {nodeName(b.nodeId)} · {b.passengers.length}/{GAME.capacity}
                {contact ? '' : ' · no signal'}
                {b.plan === 'return' ? ' · returning' : ''}
              </span>
            </div>
          );
        })}
      </section>

      <div className="water glass">
        <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2FA8C4" strokeWidth="1.75" strokeLinecap="round">
          <path d="M3 15c3-3 6 3 9 0s6 3 9 0M3 10c3-3 6 3 9 0s6 3 9 0" />
        </svg>
        <span>
          Water level <b>{view.waterLevel}</b>
          {view.phase === 'ended' ? '' : nextRise ? ` · rises again after round ${nextRise}` : ' · no more rises'}
        </span>
      </div>
      <p className="hint needs">
        {thuruthu.nodes.filter((n) => n.kind === 'house' && !n.safe && view.waterLevel >= n.height).length} of{' '}
        {thuruthu.nodes.filter((n) => n.kind === 'house' && !n.safe).length} houses flooded · needs: {Object.values(NEED_WORD).join(', ')}
      </p>
    </aside>
  );
}
