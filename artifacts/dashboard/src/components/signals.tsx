import { LiveSignal } from '@workspace/api-client-react';
import React from 'react';

export function ActiveSignals({ signals }: { signals: LiveSignal[] }) {
  return (
    <div className="matrix-card flex flex-col min-h-0 flex-1">
      <div className="border-b border-[#1c2530] px-3 py-2 text-[9.5px] font-medium text-[#55636f] flex justify-between tracking-[0.9px] uppercase shrink-0">
        <span>ACTIVE TARGETS [{signals.length}]</span>
        {signals.length > 0 && <span className="text-[#5DCAA5] animate-[flicker_3s_ease_infinite]">● TRACKING LIVE</span>}
      </div>
      <div className="overflow-y-auto p-2 flex flex-col gap-2 min-h-0 flex-1">
        {signals.length === 0 ? (
          <div className="text-[#55636f]/50 text-center py-8 font-mono text-xs flex items-center justify-center h-full">NO ACTIVE TARGETS ON RADAR</div>
        ) : (
          signals.map(s => <SignalCard key={s.id} signal={s} />)
        )}
      </div>
    </div>
  );
}

function SignalCard({ signal }: { signal: LiveSignal }) {
  const isLong = signal.direction === 'LONG';
  const dirColor = isLong ? 'text-[#5DCAA5]' : 'text-[#F0716E]';
  const dirBg = isLong ? 'bg-[rgba(93,202,165,0.1)] border-[rgba(93,202,165,0.2)]' : 'bg-[rgba(240,113,110,0.1)] border-[rgba(240,113,110,0.2)]';
  
  const pnl = signal.pnlPct || 0;
  const pnlColor = pnl > 0 ? 'text-[#5DCAA5] glow-green' : pnl < 0 ? 'text-[#F0716E] glow-red' : 'text-[#55636f]';
  
  const prog = signal.tpProgressPct || 0;
  const isNearTp = prog > 85;
  const normalizedProg = Math.max(-100, Math.min(100, prog));
  
  return (
    <div className={`border p-2 font-mono text-[10px] relative overflow-hidden ${dirBg} ${isNearTp ? 'border-[rgba(245,180,87,0.5)] shadow-[0_0_15px_rgba(245,180,87,0.15)]' : ''} transition-all duration-300 rounded`}>
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2">
          <span className={`font-bold text-[13px] ${dirColor}`}>{signal.symbol}</span>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${isLong ? 'bg-[rgba(93,202,165,0.2)] text-[#5DCAA5]' : 'bg-[rgba(240,113,110,0.2)] text-[#F0716E]'}`}>{signal.direction}</span>
          <span className="px-1.5 py-0.5 rounded bg-[#12171f] text-[#55636f] text-[9px] border border-[#1c2530]">{signal.tpTier}</span>
        </div>
        <div className={`font-bold text-[13px] ${pnlColor}`}>
          {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}%
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-4 text-[10px] text-[#55636f] mt-2">
        <div>ENTRY: <span className="text-[#e8ecf0]">{signal.entry}</span></div>
        <div className="text-center">CURR: <span className="text-[#e8ecf0]">{signal.currentPrice || '---'}</span></div>
        <div className="text-right">TP: <span className="text-[#5DCAA5]">{signal.tp}</span> | SL: <span className="text-[#F0716E]">{signal.sl}</span></div>
      </div>

      <div className="mt-2 h-1 w-full bg-[#12171f] rounded-full overflow-hidden relative">
        <div className="absolute inset-y-0 left-1/2 w-px bg-[#55636f]/30 z-10"></div>
        {normalizedProg >= 0 ? (
          <div 
            className="absolute inset-y-0 left-1/2 bg-[#5DCAA5] transition-all duration-500 shadow-[0_0_5px_#5DCAA5]" 
            style={{ width: `${normalizedProg / 2}%` }} 
          />
        ) : (
          <div 
            className="absolute inset-y-0 right-1/2 bg-[#F0716E] transition-all duration-500 shadow-[0_0_5px_#F0716E]" 
            style={{ width: `${-normalizedProg / 2}%` }} 
          />
        )}
      </div>
      <div className="flex justify-between text-[9px] text-[#55636f] mt-1">
        <span>SL PROGRESS</span>
        <span className={isNearTp ? 'text-[#F5B457] font-bold glow-amber' : ''}>{prog.toFixed(1)}% TO TP</span>
      </div>
    </div>
  );
}

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
