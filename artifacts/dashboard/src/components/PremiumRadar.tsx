import React from 'react';
import { WatchlistItem } from '@workspace/api-client-react';

function symbolAngle(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return (h % 360) * (Math.PI / 180);
}

export function PremiumRadar({ watchlist }: { watchlist: WatchlistItem[] }) {
  const maxCycles = Math.max(1, ...watchlist.map(w => w.cyclesWatched));
  
  // Sort high priority to top, then by cycles
  const sorted = [...watchlist].sort((a, b) => {
    if (a.priority === 'HIGH' && b.priority !== 'HIGH') return -1;
    if (a.priority !== 'HIGH' && b.priority === 'HIGH') return 1;
    return b.cyclesWatched - a.cyclesWatched;
  });
  
  // Top 3 closest to firing
  const closest = sorted.slice(0, 3);

  return (
    <div className="glass-panel flex flex-col h-full shadow-[0_12px_40px_-10px_rgba(0,0,0,0.5)]">
      <div className="glass-header px-5 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-5 h-5">
            <span className="absolute w-2 h-2 rounded-full bg-[#00e5ff] shadow-[0_0_8px_#00e5ff]" />
            <span className="absolute w-full h-full rounded-full border border-[#00e5ff] animate-ping opacity-50" />
          </div>
          <span className="text-xs font-semibold text-slate-200 tracking-widest uppercase">TARGET ACQUISITION RADAR</span>
        </div>
        <span className="text-[10px] font-mono text-slate-500 bg-black/30 px-2 py-1 rounded border border-white/5">{watchlist.length} DETECTED</span>
      </div>
      
      <div className="flex-1 relative flex items-center justify-center p-8 overflow-hidden">
        {/* Radar Container */}
        <div className="relative w-full max-w-[400px] aspect-square rounded-full border border-white/10 bg-black/30 shadow-[inset_0_0_60px_rgba(0,0,0,0.8)] flex items-center justify-center">
          
          {/* Sweep Animation */}
          <div className="absolute inset-0 rounded-full overflow-hidden" style={{ maskImage: 'radial-gradient(white, black)' }}>
             <div className="w-full h-full animate-[spin_4s_linear_infinite]"
                  style={{ background: 'conic-gradient(from 0deg, transparent 65%, rgba(0,229,255,0.05) 85%, rgba(0,229,255,0.4) 100%)' }} />
          </div>

          {/* Concentric Rings (drawn by diameter) */}
          <div className="absolute w-[90%] h-[90%] rounded-full border border-[#00e5ff]/20 shadow-[inset_0_0_20px_rgba(0,229,255,0.05)]" />
          <div className="absolute w-[60%] h-[60%] rounded-full border border-[#ffaa00]/30 bg-[#ffaa00]/5 shadow-[inset_0_0_30px_rgba(255,170,0,0.1)]" />
          <div className="absolute w-[30%] h-[30%] rounded-full border border-[#ff2a5f]/40 bg-[#ff2a5f]/10 shadow-[0_0_40px_rgba(255,42,95,0.2)]" />
          
          {/* Crosshairs */}
          <div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-white/10" />
          <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-white/10" />
          
          {/* Core */}
          <div className="absolute w-3 h-3 bg-white rounded-full shadow-[0_0_20px_white,0_0_40px_#00e5ff]" />
          <div className="absolute w-10 h-10 rounded-full border border-white/30 animate-[ping_3s_ease_infinite]" />

          {/* Render Blips */}
          {watchlist.map(w => {
            let baseRadius, range, color, glow;
            if (w.priority === 'HIGH') {
              baseRadius = 0; range = 15; color = '#ff2a5f'; glow = 'rgba(255,42,95,0.9)';
            } else if (w.priority === 'MEDIUM') {
              baseRadius = 15; range = 15; color = '#ffaa00'; glow = 'rgba(255,170,0,0.8)';
            } else {
              baseRadius = 30; range = 15; color = '#00e5ff'; glow = 'rgba(0,229,255,0.7)';
            }
            
            const urgency = maxCycles > 0 ? (w.cyclesWatched / maxCycles) : 0;
            // 0 distance = center. distance in [0, 50] range.
            const distance = baseRadius + (1 - urgency) * range; 
            
            const angle = symbolAngle(w.symbol);
            const x = 50 + Math.sin(angle) * distance;
            const y = 50 - Math.cos(angle) * distance;
            
            return (
              <div key={w.symbol} 
                   className="absolute flex items-center justify-center group"
                   style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}>
                {/* Blip Dot */}
                <div className="relative w-2.5 h-2.5 rounded-full z-10" style={{ backgroundColor: color, boxShadow: `0 0 12px ${glow}` }} />
                {/* Pulse for high urgency */}
                {w.priority === 'HIGH' && (
                  <div className="absolute w-8 h-8 rounded-full border blip-pulse pointer-events-none" style={{ borderColor: color }} />
                )}
                {/* Label */}
                <div className="absolute mt-7 text-[10px] font-mono font-bold tracking-widest opacity-70 group-hover:opacity-100 group-hover:z-20 transition-opacity whitespace-nowrap bg-black/60 backdrop-blur px-1.5 py-0.5 rounded border border-white/10"
                     style={{ color }}>
                  {w.symbol.replace('USDT', '')}
                </div>
              </div>
            );
          })}
          
          {watchlist.length === 0 && (
             <div className="absolute font-mono text-[10px] text-[#00e5ff]/50 tracking-widest">NO SIGNALS DETECTED</div>
          )}
        </div>
      </div>
      
      {/* Imminent Threats Panel */}
      {closest.length > 0 && (
        <div className="border-t border-white/5 bg-black/30 p-4 shrink-0 backdrop-blur-md">
          <div className="text-[10px] text-slate-500 mb-3 font-sans tracking-widest uppercase font-semibold">IMMINENT ESCALATIONS</div>
          <div className="flex gap-3">
            {closest.map(w => {
              const isHigh = w.priority === 'HIGH';
              const color = isHigh ? 'text-[#ff2a5f]' : 'text-[#ffaa00]';
              const border = isHigh ? 'border-[#ff2a5f]/30' : 'border-[#ffaa00]/30';
              const bg = isHigh ? 'bg-[#ff2a5f]/10' : 'bg-[#ffaa00]/10';
              const glow = isHigh ? 'shadow-[0_0_15px_rgba(255,42,95,0.15)]' : 'shadow-[0_0_15px_rgba(255,170,0,0.1)]';
              
              return (
                <div key={w.symbol} className={`flex-1 flex flex-col p-3 rounded-xl border ${border} ${bg} ${glow} hover:bg-opacity-20 transition-colors`}>
                  <div className="flex justify-between items-start">
                    <div className={`text-sm font-bold font-mono ${color} tracking-tight`}>{w.symbol.replace('USDT','')}</div>
                    <div className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/40 ${isHigh ? 'text-[#ff2a5f]' : 'text-[#ffaa00]'}`}>
                      {w.cyclesWatched} CYC
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-300 mt-2 line-clamp-2 leading-relaxed" title={w.meaning}>{w.meaning}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
