import { ScanSummary, ScanEntry, WatchlistItem } from '@workspace/api-client-react';
import { Target, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function ScanStatus({ scan }: { scan: ScanSummary }) {
  const pct = scan.total > 0 ? (scan.scanned / scan.total) * 100 : 0;

  return (
    <div className="border border-border bg-card/20 p-3 shrink-0 font-mono text-xs flex flex-col gap-2 backdrop-blur-sm relative overflow-hidden">
      {scan.inProgress && (
        <div className="absolute top-0 left-0 w-full h-[1px] bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)] z-10 animate-[scanline_2s_linear_infinite]" />
      )}
      
      <div className="flex justify-between items-center text-muted-foreground">
        <div className="flex items-center gap-2 font-bold">
          {scan.inProgress ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-cyan-500" />
              <span className="text-cyan-500 drop-shadow-[0_0_3px_rgba(6,182,212,0.4)]">SCAN IN PROGRESS</span>
            </>
          ) : (
            <span>SCAN IDLE</span>
          )}
        </div>
        <div>
          {scan.scanned} / {scan.total} PAIRS
        </div>
      </div>

      <div className="h-1 w-full bg-black/60 overflow-hidden rounded">
        <div 
          className={`h-full transition-all duration-300 ${scan.inProgress ? 'bg-cyan-500 shadow-[0_0_5px_rgba(6,182,212,0.5)]' : 'bg-muted-foreground/30'}`}
          style={{ width: `${pct}%` }} 
        />
      </div>
      
      <div className="flex justify-between text-[9px] text-foreground/50">
        <span>{scan.inProgress ? 'SCANNING SYSTEM...' : scan.finishedAt ? `Last scan ${formatDistanceToNow(scan.finishedAt, { addSuffix: true })}` : 'Ready'}</span>
        <span>{scan.elapsedMs ? `${(scan.elapsedMs / 1000).toFixed(1)}s` : '---'}</span>
      </div>
    </div>
  );
}

export function ScanFeed({ feed }: { feed: ScanEntry[] }) {
  return (
    <div className="border border-border bg-card/20 flex flex-col min-h-0 flex-1 backdrop-blur-sm">
      <div className="border-b border-border/50 bg-card/50 px-3 py-1.5 text-xs font-bold text-muted-foreground tracking-widest shrink-0">
        REAL-TIME SCAN FEED
      </div>
      <div className="overflow-y-auto p-2 flex flex-col min-h-0 flex-1 font-mono text-[10px]">
        {feed.map((f, i) => {
          let outlookColor = "text-muted-foreground";
          if (f.outlook === 'PUMP') outlookColor = "text-emerald-500";
          if (f.outlook === 'DUMP') outlookColor = "text-rose-500";
          if (f.outlook === 'BIG_COMING') outlookColor = "text-amber-500 font-bold";
          
          return (
            <div key={`${f.symbol}-${f.ts}-${i}`} className="flex justify-between border-b border-border/20 py-1.5 px-1 hover:bg-white/5 transition-colors">
              <span className="w-16 text-foreground/80 font-bold">{f.symbol}</span>
              <span className="w-8 text-cyan-500/50">R{f.row}</span>
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
    <div className="border border-border bg-card/20 flex flex-col min-h-0 flex-1 backdrop-blur-sm">
      <div className="border-b border-border/50 bg-card/50 px-3 py-1.5 text-xs font-bold text-muted-foreground flex justify-between items-center tracking-widest shrink-0">
        <span>RADAR WATCHLIST [{watchlist.length}]</span>
        <Target className="w-3 h-3 text-cyan-500" />
      </div>
      <div className="overflow-y-auto p-2 flex flex-col gap-1 min-h-0 flex-1">
        {sorted.length === 0 ? (
          <div className="text-muted-foreground/30 text-center py-4 font-mono text-xs flex items-center justify-center h-full">RADAR CLEAR</div>
        ) : (
          sorted.map(w => (
            <div key={w.symbol} className="flex items-center justify-between p-1.5 hover:bg-white/5 border-b border-border/30 font-mono text-[10px] transition-colors">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${w.priority === 'HIGH' ? 'bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.6)] animate-pulse' : 'bg-amber-500 shadow-[0_0_3px_rgba(245,158,11,0.4)]'}`} />
                <span className="font-bold text-foreground">{w.symbol}</span>
                <span className="text-muted-foreground px-1 bg-black/30 rounded">R{w.row}</span>
              </div>
              <div className="flex gap-3 text-muted-foreground text-right items-center">
                <span className="truncate max-w-[80px] opacity-80" title={w.meaning}>{w.meaning}</span>
                <span className="text-cyan-500/70 w-10">{w.cyclesWatched} CYC</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}