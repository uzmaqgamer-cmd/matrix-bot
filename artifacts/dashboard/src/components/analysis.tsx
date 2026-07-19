import { ActivityEntry, LiveSignal, PriorityResolution as PriorityResType } from '@workspace/api-client-react';
import { format } from 'date-fns';
import { LineChart, Line, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';

export function MatrixHeatmap({ rowFrequency }: { rowFrequency: Record<string, number> }) {
  const maxFreq = Math.max(...Object.values(rowFrequency), 1);

  return (
    <div className="border border-border bg-card/20 p-3 shrink-0 backdrop-blur-sm">
      <div className="text-xs font-bold text-muted-foreground mb-2 tracking-widest">MATRIX DISTRIBUTION</div>
      <div className="grid grid-cols-9 gap-1">
        {Array.from({ length: 27 }, (_, i) => i + 1).map(row => {
          const freq = rowFrequency[row] || 0;
          const intensity = Math.min((freq / maxFreq), 1);
          return (
            <div 
              key={row}
              className="aspect-square flex items-center justify-center text-[8px] font-mono border transition-all duration-1000 relative group cursor-default"
              style={{
                backgroundColor: intensity > 0 ? `rgba(6, 182, 212, ${intensity * 0.8})` : 'rgba(255,255,255,0.02)',
                color: intensity > 0.5 ? '#000' : 'rgba(255,255,255,0.7)',
                borderColor: intensity > 0 ? `rgba(6, 182, 212, ${intensity + 0.2})` : 'rgba(255,255,255,0.05)',
                boxShadow: intensity > 0.5 ? `0 0 ${intensity * 10}px rgba(6, 182, 212, 0.4)` : 'none'
              }}
            >
              {row}
              <div className="absolute hidden group-hover:block bg-black text-white p-1.5 rounded -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap z-50 text-[10px] border border-border shadow-xl">
                Row {row}: {freq} hits
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PriorityResolution({ resolution }: { resolution: PriorityResType }) {
  const highPct = resolution.highTotal > 0 ? (resolution.highResolved / resolution.highTotal) * 100 : 0;
  const medPct = resolution.medTotal > 0 ? (resolution.medResolved / resolution.medTotal) * 100 : 0;

  return (
    <div className="border border-border bg-card/20 p-3 shrink-0 font-mono text-xs flex flex-col gap-3 backdrop-blur-sm">
      <div>
        <div className="flex justify-between text-muted-foreground mb-1 text-[10px]">
          <span>HIGH PRIORITY RES</span>
          <span>{resolution.highResolved} / {resolution.highTotal} ({highPct.toFixed(0)}%)</span>
        </div>
        <div className="h-1.5 w-full bg-black/60 rounded-full overflow-hidden">
          <div className="h-full bg-amber-500 transition-all duration-500 shadow-[0_0_5px_rgba(245,158,11,0.5)]" style={{ width: `${highPct}%` }} />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-muted-foreground mb-1 text-[10px]">
          <span>MEDIUM PRIORITY RES</span>
          <span>{resolution.medResolved} / {resolution.medTotal} ({medPct.toFixed(0)}%)</span>
        </div>
        <div className="h-1.5 w-full bg-black/60 rounded-full overflow-hidden">
          <div className="h-full bg-cyan-500 transition-all duration-500 shadow-[0_0_5px_rgba(6,182,212,0.5)]" style={{ width: `${medPct}%` }} />
        </div>
      </div>
    </div>
  );
}

export function BalanceChart({ history, paperBalance, paperBalanceDelta }: { history: number[], paperBalance: number, paperBalanceDelta: number }) {
  const data = history.map((v, i) => ({ index: i, value: v }));
  
  const minDomain = Math.min(...history, 100) * 0.98;
  const maxDomain = Math.max(...history, 100) * 1.02;

  const isProfit = paperBalance >= 100;
  const color = isProfit ? '#10b981' : '#f43f5e'; // emerald-500 / rose-500

  return (
    <div className="border border-border bg-card/20 flex flex-col shrink-0 h-40 backdrop-blur-sm">
      <div className="px-3 py-1.5 text-xs font-bold text-muted-foreground flex justify-between border-b border-border/50 bg-card/50 tracking-widest shrink-0">
        <span>EQUITY CURVE</span>
        <span className={`${isProfit ? 'text-emerald-500 drop-shadow-[0_0_3px_rgba(16,185,129,0.5)]' : 'text-rose-500 drop-shadow-[0_0_3px_rgba(244,63,94,0.5)]'}`}>
          ${paperBalance.toFixed(2)}
        </span>
      </div>
      <div className="flex-1 p-2 min-h-0 w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <YAxis domain={[minDomain, maxDomain]} hide />
            <ReferenceLine y={100} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
            <Line 
              type="stepAfter" 
              dataKey="value" 
              stroke={color} 
              strokeWidth={2} 
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function RecentTrades({ trades }: { trades: LiveSignal[] }) {
  return (
    <div className="border border-border bg-card/20 flex flex-col min-h-0 flex-1 backdrop-blur-sm">
      <div className="border-b border-border/50 bg-card/50 px-3 py-1.5 text-xs font-bold text-muted-foreground tracking-widest shrink-0">
        SETTLED TRADES
      </div>
      <div className="overflow-y-auto min-h-0 flex-1">
        <table className="w-full text-[10px] font-mono text-left whitespace-nowrap">
          <thead className="bg-card/40 sticky top-0 border-b border-border/50 backdrop-blur-md z-10">
            <tr>
              <th className="p-2 font-normal text-muted-foreground">TIME</th>
              <th className="p-2 font-normal text-muted-foreground">SYMBOL</th>
              <th className="p-2 font-normal text-muted-foreground">DIR</th>
              <th className="p-2 font-normal text-muted-foreground">ENTRY → EXIT</th>
              <th className="p-2 font-normal text-muted-foreground text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr><td colSpan={5} className="text-center p-8 text-muted-foreground/30">NO RECENT TRADES</td></tr>
            ) : (
              trades.map(t => {
                const isWin = t.status === 'tp_hit';
                const pnlColor = isWin ? 'text-emerald-500' : 'text-rose-500';
                return (
                  <tr key={t.id} className="border-b border-border/20 hover:bg-white/5 transition-colors">
                    <td className="p-2 text-foreground/40">{format(new Date(t.resolvedAt || t.createdAt), 'HH:mm')}</td>
                    <td className="p-2 font-bold text-foreground">{t.symbol}</td>
                    <td className="p-2">
                      <span className={t.direction === 'LONG' ? 'text-emerald-500' : 'text-rose-500'}>{t.direction}</span>
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {t.entry} → {isWin ? t.tp : t.sl}
                    </td>
                    <td className={`p-2 text-right font-bold ${pnlColor}`}>
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
    <div className="border border-border bg-card/20 flex flex-col min-h-0 flex-1 backdrop-blur-sm">
      <div className="border-b border-border/50 bg-card/50 px-3 py-1.5 text-xs font-bold text-muted-foreground tracking-widest shrink-0">
        SYSTEM ACTIVITY LOG
      </div>
      <div className="overflow-y-auto p-2 flex flex-col min-h-0 flex-1 font-mono text-[10px]">
        {activity.length === 0 ? (
          <div className="text-muted-foreground/30 text-center py-4 flex items-center justify-center h-full">NO ACTIVITY</div>
        ) : (
          activity.map((a, i) => {
            let color = "text-muted-foreground";
            if (a.kind === 'tp') color = "text-emerald-500 font-bold";
            if (a.kind === 'sl') color = "text-rose-500 font-bold";
            if (a.kind === 'signal') color = "text-amber-500";
            if (a.kind === 'watch') color = "text-cyan-500/80";
            if (a.kind === 'drop') color = "text-foreground/40";
            if (a.kind === 'scan') color = "text-foreground/30";

            return (
              <div key={`${a.ts}-${i}`} className="flex gap-2 py-1 border-b border-border/10 hover:bg-white/5 transition-colors">
                <span className="text-foreground/30 shrink-0">{format(new Date(a.ts), 'HH:mm:ss')}</span>
                <span className={`${color} break-words`}>{a.text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}