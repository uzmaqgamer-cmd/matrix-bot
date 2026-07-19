import { useGetDashboard, getGetDashboardQueryKey, WatchlistItem } from '@workspace/api-client-react';
import { Header, TopStats } from '@/components/layout';
import { ActiveSignals, PendingSignals } from '@/components/signals';
import { ScanStatus, ScanFeed, Watchlist } from '@/components/market';
import { MatrixHeatmap, PriorityResolution, BalanceChart, RecentTrades, ActivityLog } from '@/components/analysis';
import { Loader2 } from 'lucide-react';
import { ParticleBackground } from '@/components/ParticleBackground';
import { NetworkCanvas, NetworkNode } from '@/components/NetworkCanvas';

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
        <div className="tracking-widest z-10 text-sm">INITIALIZING MATRIX ENGINE...</div>
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

  // ── Build real node data for each network canvas ──────────────────────────

  // Price network: active signals give real direction + live P&L.
  // Fill remaining slots from watchlist (neutral, val = cyclesWatched as "strength")
  const maxCycles = Math.max(...dashboard.watchlist.map((w: WatchlistItem) => w.cyclesWatched), 1);

  const priceNodes: NetworkNode[] = [
    ...dashboard.activeSignals.slice(0, 5).map(s => ({
      name: s.symbol,
      dir: (s.direction === 'LONG' ? 1 : -1) as 1 | 0 | -1,
      val: parseFloat((s.pnlPct ?? 0).toFixed(2)),
    })),
    ...dashboard.watchlist
      .slice(0, Math.max(0, 7 - dashboard.activeSignals.length))
      .map((w: WatchlistItem) => ({
        name: w.symbol,
        dir: 0 as const,
        val: parseFloat(((w.cyclesWatched / maxCycles) * 1.2).toFixed(2)),
      })),
  ].slice(0, 7);

  // OI network: watchlist pairs — HIGH = blue (positive), MEDIUM = amber (neutral)
  // val = cycles watched as a fraction (proxy for OI divergence accumulation)
  const oiNodes: NetworkNode[] = dashboard.watchlist.slice(0, 7).map((w: WatchlistItem) => ({
    name: w.symbol,
    dir: (w.priority === 'HIGH' ? 1 : 0) as 1 | 0 | -1,
    val: parseFloat(((w.cyclesWatched / maxCycles) * 2.0).toFixed(2)),
  }));

  // Funding network: scan feed — PUMP = positive, DUMP = negative, else neutral
  // val = matrix row / 27 as a rough divergence intensity scaled to basis points
  const seenFunding = new Set<string>();
  const fundingNodes: NetworkNode[] = dashboard.scanFeed
    .filter(f => { if (seenFunding.has(f.symbol)) return false; seenFunding.add(f.symbol); return true; })
    .slice(0, 7)
    .map(f => ({
      name: f.symbol,
      dir: (f.outlook === 'PUMP' ? 1 : f.outlook === 'DUMP' ? -1 : 0) as 1 | 0 | -1,
      val: parseFloat(((f.row / 27) * 4).toFixed(2)),
    }));

  // Fallback if scan feed empty — use watchlist
  const fundingFinal: NetworkNode[] = fundingNodes.length >= 3
    ? fundingNodes
    : dashboard.watchlist.slice(0, 7).map((w: WatchlistItem) => ({
        name: w.symbol,
        dir: 0 as const,
        val: parseFloat(((w.row / 27) * 4).toFixed(2)),
      }));

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden p-2 gap-1.5 text-xs relative z-10">
      <ParticleBackground />

      {/* Header */}
      <Header dashboard={dashboard} />

      {/* Network Canvas Row — compact 65px height */}
      <div className="grid grid-cols-3 gap-1.5 flex-none z-10">
        <NetworkCanvas
          label="price network · active signals"
          accentUp="#5DCAA5" accentDown="#F0716E" unit="%"
          nodes={priceNodes}
          height={65}
        />
        <NetworkCanvas
          label="open interest · watchlist divergence"
          accentUp="#85B7EB" accentDown="#F5B457" unit="×"
          nodes={oiNodes}
          height={65}
        />
        <NetworkCanvas
          label="funding rate · scan outlook"
          accentUp="#A29BF0" accentDown="#D4537E" unit="bp"
          nodes={fundingFinal}
          height={65}
        />
      </div>

      {/* Main 3-column grid */}
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-1.5 z-10">

        {/* LEFT — scan feed, heatmap, activity */}
        <div className="col-span-3 flex flex-col gap-1.5 min-h-0">
          <ScanStatus scan={dashboard.scan} />
          <ScanFeed feed={dashboard.scanFeed} />
          <MatrixHeatmap rowFrequency={dashboard.rowFrequency} />
          <ActivityLog activity={dashboard.activity} />
        </div>

        {/* MIDDLE — stats, active, pending, trades */}
        <div className="col-span-6 flex flex-col gap-1.5 min-h-0">
          <TopStats dashboard={dashboard} />
          <ActiveSignals signals={dashboard.activeSignals} />
          <div className="flex-1 min-h-0 grid grid-rows-2 gap-1.5">
            <PendingSignals signals={dashboard.pendingSignals} />
            <RecentTrades trades={dashboard.recentTrades} />
          </div>
        </div>

        {/* RIGHT — equity, priority bars, radar watchlist */}
        <div className="col-span-3 flex flex-col gap-1.5 min-h-0">
          <BalanceChart
            history={dashboard.balanceHistory}
            paperBalance={dashboard.paperBalance}
            paperBalanceDelta={dashboard.paperBalanceDelta}
          />
          <PriorityResolution resolution={dashboard.priorityResolution} />
          <Watchlist watchlist={dashboard.watchlist} />
        </div>
      </div>
    </div>
  );
}
