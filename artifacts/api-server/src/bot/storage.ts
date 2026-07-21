import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { BotState, BalanceLogEntry } from './types.js';

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

    return state;
  } catch {
    return { ...DEFAULT_STATE, test2StartedAt: Date.now() };
  }
}

export function saveState(state: BotState): void {
  try {
    const dir = dirname(STATE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
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
