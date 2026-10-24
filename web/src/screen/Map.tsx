// The ward as a pixel tile world (GAME-VISUAL section 0, second pass): land with dithered soil and palms, a river
// channel with banks that widens as the water rises, black sprite outlines, lit-window halos, idle bob on boats,
// diagonal rain with the odd lightning flash, and floating score pops. Everything is rects on a 4-unit grid.
import { useMemo } from 'react';
import { GAME, thuruthu, type GameEvent, type GameView, type ScenarioNode } from '@pralayam/shared';
import { NODES, initials } from './format.js';
import { STEP, channelPath, edges } from '../game/river.js';
import { COLOR_PX, P, PX, SPRITES, snap, spriteRects, type SpriteName } from '../game/sprites.js';

/** Coconut palms on the banks, placed by hand so none sits on a house, a path or the water. */
const PALMS: [number, number, boolean][] = [
  [64, 180, false], [112, 64, true], [230, 56, false], [440, 72, true], [620, 150, false], [690, 56, true], [960, 96, false],
  [980, 300, true], [60, 388, true], [330, 586, false], [500, 590, true], [720, 598, false], [900, 598, true], [1000, 420, true], [200, 596, true],
  // in the gutters beyond the viewBox, for wide or tall projectors
  [-70, 120, false], [-110, 330, true], [-50, 560, false], [-160, 460, true], [1070, 140, false], [1110, 380, true], [1060, 590, false], [1170, 250, true],
  [120, -40, true], [520, -60, false], [880, -30, true], [300, 660, false], [700, 650, true], [1000, 680, false],
];

/** Dead-zone clusters (connected nodes without signal) and where to write their label. */
function deadZones(): { nodes: ScenarioNode[]; label: string; x: number; y: number; paddy: boolean }[] {
  const dead = thuruthu.nodes.filter((n) => !n.signal);
  const ids = new Set(dead.map((n) => n.id));
  const adj = new Map<string, string[]>();
  for (const [a, b] of thuruthu.edges) {
    if (ids.has(a) && ids.has(b)) {
      adj.set(a, [...(adj.get(a) ?? []), b]);
      adj.set(b, [...(adj.get(b) ?? []), a]);
    }
  }
  const seen = new Set<string>();
  const out: ReturnType<typeof deadZones> = [];
  for (const n of dead) {
    if (seen.has(n.id)) continue;
    const cluster: ScenarioNode[] = [];
    const queue = [n.id];
    seen.add(n.id);
    while (queue.length) {
      const id = queue.pop()!;
      cluster.push(NODES[id]!);
      for (const next of adj.get(id) ?? []) if (!seen.has(next)) (seen.add(next), queue.push(next));
    }
    const name = cluster.find((c) => c.kind === 'junction')?.name ?? cluster[0]!.name;
    // label under the cluster, kept inside the map
    const y = Math.min(584, snap(Math.max(...cluster.map((c) => c.y))) + 64);
    out.push({ nodes: cluster, label: name, x: Math.min(860, Math.max(140, snap(cluster.reduce((s, c) => s + c.x, 0) / cluster.length))), y, paddy: /paddy/i.test(name) });
  }
  return out;
}

function Sprite({ name, x, y, override, className, outline }: { name: SpriteName; x: number; y: number; override?: Record<string, string>; className?: string; outline?: boolean }) {
  const rects = useMemo(() => spriteRects(SPRITES[name], PX, override), [name, override]);
  return (
    <g transform={`translate(${x} ${y})`} className={className} filter={outline ? 'url(#outline)' : undefined}>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
      ))}
    </g>
  );
}

