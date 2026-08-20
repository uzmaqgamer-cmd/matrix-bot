import { useGetDashboard, getGetDashboardQueryKey, WatchlistItem } from '@workspace/api-client-react';
import { Header, TopStats } from '@/components/layout';
import { ActiveTargetsPanel, PendingSignals } from '@/components/signals';
import { ScanStatus, ScanFeed } from '@/components/market';
import { MatrixHeatmap, ActivityLog, RecentTrades } from '@/components/analysis';
import { PremiumRadar } from '@/components/PremiumRadar';
import { AmbientBackground } from '@/components/AmbientBackground';
import { Loader2 } from 'lucide-react';
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
      <div className="flex h-[100dvh] w-full items-center justify-center font-mono text-[#00e5ff] flex-col gap-4 bg-[#030712]">
        <AmbientBackground />
        <Loader2 className="w-8 h-8 animate-spin z-10" />
        <div className="tracking-widest z-10 text-sm glow-text-cyan">INITIALIZING MATRIX ENGINE...</div>
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center font-mono text-[#ff2a5f] flex-col gap-4 bg-[#030712]">
        <AmbientBackground />
        <div className="text-xl tracking-widest font-bold z-10 glow-text-rose">CONNECTION LOST</div>
        <div className="text-sm opacity-50 z-10">Awaiting telemetry...</div>
      </div>
    );
  }

  // ── Build network node data ───────────────────────────────────────────────
  const maxCycles = Math.max(0, ...dashboard.watchlist.map((w: WatchlistItem) => w.cyclesWatched), 1);

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

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden p-3 gap-3 text-sm relative z-10 font-sans">
      <AmbientBackground />

      {/* Header */}
      <Header dashboard={dashboard} />

      {/* Network Canvas Row */}
      <div className="grid grid-cols-3 gap-4 flex-none z-10">
        <NetworkCanvas
          label="PRICE NETWORK · ACTIVE SIGNALS"
          accentUp="#00e5ff" accentDown="#ff2a5f" unit="%"
          nodes={priceNodes}
          height={60}
        />
        <NetworkCanvas
          label="OPEN INTEREST · DIVERGENCE WATCH"
          accentUp="#00e5ff" accentDown="#ffaa00" unit="×"
          nodes={oiNodes}
          height={60}
        />
        <NetworkCanvas
          label="FUNDING RATE · MATRIX SCAN OUTLOOK"
          accentUp="#00e5ff" accentDown="#ff2a5f" unit="bp"
          nodes={fundingFinal}
          height={60}
        />
      </div>

      {/* Top Stats */}
      <TopStats dashboard={dashboard} />

      {/* Active Targets */}
      <ActiveTargetsPanel signals={dashboard.activeSignals} />

      {/* Main 3-column grid */}
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-4 z-10">

        {/* LEFT — scan feed, heatmap, activity */}
        <div className="col-span-3 flex flex-col gap-4 min-h-0">
          <ScanStatus scan={dashboard.scan} />
          <ScanFeed feed={dashboard.scanFeed} />
          <MatrixHeatmap rowFrequency={dashboard.rowFrequency} />
          <ActivityLog activity={dashboard.activity} />
        </div>

        {/* MIDDLE — pending, recent trades */}
        <div className="col-span-4 flex flex-col gap-4 min-h-0">
          <PendingSignals signals={dashboard.pendingSignals} />
          <RecentTrades trades={dashboard.recentTrades} />
        </div>

        {/* RIGHT — Signal Radar (Replaces stats/watchlist) */}
        <div className="col-span-5 flex flex-col gap-4 min-h-0">
          <PremiumRadar watchlist={dashboard.watchlist} />
        </div>
      </div>
    </div>
  );
}
