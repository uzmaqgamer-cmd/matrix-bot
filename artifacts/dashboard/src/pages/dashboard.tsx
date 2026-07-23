import { useGetDashboard, getGetDashboardQueryKey, WatchlistItem } from '@workspace/api-client-react';
import { Header, TopStats } from '@/components/layout';
import { ActiveTargetsPanel, PendingSignals } from '@/components/signals';
import { ScanStatus, ScanFeed, Watchlist } from '@/components/market';
import {
  MatrixHeatmap,
  PriorityResolution,
  BalanceChart,
  TradeStats,
  RecentTrades,
  ActivityLog,
} from '@/components/analysis';
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

  // ── Build network node data ───────────────────────────────────────────────
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

  const oiNodes: NetworkNode[] = dashboard.watchlist.slice(0, 7).map((w: WatchlistItem) => ({
    name: w.symbol,
    dir: (w.priority === 'HIGH' ? 1 : 0) as 1 | 0 | -1,
    val: parseFloat(((w.cyclesWatched / maxCycles) * 2.0).toFixed(2)),
  }));

  const seenFunding = new Set<string>();
  const fundingNodes: NetworkNode[] = dashboard.scanFeed
    .filter(f => { if (seenFunding.has(f.symbol)) return false; seenFunding.add(f.symbol); return true; })
    .slice(0, 7)
    .map(f => ({
      name: f.symbol,
      dir: (f.outlook === 'PUMP' ? 1 : f.outlook === 'DUMP' ? -1 : 0) as 1 | 0 | -1,
      val: parseFloat(((f.row / 27) * 4).toFixed(2)),
    }));

  const fundingFinal: NetworkNode[] = fundingNodes.length >= 3
    ? fundingNodes
    : dashboard.watchlist.slice(0, 7).map((w: WatchlistItem) => ({
        name: w.symbol,
        dir: 0 as const,
        val: parseFloat(((w.row / 27) * 4).toFixed(2)),
      }));

  // Safe defaults for new optional fields
  const test2Stats = (dashboard as any).test2Stats ?? {
    balance: dashboard.paperBalance, tradeCount: 0, winCount: 0, lossCount: 0,
    autoClosedCount: 0, partialTpCount: 0, winRate: null, profitFactor: null,
    expectancyR: null,
    byDirection: { LONG: { trades: 0, wins: 0, pnlAmt: 0, winRate: null }, SHORT: { trades: 0, wins: 0, pnlAmt: 0, winRate: null } },
    byTier: { '2.0': { trades: 0, wins: 0, winRate: null }, '2.5': { trades: 0, wins: 0, winRate: null }, '3.5': { trades: 0, wins: 0, winRate: null } },
  };
  const test1Stats = (dashboard as any).test1Stats ?? { tpHit: dashboard.totalTpHit, slHit: dashboard.totalSlHit, total: 0, winRate: null };

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden p-2 gap-1.5 text-xs relative z-10">
      <ParticleBackground />

      {/* Header */}
      <Header dashboard={dashboard} />

      {/* Network Canvas Row */}
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

      {/* Active Targets — full-width collapsible panel, sorted by closest to TP */}
      <ActiveTargetsPanel signals={dashboard.activeSignals} />

      {/* Main 3-column grid */}
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-1.5 z-10">

        {/* LEFT — scan feed, heatmap, activity */}
        <div className="col-span-3 flex flex-col gap-1.5 min-h-0">
          <ScanStatus scan={dashboard.scan} />
          <ScanFeed feed={dashboard.scanFeed} />
          <MatrixHeatmap rowFrequency={dashboard.rowFrequency} />
          <ActivityLog activity={dashboard.activity} devMode={dashboard.devMode} />
        </div>

        {/* MIDDLE — top stats, pending, recent trades */}
        <div className="col-span-6 flex flex-col gap-1.5 min-h-0">
          <TopStats dashboard={dashboard} />
          <div className="flex-1 min-h-0 grid grid-rows-2 gap-1.5">
            <PendingSignals signals={dashboard.pendingSignals} />
            <RecentTrades trades={dashboard.recentTrades} />
          </div>
        </div>

        {/* RIGHT — balance chart, trade stats, priority, watchlist */}
        <div className="col-span-3 flex flex-col gap-1.5 min-h-0 overflow-y-auto">
          <BalanceChart
            history={dashboard.balanceHistory}
            paperBalance={dashboard.paperBalance}
            paperBalanceDelta={dashboard.paperBalanceDelta}
          />
          <TradeStats test2={test2Stats} test1={test1Stats} />
          <PriorityResolution resolution={dashboard.priorityResolution} />
          <Watchlist watchlist={dashboard.watchlist} />
        </div>
      </div>
    </div>
  );
}
