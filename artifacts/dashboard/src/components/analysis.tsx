import { ActivityEntry, LiveSignal, PriorityResolution as PriorityResType } from '@workspace/api-client-react';
import React from 'react';
import { format } from 'date-fns';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';

export function MatrixHeatmap({ rowFrequency }: { rowFrequency: Record<string, number> }) {
  const maxFreq = Math.max(...Object.values(rowFrequency), 1);

  return (
    <div className="matrix-card p-3 shrink-0">
      <div className="text-[9.5px] font-medium text-[#55636f] mb-3 tracking-[0.9px] uppercase">ROW FREQUENCY THIS SESSION</div>
      <div className="grid grid-cols-9 gap-[3px]">
        {Array.from({ length: 27 }, (_, i) => i + 1).map(row => {
          const freq = rowFrequency[row] || 0;
          const intensity = Math.min((freq / maxFreq), 1);
          const bg = freq === 0 ? '#12171f' : `rgba(93,202,165,${0.15 + intensity * 0.75})`;
          return (
            <div 
              key={row}
              className="aspect-square flex items-center justify-center text-[8px] font-mono transition-all duration-1000 relative group cursor-default rounded-sm"
              style={{ background: bg }}
              title={`Row ${row}: ${freq} hits`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-[#4a565f] mt-1.5 font-mono">
        <span>row 1</span><span>row 27</span>
      </div>
    </div>
  );
}

export function PriorityResolution({ resolution }: { resolution: PriorityResType }) {
  const highPct = resolution.highTotal > 0 ? (resolution.highResolved / resolution.highTotal) * 100 : 0;
  const medPct = resolution.medTotal > 0 ? (resolution.medResolved / resolution.medTotal) * 100 : 0;

  return (
    <div className="matrix-card p-3 shrink-0 font-mono text-[10px] flex flex-col gap-3">
      <div>
        <div className="text-[9.5px] font-medium text-[#55636f] mb-2 tracking-[0.9px] uppercase font-sans">DIVERGENCE PRIORITY RESOLUTION</div>
        <div className="flex justify-between mb-[3px]">
          <span className="text-[#F0716E]">high</span>
          <span className="text-[#e8ecf0]">{resolution.highTotal > 0 ? `${highPct.toFixed(0)}%` : '—'}</span>
        </div>
        <div className="h-[5px] w-full bg-[#12171f] rounded-[3px] overflow-hidden">
          <div className="h-full bg-[#F0716E] transition-all duration-500 shadow-[0_0_6px_#F0716E]" style={{ width: `${highPct}%` }} />
        </div>
      </div>
      <div>
        <div className="flex justify-between mb-[3px]">
          <span className="text-[#F5B457]">medium</span>
          <span className="text-[#e8ecf0]">{resolution.medTotal > 0 ? `${medPct.toFixed(0)}%` : '—'}</span>
        </div>
        <div className="h-[5px] w-full bg-[#12171f] rounded-[3px] overflow-hidden">
          <div className="h-full bg-[#F5B457] transition-all duration-500 shadow-[0_0_6px_#F5B457]" style={{ width: `${medPct}%` }} />
        </div>
      </div>
    </div>
  );
}

export function BalanceChart({ history, paperBalance }: { history: number[], paperBalance: number, paperBalanceDelta: number }) {
  const data = history.map((v, i) => ({ index: i, value: v }));
  
  const minDomain = Math.min(...history, 100) * 0.98;
  const maxDomain = Math.max(...history, 100) * 1.02;

  const isProfit = paperBalance >= 100;
  const color = isProfit ? '#5DCAA5' : '#F0716E';

  return (
    <div className="matrix-card flex flex-col shrink-0 h-40">
      <div className="px-3 py-2 text-[9.5px] font-medium text-[#55636f] flex justify-between tracking-[0.9px] uppercase shrink-0 z-10">
        <span>ACCOUNT BALANCE</span>
      </div>
      <div className="flex-1 p-2 min-h-0 w-full relative z-10">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <YAxis domain={[minDomain, maxDomain]} hide />
            <Line 
              type="linear" 
              dataKey="value" 
              stroke={color} 
              strokeWidth={1.5} 
              dot={false}
              isAnimationActive={false}
              style={{ filter: `drop-shadow(0 0 4px ${isProfit ? '#1D9E75' : '#D4537E'})` }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function RecentTrades({ trades }: { trades: LiveSignal[] }) {
  return (
    <div className="matrix-card flex flex-col min-h-0 flex-1">
      <div className="border-b border-[#1c2530] px-3 py-2 text-[9.5px] font-medium text-[#55636f] tracking-[0.9px] uppercase shrink-0">
        TRADE RESULTS
      </div>
      <div className="overflow-y-auto min-h-0 flex-1 p-1">
        <table className="w-full text-[10px] font-mono text-left whitespace-nowrap border-collapse">
          <thead className="bg-[#0c1119] sticky top-0 z-10">
            <tr>
              <th className="p-1.5 font-medium text-[#4a565f] border-b border-[#1c2530] text-[9px] uppercase tracking-[0.5px]">TIME</th>
              <th className="p-1.5 font-medium text-[#4a565f] border-b border-[#1c2530] text-[9px] uppercase tracking-[0.5px]">SYMBOL</th>
              <th className="p-1.5 font-medium text-[#4a565f] border-b border-[#1c2530] text-[9px] uppercase tracking-[0.5px]">DIR</th>
              <th className="p-1.5 font-medium text-[#4a565f] border-b border-[#1c2530] text-[9px] uppercase tracking-[0.5px]">ENTRY → EXIT</th>
              <th className="p-1.5 font-medium text-[#4a565f] border-b border-[#1c2530] text-[9px] uppercase tracking-[0.5px] text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr><td colSpan={5} className="text-center p-8 text-[#55636f]/30">NO RECENT TRADES</td></tr>
            ) : (
              trades.map(t => {
                const isWin = t.status === 'tp_hit';
                const pnlColor = isWin ? 'text-[#5DCAA5]' : 'text-[#F0716E]';
                return (
                  <tr key={t.id} className="hover:bg-white/5 transition-colors">
                    <td className="p-1.5 text-[#55636f] border-b border-[#12171f]">{format(new Date(t.resolvedAt || t.createdAt), 'HH:mm')}</td>
                    <td className="p-1.5 font-bold text-[#e8ecf0] border-b border-[#12171f]">{t.symbol}</td>
                    <td className="p-1.5 border-b border-[#12171f]">
                      <span className={t.direction === 'LONG' ? 'text-[#5DCAA5]' : 'text-[#F0716E]'}>{t.direction}</span>
                    </td>
                    <td className="p-1.5 text-[#55636f] border-b border-[#12171f]">
                      {t.entry} → {isWin ? t.tp : t.sl}
                    </td>
                    <td className={`p-1.5 text-right font-bold ${pnlColor} border-b border-[#12171f]`}>
                      {isWin ? '✅ TP' : '❌ SL'}
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
    <div className="matrix-card flex flex-col min-h-0 flex-1">
      <div className="border-b border-[#1c2530] px-3 py-2 text-[9.5px] font-medium text-[#55636f] tracking-[0.9px] uppercase shrink-0">
        ESCALATION LOG
      </div>
      <div className="overflow-y-auto p-2 flex flex-col min-h-0 flex-1 font-mono text-[10px]">
        {activity.length === 0 ? (
          <div className="text-[#55636f]/30 text-center py-4 flex items-center justify-center h-full">NO ACTIVITY</div>
        ) : (
          activity.map((a, i) => {
            let color = "text-[#4a565f]";
            if (a.kind === 'tp') color = "text-[#5DCAA5] font-bold";
            if (a.kind === 'sl') color = "text-[#F0716E] font-bold";
            if (a.kind === 'signal') color = "text-[#F5B457]";
            if (a.kind === 'watch') color = "text-[#A29BF0]";
            if (a.kind === 'drop') color = "text-[#55636f]";
            if (a.kind === 'scan') color = "text-[#55636f]";

            return (
              <div key={`${a.ts}-${i}`} className="flex gap-2 py-0.5 transition-colors">
                <span className="text-[#55636f] shrink-0">[{format(new Date(a.ts), 'HH:mm:ss')}]</span>
                <span className={`${color} break-words`}>{a.text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
