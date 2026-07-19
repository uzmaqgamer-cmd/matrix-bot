import { Router, type IRouter } from 'express';
import { loadState } from '../bot/storage.js';
import { lastScanSummary } from '../bot/scanner.js';
import { activityLog, scanFeed } from '../bot/eventLog.js';
import { MATRIX, HIGH_PRIORITY_ROWS } from '../bot/matrix.js';
import type { Signal } from '../bot/types.js';

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compute live P&L fields on a signal.
 */
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
 * Compute paper balance from completed signals.
 * 1 unit of risk per trade ($1). TP = +rr, SL = -1.
 */
function computePaperBalance(completedSignals: Signal[]): {
  balance: number;
  delta: number;
  pct: number;
  history: number[];
} {
  const START = 100;
  let balance = START;
  const history: number[] = [START];

  for (const s of [...completedSignals].reverse()) {
    if (s.status === 'tp_hit') {
      balance += s.rr ?? 2;
    } else if (s.status === 'sl_hit') {
      balance -= 1;
    }
    history.push(parseFloat(balance.toFixed(2)));
    if (history.length > 51) history.shift();
  }

  const delta = parseFloat((balance - START).toFixed(2));
  const pct = parseFloat(((delta / START) * 100).toFixed(2));
  return { balance: parseFloat(balance.toFixed(2)), delta, pct, history };
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
    // Also count origin row for divergence heatmap
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

  // Also count from activity log for pairs that dropped/escalated without signal
  for (const a of activityLog) {
    if (a.kind === 'watch') {
      // Heuristic: HIGH priority row
    }
  }

  return { highResolved, highTotal, medResolved, medTotal };
}

// ─── GET /api/dashboard ───────────────────────────────────────────────────────

router.get('/dashboard', (_req, res) => {
  const state = loadState();
  const today = getTodayKey();
  const todayStats = state.dailyStats.find(d => d.date === today) ?? {
    date: today, sent: 0, accepted: 0, ignored: 0, tpHit: 0, slHit: 0,
  };

  const { balance, delta, pct, history } = computePaperBalance(state.completedSignals);
  const rowFrequency = computeRowFrequency(state.activeSignals, state.completedSignals);
  const priorityResolution = computePriorityResolution(state.completedSignals);

  const total = state.totalTpHit + state.totalSlHit;
  const escalationAccuracyPct = total > 0
    ? parseFloat((state.totalTpHit / total * 100).toFixed(1))
    : null;

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
    paperBalance: balance,
    paperBalanceDelta: delta,
    paperBalancePct: pct,
    balanceHistory: history,
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
