// Top bar (title, round, countdown, stars) and bottom bar (score, people, join QR, host controls).
import { thuruthu, type GameView } from '@pralayam/shared';
import type { JoinInfo } from '@pralayam/shared';
import { clockText, totals } from './format.js';
import { Host } from './Host.js';
import { SPRITES, spriteRects } from '../game/sprites.js';
import type { ScreenStore } from './store.js';
import { useTween } from './useStore.js';

/** A 9×7 pixel star. */
export function Star({ on }: { on: boolean }) {
  const rects = spriteRects(on ? SPRITES.star : SPRITES.starOff, 1);
  return (
    <svg aria-hidden="true" viewBox="-4.5 -7 9 7" shapeRendering="crispEdges">
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
      ))}
    </svg>
  );
}

/** Scores read like an arcade counter: 0170, -045. */
export function padScore(n: number): string {
  return n < 0 ? '-' + String(-n).padStart(3, '0') : String(n).padStart(4, '0');
}

export function TopBar({ view, hubNow, hub }: { view: GameView | null; hubNow: number; hub: string }) {
  const remaining = view?.deadlineAt ? view.deadlineAt - hubNow : 0;
  const timer = view?.phase === 'paused' ? 'Paused' : view?.phase === 'playing' ? clockText(remaining) : view?.phase === 'ended' ? 'Dawn' : '—';
  return (
    <header className="bar top">
      <div className="brand">
        <img className="mark" src="/icon.svg" alt="" width="56" height="56" />
        <span className="display title">Pralayam</span>
        <span className="muted sub">{thuruthu.name} · 16 August, night</span>
      </div>
      <div className="right">
        {hub === 'offline' && <span className="tag bad">hub unreachable</span>}
        <div className="round">
          <span className="label">Round</span>
          <span className="num big" data-testid="round">{view?.round ?? 0}</span>
          <span className="hint">/ {thuruthu.rounds}</span>
        </div>
        <div className={'timer' + (remaining > 0 && remaining < 10_000 && view?.phase === 'playing' ? ' low' : '')} aria-live="off">
          <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span className="num" data-testid="timer">{timer}</span>
        </div>
        <div className="stars" role="img" aria-label={`${view?.stars ?? 0} of 3 stars`}>
          {[1, 2, 3].map((i) => (
            <Star key={i} on={(view?.stars ?? 0) >= i} />
          ))}
        </div>
      </div>
    </header>
  );
}

export function BottomBar({ view, join, store, busy, sound }: { view: GameView | null; join: JoinInfo | null; store: ScreenStore; busy: boolean; sound: boolean }) {
  const score = useTween(view?.score ?? 0);
  const t = view ? totals(view) : null;
  return (
    <footer className="bar bottom">
      <div className="score">
        <span className="label">Score</span>
        <span className="num huge" data-testid="score">{padScore(score)}</span>
      </div>
      {t && (
        <div className="people">
          <span>
            <b className="good">{t.saved}</b> saved
          </span>
          <span>
            <b>{t.waiting}</b> waiting
          </span>
          <span>
            <b className="aboard">{t.aboard}</b> aboard
          </span>
          <span>
            <b className="bad">{t.lost}</b> lost
          </span>
        </div>
      )}
      <Host view={view} store={store} busy={busy} sound={sound} />
      <div className="join">
        <span className="muted joinText">
          Scan to crew a boat
          <br />
          <span className="hint">{join ? `${new URL(join.joinUrl).host} · code ${join.joinCode}` : '…'}</span>
        </span>
        {join ? <img className="qr" src={join.qrDataUrl} alt={'QR code for ' + join.joinUrl} width="84" height="84" /> : <span className="qr placeholder" />}
      </div>
    </footer>
  );
}
