import { WatchlistItem } from '@workspace/api-client-react';

interface Props {
  watchlist: WatchlistItem[];
}

// Deterministic angle from symbol name so blips don't jump on re-render
function symbolAngle(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return (h % 360) * (Math.PI / 180);
}

export function RadarSVG({ watchlist }: Props) {
  const high = watchlist.filter(w => w.priority === 'HIGH').slice(0, 5);
  const medium = watchlist.filter(w => w.priority === 'MEDIUM').slice(0, 6);

  // Map cyclesWatched → radial distance: more cycles = closer to centre (more urgent)
  const maxCycles = Math.max(...watchlist.map(w => w.cyclesWatched), 1);
  const blip = (item: WatchlistItem, minR: number, maxR: number, color: string) => {
    const angle = symbolAngle(item.symbol);
    const urgency = item.cyclesWatched / maxCycles;          // 0..1
    const r = maxR - urgency * (maxR - minR);                // high cycles → inner
    const x = Math.sin(angle) * r;
    const y = -Math.cos(angle) * r;
    const label = item.symbol.replace('USDT', '').slice(0, 5);
    return (
      <g key={item.symbol}>
        <circle
          cx={x} cy={y} r={3.5}
          fill={color}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
        <text
          x={x + (x > 0 ? 6 : -6)} y={y + 3}
          textAnchor={x > 0 ? 'start' : 'end'}
          fontSize="7"
          fill={color}
          fontFamily="'JetBrains Mono', monospace"
          opacity={0.85}
        >
          {label}
        </text>
      </g>
    );
  };

  return (
    <svg width="100%" viewBox="0 0 220 160" style={{ maxHeight: 160 }}>
      <defs>
        <radialGradient id="rg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5DCAA5" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#5DCAA5" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="translate(110,85)">
        {/* Background rings */}
        <circle r="72" fill="url(#rg)" />
        <circle r="72" fill="none" stroke="#1c2530" strokeWidth="1" />
        <circle r="48" fill="none" stroke="#1c2530" strokeWidth="1" />
        <circle r="24" fill="none" stroke="#1c2530" strokeWidth="1" />
        {/* Crosshairs */}
        <line x1="0" y1="-72" x2="0" y2="72" stroke="#1c2530" strokeWidth="1" />
        <line x1="-62" y1="-36" x2="62" y2="36" stroke="#1c2530" strokeWidth="1" />
        <line x1="-62" y1="36" x2="62" y2="-36" stroke="#1c2530" strokeWidth="1" />
        {/* Axis labels */}
        <text x="0" y="-78" textAnchor="middle" fontSize="8" fill="#55636f">OI</text>
        <text x="70" y="-38" textAnchor="start" fontSize="8" fill="#55636f">PRICE</text>
        <text x="-70" y="-38" textAnchor="end" fontSize="8" fill="#55636f">FUND</text>
        {/* Spinning sweep */}
        <g style={{ transformOrigin: '0px 0px', animation: 'spin 3s linear infinite' }}>
          <path d="M0 0 L0 -72 A72 72 0 0 1 51 -51 Z" fill="#5DCAA5" opacity="0.15" />
          <line x1="0" y1="0" x2="0" y2="-72" stroke="#5DCAA5" strokeWidth="1.5"
            style={{ filter: 'drop-shadow(0 0 4px #1D9E75)' }} />
        </g>
        {/* Real blips: HIGH priority (inner) */}
        {high.map(w => blip(w, 10, 40, '#F0716E'))}
        {/* Real blips: MEDIUM priority (outer) */}
        {medium.map(w => blip(w, 42, 68, '#F5B457'))}
        {/* Empty state blips if watchlist empty */}
        {watchlist.length === 0 && (
          <>
            <circle cx="0" cy="-38" r="3.5" fill="#A29BF0" opacity="0.4" style={{ filter: 'drop-shadow(0 0 5px #A29BF0)' }} />
            <circle cx="32" cy="18" r="3.5" fill="#85B7EB" opacity="0.4" style={{ filter: 'drop-shadow(0 0 5px #85B7EB)' }} />
          </>
        )}
      </g>
    </svg>
  );
}
