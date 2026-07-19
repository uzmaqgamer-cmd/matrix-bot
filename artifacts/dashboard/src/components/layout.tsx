import { DashboardSnapshot } from '@workspace/api-client-react';
import { useEffect, useState } from 'react';
import { Activity, Clock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';

export function Header({ dashboard }: { dashboard: DashboardSnapshot }) {
  const [time, setTime] = useState(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatUptime = (seconds: number) => {
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center justify-between border-b border-border/50 bg-card/30 p-2 uppercase font-mono tracking-wider shrink-0 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Activity className="w-5 h-5 text-primary animate-pulse" />
        <span className="font-bold text-primary text-base drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]">MATRIX SIGNAL ENGINE</span>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span>{format(time, 'HH:mm:ss')} UTC</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">UPTIME:</span>
          <span className="text-foreground">{formatUptime(dashboard.uptimeSeconds)}</span>
        </div>

        <div className={`flex items-center gap-2 px-2 py-0.5 rounded text-xs font-bold ${dashboard.signalsEnabled ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-rose-500/10 text-rose-500 border border-rose-500/30'}`}>
          {dashboard.signalsEnabled ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
          <span>{dashboard.signalsEnabled ? 'SYSTEM ACTIVE' : 'SIGNALS DISABLED'}</span>
        </div>
      </div>
    </div>
  );
}

export function TopStats({ dashboard }: { dashboard: DashboardSnapshot }) {
  return (
    <div className="grid grid-cols-4 gap-2 shrink-0">
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
      />
      <StatCard 
        label="ESCALATION ACCURACY" 
        value={dashboard.escalationAccuracyPct !== null ? `${dashboard.escalationAccuracyPct.toFixed(1)}%` : '---'}
        color={dashboard.escalationAccuracyPct && dashboard.escalationAccuracyPct >= 50 ? 'emerald' : dashboard.escalationAccuracyPct !== null ? 'rose' : undefined}
      />
      <StatCard 
        label="TOTAL LIFETIME TP/SL" 
        value={`${dashboard.totalTpHit} / ${dashboard.totalSlHit}`}
        sub={`Ignored: ${dashboard.totalIgnored}`}
      />
    </div>
  );
}

function StatCard({ label, value, sub, delta, deltaFormat, color }: any) {
  let valColor = "text-foreground";
  if (color === 'emerald') valColor = "text-emerald-500 drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]";
  if (color === 'rose') valColor = "text-rose-500 drop-shadow-[0_0_5px_rgba(244,63,94,0.3)]";

  return (
    <div className="border border-border bg-card/40 p-3 flex flex-col justify-between font-mono backdrop-blur-sm hover:bg-card/60 transition-colors">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="flex items-end justify-between mt-1">
        <div className={`text-xl font-bold ${valColor}`}>{value}</div>
        {delta !== undefined && (
          <div className={`text-xs ${delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {delta > 0 ? '+' : ''}{deltaFormat === 'money' ? '$' : ''}{delta.toFixed(2)}
          </div>
        )}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1 opacity-70">{sub}</div>}
    </div>
  );
}