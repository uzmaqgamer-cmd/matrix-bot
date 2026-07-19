import { useGetDashboard, getGetDashboardQueryKey } from '@workspace/api-client-react';
import React from 'react';
import { Header, TopStats } from '@/components/layout';
import { ActiveSignals, PendingSignals } from '@/components/signals';
import { ScanStatus, ScanFeed, Watchlist } from '@/components/market';
import { MatrixHeatmap, PriorityResolution, BalanceChart, RecentTrades, ActivityLog } from '@/components/analysis';
import { Loader2 } from 'lucide-react';
import { ParticleBackground } from '@/components/ParticleBackground';
import { NetworkCanvas } from '@/components/NetworkCanvas';

export default function Dashboard() {
  const { data: dashboard, isLoading, isError } = useGetDashboard({
    query: { 
      refetchInterval: 5000,
      queryKey: getGetDashboardQueryKey()
    }
  });

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center font-mono text-[#5DCAA5] flex-col gap-4 bg-[#030509]">
        <ParticleBackground />
        <Loader2 className="w-8 h-8 animate-spin z-10" />
        <div className="tracking-widest z-10">INITIALIZING MATRIX ENGINE...</div>
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center font-mono text-[#F0716E] flex-col gap-4 bg-[#030509]">
        <ParticleBackground />
        <div className="text-xl tracking-widest font-bold z-10">CONNECTION LOST</div>
        <div className="text-sm opacity-50 z-10">Awaiting telemetry...</div>
      </div>
    );
  }

  const watchlistSymbols = dashboard.watchlist.slice(0, 6).map((w: any) => w.symbol.substring(0, 6));

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden p-2 gap-2 text-xs xl:text-sm relative z-10">
      <ParticleBackground />
      <Header dashboard={dashboard} />
      
      {/* Network Canvas Row */}
      <div className="grid grid-cols-3 gap-2 flex-none z-10">
        <NetworkCanvas label="price network" accentUp="#5DCAA5" accentDown="#F0716E" unit="%" nodeNames={watchlistSymbols} />
        <NetworkCanvas label="open interest network" accentUp="#85B7EB" accentDown="#F5B457" unit="%" nodeNames={watchlistSymbols} />
        <NetworkCanvas label="funding rate network" accentUp="#A29BF0" accentDown="#D4537E" unit="bp" nodeNames={watchlistSymbols} />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-12 gap-2 z-10">
        {/* LEFT COLUMN: 3 cols */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-2 min-h-0">
          <ScanStatus scan={dashboard.scan} />
          <ScanFeed feed={dashboard.scanFeed} />
          <MatrixHeatmap rowFrequency={dashboard.rowFrequency} />
          <ActivityLog activity={dashboard.activity} />
        </div>

        {/* MIDDLE COLUMN: 6 cols */}
        <div className="col-span-12 lg:col-span-6 flex flex-col gap-2 min-h-0">
          <TopStats dashboard={dashboard} />
          <ActiveSignals signals={dashboard.activeSignals} />
          <div className="flex-1 min-h-0 grid grid-rows-2 gap-2">
            <PendingSignals signals={dashboard.pendingSignals} />
            <RecentTrades trades={dashboard.recentTrades} />
          </div>
        </div>

        {/* RIGHT COLUMN: 3 cols */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-2 min-h-0">
          <BalanceChart history={dashboard.balanceHistory} paperBalance={dashboard.paperBalance} paperBalanceDelta={dashboard.paperBalanceDelta} />
          <PriorityResolution resolution={dashboard.priorityResolution} />
          <Watchlist watchlist={dashboard.watchlist} />
        </div>
      </div>
    </div>
  );
}
