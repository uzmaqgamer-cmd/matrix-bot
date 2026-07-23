import { Router, type IRouter, type Request, type Response, type NextFunction } from 'express';
import { loadState, saveState, getOrCreateDailyStats, addToBalanceLog, deduplicateAndRecalculate } from '../bot/storage.js';
import { lastScanSummary } from '../bot/scanner.js';
import { activityLog, scanFeed, logActivity } from '../bot/eventLog.js';
import { MATRIX, HIGH_PRIORITY_ROWS } from '../bot/matrix.js';
import { getCurrentPrice } from '../bot/binance.js';
import type { Signal, BotState } from '../bot/types.js';

const router: IRouter = Router();

// ─── Admin auth middleware ────────────────────────────────────────────────────
// Sensitive mutation endpoints require x-api-key matching SESSION_SECRET.
// In development (no SESSION_SECRET set) the check is skipped so local testing
// still works without config.
function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    next(); // dev environment — no secret configured
    return;
  }
  const provided = req.headers['x-api-key'];
  if (provided !== secret) {
    res.status(401).json({ error: 'Unauthorized — valid x-api-key header required' });
    return;
  }
  next();
}

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

type TradeOutcome = 'FULL_LOSS' | 'BREAKEVEN_WIN' | 'AUTO_CLOSE_WIN' | 'AUTO_CLOSE_LOSS' | 'FULL_TP_WIN';
const WIN_OUTCOMES = new Set<TradeOutcome>(['FULL_TP_WIN', 'BREAKEVEN_WIN', 'AUTO_CLOSE_WIN']);

/**
 * Classify a completed signal into one of five outcome buckets.
 * Rules from spec — does NOT rely on raw status alone:
 *   FULL_TP_WIN      → tp_hit
 *   BREAKEVEN_WIN    → sl_hit AND partialTpFired (partial TP banked, SL moved to BE)
 *   FULL_LOSS        → sl_hit AND !partialTpFired
 *   AUTO_CLOSE_WIN   → auto_closed AND finalPnlAmt > 0
 *   AUTO_CLOSE_LOSS  → auto_closed AND finalPnlAmt <= 0
 */
function classifyTrade(s: Signal): TradeOutcome {
  if (s.status === 'tp_hit') return 'FULL_TP_WIN';
  if (s.status === 'sl_hit') return s.partialTpFired ? 'BREAKEVEN_WIN' : 'FULL_LOSS';
  return (s.finalPnlAmt ?? 0) > 0 ? 'AUTO_CLOSE_WIN' : 'AUTO_CLOSE_LOSS';
}

/**
 * A "bugged" trade had sl === entry at CREATION time — a known artefact of bot
 * restart after downtime (SL was never set properly).
 *
 * Use `originalSl` (stamped at creation, immutable) when available.
 * Fall back for older signals that pre-date the field: treat as bugged only when
 * sl === entry AND neither breakevenMoved nor partialTpFired is true, because
 * those flags indicate the SL legitimately moved to entry via the partial-TP
 * breakeven feature — NOT a bug.
 */
function isBugged(s: Signal): boolean {
  const refSl = s.originalSl ?? s.sl;
  if (refSl == null || s.entry == null) return false;
  if (refSl !== s.entry) return false;
  // originalSl present and equals entry → definitively bugged regardless of other flags
  if (s.originalSl != null) return true;
  // Legacy fallback: only flag if the breakeven feature never ran on this trade
  return !s.breakevenMoved && !s.partialTpFired;
}

function emptyAcc() {
  return { tradeCount: 0, winCount: 0, lossCount: 0, pnlAmt: 0, gainAmt: 0, lossAmt: 0, totalR: 0 };
}

function accToStatSet(acc: ReturnType<typeof emptyAcc>) {
  const total = acc.winCount + acc.lossCount;
  return {
    tradeCount: acc.tradeCount,
    winCount: acc.winCount,
    lossCount: acc.lossCount,
    pnlAmt: parseFloat(acc.pnlAmt.toFixed(4)),
    winRate: total > 0 ? parseFloat((acc.winCount / total * 100).toFixed(1)) : null as number | null,
    profitFactor: acc.lossAmt > 0 ? parseFloat((acc.gainAmt / acc.lossAmt).toFixed(2)) : null as number | null,
    expectancyR: acc.tradeCount > 0 ? parseFloat((acc.totalR / acc.tradeCount).toFixed(3)) : null as number | null,
  };
}

