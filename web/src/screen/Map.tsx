// The hand-drawn ward as inline SVG (GAME-VISUAL section 4): paper, river, dead zones, paths, nodes, call rings,
// boats (CSS-transitioned moves), rain. Positions come from the shared scenario; everything else from the view.
import { useMemo } from 'react';
import { GAME, thuruthu, type GameView, type ScenarioNode } from '@relief-mesh/shared';
import { COLOR_HEX, NODES, initials } from './format.js';

const RIVER = 'M0 330 C 120 300, 180 420, 300 400 S 480 300, 600 360 S 760 520, 1000 440';
const RIVER_FILL = `${RIVER} L 1000 600 L 0 600 Z`;
const WAVE = 'q 30 -10 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0 t 60 0';
const RAIN = [40, 130, 250, 330, 480, 560, 690, 800, 920, 980];

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
    out.push({ nodes: cluster, label: name, x: cluster.reduce((s, c) => s + c.x, 0) / cluster.length, y: Math.max(...cluster.map((c) => c.y)) + 62 });
  }
  return out;
}

function NodeGlyph({ n, flooded }: { n: ScenarioNode; flooded: boolean }) {
  const stroke = flooded ? '#2FA8C4' : n.kind === 'junction' ? '#4F5A72' : '#B9C0CF';
  switch (n.kind) {
    case 'camp':
      return (
        <>
          <path d="M-18 14 L0 -16 L18 14 Z" fill="#12203A" stroke="#2EC4B6" strokeWidth="2" strokeLinejoin="round" />
          <path d="M-6 14 L0 2 L6 14" fill="none" stroke="#2EC4B6" strokeWidth="2" />
        </>
      );
    case 'hospital':
      return (
        <>
          <rect x="-16" y="-16" width="32" height="32" rx="6" fill="#12203A" stroke="#F4F1EA" strokeWidth="2" />
          <path d="M0 -8 V8 M-8 0 H8" stroke="#F4F1EA" strokeWidth="3" strokeLinecap="round" />
        </>
      );
    case 'temple':
      return <path d="M-16 14 H16 M-12 14 V0 H12 V14 M-6 0 L0 -18 L6 0" fill="#12203A" stroke="#FFB74D" strokeWidth="2" strokeLinejoin="round" />;
    case 'school':
      return (
        <>
          <rect x="-18" y="-6" width="36" height="20" rx="3" fill="#12203A" stroke="#B9C0CF" strokeWidth="2" />
          <path d="M-18 -6 L0 -18 L18 -6" fill="none" stroke="#B9C0CF" strokeWidth="2" strokeLinejoin="round" />
        </>
      );
    case 'jetty':
      return <path d="M-20 0 H20 M-14 0 V10 M0 0 V10 M14 0 V10" stroke="#B9C0CF" strokeWidth="2" strokeLinecap="round" />;
    case 'junction':
      return <circle r="5" fill="#0B1526" stroke={stroke} strokeWidth="1.5" />;
    default:
      return flooded ? (
        <>
          <path d="M-16 6 L0 -10 L16 6 Z" fill="#16607A" stroke="#2FA8C4" strokeWidth="2" strokeLinejoin="round" />
          <path d="M-20 10 q 10 -6 20 0 t 20 0" fill="none" stroke="#2FA8C4" strokeWidth="2" />
        </>
      ) : (
        <path d="M-14 4 L0 -12 L14 4 V14 H-14 Z" fill="#12203A" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
      );
  }
}

