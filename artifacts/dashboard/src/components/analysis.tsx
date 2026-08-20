import {
  ActivityEntry,
  LiveSignal
} from '@workspace/api-client-react';
import React from 'react';
import { format } from 'date-fns';

export function MatrixHeatmap({ rowFrequency }: { rowFrequency: Record<string, number> }) {
  const maxFreq = Math.max(0, ...Object.values(rowFrequency), 1);

  return (
    <div className="glass-panel p-4 shrink-0 shadow-lg bg-black/20">
      <div className="text-[10px] font-semibold text-slate-400 mb-4 tracking-widest uppercase font-sans">LATTICE ROW FREQUENCY</div>
      <div className="grid grid-cols-9 gap-1.5">
        {Array.from({ length: 27 }, (_, i) => i + 1).map(row => {
          const freq = rowFrequency[row] || 0;
          const intensity = Math.min((freq / maxFreq), 1);
          const bg = freq === 0 ? 'rgba(255,255,255,0.02)' : `rgba(0,229,255,${0.2 + intensity * 0.8})`;
          const shadow = freq > 0 ? `0 0 ${4 + intensity*12}px rgba(0,229,255,${intensity * 0.8})` : 'none';
          const border = freq === 0 ? 'border-white/5' : `border-[#00e5ff]/30`;
          
          return (
            <div
              key={row}
              className={`aspect-square flex items-center justify-center transition-all duration-1000 relative group cursor-default rounded-[4px] border ${border}`}
              style={{ background: bg, boxShadow: shadow }}
              title={`Row ${row}: ${freq} hits`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-slate-500 mt-3 font-mono font-semibold">
        <span>ROW 1</span><span>ROW 27</span>
      </div>
    </div>
  );
}

export function RecentTrades({ trades }: { trades: LiveSignal[] }) {
  const wins = trades.filter(t => t.status === 'tp_hit' || (t.status === 'auto_closed' && ((t as any).finalPnlAmt ?? 0) > 0)).length;
  const losses = trades.filter(t => (t.status === 'sl_hit' && !(t as any).breakevenMoved) || (t.status === 'auto_closed' && ((t as any).finalPnlAmt ?? 0) <= 0)).length;
  
  return (
    <div className="glass-panel flex flex-col min-h-0 flex-1 shadow-lg bg-black/20">
      <div className="glass-header px-4 py-3 text-[10px] font-semibold text-slate-400 tracking-widest uppercase shrink-0 flex items-center justify-between bg-black/40">
        <span>TRADE LOG</span>
        <span className="text-[10px] normal-case font-mono tracking-normal bg-black/40 px-2 py-0.5 rounded border border-white/5 shadow-inner">
          <span className="text-[#00e5ff] font-bold">{wins}W</span>
          <span className="text-slate-600 mx-1.5">/</span>
          <span className="text-[#ff2a5f] font-bold">{losses}L</span>
        </span>
      </div>
      <div className="overflow-y-auto min-h-0 flex-1 p-1">
        <table className="w-full text-[11px] font-mono text-left whitespace-nowrap border-collapse">
          <thead className="bg-black/40 sticky top-0 z-10 backdrop-blur-md">
            <tr>
              <th className="p-2.5 font-semibold text-slate-500 border-b border-white/10 text-[9px] uppercase tracking-widest">TIME</th>
              <th className="p-2.5 font-semibold text-slate-500 border-b border-white/10 text-[9px] uppercase tracking-widest">SYMBOL</th>
              <th className="p-2.5 font-semibold text-slate-500 border-b border-white/10 text-[9px] uppercase tracking-widest">DIR</th>
              <th className="p-2.5 font-semibold text-slate-500 border-b border-white/10 text-[9px] uppercase tracking-widest">OUTCOME</th>
              <th className="p-2.5 font-semibold text-slate-500 border-b border-white/10 text-[9px] uppercase tracking-widest text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr><td colSpan={5} className="text-center p-8 text-slate-600 text-[11px]">NO RECENT TRADES</td></tr>
            ) : (
              trades.map(t => {
                const s = t as LiveSignal & {
                  finalPnlAmt?: number;
                  partialTpFired?: boolean;
                  breakevenMoved?: boolean;
                };
                const isWin = s.status === 'tp_hit' || (s.status === 'auto_closed' && (s.finalPnlAmt ?? 0) > 0);
                const isBE = s.status === 'sl_hit' && s.breakevenMoved;
                const isAC = s.status === 'auto_closed';
                const pnlColor = isWin ? 'text-[#00e5ff]' : isBE ? 'text-[#ffaa00]' : 'text-[#ff2a5f]';
                const outcomeLabel = isAC ? '🔄 AC' : isWin ? '✅ TP' : isBE ? '⚡ BE' : '❌ SL';
                const pnlDisplay = s.finalPnlAmt != null
                  ? `${s.finalPnlAmt >= 0 ? '+' : ''}$${s.finalPnlAmt.toFixed(3)}`
                  : (isWin ? '✅ TP' : '❌ SL');
                return (
                  <tr key={t.id} className="hover:bg-white/5 transition-colors border-b border-white/5 last:border-0">
                    <td className="p-2.5 text-slate-500">{format(new Date(t.resolvedAt || t.createdAt), 'HH:mm')}</td>
                    <td className="p-2.5 font-bold text-slate-200">{t.symbol}</td>
                    <td className="p-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${t.direction === 'LONG' ? 'bg-[#00e5ff]/10 text-[#00e5ff] border-[#00e5ff]/20' : 'bg-[#ff2a5f]/10 text-[#ff2a5f] border-[#ff2a5f]/20'}`}>
                        {t.direction}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <span className={pnlColor}>{outcomeLabel}</span>
                      {s.partialTpFired && <span className="ml-1.5 text-[9px] text-[#ffaa00] bg-[#ffaa00]/10 px-1.5 py-0.5 rounded border border-[#ffaa00]/20 font-bold">½TP</span>}
                    </td>
                    <td className={`p-2.5 text-right font-bold tracking-tight ${pnlColor}`}>
                      {pnlDisplay}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ActivityLog({ activity }: { activity: ActivityEntry[] }) {
  return (
    <div className="glass-panel flex flex-col min-h-0 flex-1 shadow-lg bg-black/20">
      <div className="glass-header px-4 py-3 text-[10px] font-semibold text-slate-400 tracking-widest uppercase shrink-0 bg-black/40">
        ESCALATION LOG
      </div>
      <div className="overflow-y-auto p-3 flex flex-col min-h-0 flex-1 font-mono text-[11px] gap-1">
        {activity.length === 0 ? (
          <div className="text-slate-600 text-center py-4 flex items-center justify-center h-full">NO ACTIVITY</div>
        ) : (
          activity.map((a, i) => {
            let color = 'text-slate-400';
            let bgStyle = '';
            if (a.kind === 'tp') { color = 'text-[#00e5ff] font-bold'; bgStyle = 'bg-[#00e5ff]/5'; }
            if (a.kind === 'sl') { color = 'text-[#ff2a5f] font-bold'; bgStyle = 'bg-[#ff2a5f]/5'; }
            if (a.kind === 'signal') { color = 'text-[#ffaa00]'; bgStyle = 'bg-[#ffaa00]/5'; }
            if (a.kind === 'watch') color = 'text-[#a78bfa]';
            if (a.kind === 'drop') color = 'text-slate-500';
            if (a.kind === 'scan') color = 'text-slate-500';
            if (a.kind === 'auto_close') color = 'text-[#38bdf8] font-bold';
            if (a.kind === 'partial_tp') { color = 'text-[#ffaa00] font-bold'; bgStyle = 'bg-[#ffaa00]/10'; }

            return (
              <div key={`${a.ts}-${a.kind ?? ''}-${i}`} className={`flex gap-3 py-1.5 px-2 transition-colors hover:bg-white/10 rounded border border-transparent hover:border-white/5 ${bgStyle}`}>
                <span className="text-slate-600 shrink-0">[{format(new Date(a.ts), 'HH:mm:ss')}]</span>
                <span className={`${color} break-words leading-relaxed`}>{a.text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
