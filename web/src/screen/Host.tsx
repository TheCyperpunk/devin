// Host controls on the big screen: start, pause/resume, skip, end, new game, sound. All through the store.
import type { GameView } from '@relief-mesh/shared';
import type { ScreenStore } from './store.js';

export function Host({ view, store, busy, sound }: { view: GameView | null; store: ScreenStore; busy: boolean; sound: boolean }) {
  const phase = view?.phase ?? 'none';
  const on = (label: string, fn: () => void, extra = '') => (
    <button type="button" className={'btn small ' + extra} disabled={busy} onClick={fn} data-host={label.toLowerCase().replace(/\s+/g, '-')}>
      {label}
    </button>
  );
  return (
    <div className="host" aria-label="Host controls">
      {phase === 'lobby' && on('Start the night', () => void store.host('start'), 'lamp')}
      {phase === 'playing' && on('Pause', () => void store.host('pause'))}
      {phase === 'paused' && on('Resume', () => void store.host('resume'), 'lamp')}
      {(phase === 'playing' || phase === 'paused') && on('Skip round', () => void store.host('skip'))}
      {(phase === 'playing' || phase === 'paused') &&
        on('End', () => {
          if (window.confirm('End the night now?')) void store.host('end');
        }, 'ghost')}
      {(phase === 'ended' || phase === 'none') && on('New game', () => void store.newGame({}), 'lamp')}
      <button type="button" className={'btn small ghost sound' + (sound ? ' on' : '')} onClick={() => store.setSound(!sound)} aria-pressed={sound} aria-label={sound ? 'Mute' : 'Sound on'}>
        {sound ? '🔊' : '🔇'}
      </button>
    </div>
  );
}
