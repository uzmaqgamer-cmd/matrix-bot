import { ScanSummary, ScanEntry, WatchlistItem } from '@workspace/api-client-react';
import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { RadarSVG } from './RadarSVG';

export function ScanStatus({ scan }: { scan: ScanSummary }) {
  const pct = scan.total > 0 ? (scan.scanned / scan.total) * 100 : 0;

  return (
    <div className="matrix-card p-3 shrink-0 font-mono text-xs flex flex-col gap-2">
      {scan.inProgress && (
        <div className="absolute top-0 left-0 w-full h-[1px] bg-[#5DCAA5] shadow-[0_0_8px_#5DCAA5] z-10 animate-[scanline_2s_linear_infinite]" />
      )}
      
      <div className="flex justify-between items-center text-[#55636f]">
        <div className="flex items-center gap-2 font-bold text-[11px]">
          {scan.inProgress ? (
            <>
              <span className="text-[#5DCAA5] animate-[flicker_3s_ease_infinite]">● SCAN IN PROGRESS</span>
            </>
          ) : (
            <span>SCAN IDLE</span>
          )}
        </div>
        <div className="text-[10px]">
          {scan.scanned} / {scan.total} PAIRS
        </div>
      </div>

      <div className="h-1 w-full bg-[#12171f] overflow-hidden rounded">
        <div 
          className={`h-full transition-all duration-300 ${scan.inProgress ? 'bg-[#5DCAA5] shadow-[0_0_5px_#5DCAA5]' : 'bg-[#55636f]/30'}`}
          style={{ width: `${pct}%` }} 
        />
      </div>
      
      <div className="flex justify-between text-[9px] text-[#55636f]">
        <span>{scan.inProgress ? 'SCANNING SYSTEM...' : scan.finishedAt ? `Last scan ${formatDistanceToNow(scan.finishedAt, { addSuffix: true })}` : 'Ready'}</span>
        <span>{scan.elapsedMs ? `${(scan.elapsedMs / 1000).toFixed(1)}s` : '---'}</span>
      </div>
    </div>
  );
}

export function ScanFeed({ feed }: { feed: ScanEntry[] }) {
  return (
    <div className="matrix-card flex flex-col min-h-0 flex-1">
      <div className="border-b border-[#1c2530] px-3 py-2 text-[9.5px] font-medium text-[#55636f] tracking-[0.9px] uppercase shrink-0">
        LIVE MATRIX SCAN
      </div>
      <div className="overflow-y-auto p-2 flex flex-col min-h-0 flex-1 font-mono text-[10px]">
        {feed.map((f, i) => {
          let outlookColor = "text-[#55636f]";
          if (f.outlook === 'PUMP') outlookColor = "text-[#5DCAA5]";
          if (f.outlook === 'DUMP') outlookColor = "text-[#F0716E]";
          if (f.outlook === 'BIG_COMING') outlookColor = "text-[#F5B457] font-bold";
          
          return (
            <div key={`${f.symbol}-${f.ts}-${i}`} className="flex justify-between border-b border-[#12171f] py-1.5 px-1 hover:bg-white/5 transition-colors">
              <span className="w-16 text-[#e8ecf0] font-medium">{f.symbol}</span>
              <span className="w-12 text-[#55636f]">ROW {f.row}</span>
              <span className={`flex-1 text-right ${outlookColor}`}>{f.outlook}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Watchlist({ watchlist }: { watchlist: WatchlistItem[] }) {
  const sorted = [...watchlist].sort((a, b) => {
    if (a.priority === 'HIGH' && b.priority !== 'HIGH') return -1;
    if (a.priority !== 'HIGH' && b.priority === 'HIGH') return 1;
    return b.cyclesWatched - a.cyclesWatched;
  });

  return (
    <div className="matrix-card flex flex-col min-h-0 flex-1">
      <div className="border-b border-[#1c2530] px-3 py-2 text-[9.5px] font-medium text-[#55636f] flex justify-between items-center tracking-[0.9px] uppercase shrink-0">
        <span>RADAR WATCHLIST [{watchlist.length}]</span>
      </div>
      
      <div className="flex flex-col items-center justify-center p-4 pb-0 shrink-0">
        <RadarSVG />
      </div>

      <div className="overflow-y-auto p-2 flex flex-col gap-1 min-h-0 flex-1 mt-2">
        {sorted.length === 0 ? (
          <div className="text-[#55636f]/30 text-center py-4 font-mono text-[10px] flex items-center justify-center h-full">RADAR CLEAR</div>
        ) : (
          sorted.map(w => (
            <div key={w.symbol} className="flex items-center justify-between p-1.5 hover:bg-white/5 border-b border-[#12171f] font-mono text-[10px] transition-colors">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${w.priority === 'HIGH' ? 'bg-[#F0716E] shadow-[0_0_5px_#F0716E] animate-[flicker_3s_ease_infinite]' : 'bg-[#F5B457] shadow-[0_0_3px_#F5B457]'}`} />
                <span className="font-bold text-[#e8ecf0]">{w.symbol}</span>
                <span className="text-[#55636f] px-1 bg-[#12171f] rounded border border-[#1c2530]">R{w.row}</span>
              </div>
              <div className="flex gap-3 text-[#55636f] text-right items-center">
                <span className="truncate max-w-[80px] opacity-80" title={w.meaning}>{w.meaning}</span>
                <span className="text-[#85B7EB] w-10">{w.cyclesWatched} CYC</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
