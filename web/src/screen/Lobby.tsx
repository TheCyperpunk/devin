// Lobby overlay: the QR to join, crews docking as phones join, round length and bots, Start. Also the "no game yet" card.
import { useState } from 'react';
import { thuruthu, type GameView } from '@relief-mesh/shared';
import type { JoinInfo } from '../dashboard/api.js';
import { COLOR_HEX } from './format.js';
import type { ScreenStore } from './store.js';

export function Lobby({ view, join, store, busy }: { view: GameView | null; join: JoinInfo | null; store: ScreenStore; busy: boolean }) {
  const [seconds, setSeconds] = useState<30 | 45 | 60>(45);
  const [bots, setBots] = useState(true);
  const crews = view?.boats ?? [];

  return (
    <div className="overlay">
      <div className="lobbyTitle rise">
        <div className="display h1">Pralayam</div>
        <div className="muted">{thuruthu.name} · the night of 16 August · a co-op rescue for everyone in the room</div>
      </div>
      <div className="panel lobby rise">
        <div className="qrSide">
          {join ? <img className="bigqr" src={join.qrDataUrl} alt={'QR code for ' + join.joinUrl} /> : <div className="bigqr placeholder" />}
          <div className="scan">Scan to crew a boat</div>
          <div className="hint">
            or open <span className="muted">{join ? new URL(join.joinUrl).host : '…'}</span> and type <span className="code">{join?.joinCode ?? '…'}</span>
          </div>
        </div>
        <div className="crewSide">
          <div className="head">
            <span className="label">Crews at the jetty</span>
            <span className="hint">
              {crews.length} joined{bots ? ' · bots fill to 3' : ''}
            </span>
          </div>
          {view ? (
            <>
              {crews.map((b) => (
                <div key={b.id} className="crewRow" data-crew={b.id}>
                  <span className="boat" style={{ background: COLOR_HEX[b.color] }} />
                  {b.name}
                  <span className="tag r">ready</span>
                </div>
              ))}
              <div className="crewRow dashed hint">Next boat docks here as a phone joins</div>
            </>
          ) : (
            <div className="crewRow dashed hint">No game open yet. Open the lobby below.</div>
          )}
          <div className="rules hint">
            {thuruthu.rounds} rounds · the water rises after rounds {thuruthu.riseAfterRounds.join(', ')}. Children and the elderly first. In the bend and the
            paddy fields there is no signal.
          </div>
          <div className="actions">
            {view ? (
              <button type="button" className="btn lamp" disabled={busy} onClick={() => void store.host('start')} data-host="start">
                Start the night
              </button>
            ) : (
              <>
                <label className="opt">
                  Round
                  <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value) as 30 | 45 | 60)}>
                    <option value={30}>30 s</option>
                    <option value={45}>45 s</option>
                    <option value={60}>60 s</option>
                  </select>
                </label>
                <label className="opt">
                  <input type="checkbox" checked={bots} onChange={(e) => setBots(e.target.checked)} /> bots
                </label>
                <button type="button" className="btn lamp" disabled={busy} onClick={() => void store.newGame({ roundSeconds: seconds, bots })} data-host="new">
                  Open the lobby
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="hint foot">Works with no Internet · the same hub runs the Relief Mesh coordination tool</div>
    </div>
  );
}
