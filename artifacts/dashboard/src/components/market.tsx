import { ScanSummary, ScanEntry } from '@workspace/api-client-react';
import React from 'react';
import { formatDistanceToNow } from 'date-fns';

export function ScanStatus({ scan }: { scan: ScanSummary }) {
  const pct = scan.total > 0 ? (scan.scanned / scan.total) * 100 : 0;

  return (
    <div className="glass-panel p-4 shrink-0 font-mono text-xs flex flex-col gap-3 shadow-lg bg-black/20">
      {scan.inProgress && (
        <div className="absolute top-0 left-0 w-full h-[2px] bg-[#00e5ff] shadow-[0_0_15px_#00e5ff] z-10 animate-[scanline_2s_linear_infinite]" />
      )}
      
      <div className="flex justify-between items-center text-slate-400">
        <div className="flex items-center gap-2 font-bold text-[11px] tracking-wide">
          {scan.inProgress ? (
            <span className="glow-text-cyan animate-pulse">● SCAN IN PROGRESS</span>
          ) : (
            <span>SCAN IDLE</span>
          )}
        </div>
        <div className="text-[10px] font-semibold bg-black/40 px-2 py-0.5 rounded border border-white/5">
          {scan.scanned} / {scan.total}
        </div>
      </div>

      <div className="h-1.5 w-full bg-black/60 overflow-hidden rounded-full border border-white/10 shadow-inner">
        <div 
          className={`h-full rounded-full transition-all duration-300 ${scan.inProgress ? 'bg-[#00e5ff] shadow-[0_0_10px_#00e5ff]' : 'bg-slate-700'}`}
          style={{ width: `${pct}%` }} 
        />
      </div>
      
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{scan.inProgress ? 'SCANNING LATTICE...' : scan.finishedAt ? `Last scan ${formatDistanceToNow(scan.finishedAt, { addSuffix: true })}` : 'Ready'}</span>
        <span>{scan.elapsedMs ? `${(scan.elapsedMs / 1000).toFixed(1)}s` : '---'}</span>
      </div>
    </div>
  );
}

export function ScanFeed({ feed }: { feed: ScanEntry[] }) {
  return (
    <div className="glass-panel flex flex-col min-h-0 flex-1 shadow-lg bg-black/20">
      <div className="glass-header px-4 py-3 text-[10px] font-semibold text-slate-400 tracking-widest uppercase shrink-0 bg-black/40">
        LIVE MATRIX SCAN
      </div>
      <div className="overflow-y-auto p-2 flex flex-col min-h-0 flex-1 font-mono text-[11px]">
        {feed.map((f, i) => {
          let outlookColor = "text-slate-400";
          let outlookStyle = "";
          if (f.outlook === 'PUMP') outlookColor = "text-[#00e5ff]";
          if (f.outlook === 'DUMP') outlookColor = "text-[#ff2a5f]";
          if (f.outlook === 'BIG_COMING') {
            outlookColor = "text-[#ffaa00] font-bold";
            outlookStyle = "shadow-[0_0_10px_rgba(255,170,0,0.1)] bg-[#ffaa00]/10";
          }
          
          return (
            <div key={`${f.symbol}-${f.ts}-${i}`} className={`flex justify-between border-b border-white/5 py-2.5 px-3 hover:bg-white/5 transition-colors rounded ${outlookStyle}`}>
              <span className="w-16 text-slate-200 font-bold">{f.symbol}</span>
              <span className="w-12 text-slate-500">ROW {f.row}</span>
              <span className={`flex-1 text-right ${outlookColor}`}>{f.outlook}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
