import { LiveSignal } from '@workspace/api-client-react';

export function ActiveSignals({ signals }: { signals: LiveSignal[] }) {
  return (
    <div className="border border-border bg-card/20 flex flex-col min-h-0 flex-1 backdrop-blur-sm">
      <div className="border-b border-border/50 bg-card/50 px-3 py-1.5 text-xs font-bold text-muted-foreground flex justify-between tracking-widest shrink-0">
        <span>ACTIVE TARGETS [{signals.length}]</span>
        {signals.length > 0 && <span className="text-[10px] animate-pulse text-emerald-500">TRACKING LIVE</span>}
      </div>
      <div className="overflow-y-auto p-2 flex flex-col gap-2 min-h-0 flex-1">
        {signals.length === 0 ? (
          <div className="text-muted-foreground/30 text-center py-8 font-mono text-xs flex items-center justify-center h-full">NO ACTIVE TARGETS ON RADAR</div>
        ) : (
          signals.map(s => <SignalCard key={s.id} signal={s} />)
        )}
      </div>
    </div>
  );
}

function SignalCard({ signal }: { signal: LiveSignal }) {
  const isLong = signal.direction === 'LONG';
  const dirColor = isLong ? 'text-emerald-500' : 'text-rose-500';
  const dirBg = isLong ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20';
  
  const pnl = signal.pnlPct || 0;
  const pnlColor = pnl > 0 ? 'text-emerald-500' : pnl < 0 ? 'text-rose-500' : 'text-muted-foreground';
  
  const prog = signal.tpProgressPct || 0;
  const isNearTp = prog > 85;
  const normalizedProg = Math.max(-100, Math.min(100, prog));
  
  return (
    <div className={`border p-2 font-mono text-xs relative overflow-hidden ${dirBg} ${isNearTp ? 'border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.15)]' : 'border-border/50'} transition-all duration-300`}>
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2">
          <span className={`font-bold text-sm ${dirColor}`}>{signal.symbol}</span>
          <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${isLong ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'}`}>{signal.direction}</span>
          <span className="px-1 py-0.5 rounded bg-secondary text-muted-foreground text-[9px]">{signal.tpTier}</span>
        </div>
        <div className={`font-bold text-sm ${pnlColor} ${isNearTp ? 'animate-pulse' : ''}`}>
          {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}%
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-4 text-[10px] text-muted-foreground mt-2">
        <div>ENTRY: <span className="text-foreground">{signal.entry}</span></div>
        <div className="text-center">CURR: <span className="text-foreground">{signal.currentPrice || '---'}</span></div>
        <div className="text-right">TP: <span className="text-emerald-500">{signal.tp}</span> | SL: <span className="text-rose-500">{signal.sl}</span></div>
      </div>

      <div className="mt-2 h-1.5 w-full bg-black/60 rounded-full overflow-hidden relative">
        <div className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground/30 z-10"></div>
        {normalizedProg >= 0 ? (
          <div 
            className="absolute inset-y-0 left-1/2 bg-emerald-500 transition-all duration-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" 
            style={{ width: `${normalizedProg / 2}%` }} 
          />
        ) : (
          <div 
            className="absolute inset-y-0 right-1/2 bg-rose-500 transition-all duration-500 shadow-[0_0_5px_rgba(244,63,94,0.5)]" 
            style={{ width: `${-normalizedProg / 2}%` }} 
          />
        )}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1 opacity-70">
        <span>SL PROGRESS</span>
        <span className={isNearTp ? 'text-amber-500 font-bold' : ''}>{prog.toFixed(1)}% TO TP</span>
      </div>
    </div>
  );
}

export function PendingSignals({ signals }: { signals: LiveSignal[] }) {
  return (
    <div className="border border-border bg-card/20 flex flex-col min-h-0 backdrop-blur-sm">
      <div className="border-b border-border/50 bg-card/50 px-3 py-1.5 text-xs font-bold text-muted-foreground flex justify-between tracking-widest shrink-0">
        <span>PENDING VERIFICATION [{signals.length}]</span>
      </div>
      <div className="overflow-y-auto p-2 flex flex-col gap-1.5 min-h-0 flex-1">
        {signals.length === 0 ? (
          <div className="text-muted-foreground/30 text-center py-4 font-mono text-xs flex items-center justify-center h-full">NO PENDING SIGNALS</div>
        ) : (
          signals.map(s => (
            <div key={s.id} className="border border-amber-500/20 bg-amber-500/5 p-2 font-mono text-xs flex justify-between items-center opacity-80 hover:opacity-100 transition-opacity">
              <div className="flex gap-2 items-center">
                <span className="font-bold text-amber-500 drop-shadow-[0_0_3px_rgba(245,158,11,0.4)]">{s.symbol}</span>
                <span className="text-[10px] text-muted-foreground px-1 bg-black/40 rounded">{s.direction}</span>
              </div>
              <div className="text-[10px] text-muted-foreground text-right">
                <div>ROW {s.matrixRow} - {s.originPriority}</div>
                <div className="opacity-70">RR: {s.rr.toFixed(2)} | ATR: {s.atr.toFixed(4)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}