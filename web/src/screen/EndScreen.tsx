// "First light": stars, three numbers with one real line from 2018 each, crews ranked, play again / the real tool.
import type { GameView } from '@pralayam/shared';
import { Star, padScore } from './Bars.js';
import { COLOR_HEX, totals } from './format.js';
import type { ScreenStore } from './store.js';

export function EndScreen({ view, store, busy }: { view: GameView; store: ScreenStore; busy: boolean }) {
  const t = totals(view);
  const priorityPct = t.saved ? Math.round((t.priority / t.saved) * 100) : 0;
  const ranked = [...view.boats].sort((a, b) => b.saved - a.saved || a.name.localeCompare(b.name));
  const verdict = t.lost === 0 && t.saved >= t.people ? 'Everyone came home.' : t.lost === 0 ? 'Nobody was lost to the water tonight.' : `${t.lost} were still on their roofs at first light.`;
  return (
    <div className="overlay end">
      <div className="panel endPanel pop">
        <div className="head">
          <span className="display h1">First light</span>
          <span className="muted">{view.round} rounds · team score</span>
          <span className="num huge">{padScore(view.score)}</span>
          <span className="stars big" role="img" aria-label={`${view.stars} of 3 stars`}>
            {[1, 2, 3].map((i) => (
              <Star key={i} on={view.stars >= i} />
            ))}
          </span>
        </div>
        <div className="stats">
          <div className="stat">
            <div className="big num good">
              {t.saved} <span className="of">of {t.people}</span>
            </div>
            <div className="h">people saved</div>
            <div className="l">In 2018, fishermen’s boats from the coast saved more people than any agency.</div>
          </div>
          <div className="stat">
            <div className="big num lamp">{priorityPct}%</div>
            <div className="h">children and elderly first</div>
            <div className="l">Call-centre volunteers triaged every call before passing it on.</div>
          </div>
          <div className="stat">
            <div className="big num grey">{t.outOfContactRounds}</div>
            <div className="h">crew-rounds out of contact</div>
            <div className="l">Networks faltered; WhatsApp groups became the control room.</div>
          </div>
        </div>
        <div className="verdict">
          <span className="display">{verdict}</span>
          <span className="ask">What would you do differently next time?</span>
        </div>
        <div className="ranked glass">
          <span className="label">Crews</span>
          {ranked.map((b) => (
            <span key={b.id} className="rank">
              <span className="boat" style={{ background: COLOR_HEX[b.color] }} />
              <b>{b.name}</b> {b.saved}
              {b.bot && <span className="tag">bot</span>}
            </span>
          ))}
          {t.lost > 0 && <span className="hint lost">{t.lost} lost to the water</span>}
        </div>
        <div className="actions">
          <span className="hint">Every order from every phone arrived exactly once, even from the dead zones. Works with no Internet.</span>
          <button type="button" className="btn lamp" disabled={busy} onClick={() => void store.newGame({})} data-host="new">
            Play again
          </button>
        </div>
      </div>
    </div>
  );
}