export function WardMap({ view, dim }: { view: GameView | null; dim?: boolean }) {
  const zones = useMemo(deadZones, []);
  const water = view?.waterLevel ?? 0;
  const openCalls = (view?.calls ?? []).filter((c) => c.status === 'open');
  const callAt = new Map(openCalls.map((c) => [c.nodeId, c]));
  const boatsAt = new Map<string, number>();

  return (
    <svg
      className={'map' + (dim ? ' dim' : '')}
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={view ? `Map of ${thuruthu.name}, round ${view.round}` : 'Map of Thuruthu ward'}
    >
      <defs>
        <filter id="paper">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 .05" />
          </feComponentTransfer>
        </filter>
        <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="12" stroke="#8A93A6" strokeWidth="1.2" opacity=".45" />
        </pattern>
        <radialGradient id="glow-red"><stop offset="0" stopColor="#FF3B5C" stopOpacity=".55" /><stop offset="1" stopColor="#FF3B5C" stopOpacity="0" /></radialGradient>
        <radialGradient id="glow-orange"><stop offset="0" stopColor="#FF6B35" stopOpacity=".5" /><stop offset="1" stopColor="#FF6B35" stopOpacity="0" /></radialGradient>
        <radialGradient id="glow-yellow"><stop offset="0" stopColor="#FFB74D" stopOpacity=".45" /><stop offset="1" stopColor="#FFB74D" stopOpacity="0" /></radialGradient>
        <clipPath id="river-clip"><path d={RIVER_FILL} /></clipPath>
      </defs>

      <rect width="1000" height="600" fill="#0B1526" />
      <rect width="1000" height="600" filter="url(#paper)" />

      {/* river, with a flood band that climbs with the water level */}
      <path d={RIVER_FILL} fill="#0C3146" />
      <path className="flood" d={RIVER_FILL} fill="#16607A" opacity=".55" style={{ transform: `translateY(${-28 * water}px)` }} />
      <g clipPath="url(#river-clip)" opacity=".9">
        <path className="wave" d={`M-60 380 ${WAVE}`} fill="none" stroke="#16607A" strokeWidth="3" />
        <path className="wave2" d={`M-60 440 ${WAVE}`} fill="none" stroke="#2FA8C4" strokeWidth="2" opacity=".6" />
        <path className="wave" d={`M-60 510 ${WAVE}`} fill="none" stroke="#16607A" strokeWidth="2" />
      </g>
      <path d={RIVER} fill="none" stroke="#2FA8C4" strokeWidth="1.5" opacity=".7" />

      {/* dead zones */}
      {zones.map((z) => (
        <g key={z.label}>
          {z.nodes.map((n) => (
            <circle key={n.id} cx={n.x} cy={n.y} r="52" fill="url(#hatch)" stroke="#8A93A6" strokeWidth="1.2" strokeDasharray="6 6" opacity=".8" />
          ))}
          <text x={z.x} y={z.y} textAnchor="middle" fill="#8A93A6" fontSize="15" fontWeight="700" letterSpacing="2">
            {z.label.toUpperCase()} · NO SIGNAL
          </text>
        </g>
      ))}

      {/* paths */}
      <g fill="none" stroke="#7D8597" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 7" opacity=".7">
        {thuruthu.edges.map(([a, b]) => (
          <line key={a + b} x1={NODES[a]!.x} y1={NODES[a]!.y} x2={NODES[b]!.x} y2={NODES[b]!.y} />
        ))}
      </g>

      {/* glows under calls */}
      {openCalls.map((c) => {
        const n = NODES[c.nodeId]!;
        const band = view?.urgency[c.id]?.band ?? 'yellow';
        return <circle key={c.id} cx={n.x} cy={n.y} r={band === 'red' ? 60 : 48} fill={`url(#glow-${band})`} />;
      })}

      {/* nodes */}
      <g fontSize="15" fontWeight="600" fill="#B9C0CF" textAnchor="middle">
        {thuruthu.nodes.map((n) => {
          const flooded = n.kind === 'house' && !n.safe && water >= n.height;
          const quiet = n.kind === 'house' && !callAt.has(n.id) && !flooded;
          return (
            <g key={n.id} transform={`translate(${n.x} ${n.y})`} opacity={quiet ? 0.8 : 1}>
              <NodeGlyph n={n} flooded={flooded} />
              <text y={n.kind === 'junction' ? 22 : 38} fill={quiet ? '#7D8597' : flooded ? '#B9C0CF' : '#B9C0CF'}>
                {n.name}
                {flooded ? ' · flooded' : n.safe ? ' · safe' : ''}
              </text>
            </g>
          );
        })}
      </g>

      {/* call rings */}
      <g fontFamily="Fraunces, Georgia, serif" fontWeight="700" textAnchor="middle">
        {openCalls.map((c) => {
          const n = NODES[c.nodeId]!;
          const u = view?.urgency[c.id];
          const band = u?.band ?? 'yellow';
          const color = band === 'red' ? '#FF3B5C' : band === 'orange' ? '#FF6B35' : '#FFB74D';
          const roof = c.roofRounds !== null;
          return (
            <g key={c.id} className="call" data-band={band}>
              <circle className={'breathe' + (band === 'red' ? ' fast' : '')} cx={n.x} cy={n.y} r={band === 'red' ? 28 : 25} fill="none" stroke={color} strokeWidth={band === 'red' ? 4 : 3} />
              <circle cx={n.x} cy={n.y} r="19" fill="#070D18" stroke={color} strokeWidth="1.5" />
              <text x={n.x} y={n.y + 8} fontSize="22" fill="#F4F1EA">
                {c.remaining > 0 ? c.remaining : '✓'}
              </text>
              {roof && (
                <text x={n.x + 30} y={n.y - 22} fontSize="12" fontFamily="Manrope, sans-serif" fontWeight="800" fill="#2FA8C4" textAnchor="start">
                  ROOF {c.roofRounds}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* boats: CSS-transitioned translate so a move slides */}
      <g fontSize="13" fontWeight="800" textAnchor="middle" fontFamily="Manrope, sans-serif">
        {(view?.boats ?? []).map((b) => {
          const n = NODES[b.nodeId] ?? NODES[thuruthu.startNodeId]!;
          const k = boatsAt.get(b.nodeId) ?? 0;
          boatsAt.set(b.nodeId, k + 1);
          const angle = -0.9 + k * 0.7;
          const x = n.x + 34 * Math.cos(angle) + 6;
          const y = n.y + 22 * Math.sin(angle) + 12;
          const contact = view?.contact[b.id] ?? true;
          const hex = COLOR_HEX[b.color];
          return (
            <g key={b.id} className={'boat' + (contact ? '' : ' off')} data-boat={b.id} style={{ transform: `translate(${x}px, ${y}px)` }}>
              <path d="M-16 0 Q -14 12 0 12 Q 14 12 16 0 Z" fill={hex} stroke={contact ? 'none' : '#8A93A6'} strokeWidth="1.5" strokeDasharray={contact ? undefined : '3 3'} />
              <rect x="-10" y="-8" width="20" height="8" rx="2" fill="#F4F1EA" />
              {Array.from({ length: GAME.capacity }, (_, i) => (
                <circle key={i} cx={-9 + i * 6} cy="-4" r="2" fill={i < b.passengers.length ? '#0B1526' : 'rgba(11,21,38,.25)'} />
              ))}
              <text y="-13" fill={contact ? '#F4F1EA' : '#8A93A6'}>
                {initials(b.name)} · {b.passengers.length}/{GAME.capacity}
                {contact ? '' : ' · NO SIGNAL'}
              </text>
            </g>
          );
        })}
      </g>

      {/* rain */}
      <g className="rain" stroke="#B9C0CF" strokeWidth="1" opacity=".12" strokeLinecap="round">
        {RAIN.map((x, i) => (
          <line key={x} x1={x} y1={-i * 12} x2={x - 6} y2={40 - i * 12} />
        ))}
      </g>
    </svg>
  );
}
