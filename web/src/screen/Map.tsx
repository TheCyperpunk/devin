// The ward as a pixel map: everything is rects on a 4-unit grid with crisp edges. Square-wave water that climbs
// with the level, dithered foam, checkerboard dead zones, sprite houses and boats, stepped motion, blocky rain.
import { useMemo } from 'react';
import { GAME, thuruthu, type GameView, type ScenarioNode } from '@relief-mesh/shared';
import { NODES, initials } from './format.js';
import { COLOR_PX, P, PX, SPRITES, snap, spriteRects, type SpriteName } from './sprites.js';

const STEP = 16;
const RAIN_COLS = [40, 130, 250, 330, 480, 560, 690, 800, 920, 980];

/** The river's surface before any flooding, as a staircase of 16-unit steps. */
function surface(x: number): number {
  return 372 + 36 * Math.sin(x / 140) + 18 * Math.sin(x / 55 + 1);
}
function riverPolygon(): string {
  const pts: string[] = [];
  for (let x = 0; x <= 1000; x += STEP) {
    const y = snap(surface(x));
    pts.push(`${x},${y}`, `${x + STEP},${y}`);
  }
  return `M${pts.join(' L')} L1016,600 L0,600 Z`;
}
function surfaceSteps(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let x = 0; x <= 1000; x += STEP) out.push({ x, y: snap(surface(x)) });
  return out;
}

/** Dead-zone clusters (connected nodes without signal) and where to write their label. */
function deadZones(): { nodes: ScenarioNode[]; label: string; x: number; y: number }[] {
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
  const out: { nodes: ScenarioNode[]; label: string; x: number; y: number }[] = [];
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
    out.push({ nodes: cluster, label: name, x: snap(cluster.reduce((s, c) => s + c.x, 0) / cluster.length), y: snap(Math.max(...cluster.map((c) => c.y))) + 72 });
  }
  return out;
}

