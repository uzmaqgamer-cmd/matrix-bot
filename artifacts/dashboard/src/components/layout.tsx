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
    <div className="flex items-center justify-between shrink-0 z-10 font-sans px-1">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-[radial-gradient(circle_at_30%_30%,#1D9E75,#04342C)] flex items-center justify-center text-[#5DCAA5] font-bold text-[13px] shadow-[0_0_16px_rgba(29,158,117,0.5)]">M</div>
        <div>
          <div className="text-[13px] font-semibold text-[#e8ecf0]">MATRIX SIGNAL ENGINE</div>
          <div className="text-[10px] text-[#55636f]">OI · PRICE · FUNDING NEURAL LATTICE</div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-[10px] tracking-[0.4px] font-medium border ${dashboard.signalsEnabled ? 'bg-[rgba(93,202,165,0.1)] text-[#5DCAA5] border-[rgba(93,202,165,0.3)]' : 'bg-[rgba(240,113,110,0.1)] text-[#F0716E] border-[rgba(240,113,110,0.3)]'} `}>
          <span>{dashboard.signalsEnabled ? 'SIGNAL-ONLY' : 'SIGNALS DISABLED'}</span>
        </div>
        <span className="font-mono text-[9.5px] text-[#55636f] tracking-[0.9px] uppercase font-medium">
          {format(time, 'HH:mm:ss')}
        </span>
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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 shrink-0">
      <StatCard 
        label="PAPER BALANCE" 
        value={`$${dashboard.paperBalance.toFixed(2)}`} 
        delta={dashboard.paperBalanceDelta}
        deltaFormat="money"
      />
      <StatCard 
        label="TODAY: TP / SL" 
        value={`${dashboard.today.tpHit} / ${dashboard.today.slHit}`}
        sub={`Sent: ${dashboard.today.sent} | Acc: ${dashboard.today.accepted}`}
        isHits={true}
      />
      <StatCard 
        label="ESCALATION ACCURACY" 
        value={dashboard.escalationAccuracyPct !== null ? `${dashboard.escalationAccuracyPct.toFixed(1)}%` : '---'}
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
  let valNode: React.ReactNode = <span className="text-[#e8ecf0]">{value}</span>;

  if (label === 'PAPER BALANCE') {
    valNode = <span className="text-[#5DCAA5] glow-green">{value}</span>;
  } else if (label === 'ESCALATION ACCURACY') {
    if (color === 'emerald') {
      valNode = <span className="text-[#5DCAA5] glow-green">{value}</span>;
    } else if (color === 'rose') {
      valNode = <span className="text-[#F0716E] glow-red">{value}</span>;
    } else {
      valNode = <span className="text-[#e8ecf0]">{value}</span>;
    }
  } else if (isHits) {
    const parts = value.split(' / ');
    if (parts.length === 2) {
      valNode = (
        <>
          <span className="text-[#5DCAA5] glow-green">{parts[0]}</span>
          <span className="text-[#55636f]"> / </span>
          <span className="text-[#F0716E] glow-red">{parts[1]}</span>
        </>
      );
    }
  } else if (color === 'muted') {
    valNode = <span className="text-[#e8ecf0]">{value}</span>;
  }

  return (
    <div className="matrix-card p-3 flex flex-col justify-between font-mono">
      <div className="text-[9.5px] text-[#55636f] tracking-[0.9px] uppercase font-medium">{label}</div>
      <div className="flex items-end justify-between mt-1">
        <div className={`text-[22px] font-bold`}>{valNode}</div>
        {delta !== undefined && (
          <div className={`text-[10.5px] ${delta >= 0 ? 'text-[#5DCAA5]' : 'text-[#F0716E]'}`}>
            {delta > 0 ? '+' : ''}{deltaFormat === 'money' ? '$' : ''}{delta.toFixed(2)}
          </div>
        )}
      </div>
      {sub && <div className="text-[10.5px] text-[#55636f] mt-1">{sub}</div>}
    </div>
  );
}
