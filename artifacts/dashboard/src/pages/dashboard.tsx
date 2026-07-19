import { useGetDashboard, getGetDashboardQueryKey } from '@workspace/api-client-react';
import { Header, TopStats } from '@/components/layout';
import { ActiveSignals, PendingSignals } from '@/components/signals';
import { ScanStatus, ScanFeed, Watchlist } from '@/components/market';
import { MatrixHeatmap, PriorityResolution, BalanceChart, RecentTrades, ActivityLog } from '@/components/analysis';
import { Loader2 } from 'lucide-react';

export default function Dashboard() {
  const { data: dashboard, isLoading, isError } = useGetDashboard({
    query: { 
      refetchInterval: 5000,
      queryKey: getGetDashboardQueryKey()
    }
  });

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center font-mono text-primary flex-col gap-4 bg-background">
        <Loader2 className="w-8 h-8 animate-spin" />
        <div className="tracking-widest">INITIALIZING MATRIX ENGINE...</div>
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center font-mono text-destructive flex-col gap-4 bg-background">
        <div className="text-xl tracking-widest font-bold">CONNECTION LOST</div>
        <div className="text-sm opacity-50">Awaiting telemetry...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden p-2 gap-2 text-xs xl:text-sm relative z-10">
      <Header dashboard={dashboard} />
      
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-2">
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