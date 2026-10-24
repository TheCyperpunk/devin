// The whole ward on the phone: every house, call and boat, your boat and route highlighted, tap a place to go.
import { useMemo } from 'react';
import { GAME, thuruthu, type Boat, type GameView } from '@pralayam/shared';
import { channelPath, edges } from '../game/river.js';
import { COLOR_PX, P, SPRITES, snap, spriteRects, type SpriteName } from '../game/sprites.js';
import { NODES, nodeName, ward } from './orders.js';

const PX = 3;

function spriteFor(kind: string, flooded: boolean, hasCall: boolean): SpriteName {
  switch (kind) {
    case 'camp':
      return 'camp';
    case 'hospital':
      return 'hospital';
    case 'temple':
      return 'temple';
    case 'school':
      return 'school';
    case 'jetty':
      return 'jetty';
    case 'junction':
      return 'junction';
    default:
      return flooded ? 'houseFlooded' : hasCall ? 'house' : 'houseDark';
  }
}

function Sprite({ name, x, y, override }: { name: SpriteName; x: number; y: number; override?: Record<string, string> }) {
  const rects = useMemo(() => spriteRects(SPRITES[name], PX, override), [name, override]);
  return (
    <g transform={`translate(${x} ${y})`}>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
      ))}
    </g>
  );
}

export function PhoneMap({
  view,
  boat,
  target,
  path,
  dim,
  lang,
  onPick,
}: {
  view: GameView;
  boat: Boat;
  /** Where the boat is heading (highlighted) and the nodes on the way. */
  target: string | null;
  path: string[];
  dim?: boolean;
  lang: 'en' | 'ml';
  onPick: (nodeId: string) => void;
}) {
  const e = useMemo(() => edges(view.waterLevel), [view.waterLevel]);
  const channel = useMemo(() => channelPath(e), [e]);
  const open = view.calls.filter((c) => c.status === 'open');
  const callAt = new Map(open.map((c) => [c.nodeId, c]));
  const onPath = new Set(path);
  const boatsAt = new Map<string, number>();

  return (
    <svg className={'phonemap' + (dim ? ' dim' : '')} viewBox="0 0 1000 600" shapeRendering="crispEdges" role="img" aria-label={`Map of ${thuruthu.name}`}>
      <defs>
        <pattern id="pmChecker" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill={P.grey} opacity=".3" />
          <rect x="4" y="4" width="4" height="4" fill={P.grey} opacity=".3" />
        </pattern>
      </defs>
      <rect width="1000" height="600" fill="#1a2a4d" />
      <path d={channel} fill="#2a8fb8" />
      <path d={channel} fill="none" stroke={P.foam} strokeWidth="3" opacity=".8" />
      {thuruthu.nodes
        .filter((n) => !n.signal)
        .map((n) => (
          <rect key={n.id} x={snap(n.x) - 60} y={snap(n.y) - 60} width="120" height="120" fill="url(#pmChecker)" stroke={P.grey} strokeWidth="2" strokeDasharray="8 8" />
        ))}
      {/* roads, the route on top in yellow */}
      <g strokeLinecap="square">
        {thuruthu.edges.map(([a, b]) => {
          const routed = onPath.has(a) && onPath.has(b) && Math.abs(path.indexOf(a) - path.indexOf(b)) === 1;
          return (
            <line
              key={a + b}
              x1={snap(NODES[a]!.x)}
              y1={snap(NODES[a]!.y)}
              x2={snap(NODES[b]!.x)}
              y2={snap(NODES[b]!.y)}
              stroke={routed ? P.yellow : '#b7874a'}
              strokeWidth={routed ? 8 : 3}
              strokeDasharray={routed ? undefined : '8 6'}
              opacity={routed ? 1 : 0.9}
            />
          );
        })}
      </g>
      {/* places: tap to go */}
      {thuruthu.nodes.map((n) => {
        const flooded = n.kind === 'house' && !n.safe && view.waterLevel >= n.height;
        const c = callAt.get(n.id);
        const band = c ? view.urgency[c.id]?.band : undefined;
        const color = band === 'red' ? P.red : band === 'orange' ? P.orange : band === 'yellow' ? P.yellow : null;
        const x = snap(n.x);
        const y = snap(n.y);
        const mine = n.id === boat.nodeId;
        const isTarget = n.id === target;
        return (
          <g key={n.id} data-node={n.id} onClick={() => onPick(n.id)} style={{ cursor: 'pointer' }}>
            <rect x={x - 48} y={y - 60} width="96" height="100" fill="transparent" />
            {(mine || isTarget) && <rect x={x - 44} y={y - 50} width="88" height="76" fill="none" stroke={mine ? COLOR_PX[boat.color] : P.yellow} strokeWidth="4" strokeDasharray={isTarget && !mine ? '8 6' : undefined} />}
            <Sprite name={spriteFor(n.kind, flooded, !!c)} x={x} y={y + 12} />
            {c && color && (
              <g>
                <rect x={x - 18} y={y - 56} width="36" height="36" fill={P.black} stroke={color} strokeWidth="4" />
                <text x={x} y={y - 31} textAnchor="middle" fontFamily="'Press Start 2P', monospace" fontSize="14" fill={P.white}>
                  {c.remaining > 0 ? c.remaining : '✓'}
                </text>
              </g>
            )}
            {(mine || isTarget || c) && (
              <text x={x} y={y + 34} textAnchor="middle" fontFamily="'Pixelify Sans', sans-serif" fontSize="18" fontWeight="700" fill={mine ? P.yellow : P.white} stroke={P.black} strokeWidth="3" paintOrder="stroke">
                {nodeName(n.id, lang).toUpperCase()}
              </text>
            )}
          </g>
        );
      })}
      {/* every boat: yours first so it is drawn on top */}
      {[...view.boats].sort((a, b) => (a.id === boat.id ? 1 : b.id === boat.id ? -1 : 0)).map((b) => {
        const n = NODES[b.nodeId] ?? NODES[thuruthu.startNodeId]!;
        const k = boatsAt.get(b.nodeId) ?? 0;
        boatsAt.set(b.nodeId, k + 1);
        const x = snap(n.x) + 40 + k * 10;
        const y = snap(n.y) + 2 - k * 16;
        const me = b.id === boat.id;
        return (
          <g key={b.id} transform={`translate(${x} ${y})`} opacity={view.contact[b.id] === false ? 0.5 : 1}>
            <Sprite name="boat" x={0} y={0} override={{ C: COLOR_PX[b.color] }} />
            {Array.from({ length: GAME.capacity }, (_, i) => (
              <rect key={i} x={-12 + i * 7} y={-24} width="5" height="5" fill={i < b.passengers.length ? P.white : P.black} stroke={COLOR_PX[b.color]} strokeWidth="1" />
            ))}
            <text y="-28" textAnchor="middle" fontFamily="'Press Start 2P', monospace" fontSize="10" fill={me ? P.yellow : P.white} stroke={P.black} strokeWidth="2" paintOrder="stroke">
              {me ? 'YOU' : b.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
