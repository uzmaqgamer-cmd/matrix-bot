import { Router, type IRouter } from 'express';
import { loadState } from '../bot/storage.js';
import { lastScanSummary } from '../bot/scanner.js';
import { activityLog, scanFeed } from '../bot/eventLog.js';
import { MATRIX, HIGH_PRIORITY_ROWS } from '../bot/matrix.js';
import type { Signal, BotState } from '../bot/types.js';

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function enrichSignal(s: Signal): Signal & { pnlPct: number | null; tpProgressPct: number | null } {
  let pnlPct: number | null = null;
  let tpProgressPct: number | null = null;

  if (s.currentPrice) {
    const price = s.currentPrice;
    pnlPct = s.direction === 'LONG'
      ? ((price - s.entry) / s.entry) * 100
      : ((s.entry - price) / s.entry) * 100;

    const tpDist = s.direction === 'LONG' ? s.tp - s.entry : s.entry - s.tp;
    const currentDist = s.direction === 'LONG' ? price - s.entry : s.entry - price;
    tpProgressPct = tpDist > 0 ? (currentDist / tpDist) * 100 : null;
  }

  return { ...s, pnlPct, tpProgressPct };
}

/**
 * Row frequency from active + completed signals combined.
 */
function computeRowFrequency(active: Signal[], completed: Signal[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (let r = 1; r <= 27; r++) freq[String(r)] = 0;

  for (const s of [...active, ...completed]) {
    const k = String(s.matrixRow);
    freq[k] = (freq[k] ?? 0) + 1;
    if (s.originRow && s.originRow !== s.matrixRow) {
      const ok = String(s.originRow);
      freq[ok] = (freq[ok] ?? 0) + 1;
    }
  }
  return freq;
}

/**
 * Priority resolution from completed signals.
 */
function computePriorityResolution(completed: Signal[]) {
  let highResolved = 0, highTotal = 0, medResolved = 0, medTotal = 0;

  for (const s of completed) {
    if (s.originPriority === 'HIGH') {
      highTotal++;
      if (s.status === 'tp_hit') highResolved++;
    } else {
      medTotal++;
      if (s.status === 'tp_hit') medResolved++;
    }
  }

  return { highResolved, highTotal, medResolved, medTotal };
}

// ─── Test 2 stats ─────────────────────────────────────────────────────────────

/** A trade is "Test 2" if it carries a riskAmt (stamped at acceptance after reset). */
function computeTest2Stats(state: BotState) {
  const completed = state.completedSignals.filter(s => s.riskAmt != null);

  let winCount = 0, lossCount = 0, autoClosedCount = 0, partialTpCount = 0;
  let totalGainAmt = 0, totalLossAmt = 0;
  let totalR = 0;

  const byDir = {
    LONG: { trades: 0, wins: 0, pnlAmt: 0 },
    SHORT: { trades: 0, wins: 0, pnlAmt: 0 },
  };
  const byTier: Record<string, { trades: number; wins: number }> = {
    '2.0': { trades: 0, wins: 0 },
    '2.5': { trades: 0, wins: 0 },
    '3.5': { trades: 0, wins: 0 },
  };

  for (const s of completed) {
    const pnl = s.finalPnlAmt ?? 0;
    const isWin =
      s.status === 'tp_hit' ||
      (s.status === 'auto_closed' && pnl > 0) ||
      (s.status === 'sl_hit' && pnl >= 0); // sl at breakeven = 0 P&L → counts as a saved trade

    if (s.status === 'auto_closed') autoClosedCount++;
    if (s.partialTpFired) partialTpCount++;

    if (isWin) { winCount++; totalGainAmt += pnl; }
    else { lossCount++; totalLossAmt += Math.abs(pnl); }

    byDir[s.direction].trades++;
    byDir[s.direction].pnlAmt += pnl;
    if (isWin) byDir[s.direction].wins++;

    const tierKey = s.rr >= 3 ? '3.5' : s.rr >= 2.3 ? '2.5' : '2.0';
    if (byTier[tierKey]) {
      byTier[tierKey].trades++;
      if (isWin) byTier[tierKey].wins++;
    }

    if (s.riskAmt && s.riskAmt > 0) totalR += pnl / s.riskAmt;
  }

  const closedForRate = winCount + lossCount;
  const winRate = closedForRate > 0
    ? parseFloat((winCount / closedForRate * 100).toFixed(1))
    : null;
  const profitFactor = totalLossAmt > 0
    ? parseFloat((totalGainAmt / totalLossAmt).toFixed(2))
    : null;
  const expectancyR = completed.length > 0
    ? parseFloat((totalR / completed.length).toFixed(3))
    : null;

  return {
    balance: state.paperBalance,
    tradeCount: completed.length,
    winCount,
    lossCount,
    autoClosedCount,
    partialTpCount,
    winRate,
    profitFactor,
    expectancyR,
    byDirection: {
      LONG: {
        trades: byDir.LONG.trades,
        wins: byDir.LONG.wins,
        pnlAmt: parseFloat(byDir.LONG.pnlAmt.toFixed(4)),
        winRate: byDir.LONG.trades > 0
          ? parseFloat((byDir.LONG.wins / byDir.LONG.trades * 100).toFixed(1))
          : null,
      },
      SHORT: {
        trades: byDir.SHORT.trades,
        wins: byDir.SHORT.wins,
        pnlAmt: parseFloat(byDir.SHORT.pnlAmt.toFixed(4)),
        winRate: byDir.SHORT.trades > 0
          ? parseFloat((byDir.SHORT.wins / byDir.SHORT.trades * 100).toFixed(1))
          : null,
      },
    },
    byTier: {
      '2.0': {
        ...byTier['2.0'],
        winRate: byTier['2.0'].trades > 0
          ? parseFloat((byTier['2.0'].wins / byTier['2.0'].trades * 100).toFixed(1))
          : null,
      },
      '2.5': {
        ...byTier['2.5'],
        winRate: byTier['2.5'].trades > 0
          ? parseFloat((byTier['2.5'].wins / byTier['2.5'].trades * 100).toFixed(1))
          : null,
      },
      '3.5': {
        ...byTier['3.5'],
        winRate: byTier['3.5'].trades > 0
          ? parseFloat((byTier['3.5'].wins / byTier['3.5'].trades * 100).toFixed(1))
          : null,
      },
    },
  };
}

/** Test 1 = completed signals without a riskAmt (pre-reset history). */
function computeTest1Stats(state: BotState) {
  const test1 = state.completedSignals.filter(s => s.riskAmt == null);
  const tpHit = test1.filter(s => s.status === 'tp_hit').length;
  const slHit = test1.filter(s => s.status === 'sl_hit').length;
  const total = tpHit + slHit;
  return {
    tpHit,
    slHit,
    total,
    winRate: total > 0 ? parseFloat((tpHit / total * 100).toFixed(1)) : null,
  };
}

// ─── GET /api/dashboard ───────────────────────────────────────────────────────

router.get('/dashboard', (_req, res) => {
  const state = loadState();
  const today = getTodayKey();
  const todayStats = state.dailyStats.find(d => d.date === today) ?? {
    date: today, sent: 0, accepted: 0, ignored: 0, tpHit: 0, slHit: 0,
  };

  const rowFrequency = computeRowFrequency(state.activeSignals, state.completedSignals);
  const priorityResolution = computePriorityResolution(state.completedSignals);
  const test2Stats = computeTest2Stats(state);
  const test1Stats = computeTest1Stats(state);

  const total = state.totalTpHit + state.totalSlHit;
  const escalationAccuracyPct = total > 0
    ? parseFloat((state.totalTpHit / total * 100).toFixed(1))
    : null;

  // Balance history from the running log (Test 2 only)
  const balanceHistory: number[] = [100, ...state.balanceLog.map(e => e.balance)];

  // paperBalance fields relative to the Test 2 $100 baseline
  const paperBalance = parseFloat(state.paperBalance.toFixed(2));
  const paperBalanceDelta = parseFloat((state.paperBalance - 100).toFixed(4));
  const paperBalancePct = parseFloat(((state.paperBalance - 100) / 100 * 100).toFixed(2));

  // Enrich watchlist with matrix meanings and expected TP multiplier
  const watchlistItems = Object.entries(state.watchlist).map(([symbol, entry]) => {
    const matRow = MATRIX.find(r => r.row === entry.row);
    const expectedTpMultiplier = HIGH_PRIORITY_ROWS.includes(entry.row) ? 3.5
      : entry.priority === 'HIGH' ? 3.5
      : 2.5;
    return {
      symbol,
      row: entry.row,
      priority: entry.priority,
      cyclesWatched: entry.cyclesWatched,
      addedAt: entry.addedAt,
      meaning: matRow?.meaning ?? '',
      expectedTpMultiplier,
    };
  }).sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'HIGH' ? -1 : 1;
    return b.cyclesWatched - a.cyclesWatched;
  });

  const scan = lastScanSummary;

  const response = {
    uptimeSeconds: parseFloat(process.uptime().toFixed(1)),
    signalsEnabled: state.signalsEnabled,
    signalMode: state.signalMode ?? 'LIMITED',
    totalSent: state.totalSent,
    totalAccepted: state.totalAccepted,
    totalIgnored: state.totalIgnored,
    totalTpHit: state.totalTpHit,
    totalSlHit: state.totalSlHit,
    paperBalance,
    paperBalanceDelta,
    paperBalancePct,
    balanceHistory,
    test2Stats,
    test1Stats,
    test2StartedAt: state.test2StartedAt,
    rowFrequency,
    priorityResolution,
    escalationAccuracyPct,
    activeSignals: state.activeSignals.map(enrichSignal),
    pendingSignals: state.pendingSignals.map(enrichSignal),
    recentTrades: [...state.completedSignals].reverse().slice(0, 20).map(enrichSignal),
    watchlist: watchlistItems,
    scanFeed: scanFeed.slice(0, 30),
    activity: activityLog.slice(0, 20),
    today: todayStats,
    scan: {
      inProgress: scan.inProgress,
      scanned: scan.scanned,
      total: scan.total,
      watchlistCount: scan.watchlistCount,
      signalsSent: scan.signalsSent,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt ?? null,
      elapsedMs: scan.finishedAt
        ? parseFloat((scan.finishedAt - scan.startedAt).toFixed(0))
        : scan.inProgress
          ? parseFloat((Date.now() - scan.startedAt).toFixed(0))
          : null,
    },
  };

  res.json(response);
});

// ─── GET /api/dashboard/activity ─────────────────────────────────────────────

router.get('/dashboard/activity', (_req, res) => {
  res.json(activityLog.slice(0, 50));
});

export default router;
