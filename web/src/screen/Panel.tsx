// Right column of the big screen: calls by urgency (with pixel icons for people, child, elderly, kits), crews,
// and the water level as a segmented bar.
import { GAME, thuruthu, type GameView } from '@pralayam/shared';
import { KIT_WORD_SPRITE, nodeName } from './format.js';
import { COLOR_PX, SPRITES, spriteRects, type SpriteName } from './sprites.js';

export function Icon({ name, size = 16, title }: { name: SpriteName; size?: number; title?: string }) {
  const s = SPRITES[name];
  const w = Math.max(...s.rows.map((r) => r.length));
  const h = s.rows.length;
  const rects = spriteRects(s, 1);
  return (
    <svg className="icon" viewBox={`${-w / 2} ${-h} ${w} ${h}`} width={size * (w / h)} height={size} shapeRendering="crispEdges" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
      ))}
    </svg>
  );
}

export function Panel({ view }: { view: GameView }) {
  const open = view.calls
    .filter((c) => c.status === 'open')
    .map((c) => ({ c, u: view.urgency[c.id] ?? { score: 0, band: 'yellow' as const } }))
    .sort((a, b) => b.u.score - a.u.score || a.c.id.localeCompare(b.c.id));
  const nextRise = thuruthu.riseAfterRounds.find((r) => r >= view.round);
  const houses = thuruthu.nodes.filter((n) => n.kind === 'house' && !n.safe);
  const flooded = houses.filter((n) => view.waterLevel >= n.height).length;

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
              <span className="icons">
                {Array.from({ length: Math.min(c.remaining, 6) }, (_, i) => (
                  <Icon key={i} name={i < c.priorityLeft ? (c.hasChildren ? 'child' : 'elder') : 'person'} />
                ))}
                {c.remaining > 6 && <span className="more">+{c.remaining - 6}</span>}
                {c.kitsNeeded.map((k) => (
                  <Icon key={k} name={KIT_WORD_SPRITE[k]} title={k + ' kit needed'} />
                ))}
              </span>
              <span className="m">
                {c.remaining > 0 ? `${c.remaining} ${c.remaining === 1 ? 'person' : 'people'}` : 'everyone aboard'}
                {c.hasChildren ? ' · child' : ''}
                {c.hasElderlyOrSick ? ' · elderly' : ''}
                {c.urgent ? ' · urgent' : ''}
                {c.roofRounds !== null ? ` · roof ${c.roofRounds}` : ''}
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
              <span className="chip" style={{ background: COLOR_PX[b.color], opacity: contact ? 1 : 0.6 }} />
              <span className="name">{b.name}</span>
              {b.bot && <span className="tag">bot</span>}
              {!contact && <Icon name="radioOff" title="no signal" size={14} />}
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
        <span className="bar" role="img" aria-label={`water level ${view.waterLevel} of 4`}>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={'seg' + (view.waterLevel >= i ? ' on' : '')} />
          ))}
        </span>
        <span>
          Water <b>{view.waterLevel}</b>
          {view.phase === 'ended' ? '' : nextRise ? ` · rises after round ${nextRise}` : ' · no more rises'}
        </span>
      </div>
      <p className="hint needs">
        {flooded} of {houses.length} houses flooded · <Icon name="person" size={12} /> person · <Icon name="child" size={12} /> child · <Icon name="elder" size={12} /> elderly ·{' '}
        <Icon name="kitWater" size={12} /> <Icon name="kitFood" size={12} /> <Icon name="kitMed" size={12} /> kits
      </p>
    </aside>
  );
}
