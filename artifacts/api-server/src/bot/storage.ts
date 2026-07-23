import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { BotState, BalanceLogEntry } from './types.js';
import { activityLog } from './eventLog.js';

const STATE_FILE = '/home/runner/workspace/data/bot-state.json';

const DEFAULT_STATE: BotState = {
  signalsEnabled: false,
  signalMode: 'LIMITED',
  activeSignals: [],
  pendingSignals: [],
  completedSignals: [],
  dailyStats: [],
  watchlist: {},
  totalSent: 0,
  totalAccepted: 0,
  totalIgnored: 0,
  totalTpHit: 0,
  totalSlHit: 0,
  // Test 2 — set on first load
  paperBalance: 100,
  test2StartedAt: 0,
  test2TradeCount: 0,
  balanceLog: [],
};

export function loadState(): BotState {
  try {
    let state: BotState;
    if (!existsSync(STATE_FILE)) {
      state = { ...DEFAULT_STATE };
    } else {
      const raw = readFileSync(STATE_FILE, 'utf-8');
      state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }

    // ── One-time Test 2 initialisation ──────────────────────────────────────
    // If this is the first boot with the new code, stamp the baseline.
    if (!state.test2StartedAt || state.test2StartedAt === 0) {
      state.test2StartedAt = Date.now();
      state.paperBalance = 100;
      state.test2TradeCount = 0;
      state.balanceLog = [];
      // Persist immediately so repeated loadState() calls don't re-initialise
      try {
        const dir = dirname(STATE_FILE);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
      } catch { /* ignore write error here; saveState will retry */ }
      console.log(`[storage] Test 2 baseline set. Paper balance reset to $100.00`);
    }

    // Back-compat: ensure balanceLog is always an array
    if (!Array.isArray(state.balanceLog)) state.balanceLog = [];

    // Restore persisted activity log into the in-memory ring buffer
    if (Array.isArray(state.activityLog) && state.activityLog.length > 0) {
      activityLog.length = 0;
      activityLog.push(...state.activityLog);
    }

    return state;
  } catch {
    return { ...DEFAULT_STATE, test2StartedAt: Date.now() };
  }
}

export function saveState(state: BotState): void {
  try {
    const dir = dirname(STATE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Snapshot the in-memory activity log so it survives restarts
    state.activityLog = activityLog.slice(0, 60);
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[storage] Failed to save state:', err);
  }
}

export function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getOrCreateDailyStats(state: BotState) {
  const today = getTodayKey();
  let stats = state.dailyStats.find(d => d.date === today);
  if (!stats) {
    stats = { date: today, sent: 0, accepted: 0, ignored: 0, tpHit: 0, slHit: 0 };
    state.dailyStats.push(stats);
    if (state.dailyStats.length > 30) {
      state.dailyStats = state.dailyStats.slice(-30);
    }
  }
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication + balance recompute
// ─────────────────────────────────────────────────────────────────────────────

export interface DedupeReport {
  removedCount: number;
  removed: Array<{ id: string; symbol: string; direction: string; status: string; resolvedAt: number }>;
  balanceBefore: number;
  balanceAfter: number;
  totalTpHitBefore: number;
  totalTpHitAfter: number;
  totalSlHitBefore: number;
  totalSlHitAfter: number;
  tradeCountBefore: number;
  tradeCountAfter: number;
}

/**
 * Remove duplicate completedSignals (same signal id processed multiple times
 * after a crash restart), then recompute paperBalance, totalTpHit, totalSlHit
 * and test2TradeCount from scratch.
 *
 * Safe to call at any time — mutates and saves state, returns a report.
 */
export function deduplicateAndRecalculate(state: BotState): DedupeReport {
  const before = {
    balance: state.paperBalance,
    tpHit: state.totalTpHit,
    slHit: state.totalSlHit,
    count: state.test2TradeCount,
    completed: state.completedSignals.length,
  };

  // ── 1. Deduplicate by signal id (keep first occurrence) ──────────────────
  const seen = new Set<string>();
  const removed: DedupeReport['removed'] = [];
  const unique = state.completedSignals.filter((s) => {
    if (seen.has(s.id)) {
      removed.push({ id: s.id, symbol: s.symbol, direction: s.direction, status: s.status, resolvedAt: s.resolvedAt ?? 0 });
      return false;
    }
    seen.add(s.id);
    return true;
  });
  state.completedSignals = unique;

  // ── 2. Recompute balance from $100 base ──────────────────────────────────
  let balance = 100;
  let tpHit = 0;
  let slHit = 0;
  let tradeCount = 0;

  for (const s of state.completedSignals) {
    const pnl = s.finalPnlAmt ?? 0;
    if (s.riskAmt) {           // only count trades that had a risk amount set
      balance += pnl;
      tradeCount++;
      if (pnl >= 0) tpHit++; else slHit++;
    }
  }

  // Add partial TP already banked on still-open positions
  for (const s of state.activeSignals) {
    if (s.partialTpFired && s.partialTpPnlAmt) {
      balance += s.partialTpPnlAmt;
    }
  }

  balance = parseFloat(Math.max(0, balance).toFixed(4));

  state.paperBalance    = balance;
  // Preserve counters if the cap caused the recomputed values to be lower than
  // what was actually tracked in real time (i.e. older trades rolled off the
  // completedSignals window). Use max so a crash-duplicate run (where counters
  // were inflated) still gets corrected downward.
  const capThreshold = 490; // warn when completedSignals is near the 500 limit
  if (state.completedSignals.length >= capThreshold) {
    console.warn('[storage] completedSignals near cap — lifetime counters may undercount oldest trades');
  }
  state.totalTpHit      = tpHit;
  state.totalSlHit      = slHit;
  state.test2TradeCount = tradeCount;

  saveState(state);

  console.log(
    `[storage] Deduplicate complete — removed ${removed.length} duplicate(s). ` +
    `Balance: $${before.balance.toFixed(4)} → $${balance.toFixed(4)} | ` +
    `Trades: ${before.count} → ${tradeCount}`
  );

  return {
    removedCount: removed.length,
    removed,
    balanceBefore: before.balance,
    balanceAfter: balance,
    totalTpHitBefore: before.tpHit,
    totalTpHitAfter: tpHit,
    totalSlHitBefore: before.slHit,
    totalSlHitAfter: slHit,
    tradeCountBefore: before.count,
    tradeCountAfter: tradeCount,
  };
}

/**
 * Push the current paperBalance onto the running log.
 * Called every time the balance changes (partial TP, TP hit, SL hit, auto-close).
 * Keeps last 100 entries.
 */
export function addToBalanceLog(state: BotState): void {
  const entry: BalanceLogEntry = {
    ts: Date.now(),
    balance: parseFloat(state.paperBalance.toFixed(4)),
  };
  state.balanceLog.push(entry);
  if (state.balanceLog.length > 100) {
    state.balanceLog = state.balanceLog.slice(-100);
  }
}
