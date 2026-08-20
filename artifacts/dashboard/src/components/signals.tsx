import { LiveSignal } from '@workspace/api-client-react';
import React, { useState } from 'react';
import { NeuralNerveCanvas } from './NeuralNerveCanvas';

interface ActiveSignalFull extends LiveSignal {
  breakevenMoved?: boolean;
  partialTpFired?: boolean;
}

function sortByActionable(signals: ActiveSignalFull[]): ActiveSignalFull[] {
  return [...signals].sort((a, b) => {
    const pa = a.tpProgressPct ?? -999;
    const pb = b.tpProgressPct ?? -999;
    return pb - pa;
  });
}

export function ActiveTargetsPanel({ signals }: { signals: LiveSignal[] }) {
  const sorted = sortByActionable(signals as ActiveSignalFull[]);
  const isLive = signals.length > 0;

  return (
    <div className="glass-panel shrink-0 z-10">
      <div className="glass-header px-4 py-3 flex items-center justify-between text-[10px] font-semibold text-slate-400 tracking-widest uppercase">
        <div className="flex items-center gap-3">
          <span>ACTIVE TARGETS [{signals.length}]</span>
          {isLive && (
            <span className="text-[#00e5ff] animate-pulse flex items-center gap-1.5 bg-[#00e5ff]/10 px-2.5 py-0.5 rounded-full border border-[#00e5ff]/20">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00e5ff]" />
              LIVE
            </span>
          )}
        </div>
      </div>

      <div>
        {signals.length === 0 ? (
          <div className="text-slate-500 text-center py-8 font-mono text-[11px] bg-black/10">
            NO ACTIVE TARGETS ON RADAR
          </div>
        ) : (
          <>
            <div className="grid font-mono text-[10px] text-slate-400 tracking-widest uppercase px-4 py-2.5 border-b border-white/5 bg-black/20"
              style={{ gridTemplateColumns: '160px 100px 80px 1fr 100px' }}>
              <span>SYMBOL / DIR</span>
              <span>TIER</span>
              <span className="text-right">P&L</span>
              <span className="text-center px-6">PROGRESS TO TP</span>
              <span className="text-right">STATUS</span>
            </div>
            <div className="overflow-y-auto bg-black/10" style={{ maxHeight: '240px' }}>
              {sorted.map(s => (
                <ActiveTargetRow key={s.id} signal={s as ActiveSignalFull} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ActiveTargetRow({ signal: s }: { signal: ActiveSignalFull }) {
  const isLong = s.direction === 'LONG';
  const pnl = s.pnlPct ?? 0;
  const prog = s.tpProgressPct ?? 0;
  const normalizedProg = Math.max(0, Math.min(100, prog));
  const isNearTp = prog > 75;
  const isBelow = prog < 0;
  const isBE = s.breakevenMoved;
  const isPartial = s.partialTpFired;

  const dirColor = isLong ? 'text-[#00e5ff]' : 'text-[#ff2a5f]';
  const dirBg = isLong
    ? 'bg-[#00e5ff]/15 text-[#00e5ff] border border-[#00e5ff]/30 shadow-[0_0_10px_rgba(0,229,255,0.1)]'
    : 'bg-[#ff2a5f]/15 text-[#ff2a5f] border border-[#ff2a5f]/30 shadow-[0_0_10px_rgba(255,42,95,0.1)]';
  const pnlColor = pnl > 0 ? 'text-[#00e5ff]' : pnl < 0 ? 'text-[#ff2a5f]' : 'text-slate-400';
  const barColor = isNearTp ? 'bg-[#ffaa00] shadow-[0_0_12px_rgba(255,170,0,0.6)]'
    : isBelow ? 'bg-[#ff2a5f] shadow-[0_0_12px_rgba(255,42,95,0.6)]'
    : 'bg-[#00e5ff] shadow-[0_0_12px_rgba(0,229,255,0.6)]';

  const tierShort = s.tpTier === 'HIGH_DIVERGENCE' ? '3.5× HIGH'
    : s.tpTier === 'MEDIUM_DIVERGENCE' ? '2.5× MED'
    : '2.0× CLEAN';
  const tierColor = s.tpTier === 'HIGH_DIVERGENCE' ? 'text-[#ff2a5f]'
    : s.tpTier === 'MEDIUM_DIVERGENCE' ? 'text-[#ffaa00]'
    : 'text-[#00e5ff]';

  return (
    <div
      className={`grid items-center h-[48px] border-b border-white/5 px-4 font-mono text-[11px] shrink-0 hover:bg-white/[0.04] transition-colors ${isNearTp ? 'bg-[#ffaa00]/[0.03]' : ''}`}
      style={{ gridTemplateColumns: '160px 100px 80px 1fr 100px' }}
    >
      <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
        <span className={`font-bold text-sm truncate ${dirColor}`}>{s.symbol}</span>
        <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold ${dirBg}`}>{s.direction}</span>
      </div>

      <span className={`text-[10px] ${tierColor} truncate font-bold`}>{tierShort}</span>

      <span className={`font-bold text-[13px] text-right tracking-tight ${pnlColor}`}>
        {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}%
      </span>

      <div className="flex items-center gap-4 px-6">
        <div className="flex-1 h-[4px] bg-black/50 rounded-full overflow-hidden relative border border-white/10 shadow-inner">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${isBelow ? 0 : normalizedProg}%` }}
          />
        </div>
        <span className={`text-[11px] w-10 text-right shrink-0 tabular-nums ${isNearTp ? 'text-[#ffaa00] font-bold' : 'text-slate-400'}`}>
          {prog.toFixed(0)}%
        </span>
      </div>

      <div className="flex items-center gap-1.5 justify-end">
        {isPartial && (
          <span className="text-[9px] px-1.5 py-0.5 bg-[#ffaa00]/15 text-[#ffaa00] border border-[#ffaa00]/30 rounded font-bold shadow-[0_0_8px_rgba(255,170,0,0.15)]">½TP</span>
        )}
        {isBE && (
          <span className="text-[9px] px-1.5 py-0.5 bg-[#00e5ff]/15 text-[#00e5ff] border border-[#00e5ff]/30 rounded font-bold shadow-[0_0_8px_rgba(0,229,255,0.15)]">BE</span>
        )}
        {!isPartial && !isBE && (
          <span className="text-[9px] px-1.5 py-0.5 bg-white/5 text-slate-400 border border-white/10 rounded font-bold tracking-widest">OPEN</span>
        )}
      </div>
    </div>
  );
}

export function PendingSignals({ signals }: { signals: LiveSignal[] }) {
  return (
    <div className="glass-panel flex flex-col min-h-0 flex-1 shadow-lg">
      <div className="glass-header px-4 py-3 text-[10px] font-semibold text-slate-400 tracking-widest uppercase shrink-0 bg-black/40">
        PENDING VERIFICATION [{signals.length}]
      </div>
      <div className="overflow-y-auto p-3 flex flex-col gap-2 min-h-0 flex-1 relative bg-black/20">
        {signals.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center opacity-70 mix-blend-screen">
            <NeuralNerveCanvas />
            <div className="absolute font-mono text-[10px] text-slate-500 tracking-widest bg-black/50 px-3 py-1 rounded backdrop-blur border border-white/5">NO PENDING SIGNALS</div>
          </div>
        ) : (
          signals.map(s => (
            <div key={s.id} className="border border-[#ffaa00]/30 bg-[#ffaa00]/10 p-3 font-mono text-[11px] flex justify-between items-center rounded-lg hover:bg-[#ffaa00]/15 transition-colors shadow-[0_0_15px_rgba(255,170,0,0.05)] relative z-10">
              <div className="flex gap-3 items-center">
                <span className="font-bold text-[#ffaa00] text-[13px]">{s.symbol}</span>
                <span className="text-[9px] font-bold text-[#ffaa00]/80 px-1.5 py-0.5 bg-black/40 rounded border border-[#ffaa00]/20">{s.direction}</span>
              </div>
              <div className="text-[10px] text-right">
                <div className="text-slate-300">ROW {s.matrixRow} - {s.originPriority}</div>
                <div className="text-slate-500 mt-1">RR: {s.rr.toFixed(2)} | ATR: {s.atr.toFixed(4)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
