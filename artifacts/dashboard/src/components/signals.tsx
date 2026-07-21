import { LiveSignal } from '@workspace/api-client-react';
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// ─── Active Targets panel (full-width, scrollable, sortable) ─────────────────

interface ActiveSignalFull extends LiveSignal {
  breakevenMoved?: boolean;
  partialTpFired?: boolean;
}

function sortByActionable(signals: ActiveSignalFull[]): ActiveSignalFull[] {
  return [...signals].sort((a, b) => {
    const pa = a.tpProgressPct ?? -999;
    const pb = b.tpProgressPct ?? -999;
    return pb - pa; // highest progress first (closest to TP)
  });
}

export function ActiveTargetsPanel({ signals }: { signals: LiveSignal[] }) {
  const [expanded, setExpanded] = useState(true);
  const sorted = sortByActionable(signals as ActiveSignalFull[]);
  const isLive = signals.length > 0;

  return (
    <div className="matrix-card shrink-0 z-10">
      {/* Header */}
      <button
        className="w-full border-b border-[#1c2530] px-3 py-2 flex items-center justify-between text-[9.5px] font-medium text-[#55636f] tracking-[0.9px] uppercase hover:text-[#8a9aaa] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <span>ACTIVE TARGETS [{signals.length}]</span>
          {isLive && (
            <span className="text-[#5DCAA5] animate-[flicker_3s_ease_infinite] text-[9px]">● LIVE</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="text-[10px] text-[#4a565f]">
              sorted by closest to TP
            </span>
          )}
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </button>

      {expanded && (
        <div className="overflow-hidden">
          {signals.length === 0 ? (
            <div className="text-[#55636f]/40 text-center py-3 font-mono text-[10px]">
              NO ACTIVE TARGETS ON RADAR
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div className="grid font-mono text-[9px] text-[#4a565f] tracking-[0.5px] uppercase px-2 py-1 border-b border-[#12171f]"
                style={{ gridTemplateColumns: '140px 100px 72px 1fr 88px' }}>
                <span>SYMBOL / DIR</span>
                <span>TIER</span>
                <span className="text-right">P&L</span>
                <span className="text-center px-4">PROGRESS TO TP</span>
                <span className="text-right">STATUS</span>
              </div>

              {/* Scrollable rows — max ~6 rows visible before scrolling */}
              <div className="overflow-y-auto" style={{ maxHeight: '216px' }}>
                {sorted.map(s => (
                  <ActiveTargetRow key={s.id} signal={s as ActiveSignalFull} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ActiveTargetRow({ signal: s }: { signal: ActiveSignalFull }) {
  const isLong = s.direction === 'LONG';
  const pnl = s.pnlPct ?? 0;
  const prog = s.tpProgressPct ?? 0;
  const normalizedProg = Math.max(0, Math.min(100, prog)); // 0-100 for display
  const isNearTp = prog > 75;
  const isBelow = prog < 0;
  const isBE = s.breakevenMoved;
  const isPartial = s.partialTpFired;

  const dirColor = isLong ? 'text-[#5DCAA5]' : 'text-[#F0716E]';
  const dirBg = isLong
    ? 'bg-[rgba(93,202,165,0.15)] text-[#5DCAA5]'
    : 'bg-[rgba(240,113,110,0.15)] text-[#F0716E]';
  const pnlColor = pnl > 0 ? 'text-[#5DCAA5]' : pnl < 0 ? 'text-[#F0716E]' : 'text-[#55636f]';
  const barColor = isNearTp ? 'bg-[#F5B457] shadow-[0_0_4px_#F5B457]'
    : isBelow ? 'bg-[#F0716E] shadow-[0_0_4px_#F0716E]'
    : 'bg-[#5DCAA5] shadow-[0_0_4px_#5DCAA5]';

  const tierShort = s.tpTier === 'HIGH_DIVERGENCE' ? '3.5× HIGH'
    : s.tpTier === 'MEDIUM_DIVERGENCE' ? '2.5× MED'
    : '2.0× CLEAN';
  const tierColor = s.tpTier === 'HIGH_DIVERGENCE' ? 'text-[#F0716E]'
    : s.tpTier === 'MEDIUM_DIVERGENCE' ? 'text-[#F5B457]'
    : 'text-[#5DCAA5]';

  return (
    <div
      className={`grid items-center h-[36px] border-b border-[#0d1219] px-2 font-mono text-[10px] shrink-0 hover:bg-white/[0.025] transition-colors ${isNearTp ? 'bg-[rgba(245,180,87,0.04)]' : ''}`}
      style={{ gridTemplateColumns: '140px 100px 72px 1fr 88px' }}
    >
      {/* Symbol + direction */}
      <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
        <span className={`font-bold text-[11px] truncate ${dirColor}`}>{s.symbol}</span>
        <span className={`shrink-0 text-[8px] px-1 rounded ${dirBg} font-bold`}>{s.direction}</span>
      </div>

      {/* Tier */}
      <span className={`text-[9px] ${tierColor} truncate`}>{tierShort}</span>

      {/* P&L */}
      <span className={`font-bold text-[11px] text-right ${pnlColor}`}>
        {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}%
      </span>

      {/* Progress bar */}
      <div className="flex items-center gap-2 px-4">
        <div className="flex-1 h-[3px] bg-[#12171f] rounded-full overflow-hidden relative">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${isBelow ? 0 : normalizedProg}%` }}
          />
        </div>
        <span className={`text-[9px] w-10 text-right shrink-0 tabular-nums ${isNearTp ? 'text-[#F5B457] font-bold' : 'text-[#55636f]'}`}>
          {prog.toFixed(0)}%
        </span>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1 justify-end">
        {isPartial && (
          <span className="text-[8px] px-1 py-0.5 bg-[rgba(245,180,87,0.15)] text-[#F5B457] rounded font-bold">½TP</span>
        )}
        {isBE && (
          <span className="text-[8px] px-1 py-0.5 bg-[rgba(93,202,165,0.1)] text-[#5DCAA5] rounded font-bold">BE</span>
        )}
        {!isPartial && !isBE && (
          <span className="text-[9px] text-[#4a565f]">{s.tpProgressPct != null ? '—' : 'N/A'}</span>
        )}
      </div>
    </div>
  );
}

// ─── Pending signals ──────────────────────────────────────────────────────────

export function PendingSignals({ signals }: { signals: LiveSignal[] }) {
  return (
    <div className="matrix-card flex flex-col min-h-0">
      <div className="border-b border-[#1c2530] px-3 py-2 text-[9.5px] font-medium text-[#55636f] tracking-[0.9px] uppercase shrink-0">
        <span>PENDING VERIFICATION [{signals.length}]</span>
      </div>
      <div className="overflow-y-auto p-2 flex flex-col gap-1.5 min-h-0 flex-1">
        {signals.length === 0 ? (
          <div className="text-[#55636f]/50 text-center py-4 font-mono text-xs flex items-center justify-center h-full">NO PENDING SIGNALS</div>
        ) : (
          signals.map(s => (
            <div key={s.id} className="border border-[rgba(245,180,87,0.2)] bg-[rgba(245,180,87,0.05)] p-2 font-mono text-[10px] flex justify-between items-center opacity-80 hover:opacity-100 transition-opacity rounded">
              <div className="flex gap-2 items-center">
                <span className="font-bold text-[#F5B457] glow-amber">{s.symbol}</span>
                <span className="text-[9px] text-[#55636f] px-1 bg-[#12171f] rounded border border-[#1c2530]">{s.direction}</span>
              </div>
              <div className="text-[9.5px] text-[#55636f] text-right">
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
