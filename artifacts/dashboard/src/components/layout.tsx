import { DashboardSnapshot } from '@workspace/api-client-react';
import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';

export function Header({ dashboard }: { dashboard: DashboardSnapshot }) {
  const [time, setTime] = useState(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center justify-between shrink-0 z-10 px-2 py-1">
      <div className="flex items-center gap-4">
        {/* Logo Mark */}
        <div className="relative flex items-center justify-center w-11 h-11 rounded-2xl bg-white/5 border border-white/10 shadow-[0_0_25px_rgba(0,229,255,0.15)] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#00e5ff]/20 to-transparent" />
          <span className="relative text-[#00e5ff] font-bold text-xl tracking-tighter">M</span>
        </div>
        
        <div>
          <div className="text-[17px] font-bold text-white tracking-wide">MATRIX ENGINE</div>
          <div className="text-[10px] text-slate-400 font-mono tracking-[0.2em] mt-0.5">AUTONOMOUS SIGNAL LATTICE</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Signal mode badge */}
        {(dashboard as any).signalMode === 'UNLIMITED' ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold border bg-[#00e5ff]/10 text-[#00e5ff] border-[#00e5ff]/20 shadow-[0_0_10px_rgba(0,229,255,0.1)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00e5ff] animate-pulse shadow-[0_0_6px_#00e5ff]" />
            UNLIMITED
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold border bg-[#ffaa00]/10 text-[#ffaa00] border-[#ffaa00]/20 shadow-[0_0_10px_rgba(255,170,0,0.1)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ffaa00] animate-pulse shadow-[0_0_6px_#ffaa00]" />
            LIMITED · 5 MAX
          </div>
        )}
        
        {/* Signals enabled/disabled badge */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold border ${dashboard.signalsEnabled ? 'bg-[#00e5ff]/10 text-[#00e5ff] border-[#00e5ff]/20' : 'bg-[#ff2a5f]/10 text-[#ff2a5f] border-[#ff2a5f]/20'}`}>
          <span>{dashboard.signalsEnabled ? 'SIGNALS ACTIVE' : 'SIGNALS OFFLINE'}</span>
        </div>
        
        <div className="glass-panel px-4 py-1.5 rounded-lg flex items-center justify-center min-w-[100px] border border-white/10">
           <span className="font-mono text-sm text-slate-200 tracking-widest font-semibold">
             {format(time, 'HH:mm:ss')}
           </span>
        </div>
      </div>
    </div>
  );
}

export function TopStats({ dashboard }: { dashboard: DashboardSnapshot }) {
  const formatUptime = (seconds: number) => {
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0 z-10">
      <StatCard
        label={dashboard.realBalance != null ? 'EXCHANGE BALANCE' : 'PAPER BALANCE'}
        value={`$${(dashboard.realBalance ?? dashboard.paperBalance).toFixed(2)}`}
        delta={dashboard.realBalance != null ? dashboard.realBalanceDelta : dashboard.paperBalanceDelta}
        deltaFormat="money"
        sub={dashboard.realBalance != null
          ? `Live Binance USDT · synced ${dashboard.realBalanceAt ? Math.round((Date.now() - dashboard.realBalanceAt) / 1000) + 's ago' : '…'}`
          : 'Paper simulation'}
      />
      <StatCard 
        label="TODAY: TP / SL" 
        value={`${dashboard.today.tpHit} / ${dashboard.today.slHit}`}
        sub={`½TP fired: ${(dashboard.today as any).partialTpHit ?? 0} · Sent: ${dashboard.today.sent}`}
        isHits={true}
      />
      <StatCard 
        label="WIN RATE (all-time)" 
        value={dashboard.escalationAccuracyPct !== null ? `${dashboard.escalationAccuracyPct.toFixed(1)}%` : '---'}
        sub={`${dashboard.totalTpHit} TP / ${dashboard.totalSlHit} SL · ${dashboard.totalTpHit + dashboard.totalSlHit} closed`}
        color={dashboard.escalationAccuracyPct && dashboard.escalationAccuracyPct >= 50 ? 'emerald' : dashboard.escalationAccuracyPct !== null ? 'rose' : undefined}
      />
      <StatCard 
        label="SYSTEM UPTIME" 
        value={formatUptime(dashboard.uptimeSeconds)}
        sub={`Lifetime TP/SL: ${dashboard.totalTpHit} / ${dashboard.totalSlHit}`}
        color="muted"
      />
    </div>
  );
}

function StatCard({ label, value, sub, delta, deltaFormat, color, isHits }: any) {
  let valNode: React.ReactNode = <span className="text-white">{value}</span>;

  if (label === 'PAPER BALANCE') {
    valNode = <span className="glow-text-cyan">{value}</span>;
  } else if (label === 'ESCALATION ACCURACY') {
    if (color === 'emerald') {
      valNode = <span className="glow-text-cyan">{value}</span>;
    } else if (color === 'rose') {
      valNode = <span className="glow-text-rose">{value}</span>;
    } else {
      valNode = <span className="text-white">{value}</span>;
    }
  } else if (isHits) {
    const parts = value.split(' / ');
    if (parts.length === 2) {
      valNode = (
        <>
          <span className="glow-text-cyan">{parts[0]}</span>
          <span className="text-slate-600 mx-2">/</span>
          <span className="glow-text-rose">{parts[1]}</span>
        </>
      );
    }
  } else if (color === 'muted') {
    valNode = <span className="text-slate-200">{value}</span>;
  }

  return (
    <div className="glass-panel p-4 flex flex-col justify-between hover:bg-white/[0.03] transition-colors relative overflow-hidden group">
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/[0.02] rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-white/[0.04] transition-colors pointer-events-none" />
      <div className="text-[10px] text-slate-400 tracking-widest uppercase font-semibold font-sans mb-3">{label}</div>
      <div className="flex items-end justify-between mt-1 relative z-10">
        <div className="text-2xl font-bold font-mono tracking-tight">{valNode}</div>
        {delta !== undefined && (
          <div className={`text-[11px] font-mono font-bold bg-black/30 px-2 py-1 rounded border border-white/5 ${delta >= 0 ? 'text-[#00e5ff]' : 'text-[#ff2a5f]'}`}>
            {delta > 0 ? '+' : ''}{deltaFormat === 'money' ? '$' : ''}{delta.toFixed(2)}
          </div>
        )}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-3 font-sans relative z-10">{sub}</div>}
    </div>
  );
}
