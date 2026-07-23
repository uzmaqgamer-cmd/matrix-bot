import {
  ActivityEntry,
  LiveSignal,
  PriorityResolution as PriorityResType,
  Test2Stats,
  Test1Stats,
} from '@workspace/api-client-react';
import React from 'react';
import { format } from 'date-fns';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';

// ─── Matrix Heatmap ───────────────────────────────────────────────────────────

export function MatrixHeatmap({ rowFrequency }: { rowFrequency: Record<string, number> }) {
  const maxFreq = Math.max(0, ...Object.values(rowFrequency), 1);

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

// ─── Priority Resolution ──────────────────────────────────────────────────────

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

// ─── Balance Chart ────────────────────────────────────────────────────────────

export function BalanceChart({ history, paperBalance, paperBalanceDelta }: { history: number[], paperBalance: number, paperBalanceDelta: number }) {
  const data = history.map((v, i) => ({ index: i, value: v }));

  const minDomain = Math.min(...history, 100) * 0.98;
  const maxDomain = Math.max(...history, 100) * 1.02;

  const isProfit = paperBalance >= 100;
  const color = isProfit ? '#5DCAA5' : '#F0716E';

  return (
    <div className="matrix-card flex flex-col shrink-0 h-32">
      <div className="px-3 py-2 text-[9.5px] font-medium text-[#55636f] flex justify-between tracking-[0.9px] uppercase shrink-0 z-10">
        <span>TEST 2 BALANCE</span>
        <span className={`font-bold font-mono ${isProfit ? 'text-[#5DCAA5]' : 'text-[#F0716E]'}`}>
          ${paperBalance.toFixed(2)}
          <span className="ml-1 text-[9px] opacity-70">
            ({paperBalanceDelta >= 0 ? '+' : ''}{paperBalanceDelta.toFixed(2)})
          </span>
        </span>
      </div>
      <div className="flex-1 p-2 min-h-0 w-full relative z-10">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
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

// ─── Trade Stats (Test 2 comprehensive + Test 1 baseline) ─────────────────────

export function TradeStats({ test2, test1 }: { test2: Test2Stats; test1: Test1Stats }) {
  const longStats  = test2.byDirection?.LONG;
  const shortStats = test2.byDirection?.SHORT;
  const tier20 = test2.byTier?.['2.0'];
  const tier25 = test2.byTier?.['2.5'];
  const tier35 = test2.byTier?.['3.5'];

  const all   = test2.allStats;
  const clean = test2.cleanStats;
  const bkts  = test2.buckets;

  function WR({ val }: { val?: number | null }) {
    if (val == null) return <span className="text-[#55636f]">—</span>;
    const c = val >= 55 ? 'text-[#5DCAA5]' : val >= 40 ? 'text-[#F5B457]' : 'text-[#F0716E]';
    return <span className={c}>{val.toFixed(0)}%</span>;
  }

  function StatCol({ label, s, highlight }: { label: string; s?: typeof all; highlight?: boolean }) {
    const wr = s?.winRate ?? null;
    const pf = s?.profitFactor ?? null;
    const er = s?.expectancyR ?? null;
    const wrC = wr == null ? 'text-[#55636f]' : wr >= 55 ? 'text-[#5DCAA5]' : wr >= 40 ? 'text-[#F5B457]' : 'text-[#F0716E]';
    const pfC = pf == null ? 'text-[#55636f]' : pf >= 1.5 ? 'text-[#5DCAA5]' : pf >= 1.0 ? 'text-[#F5B457]' : 'text-[#F0716E]';
    const erC = er == null ? 'text-[#55636f]' : er > 0 ? 'text-[#5DCAA5]' : 'text-[#F0716E]';
    const pnlC = (s?.pnlAmt ?? 0) >= 0 ? 'text-[#5DCAA5]' : 'text-[#F0716E]';
    return (
      <div className={`bg-[#0c1119] rounded p-1.5 flex flex-col gap-0.5 ${highlight ? 'border border-[rgba(93,202,165,0.2)]' : ''}`}>
        <div className={`text-[8.5px] uppercase tracking-[0.5px] mb-0.5 ${highlight ? 'text-[#5DCAA5]' : 'text-[#55636f]'}`}>{label}</div>
        <div className="flex justify-between text-[9px]">
          <span className="text-[#4a565f]">WR</span>
          <span className={wrC}>{wr != null ? `${wr.toFixed(1)}%` : '—'}</span>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-[#4a565f]">PF</span>
          <span className={pfC}>{pf != null ? pf.toFixed(2) : '—'}</span>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-[#4a565f]">E(R)</span>
          <span className={erC}>{er != null ? (er >= 0 ? '+' : '') + er.toFixed(3) : '—'}</span>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-[#4a565f]">P&amp;L</span>
          <span className={pnlC}>
            {s?.pnlAmt != null ? `${s.pnlAmt >= 0 ? '+' : ''}$${s.pnlAmt.toFixed(3)}` : '—'}
          </span>
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-[#4a565f]">W/L</span>
          <span className="text-[#e8ecf0]">{s?.winCount ?? 0}/{s?.lossCount ?? 0}</span>
        </div>
      </div>
    );
  }

  // Bucket config: label, key, colour
  const BUCKETS: { label: string; key: keyof NonNullable<typeof bkts>; color: string }[] = [
    { label: 'TP WIN',  key: 'FULL_TP_WIN',    color: 'text-[#5DCAA5]' },
    { label: 'BE WIN',  key: 'BREAKEVEN_WIN',  color: 'text-[#5DCAA5]' },
    { label: 'AC WIN',  key: 'AUTO_CLOSE_WIN', color: 'text-[#5DCAA5]' },
    { label: 'AC LOSS', key: 'AUTO_CLOSE_LOSS',color: 'text-[#F0716E]' },
    { label: 'SL LOSS', key: 'FULL_LOSS',      color: 'text-[#F0716E]' },
  ];

  return (
    <div className="matrix-card p-3 shrink-0 flex flex-col gap-2.5 font-mono text-[10px]">
      <div className="text-[9.5px] font-medium text-[#55636f] tracking-[0.9px] uppercase font-sans">TEST 2 PERFORMANCE</div>

      {/* ── Parallel stat sets: All vs Clean ── */}
      <div className="grid grid-cols-2 gap-2">
        <StatCol label={`All (${all?.tradeCount ?? 0})`} s={all} />
        <StatCol label={`Clean (${clean?.tradeCount ?? 0})`} s={clean} highlight />
      </div>
      {(test2.buggedCount ?? 0) > 0 && (
        <div className="text-[8.5px] text-[#F5B457]/70 -mt-1">
          ⚠ {test2.buggedCount} bugged trade{test2.buggedCount === 1 ? '' : 's'} excluded from Clean (sl = entry at creation)
        </div>
      )}

      {/* ── Outcome buckets (clean) ── */}
      <div className="border-t border-[#1c2530] pt-2">
        <div className="text-[9px] text-[#4a565f] mb-1.5 uppercase tracking-[0.5px]">Outcome Buckets <span className="normal-case text-[#2a3540]">(clean only)</span></div>
        <table className="w-full text-[9.5px] border-collapse">
          <thead>
            <tr className="text-[#4a565f] text-[9px]">
              <th className="text-left py-0.5">BUCKET</th>
              <th className="text-right py-0.5">N</th>
              <th className="text-right py-0.5">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {BUCKETS.map(({ label, key, color }) => {
              const b = bkts?.[key];
              const pnlC = (b?.pnlAmt ?? 0) >= 0 ? 'text-[#5DCAA5]' : 'text-[#F0716E]';
              return (
                <tr key={key} className="border-t border-[#12171f]">
                  <td className={`py-0.5 ${color}`}>{label}</td>
                  <td className="py-0.5 text-right text-[#55636f]">{b?.count ?? 0}</td>
                  <td className={`py-0.5 text-right ${b?.count ? pnlC : 'text-[#2a3540]'}`}>
                    {b?.count ? `${(b.pnlAmt ?? 0) >= 0 ? '+' : ''}$${(b.pnlAmt ?? 0).toFixed(3)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Direction breakdown (clean) ── */}
      <div className="border-t border-[#1c2530] pt-2">
        <div className="text-[9px] text-[#4a565f] mb-1.5 uppercase tracking-[0.5px]">By Direction <span className="normal-case text-[#2a3540]">(clean)</span></div>
        <div className="grid grid-cols-2 gap-2 text-[9.5px]">
          <div className="bg-[#0c1119] rounded p-1.5">
            <div className="text-[#5DCAA5] font-bold mb-1">LONG ({longStats?.trades ?? 0})</div>
            <div className="flex justify-between text-[9px]">
              <span className="text-[#4a565f]">WR</span>
              <WR val={longStats?.winRate} />
            </div>
            <div className="flex justify-between text-[9px]">
              <span className="text-[#4a565f]">P&amp;L</span>
              <span className={longStats?.pnlAmt != null && longStats.pnlAmt >= 0 ? 'text-[#5DCAA5]' : 'text-[#F0716E]'}>
                {longStats?.pnlAmt != null ? `${longStats.pnlAmt >= 0 ? '+' : ''}$${longStats.pnlAmt.toFixed(3)}` : '—'}
              </span>
            </div>
          </div>
          <div className="bg-[#0c1119] rounded p-1.5">
            <div className="text-[#F0716E] font-bold mb-1">SHORT ({shortStats?.trades ?? 0})</div>
            <div className="flex justify-between text-[9px]">
              <span className="text-[#4a565f]">WR</span>
              <WR val={shortStats?.winRate} />
            </div>
            <div className="flex justify-between text-[9px]">
              <span className="text-[#4a565f]">P&amp;L</span>
              <span className={shortStats?.pnlAmt != null && shortStats.pnlAmt >= 0 ? 'text-[#5DCAA5]' : 'text-[#F0716E]'}>
                {shortStats?.pnlAmt != null ? `${shortStats.pnlAmt >= 0 ? '+' : ''}$${shortStats.pnlAmt.toFixed(3)}` : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── R/R tier breakdown (clean) ── */}
      <div className="border-t border-[#1c2530] pt-2">
        <div className="text-[9px] text-[#4a565f] mb-1.5 uppercase tracking-[0.5px]">By R/R Tier <span className="normal-case text-[#2a3540]">(clean)</span></div>
        <table className="w-full text-[9.5px] border-collapse">
          <thead>
            <tr className="text-[#4a565f] text-[9px]">
              <th className="text-left py-0.5">TIER</th>
              <th className="text-right py-0.5">TRADES</th>
              <th className="text-right py-0.5">WINS</th>
              <th className="text-right py-0.5">WR</th>
            </tr>
          </thead>
          <tbody>
            {([['2.0×', tier20], ['2.5×', tier25], ['3.5×', tier35]] as const).map(([label, t]) => (
              <tr key={label} className="border-t border-[#12171f]">
                <td className="py-0.5 text-[#e8ecf0]">{label}</td>
                <td className="py-0.5 text-right text-[#55636f]">{t?.trades ?? 0}</td>
                <td className="py-0.5 text-right text-[#5DCAA5]">{t?.wins ?? 0}</td>
                <td className="py-0.5 text-right"><WR val={t?.winRate} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Test 1 vs Test 2 comparison ── */}
      <div className="border-t border-[#1c2530] pt-2">
        <div className="text-[9px] text-[#4a565f] mb-1.5 uppercase tracking-[0.5px]">Baseline Comparison</div>
        <div className="grid grid-cols-2 gap-2 text-[9.5px]">
          <div className="bg-[#0c1119] rounded p-1.5">
            <div className="text-[#55636f] text-[9px] mb-0.5">TEST 1 (baseline)</div>
            <div className="flex justify-between">
              <span className="text-[#4a565f]">TP/SL</span>
              <span className="text-[#e8ecf0]">{test1.tpHit ?? 0}/{test1.slHit ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#4a565f]">WR</span>
              <WR val={test1.winRate} />
            </div>
          </div>
          <div className="bg-[#0c1119] rounded p-1.5 border border-[rgba(93,202,165,0.15)]">
            <div className="text-[#5DCAA5] text-[9px] mb-0.5">TEST 2 (clean WR)</div>
            <div className="flex justify-between">
              <span className="text-[#4a565f]">W/L</span>
              <span className="text-[#e8ecf0]">{clean?.winCount ?? 0}/{clean?.lossCount ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#4a565f]">WR</span>
              <WR val={clean?.winRate} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0c1119] rounded p-1.5">
      <div className="text-[8.5px] text-[#4a565f] uppercase tracking-[0.4px] mb-0.5">{label}</div>
      <div className={`text-[13px] font-bold ${color}`}>{value}</div>
    </div>
  );
}

// ─── Recent Trades ────────────────────────────────────────────────────────────

export function RecentTrades({ trades }: { trades: LiveSignal[] }) {
  const wins = trades.filter(t => t.status === 'tp_hit' || (t.status === 'auto_closed' && ((t as any).finalPnlAmt ?? 0) > 0)).length;
  const losses = trades.filter(t => (t.status === 'sl_hit' && !(t as any).breakevenMoved) || (t.status === 'auto_closed' && ((t as any).finalPnlAmt ?? 0) <= 0)).length;
  return (
    <div className="matrix-card flex flex-col min-h-0 flex-1">
      <div className="border-b border-[#1c2530] px-3 py-2 text-[9.5px] font-medium text-[#55636f] tracking-[0.9px] uppercase shrink-0 flex items-center justify-between">
        <span>TRADE RESULTS [{trades.length}]</span>
        <span className="text-[9px] normal-case font-normal tracking-normal">
          <span className="text-[#5DCAA5]">{wins}W</span>
          <span className="text-[#4a565f] mx-1">/</span>
          <span className="text-[#F0716E]">{losses}L</span>
          <span className="text-[#4a565f] ml-1">↕ scroll</span>
        </span>
      </div>
      <div className="overflow-y-auto min-h-0 flex-1 p-1">
        <table className="w-full text-[10px] font-mono text-left whitespace-nowrap border-collapse">
          <thead className="bg-[#0c1119] sticky top-0 z-10">
            <tr>
              <th className="p-1.5 font-medium text-[#4a565f] border-b border-[#1c2530] text-[9px] uppercase tracking-[0.5px]">TIME</th>
              <th className="p-1.5 font-medium text-[#4a565f] border-b border-[#1c2530] text-[9px] uppercase tracking-[0.5px]">SYMBOL</th>
              <th className="p-1.5 font-medium text-[#4a565f] border-b border-[#1c2530] text-[9px] uppercase tracking-[0.5px]">DIR</th>
              <th className="p-1.5 font-medium text-[#4a565f] border-b border-[#1c2530] text-[9px] uppercase tracking-[0.5px]">OUTCOME</th>
              <th className="p-1.5 font-medium text-[#4a565f] border-b border-[#1c2530] text-[9px] uppercase tracking-[0.5px] text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr><td colSpan={5} className="text-center p-8 text-[#55636f]/30">NO RECENT TRADES</td></tr>
            ) : (
              trades.map(t => {
                const s = t as LiveSignal & {
                  finalPnlAmt?: number;
                  partialTpFired?: boolean;
                  breakevenMoved?: boolean;
                  autoCloseReason?: string;
                };
                const isWin = s.status === 'tp_hit' || (s.status === 'auto_closed' && (s.finalPnlAmt ?? 0) > 0);
                const isBE = s.status === 'sl_hit' && s.breakevenMoved;
                const isAC = s.status === 'auto_closed';
                const pnlColor = isWin ? 'text-[#5DCAA5]' : isBE ? 'text-[#F5B457]' : 'text-[#F0716E]';
                const outcomeLabel = isAC ? '🔄 AC' : isWin ? '✅ TP' : isBE ? '⚡ BE' : '❌ SL';
                const pnlDisplay = s.finalPnlAmt != null
                  ? `${s.finalPnlAmt >= 0 ? '+' : ''}$${s.finalPnlAmt.toFixed(3)}`
                  : (isWin ? '✅ TP' : '❌ SL');
                return (
                  <tr key={t.id} className="hover:bg-white/5 transition-colors">
                    <td className="p-1.5 text-[#55636f] border-b border-[#12171f]">{format(new Date(t.resolvedAt || t.createdAt), 'HH:mm')}</td>
                    <td className="p-1.5 font-bold text-[#e8ecf0] border-b border-[#12171f]">{t.symbol}</td>
                    <td className="p-1.5 border-b border-[#12171f]">
                      <span className={t.direction === 'LONG' ? 'text-[#5DCAA5]' : 'text-[#F0716E]'}>{t.direction}</span>
                    </td>
                    <td className="p-1.5 border-b border-[#12171f]">
                      <span className={pnlColor}>{outcomeLabel}</span>
                      {s.partialTpFired && <span className="ml-1 text-[8px] text-[#F5B457]">½TP</span>}
                    </td>
                    <td className={`p-1.5 text-right font-bold ${pnlColor} border-b border-[#12171f]`}>
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

// ─── Activity Log ─────────────────────────────────────────────────────────────

export function ActivityLog({ activity, devMode }: { activity: ActivityEntry[], devMode?: boolean }) {
  return (
    <div className="matrix-card flex flex-col min-h-0 flex-1">
      <div className="border-b border-[#1c2530] px-3 py-2 text-[9.5px] font-medium text-[#55636f] tracking-[0.9px] uppercase shrink-0 flex items-center justify-between">
        <span>ESCALATION LOG</span>
        {devMode && (
          <span className="text-[8px] tracking-[0.5px] text-[#F5B457]/70 normal-case font-normal">
            ● PREVIEW — live log on published URL
          </span>
        )}
      </div>
      {devMode && (
        <div className="border-b border-[#1c2530] px-3 py-1.5 bg-[#F5B457]/5 shrink-0">
          <p className="text-[9px] text-[#F5B457]/80 font-mono leading-relaxed">
            This is the editor preview. The bot scanner runs on the <strong>deployed server</strong> — open your published URL to see the live escalation log and real-time trades.
          </p>
        </div>
      )}
      <div className="overflow-y-auto p-2 flex flex-col min-h-0 flex-1 font-mono text-[10px]">
        {activity.length === 0 ? (
          <div className="text-[#55636f]/30 text-center py-4 flex items-center justify-center h-full">NO ACTIVITY</div>
        ) : (
          activity.map((a, i) => {
            let color = 'text-[#4a565f]';
            if (a.kind === 'tp') color = 'text-[#5DCAA5] font-bold';
            if (a.kind === 'sl') color = 'text-[#F0716E] font-bold';
            if (a.kind === 'signal') color = 'text-[#F5B457]';
            if (a.kind === 'watch') color = 'text-[#A29BF0]';
            if (a.kind === 'drop') color = 'text-[#55636f]';
            if (a.kind === 'scan') color = 'text-[#55636f]';
            if (a.kind === 'auto_close') color = 'text-[#85B7EB] font-bold';
            if (a.kind === 'partial_tp') color = 'text-[#F5B457] font-bold';

            return (
              <div key={`${a.ts}-${a.kind ?? ''}-${i}`} className="flex gap-2 py-0.5 transition-colors">
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
