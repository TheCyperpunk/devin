// The crew's neighbourhood: your node in the middle, the places one move away around it, calls and dead zones.
import { useMemo } from 'react';
import type { Boat, GameView } from '@pralayam/shared';
import { COLOR_PX, P, SPRITES, spriteRects, type SpriteName } from '../game/sprites.js';
import { NODES, nodeName, ward } from './orders.js';

function spriteFor(kind: string, flooded: boolean): SpriteName {
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
      return flooded ? 'houseFlooded' : 'house';
  }
}

function Sprite({ name, x, y, px = 3, override }: { name: SpriteName; x: number; y: number; px?: number; override?: Record<string, string> }) {
  const rects = useMemo(() => spriteRects(SPRITES[name], px, override), [name, px, override]);
  return (
    <g transform={`translate(${x} ${y})`}>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
      ))}
    </g>
  );
}

export function MiniMap({ view, boat, dim, lang }: { view: GameView; boat: Boat; dim?: boolean; lang: 'en' | 'ml' }) {
  const around = [...ward.neighbours(boat.nodeId)];
  const W = 360;
  const H = 200;
  const cx = W / 2;
  const cy = H / 2 + 6;
  const r = 74;
  const place = (i: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / around.length;
    return { x: Math.round(cx + Math.cos(a) * (around.length > 4 ? r + 10 : r)), y: Math.round(cy + Math.sin(a) * (r - 14)) };
  };
  const callAt = (id: string) => view.calls.find((c) => c.status === 'open' && c.nodeId === id);
  const bandColor = (id: string) => {
    const c = callAt(id);
    const b = c ? view.urgency[c.id]?.band : undefined;
    return b === 'red' ? P.red : b === 'orange' ? P.orange : b === 'yellow' ? P.yellow : null;
  };
  const node = (id: string, x: number, y: number, me: boolean) => {
    const n = NODES[id]!;
    const flooded = n.kind === 'house' && !n.safe && view.waterLevel >= n.height;
    const c = callAt(id);
    const color = bandColor(id);
    return (
      <g key={id} data-node={id}>
        {!n.signal && <rect x={x - 26} y={y - 30} width="52" height="52" fill="url(#mmChecker)" stroke={P.grey} strokeWidth="1" strokeDasharray="4 4" />}
        <Sprite name={spriteFor(n.kind, flooded)} x={x} y={y + 8} />
        {c && color && (
          <g>
            <rect x={x - 11} y={y - 36} width="22" height="22" fill={P.black} stroke={color} strokeWidth="3" />
            <text x={x} y={y - 21} textAnchor="middle" fontFamily="'Press Start 2P', monospace" fontSize="9" fill={P.white}>
              {c.remaining > 0 ? c.remaining : '✓'}
            </text>
          </g>
        )}
        <text x={x} y={y + 22} textAnchor="middle" fontFamily="'Pixelify Sans', sans-serif" fontSize="11" fontWeight="700" fill={me ? P.yellow : n.signal ? P.white : P.grey} stroke={P.black} strokeWidth="2" paintOrder="stroke">
          {nodeName(id, lang).toUpperCase()}
        </text>
      </g>
    );
  };

  return (
    <svg className={'minimap' + (dim ? ' dim' : '')} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" role="img" aria-label={`Around ${nodeName(boat.nodeId)}`}>
      <defs>
        <pattern id="mmChecker" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill={P.grey} opacity=".25" />
          <rect x="3" y="3" width="3" height="3" fill={P.grey} opacity=".25" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="#1a2a4d" />
      {around.map((id, i) => {
        const p = place(i);
        return <line key={id} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#b7874a" strokeWidth="2" strokeDasharray="6 3" opacity=".9" />;
      })}
      {around.map((id, i) => {
        const p = place(i);
        return node(id, p.x, p.y, false);
      })}
      {node(boat.nodeId, cx, cy, true)}
      <Sprite name="boat" x={cx + 30} y={cy + 4} override={{ C: COLOR_PX[boat.color] }} />
    </svg>
  );
}
