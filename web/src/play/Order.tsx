// The crew's screen: where you are, what the radio suggests (one tap: Go), the whole ward to tap a place and go,
// your route, and the single-move orders for fine control. Routes queue one move per round through the outbox.
import { useEffect, useState } from 'react';
import { GAME, KITS, type Boat, type GameView, type Order } from '@pralayam/shared';
import { COLOR_PX } from '../game/sprites.js';
import type { GameSync, GameSyncState } from '../lib/gameSync.js';
import { useLang } from './lang.js';
import { NODES, estimatedRound, legalOrders, nodeName, routeOrders, suggest, ward, type OrderOption } from './orders.js';
import { PhoneMap } from './PhoneMap.js';
import { useTick } from './useGame.js';

const KIT_ICON = { water: '💧', food: '🍚', medical: '🩺' } as const;

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function OrderScreen({ view, boat, state, sync }: { view: GameView; boat: Boat; state: GameSyncState; sync: GameSync }) {
  const { t, lang } = useLang();
  const now = useTick();
  const hubNow = now + state.clockOffset;
  const [picked, setPicked] = useState<number | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [warn, setWarn] = useState<{ steps: Order[]; target: string | null; mode: 'plan' | 'append' } | null>(null);
  const options = legalOrders(view, boat);
  const inZone = !(NODES[boat.nodeId]?.signal ?? true);
  const contact = state.hub === 'online' && !state.noSignal && !inZone && (state.viewAt === null || now - state.viewAt < 25_000);
  const unapplied = state.unsent + state.queued;
  const remaining = view.deadlineAt !== null ? view.deadlineAt - hubNow : 0;
  const round = contact ? view.round : estimatedRound(view, hubNow);
  const tip = suggest(view, boat);
  const plan = state.plan;
  const routePath = target ? ward.shortestPath(boat.nodeId, target) ?? [] : plan ? ward.shortestPath(boat.nodeId, plan.target) ?? [] : tip ? tip.path : [];
  const highlighted = target ?? plan?.target ?? tip?.nodeId ?? null;
  const here = view.boats.filter((b) => b.id !== boat.id && b.nodeId === boat.nodeId).map((b) => b.name);

  // A new round clears the selection; mere revision bumps (another crew's order, a heartbeat) must not.
  useEffect(() => {
    setPicked(null);
    setTarget(null);
  }, [view.round]);
  useEffect(() => {
    if (sentAt === null) return;
    const id = window.setTimeout(() => setSentAt(null), 2000);
    return () => window.clearTimeout(id);
  }, [sentAt]);

  const movesWord = (n: number) => (n === 1 ? t('oneMove') : t('movesAway', { n }));
  const entersDeadZone = (steps: Order[]) => steps.some((o) => o.type === 'move' && !(NODES[o.nodeId]?.signal ?? true));

  /** Send a whole plan (or one more order). Asks first when the plan enters a dead zone. */
  async function go(steps: Order[], dest: string | null, mode: 'plan' | 'append', force = false) {
    if (steps.length === 0) return;
    if (contact && !force && entersDeadZone(steps)) return setWarn({ steps, target: dest, mode });
    setWarn(null);
    if (mode === 'plan') await sync.plan(steps, dest);
    else for (const o of steps) await sync.submit(o, 'append');
    setSentAt(Date.now());
    setPicked(null);
    setTarget(null);
  }
  async function goWithReturn(w: NonNullable<typeof warn>) {
    if (boat.standingOrder !== 'return') await sync.submit({ type: 'standing', mode: 'return' }, 'append');
    await go(w.steps, w.target, w.mode, true);
  }
  const sendPicked = (mode: 'plan' | 'append') => {
    const o = picked !== null ? options[picked] : undefined;
    if (o) void go([o.order], o.kind === 'move' ? o.nodeId : null, mode);
  };

  const label = (o: OrderOption) => {
    switch (o.kind) {
      case 'move':
        return t('move') + ' · ' + nodeName(o.nodeId, lang);
      case 'rescue':
        return t('rescueHere', { n: Math.min(o.people, GAME.capacity - boat.passengers.length) });
      case 'drop':
        return t('dropKit', { kit: t(o.kit === 'water' ? 'waterKit' : o.kit === 'food' ? 'foodKit' : 'medicalKit') });
      case 'return':
        return t('returnTo', { place: nodeName(o.nodeId, lang) });
      default:
        return t('hold');
    }
  };
  const detail = (o: OrderOption) => {
    const bits: string[] = [];
    if (o.kind === 'move' || o.kind === 'return') {
      if (o.people) bits.push(t('peopleWaiting', { n: o.people }));
      if (o.score) bits.push(String(o.score));
      if (o.deadZone) bits.push(t('noSignalThere'));
      if (o.kind === 'return') bits.push(movesWord(o.steps ?? 1));
      if (o.kind === 'return' && boat.passengers.length) bits.push(t('unload', { n: boat.passengers.length }));
    }
    if (o.kind === 'rescue') bits.push(t('fillsBoat'));
    if (o.kind === 'drop') bits.push(o.needed ? t('kitNeeded') : t('kitNotNeeded'));
    if (o.kind === 'hold') bits.push(t('holdHint'));
    return bits.join(' · ');
  };

  const targetCall = target ? view.calls.find((c) => c.status === 'open' && c.nodeId === target) : null;

  return (
    <div className="stack" data-screen="order">
      {!contact && (
        <div className="banner" role="status" data-testid="no-signal">
          <span className="radio-x">✕</span>
          <span>
            {state.hub === 'offline' ? t('hubOffline') : t('noSignal')}
            {unapplied ? ` · ${t('ordersQueued', { n: unapplied })}` : ''}
            <br />
            <small>
              {t('lastUpdate', { s: Math.max(0, Math.round((now - (state.viewAt ?? now)) / 1000)) })} · ~{t('roundN', { n: round })}
            </small>
          </span>
          <button type="button" className="btn small" onClick={() => void sync.retryNow()} data-testid="retry">
            {t('retryNow')}
          </button>
        </div>
      )}
      {warn !== null && (
        <div className="panel pad stack warn" role="alertdialog" aria-label={t('deadZoneTitle')} data-testid="dead-zone-warn">
          <div className="display h2">{t('deadZoneTitle')}</div>
          <p>{t('deadZoneBody')}</p>
          <button type="button" className="btn lamp big" onClick={() => void goWithReturn(warn)} data-testid="go-return">
            {t('deadZoneGoReturn')}
          </button>
          <button type="button" className="btn big" onClick={() => void go(warn.steps, warn.target, warn.mode, true)} data-testid="go-anyway">
            {t('deadZoneGoAnyway')}
          </button>
          <button type="button" className="btn big ghost" onClick={() => setWarn(null)}>
            {t('cancel')}
          </button>
        </div>
      )}

      <div className="strip">
        <span className="hull" style={{ background: COLOR_PX[boat.color] }} />
        <span className="who">{boat.name}</span>
        <span className="round display">{contact ? t('roundN', { n: round }) : '~' + t('roundN', { n: round })}</span>
        <span className={'timer display' + (contact && remaining > 0 && remaining < 10_000 ? ' low' : '')} data-testid="timer">
          {view.phase === 'paused' ? t('paused') : contact && remaining > 0 ? clock(remaining) : '—'}
        </span>
      </div>
      <div className="strip sub">
        <span className="seats" aria-label={`${boat.passengers.length} of ${GAME.capacity} aboard`}>
          {Array.from({ length: GAME.capacity }, (_, i) => (
            <i key={i} className={i < boat.passengers.length ? 'on' : ''} />
          ))}
        </span>
        <span>{t('aboardCount', { n: boat.passengers.length, max: GAME.capacity })}</span>
        {unapplied > 0 && <span className="queued display" data-testid="queued">{t('ordersQueued', { n: unapplied })}</span>}
        <span className="kits">
          {KITS.map((k) => (
            <span key={k} className={boat.kits[k] ? '' : 'out'}>
              {KIT_ICON[k]}
              {boat.kits[k]}
            </span>
          ))}
        </span>
      </div>

      {state.notice && (
        <p className="notice" role="alert">
          {state.notice === 'late' ? t('orderLate') : state.notice === 'invalid' ? t('orderInvalid') : state.notice === 'ended' ? t('nightOver') : t('errGeneric')}
        </p>
      )}
      {state.lastRound && state.lastRoundAt !== null && now - state.lastRoundAt < 6000 && <RoundCard payload={state.lastRound} boatId={boat.id} lang={lang} />}

      {/* the radio: one line, one button */}
      <div className={'radio' + (tip ? '' : ' quiet')} data-testid="radio">
        <span className="label">{t('radio')}</span>
        <span className="txt">
          {tip
            ? tip.kind === 'call'
              ? t('radioCall', { place: nodeName(tip.nodeId, lang), n: tip.people, prio: tip.priority ? t('radioPriority') : '' })
              : t('radioReturn', { place: nodeName(tip.nodeId, lang) })
            : t('radioQuiet')}
          {tip && <small>{movesWord(tip.path.length)}</small>}
        </span>
        {tip && (
          <button type="button" className="btn lamp" onClick={() => void go(tip.kind === 'call' ? routeOrders(boat.nodeId, tip.nodeId) : [{ type: 'return' }], tip.nodeId, 'plan')} data-testid="radio-go">
            {t('go')}
          </button>
        )}
      </div>

      <PhoneMap view={view} boat={boat} target={highlighted} path={routePath} dim={!contact} lang={lang} onPick={(id) => setTarget(id === boat.nodeId ? null : id)} />
      <p className="hint center">
        {t('youAreAt', { place: nodeName(boat.nodeId, lang) })}
        {here.length ? ' · ' + t('othersHere', { names: here.join(', ') }) : ''} · {t('tapMap')}
      </p>

      {target && (
        <div className="pick" data-testid="pick">
          <span className="txt">
            <b>{t('goTo', { place: nodeName(target, lang) })}</b> · {movesWord(ward.distance(boat.nodeId, target))}
            {targetCall ? ' · ' + t('peopleWaiting', { n: targetCall.remaining }) : ''}
            {!(NODES[target]?.signal ?? true) ? ' · ' + t('noSignalThere') : ''}
          </span>
          <div className="btns">
            <button type="button" className="btn lamp" onClick={() => void go(routeOrders(boat.nodeId, target), target, 'plan')} data-testid="pick-go">
              {t('go')}
            </button>
            <button type="button" className="btn ghost" onClick={() => setTarget(null)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {plan && unapplied > 0 && (
        <div className="route" data-testid="route">
          <span className="num">▶</span>
          <span>{t('enRoute', { place: nodeName(plan.target, lang), n: unapplied })}</span>
        </div>
      )}

      <details className="byhand">
        <summary>{t('orByHand')}</summary>
        <div className="rows" role="listbox" aria-label={t('yourOrder')}>
          {options.map((o, i) => (
            <button key={i} type="button" role="option" aria-selected={picked === i} className={'row' + (picked === i ? ' sel' : '') + (o.band ? ' band-' + o.band : '')} data-kind={o.kind} data-node={o.nodeId} onClick={() => setPicked(i)}>
              <span className="ico">{o.kind === 'move' ? '➜' : o.kind === 'rescue' ? '⊕' : o.kind === 'drop' ? KIT_ICON[o.kit!] : o.kind === 'return' ? '▲' : '■'}</span>
              <span className="txt">
                {label(o)}
                <small>{detail(o)}</small>
              </span>
              {o.people > 0 && o.kind !== 'drop' && <span className="num badge">{o.people}</span>}
            </button>
          ))}
        </div>
        <button type="button" className={'btn lamp big' + (sentAt ? ' sent' : '')} disabled={picked === null} onClick={() => sendPicked('plan')} data-testid="send">
          {sentAt ? '✓ ' + (contact ? t('orderSent') : t('orderQueuedOne')) : unapplied > 0 && contact ? t('changeOrder') : contact ? t('sendOrder') : t('queueOrder')}
        </button>
        {unapplied > 0 && picked !== null && (
          <button type="button" className="btn big" onClick={() => sendPicked('append')} data-testid="queue-next">
            {t('queueNext')}
          </button>
        )}
      </details>

      <div className="standing">
        <span>{t('ifNoSignal')}</span>
        <span className="seg" role="group" aria-label={t('ifNoSignal')}>
          <button type="button" className={boat.standingOrder === 'hold' ? 'on' : ''} onClick={() => void sync.submit({ type: 'standing', mode: 'hold' }, 'append')}>
            {t('hold')}
          </button>
          <button type="button" className={boat.standingOrder === 'return' ? 'on' : ''} onClick={() => void sync.submit({ type: 'standing', mode: 'return' }, 'append')}>
            {t('returnHome')}
          </button>
        </span>
      </div>
    </div>
  );
}

/** What happened to you last round, as one card. */
function RoundCard({ payload, boatId, lang }: { payload: { round: number; events: { type: string; boatId?: string; nodeId?: string; count?: number; points: number }[]; scoreAfter: number }; boatId: string; lang: 'en' | 'ml' }) {
  const { t } = useLang();
  const mine = payload.events.filter((e) => e.boatId === boatId);
  const pts = mine.reduce((n, e) => n + e.points, 0);
  const rescued = mine.filter((e) => e.type === 'rescued').reduce((n, e) => n + (e.count ?? 0), 0);
  const saved = mine.filter((e) => e.type === 'saved').reduce((n, e) => n + (e.count ?? 0), 0);
  const where = mine.find((e) => e.type === 'rescued' || e.type === 'saved')?.nodeId;
  const invalid = mine.some((e) => e.type === 'invalid');
  const line = saved ? t('youSaved', { n: saved, place: nodeName(where ?? '', lang) }) : rescued ? t('youRescued', { n: rescued, place: nodeName(where ?? '', lang) }) : invalid ? t('orderInvalid') : t('nothingThisRound');
  return (
    <div className="result pop" role="status" data-testid="round-card">
      <div className="label">{t('roundN', { n: payload.round })}</div>
      <div className={'display pts' + (pts < 0 ? ' neg' : '')}>{pts > 0 ? '+' + pts : pts}</div>
      <div>{line}</div>
      <small className="hint">{t('teamScore', { n: payload.scoreAfter })}</small>
    </div>
  );
}
