// First light on the phone: team score, stars, what this boat delivered.
import type { Boat, GameView } from '@pralayam/shared';
import { COLOR_PX } from '../game/sprites.js';
import { useLang } from './lang.js';

export function EndScreen({ view, boat }: { view: GameView; boat: Boat | null }) {
  const { t } = useLang();
  const saved = view.boats.reduce((n, b) => n + b.saved, 0);
  const people = view.calls.reduce((n, c) => n + c.peopleCount, 0);
  return (
    <section className="panel pad stack end" data-screen="end">
      <h1 className="display h2">{t('firstLight')}</h1>
      <div className="score display">{String(view.score).padStart(4, '0')}</div>
      <div className="stars" role="img" aria-label={`${view.stars} of 3`}>
        {'★'.repeat(view.stars)}
        {'☆'.repeat(3 - view.stars)}
      </div>
      <p>{t('teamSaved', { n: saved, of: people })}</p>
      {boat && (
        <div className="boatRow">
          <span className="hull" style={{ background: COLOR_PX[boat.color] }} />
          <span>{t('youDelivered', { n: boat.saved })}</span>
        </div>
      )}
      <p className="hint">{t('lookAtScreen')}</p>
    </section>
  );
}
