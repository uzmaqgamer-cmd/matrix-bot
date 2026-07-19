import React from 'react';

export function RadarSVG() {
  return (
    <svg width="160" height="130" viewBox="0 0 260 190">
      <defs>
        <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5DCAA5" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#5DCAA5" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="translate(130,96)">
        <circle r="80" fill="url(#radarGlow)" />
        <circle r="80" fill="none" stroke="#1c2530" strokeWidth="1" />
        <circle r="53" fill="none" stroke="#1c2530" strokeWidth="1" />
        <circle r="27" fill="none" stroke="#1c2530" strokeWidth="1" />
        <line x1="0" y1="-80" x2="0" y2="80" stroke="#1c2530" />
        <line x1="-70" y1="-40" x2="70" y2="40" stroke="#1c2530" />
        <line x1="-70" y1="40" x2="70" y2="-40" stroke="#1c2530" />
        
        <text x="0" y="-86" textAnchor="middle" fontSize="10" fill="#55636f">price</text>
        <text x="78" y="-43" textAnchor="start" fontSize="10" fill="#55636f">OI</text>
        <text x="-78" y="-43" textAnchor="end" fontSize="10" fill="#55636f">funding</text>
        
        <g style={{ transformOrigin: '0px 0px', animation: 'spin 3s linear infinite' }}>
          <path d="M0 0 L0 -80 A80 80 0 0 1 57 -57 Z" fill="#5DCAA5" opacity="0.22" />
          <line x1="0" y1="0" x2="0" y2="-80" stroke="#5DCAA5" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 0 4px #1D9E75)' }} />
        </g>
        
        <circle cx="0" cy="-40" r="4.5" fill="#A29BF0" style={{ filter: 'drop-shadow(0 0 7px #A29BF0)' }} />
        <circle cx="35" cy="20" r="4.5" fill="#85B7EB" style={{ filter: 'drop-shadow(0 0 7px #85B7EB)' }} />
        <circle cx="-30" cy="25" r="4.5" fill="#D4537E" style={{ filter: 'drop-shadow(0 0 7px #D4537E)' }} />
      </g>
    </svg>
  );
}