function spriteFor(n: ScenarioNode, flooded: boolean, hasCall: boolean): SpriteName {
  switch (n.kind) {
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

export interface Pop {
  id: string;
  nodeId: string;
  text: string;
  tone: 'good' | 'bad';
}

/** Floating score pops for the events of a round: one per node, points summed, "+30" in green, "-45" in red. */
export function popsFor(events: GameEvent[], key: number): Pop[] {
  const byNode = new Map<string, number>();
  for (const e of events) if (e.points && e.nodeId) byNode.set(e.nodeId, (byNode.get(e.nodeId) ?? 0) + e.points);
  return [...byNode].map(([nodeId, pts]) => ({ id: `${key}-${nodeId}`, nodeId, text: (pts > 0 ? '+' : '') + pts, tone: pts > 0 ? 'good' : 'bad' }));
}

export interface WardMapProps {
  view: GameView | null;
  dim?: boolean;
  pops?: Pop[];
  outSince?: Record<string, number>;
  /** The phone's own boat: framed in its colour and labelled YOU. */
  me?: string;
  /** Where that boat is heading, and the nodes on the way (drawn as a yellow route). */
  target?: string | null;
  path?: string[];
  /** Tap a place (the phone): makes every node a target. */
  onPick?: (nodeId: string) => void;
  /** Phone size: bigger labels, only where they matter. */
  compact?: boolean;
}

export function WardMap({ view, dim, pops = [], outSince, me, target = null, path = [], onPick, compact }: WardMapProps) {
  const myBoat = me ? view?.boats.find((b) => b.id === me) : undefined;
  const onRoute = (a: string, b: string) => {
    const i = path.indexOf(a);
    const j = path.indexOf(b);
    const from = myBoat?.nodeId;
    return (i >= 0 && j >= 0 && Math.abs(i - j) === 1) || (from !== undefined && path.length > 0 && ((a === from && b === path[0]) || (b === from && a === path[0])));
  };
  const zones = useMemo(deadZones, []);
  const water = view?.waterLevel ?? 0;
  const e = useMemo(() => edges(water), [water]);
  const channel = useMemo(() => channelPath(e), [e]);
  const openCalls = (view?.calls ?? []).filter((c) => c.status === 'open');
  const callAt = new Map(openCalls.map((c) => [c.nodeId, c]));
  const boatsAt = new Map<string, number>();

  return (
    <svg
      className={'map' + (dim ? ' dim' : '')}
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      overflow="visible"
      role="img"
      aria-label={view ? `Map of ${thuruthu.name}, round ${view.round}` : 'Map of Thuruthu ward'}
    >
      <defs>
        <pattern id="land" width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#1a2a4d" />
          <rect x="4" y="8" width="4" height="4" fill="#27407a" />
          <rect x="20" y="20" width="4" height="4" fill="#27407a" />
          <rect x="12" y="24" width="8" height="2" fill="#2d6b57" />
          <rect x="24" y="4" width="4" height="2" fill="#2d6b57" />
        </pattern>
        <pattern id="deep" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="#1e6f94" />
          <rect x="4" y="4" width="4" height="4" fill="#1e6f94" />
        </pattern>
        <pattern id="checker" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill={P.grey} opacity=".22" />
          <rect x="4" y="4" width="4" height="4" fill={P.grey} opacity=".22" />
        </pattern>
        <pattern id="paddy" width="16" height="8" patternUnits="userSpaceOnUse">
          <rect width="16" height="8" fill="#1d3a2a" />
          <rect y="2" width="16" height="2" fill="#2f9e7b" opacity=".5" />
          <rect y="6" width="16" height="2" fill="#2f9e7b" opacity=".3" />
        </pattern>
        <pattern id="halo" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill={P.yellow} opacity=".18" />
          <rect x="4" y="4" width="4" height="4" fill={P.yellow} opacity=".18" />
        </pattern>
        <filter id="outline" x="-30%" y="-30%" width="160%" height="160%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="d" />
          <feFlood floodColor={P.black} />
          <feComposite in2="d" operator="in" result="o" />
          <feMerge>
            <feMergeNode in="o" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* land */}
      {/* the land runs past the viewBox so the tile world fills whatever the projector is */}
      <rect x="-1200" y="-800" width="3400" height="2200" fill="url(#land)" />
      {zones.map((z) =>
        z.nodes.map((n) => <rect key={n.id} x={snap(n.x) - 60} y={snap(n.y) - 60} width="120" height="120" fill={z.paddy ? 'url(#paddy)' : 'url(#checker)'} />),
      )}

      {/* river channel: widens upward with the level; foam on the edges, dither in the deep */}
      <g key={water} className="river splash">
        <path d={channel} fill="#2a8fb8" />
        <path d={channel} fill="url(#deep)" opacity=".7" />
        <path d={channel} fill="none" stroke={P.foam} strokeWidth="2" opacity=".8" />
        <g className="waveA">
          {e.map((p, i) => (
            <rect key={p.x} x={p.x + (i % 2 ? 8 : 0)} y={p.top + 4} width="8" height="2" fill={P.foam} opacity=".7" />
          ))}
        </g>
        <g className="waveB">
          {e.map((p, i) => (
            <rect key={p.x} x={p.x + (i % 2 ? 0 : 8)} y={p.top + 8} width="8" height="2" fill={P.foam} opacity=".5" />
          ))}
        </g>
      </g>

      {/* dead-zone frames and labels */}
      {zones.map((z) => (
        <g key={z.label}>
          {z.nodes.map((n) => (
            <rect key={n.id} x={snap(n.x) - 60} y={snap(n.y) - 60} width="120" height="120" fill="none" stroke={P.grey} strokeWidth="2" strokeDasharray="8 8" opacity=".6" />
          ))}
          <rect x={z.x - (z.label.length + 12) * 5 - 8} y={z.y - 13} width={(z.label.length + 12) * 10 + 16} height="20" fill={P.black} stroke={P.grey} strokeWidth="2" />
          <text x={z.x} y={z.y + 1} textAnchor="middle" fill={P.grey} fontFamily="'Press Start 2P', monospace" fontSize="10">
            {z.label.toUpperCase()} · NO SIGNAL
          </text>
        </g>
      ))}

      {/* paths: a dark road with a lighter crown */}
      <g strokeLinecap="square">
        {thuruthu.edges.map(([a, b]) => (
          <g key={a + b}>
            <line x1={snap(NODES[a]!.x)} y1={snap(NODES[a]!.y)} x2={snap(NODES[b]!.x)} y2={snap(NODES[b]!.y)} stroke={P.black} strokeWidth="6" opacity=".5" />
            <line x1={snap(NODES[a]!.x)} y1={snap(NODES[a]!.y)} x2={snap(NODES[b]!.x)} y2={snap(NODES[b]!.y)} stroke="#b7874a" strokeWidth="2" strokeDasharray="8 4" opacity=".95" />
          </g>
        ))}
      </g>

      {/* the route the phone chose */}
      {path.length > 0 && (
        <g stroke={P.yellow} strokeWidth="8" strokeLinecap="square">
          {thuruthu.edges.filter(([a, b]) => onRoute(a, b)).map(([a, b]) => (
            <line key={'r' + a + b} x1={snap(NODES[a]!.x)} y1={snap(NODES[a]!.y)} x2={snap(NODES[b]!.x)} y2={snap(NODES[b]!.y)} />
          ))}
        </g>
      )}

      {/* palms */}
      {PALMS.map(([x, y, small]) => (
        <Sprite key={`${x}-${y}`} name={small ? 'palmSmall' : 'palm'} x={x} y={y} outline />
      ))}

      {/* lit-window halos under houses with people calling */}
      {openCalls.map((c) => {
        const n = NODES[c.nodeId]!;
        return <rect key={c.id} x={snap(n.x) - 40} y={snap(n.y) - 36} width="80" height="56" fill="url(#halo)" />;
      })}

      {/* nodes */}
      <g fontFamily="'Pixelify Sans', sans-serif" fontSize="15" fontWeight="600" fill={P.white} textAnchor="middle">
        {thuruthu.nodes.map((n) => {
          const flooded = n.kind === 'house' && !n.safe && water >= n.height;
          const hasCall = callAt.has(n.id);
          const quiet = n.kind === 'house' && !hasCall && !flooded;
          const x = snap(n.x);
          const y = snap(n.y);
          const mine = myBoat?.nodeId === n.id;
          const isTarget = target === n.id;
          const showLabel = !compact || mine || isTarget || hasCall || n.kind !== 'house';
          return (
            <g key={n.id} data-node={n.id} opacity={quiet ? 0.9 : 1} onClick={onPick ? () => onPick(n.id) : undefined} style={onPick ? { cursor: 'pointer' } : undefined}>
              {onPick && <rect x={x - 48} y={y - 64} width="96" height="110" fill="transparent" />}
              {(mine || isTarget) && (
                <rect x={x - 44} y={y - 54} width="88" height="80" fill="none" stroke={mine && myBoat ? COLOR_PX[myBoat.color] : P.yellow} strokeWidth="4" strokeDasharray={isTarget && !mine ? '8 6' : undefined} />
              )}
              <Sprite name={spriteFor(n, flooded, hasCall)} x={x} y={y + 16} outline={n.kind !== 'junction'} />
              {showLabel && (
                <text x={x} y={compact ? y + 40 : y + 36} fontSize={compact ? 22 : undefined} fill={mine ? P.yellow : quiet ? P.grey : flooded ? P.foam : P.white} stroke={P.black} strokeWidth="3" paintOrder="stroke">
                  {n.name.toUpperCase()}
                  {flooded ? ' ~' : n.safe ? ' ✦' : ''}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* call markers: a square frame in the band colour, the number inside */}
      <g fontFamily="'Press Start 2P', monospace" textAnchor="middle">
        {openCalls.map((c) => {
          const n = NODES[c.nodeId]!;
          const x = snap(n.x);
          const y = snap(n.y) - 44;
          const band = view?.urgency[c.id]?.band ?? 'yellow';
          const color = band === 'red' ? P.red : band === 'orange' ? P.orange : P.yellow;
          return (
            <g key={c.id} className={'call' + (band === 'red' ? ' blink' : '')} data-band={band}>
              <rect x={x - 18} y={y - 18} width="40" height="40" fill={P.black} opacity=".6" />
              <rect x={x - 20} y={y - 20} width="40" height="40" fill={P.black} stroke={color} strokeWidth="4" />
              <text x={x} y={y + 6} fontSize="14" fill={P.white}>
                {c.remaining > 0 ? c.remaining : '✓'}
              </text>
              {c.roofRounds !== null && (
                <text x={x + 24} y={y - 14} fontSize="8" fill={P.foam} textAnchor="start" stroke={P.black} strokeWidth="2" paintOrder="stroke">
                  ROOF {c.roofRounds}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* boats: stepped slide between nodes, idle bob while waiting */}
      <g fontFamily="'Press Start 2P', monospace" fontSize="8" textAnchor="middle">
        {(view?.boats ?? []).map((b) => {
          const n = NODES[b.nodeId] ?? NODES[thuruthu.startNodeId]!;
          const k = boatsAt.get(b.nodeId) ?? 0;
          boatsAt.set(b.nodeId, k + 1);
          const x = snap(n.x) + 48 + k * 10;
          const y = snap(n.y) + 4 - k * 18;
          const contact = view?.contact[b.id] ?? true;
          const hex = COLOR_PX[b.color];
          return (
            <g key={b.id} className={'boat' + (contact ? '' : ' off')} data-boat={b.id} style={{ transform: `translate(${x}px, ${y}px)` }}>
              <g className="bob">
                <Sprite name="boat" x={0} y={0} override={{ C: hex }} outline />
                {Array.from({ length: GAME.capacity }, (_, i) => (
                  <rect key={i} x={-14 + i * 8} y={-28} width="6" height="6" fill={i < b.passengers.length ? P.white : P.black} stroke={hex} strokeWidth="1" />
                ))}
                <text y="-34" fontSize={compact ? 11 : undefined} fill={me === b.id ? P.yellow : contact ? P.white : P.grey} stroke={P.black} strokeWidth="2" paintOrder="stroke">
                  {me === b.id ? 'YOU' : initials(b.name)}
                  {contact ? '' : outSince?.[b.id] ? ` ✕ R${outSince[b.id]}` : ' ✕'}
                </text>
                {!contact && <Sprite name="radioOff" x={26} y={-26} />}
              </g>
            </g>
          );
        })}
      </g>

      {/* floating score pops */}
      <g fontFamily="'Press Start 2P', monospace" fontSize="12" textAnchor="middle">
        {pops.map((p) => {
          const n = NODES[p.nodeId];
          if (!n) return null;
          return (
            <text key={p.id} className="popText" x={snap(n.x)} y={snap(n.y) - 70} fill={p.tone === 'good' ? P.green : P.red} stroke={P.black} strokeWidth="3" paintOrder="stroke">
              {p.text}
            </text>
          );
        })}
      </g>

      {/* weather */}
      <g className="rain" stroke={P.foam} strokeWidth="2" opacity=".22">
        {[30, 120, 240, 330, 470, 560, 690, 790, 910, 985].map((x, i) => (
          <line key={x} x1={x} y1={-i * 14} x2={x - 4} y2={10 - i * 14} />
        ))}
      </g>
      <rect className="flash" width="1000" height="600" fill={P.white} opacity="0" />
    </svg>
  );
}