function Sprite({ name, x, y, override, className }: { name: SpriteName; x: number; y: number; override?: Record<string, string>; className?: string }) {
  const rects = useMemo(() => spriteRects(SPRITES[name], PX, override), [name, override]);
  return (
    <g transform={`translate(${x} ${y})`} className={className}>
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

export function WardMap({ view, dim }: { view: GameView | null; dim?: boolean }) {
  const zones = useMemo(deadZones, []);
  const river = useMemo(riverPolygon, []);
  const steps = useMemo(surfaceSteps, []);
  const water = view?.waterLevel ?? 0;
  const rise = 28 * water;
  const openCalls = (view?.calls ?? []).filter((c) => c.status === 'open');
  const callAt = new Map(openCalls.map((c) => [c.nodeId, c]));
  const boatsAt = new Map<string, number>();

  return (
    <svg
      className={'map' + (dim ? ' dim' : '')}
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      role="img"
      aria-label={view ? `Map of ${thuruthu.name}, round ${view.round}` : 'Map of Thuruthu ward'}
    >
      <defs>
        <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect x="7" y="7" width="2" height="2" fill={P.white} opacity=".08" />
        </pattern>
        <pattern id="checker" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill={P.grey} opacity=".22" />
          <rect x="4" y="4" width="4" height="4" fill={P.grey} opacity=".22" />
        </pattern>
        <pattern id="dither" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill={P.foam} opacity=".35" />
          <rect x="4" y="4" width="4" height="4" fill={P.foam} opacity=".35" />
        </pattern>
        <clipPath id="river-clip">
          <path d={river} className="flood" style={{ transform: `translateY(${-rise}px)` }} />
        </clipPath>
      </defs>

      {/* paper */}
      <rect width="1000" height="600" fill={P.navy} />
      <rect width="1000" height="600" fill="url(#grid)" />

      {/* water: the whole band climbs with the level, in steps */}
      <g className="flood" style={{ transform: `translateY(${-rise}px)` }}>
        <path d={river} fill={P.water1} />
        {steps.map((s) => (
          <rect key={s.x} x={s.x} y={s.y} width={STEP} height={24} fill="url(#dither)" />
        ))}
        <g className="wave">
          {steps.map((s, i) => (
            <rect key={s.x} x={s.x + (i % 2 ? 8 : 0)} y={s.y - 4} width={8} height={4} fill={P.foam} />
          ))}
        </g>
      </g>

      {/* dead zones */}
      {zones.map((z) => (
        <g key={z.label}>
          {z.nodes.map((n) => (
            <g key={n.id}>
              <rect x={snap(n.x) - 56} y={snap(n.y) - 56} width="112" height="112" fill="url(#checker)" />
              <rect x={snap(n.x) - 56} y={snap(n.y) - 56} width="112" height="112" fill="none" stroke={P.grey} strokeWidth="2" strokeDasharray="8 8" opacity=".7" />
            </g>
          ))}
          <rect x={z.x - (z.label.length + 12) * 5 - 8} y={z.y - 13} width={(z.label.length + 12) * 10 + 16} height="20" fill={P.black} stroke={P.grey} strokeWidth="2" />
          <text x={z.x} y={z.y + 1} textAnchor="middle" fill={P.grey} fontFamily="'Press Start 2P', monospace" fontSize="10">
            {z.label.toUpperCase()} · NO SIGNAL
          </text>
        </g>
      ))}

      {/* paths */}
      <g stroke={P.grey} strokeWidth="2" strokeDasharray="4 8" opacity=".55">
        {thuruthu.edges.map(([a, b]) => (
          <line key={a + b} x1={snap(NODES[a]!.x)} y1={snap(NODES[a]!.y)} x2={snap(NODES[b]!.x)} y2={snap(NODES[b]!.y)} />
        ))}
      </g>

      {/* nodes */}
      <g fontFamily="'Pixelify Sans', sans-serif" fontSize="15" fontWeight="600" fill={P.white} textAnchor="middle">
        {thuruthu.nodes.map((n) => {
          const flooded = n.kind === 'house' && !n.safe && water >= n.height;
          const hasCall = callAt.has(n.id);
          const quiet = n.kind === 'house' && !hasCall && !flooded;
          const x = snap(n.x);
          const y = snap(n.y);
          return (
            <g key={n.id} opacity={quiet ? 0.85 : 1}>
              <Sprite name={spriteFor(n, flooded, hasCall)} x={x} y={y + 16} />
              <text x={x} y={y + 34} fill={quiet ? P.grey : flooded ? P.foam : P.white}>
                {n.name.toUpperCase()}
                {flooded ? ' ~' : n.safe ? ' ✦' : ''}
              </text>
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
              <rect x={x - 20} y={y - 20} width="40" height="40" fill={P.black} stroke={color} strokeWidth="4" />
              <text x={x} y={y + 6} fontSize="14" fill={P.white}>
                {c.remaining > 0 ? c.remaining : '✓'}
              </text>
              {c.roofRounds !== null && (
                <text x={x + 24} y={y - 14} fontSize="8" fill={P.foam} textAnchor="start">
                  ROOF {c.roofRounds}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* boats: stepped slide between nodes */}
      <g fontFamily="'Press Start 2P', monospace" fontSize="8" textAnchor="middle">
        {(view?.boats ?? []).map((b) => {
          const n = NODES[b.nodeId] ?? NODES[thuruthu.startNodeId]!;
          const k = boatsAt.get(b.nodeId) ?? 0;
          boatsAt.set(b.nodeId, k + 1);
          // beside the sprite, above the label, fanned out when several boats share a node
          const x = snap(n.x) + 48 + k * 10;
          const y = snap(n.y) + 4 - k * 18;
          const contact = view?.contact[b.id] ?? true;
          const hex = COLOR_PX[b.color];
          return (
            <g key={b.id} className={'boat' + (contact ? '' : ' off')} data-boat={b.id} style={{ transform: `translate(${x}px, ${y}px)` }}>
              <Sprite name="boat" x={0} y={0} override={{ C: hex }} />
              {Array.from({ length: GAME.capacity }, (_, i) => (
                <rect key={i} x={-14 + i * 8} y={-28} width="6" height="6" fill={i < b.passengers.length ? P.white : P.black} stroke={hex} strokeWidth="1" />
              ))}
              <text y="-34" fill={contact ? P.white : P.grey}>
                {initials(b.name)}
                {contact ? '' : ' ✕'}
              </text>
              {!contact && <Sprite name="radioOff" x={26} y={-26} />}
            </g>
          );
        })}
      </g>

      {/* rain */}
      <g className="rain" fill={P.foam} opacity=".18">
        {RAIN_COLS.map((x, i) => (
          <rect key={x} x={x} y={-i * 14} width="2" height="8" />
        ))}
      </g>
    </svg>
  );
}