/** A trade is "Test 2" if it carries a riskAmt (stamped at acceptance after reset). */
function computeTest2Stats(state: BotState) {
  const completed = state.completedSignals.filter(s => s.riskAmt != null);

  const emptyBucket = () => ({ count: 0, pnlAmt: 0 });
  const buckets: Record<TradeOutcome, { count: number; pnlAmt: number }> = {
    FULL_LOSS:       emptyBucket(),
    BREAKEVEN_WIN:   emptyBucket(),
    AUTO_CLOSE_WIN:  emptyBucket(),
    AUTO_CLOSE_LOSS: emptyBucket(),
    FULL_TP_WIN:     emptyBucket(),
  };

  const all   = emptyAcc();
  const clean = emptyAcc();

  let buggedCount = 0, autoClosedCount = 0, partialTpCount = 0;

  const byDir = {
    LONG:  { trades: 0, wins: 0, pnlAmt: 0 },
    SHORT: { trades: 0, wins: 0, pnlAmt: 0 },
  };
  const byTier: Record<string, { trades: number; wins: number }> = {
    '2.0': { trades: 0, wins: 0 },
    '2.5': { trades: 0, wins: 0 },
    '3.5': { trades: 0, wins: 0 },
  };

  for (const s of completed) {
    const pnl    = s.finalPnlAmt ?? 0;
    const outcome = classifyTrade(s);
    const isWin   = WIN_OUTCOMES.has(outcome);
    const bugged  = isBugged(s);

    if (bugged) buggedCount++;
    if (s.status === 'auto_closed') autoClosedCount++;
    if (s.partialTpFired) partialTpCount++;

    // ── All-trades accumulator ────────────────────────────────────────────
    all.tradeCount++;
    all.pnlAmt += pnl;
    if (isWin) { all.winCount++; all.gainAmt += pnl; }
    else        { all.lossCount++; all.lossAmt += Math.abs(pnl); }
    if (s.riskAmt && s.riskAmt > 0) all.totalR += pnl / s.riskAmt;

    // ── Clean-trades accumulator + breakdowns (bugged trades excluded) ────
    if (!bugged) {
      clean.tradeCount++;
      clean.pnlAmt += pnl;
      if (isWin) { clean.winCount++; clean.gainAmt += pnl; }
      else        { clean.lossCount++; clean.lossAmt += Math.abs(pnl); }
      if (s.riskAmt && s.riskAmt > 0) clean.totalR += pnl / s.riskAmt;

      buckets[outcome].count++;
      buckets[outcome].pnlAmt += pnl;

      byDir[s.direction].trades++;
      byDir[s.direction].pnlAmt += pnl;
      if (isWin) byDir[s.direction].wins++;

      const tierKey = s.rr >= 3 ? '3.5' : s.rr >= 2.3 ? '2.5' : '2.0';
      if (byTier[tierKey]) {
        byTier[tierKey].trades++;
        if (isWin) byTier[tierKey].wins++;
      }
    }
  }

  // Round bucket pnlAmt values
  for (const b of Object.values(buckets)) {
    b.pnlAmt = parseFloat(b.pnlAmt.toFixed(4));
  }

  const allStats   = accToStatSet(all);
  const cleanStats = accToStatSet(clean);

  const tierStat = (k: string) => ({
    ...byTier[k],
    winRate: byTier[k].trades > 0
      ? parseFloat((byTier[k].wins / byTier[k].trades * 100).toFixed(1)) : null as number | null,
  });
  const dirStat = (d: 'LONG' | 'SHORT') => ({
    trades:  byDir[d].trades,
    wins:    byDir[d].wins,
    pnlAmt:  parseFloat(byDir[d].pnlAmt.toFixed(4)),
    winRate: byDir[d].trades > 0
      ? parseFloat((byDir[d].wins / byDir[d].trades * 100).toFixed(1)) : null as number | null,
  });

  return {
    balance: state.paperBalance,
    // Legacy top-level fields (kept for backward-compat; derived from allStats)
    tradeCount:      completed.length,
    winCount:        allStats.winCount,
    lossCount:       allStats.lossCount,
    autoClosedCount,
    partialTpCount,
    winRate:         allStats.winRate,
    profitFactor:    allStats.profitFactor,
    expectancyR:     allStats.expectancyR,
    // New fields
    buggedCount,
    buckets,
    allStats,
    cleanStats,
    byDirection: { LONG: dirStat('LONG'), SHORT: dirStat('SHORT') },
    byTier: { '2.0': tierStat('2.0'), '2.5': tierStat('2.5'), '3.5': tierStat('3.5') },
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
    devMode: process.env.NODE_ENV !== 'production',
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

// ─── POST /api/force-close/:symbol ───────────────────────────────────────────
// Manually force-close an active signal as auto_closed (thesis_invalidated).

router.post('/force-close/:symbol', requireApiKey, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const state = loadState();

  const idx = state.activeSignals.findIndex(s => s.symbol === symbol);
  if (idx === -1) {
    res.status(404).json({ error: `No active signal found for ${symbol}` });
    return;
  }

  const signal = state.activeSignals[idx];

  // Fetch current price
  let exitPrice = signal.currentPrice ?? 0;
  if (exitPrice === 0) {
    try { exitPrice = await getCurrentPrice(symbol); } catch { /* ignore */ }
  }

  // Compute P&L (same as tracker auto-close)
  const positionFraction = signal.partialTpFired ? 0.5 : 1.0;
  const closeAmt = signal.riskAmt
    ? (() => {
        const priceMoved = signal.direction === 'LONG'
          ? exitPrice - signal.entry
          : signal.entry - exitPrice;
        return positionFraction * (priceMoved / signal.atr) * signal.riskAmt!;
      })()
    : 0;

  signal.status = 'auto_closed';
  signal.resolvedAt = Date.now();
  signal.autoClosedAt = Date.now();
  signal.autoCloseReason = 'thesis_invalidated';
  signal.autoClosePrice = exitPrice;
  signal.finalPnlAmt = parseFloat(((signal.partialTpPnlAmt ?? 0) + closeAmt).toFixed(4));

  if (signal.riskAmt) {
    state.paperBalance = Math.max(0, parseFloat((state.paperBalance + closeAmt).toFixed(4)));
    addToBalanceLog(state);
    state.test2TradeCount++;
  }

  const acIsWin = (signal.finalPnlAmt ?? 0) >= 0;
  if (acIsWin) {
    state.totalTpHit++;
    getOrCreateDailyStats(state).tpHit++;
  } else {
    state.totalSlHit++;
    getOrCreateDailyStats(state).slHit++;
  }

  state.activeSignals.splice(idx, 1);
  state.completedSignals.push({ ...signal });
  if (state.completedSignals.length > 500) {
    state.completedSignals = state.completedSignals.slice(-500);
  }

  const pnlPct = exitPrice > 0 && signal.entry > 0
    ? (signal.direction === 'LONG'
        ? (exitPrice - signal.entry) / signal.entry * 100
        : (signal.entry - exitPrice) / signal.entry * 100)
    : 0;

  const pnlStr = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` +
    (signal.finalPnlAmt != null ? ` ($${signal.finalPnlAmt >= 0 ? '+' : ''}${signal.finalPnlAmt.toFixed(4)})` : '');

  logActivity({
    ts: Date.now(),
    text: `[MANUAL AUTO-CLOSE] ${signal.symbol} ${signal.direction} | force-closed via dashboard | P&L: ${pnlStr}`,
    kind: 'auto_close',
    symbol: signal.symbol,
  });

  saveState(state);

  res.json({
    ok: true,
    symbol,
    direction: signal.direction,
    entry: signal.entry,
    exitPrice,
    finalPnlAmt: signal.finalPnlAmt,
    pnlPct: parseFloat(pnlPct.toFixed(4)),
  });
});

// ─── POST /api/admin/deduplicate ──────────────────────────────────────────────
// One-time cleanup: removes duplicate completedSignals that accumulated from
// crash-restart cycles, then recomputes balance + counters from scratch.
// Safe to call multiple times — idempotent after duplicates are gone.
router.post('/admin/deduplicate', requireApiKey, (_req, res) => {
  const state = loadState();
  const report = deduplicateAndRecalculate(state);
  res.json({ ok: true, ...report });
});

export default router;
