import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import pg from 'pg';
import type { BotState, BalanceLogEntry } from './types.js';
import { activityLog } from './eventLog.js';

const { Pool } = pg;

// ─── Constants ─────────────────────────────────────────────────────────────────
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
  paperBalance: 100,
  test2StartedAt: 0,
  test2TradeCount: 0,
  balanceLog: [],
};

// ─── Shared in-memory singleton ────────────────────────────────────────────────
// All callers share the same object reference — no TOCTOU races.
let _state: BotState | null = null;

// ─── PostgreSQL pool ───────────────────────────────────────────────────────────
let _pool: InstanceType<typeof Pool> | null = null;
let _dbAvailable = false;

function getPool(): InstanceType<typeof Pool> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!_pool) {
    _pool = new Pool({ connectionString: url });
    _pool.on('error', (err) => console.error('[storage] pg pool error:', err.message));
  }
  return _pool;
}

// ─── DB helpers ────────────────────────────────────────────────────────────────

async function ensureTable(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_state (
      id      INTEGER PRIMARY KEY,
      state   JSONB    NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function dbLoad(): Promise<BotState | null> {
  const pool = getPool();
  if (!pool) return null;
  const res = await pool.query('SELECT state FROM bot_state WHERE id = 1');
  if (res.rows.length === 0) return null;
  return { ...DEFAULT_STATE, ...(res.rows[0].state as Partial<BotState>) };
}

async function dbSave(state: BotState): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  // Snapshot in-memory activity log before persisting
  (state as any).activityLog = activityLog.slice(0, 60);
  await pool.query(
    `INSERT INTO bot_state (id, state, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE
       SET state      = EXCLUDED.state,
           updated_at = NOW()`,
    [JSON.stringify(state)]
  );
}

// ─── File helpers (backup + migration source) ──────────────────────────────────

function fileLoad(): BotState {
  try {
    if (!existsSync(STATE_FILE)) {
      return { ...DEFAULT_STATE, test2StartedAt: Date.now() };
    }
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    const state: BotState = { ...DEFAULT_STATE, ...parsed };
    // One-time Test 2 initialisation guard
    if (!state.test2StartedAt || state.test2StartedAt === 0) {
      state.test2StartedAt = Date.now();
      state.paperBalance   = 100;
      state.test2TradeCount = 0;
      state.balanceLog     = [];
    }
    if (!Array.isArray(state.balanceLog)) state.balanceLog = [];
    return state;
  } catch {
    return { ...DEFAULT_STATE, test2StartedAt: Date.now() };
  }
}

function fileSave(state: BotState): void {
  try {
    const dir = dirname(STATE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    (state as any).activityLog = activityLog.slice(0, 60);
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[storage] File write failed:', err);
  }
}

// ─── Public: initialisation (call once at startup, before loadState) ───────────

/**
 * Loads state from PostgreSQL. On the very first run the DB is empty, so it
 * migrates from the JSON file and seeds the DB. After that the file is only
 * used as a backup and is never read again.
 *
 * Must be awaited before loadState() is called.
 */
export async function initStorage(): Promise<void> {
  if (_state) return; // idempotent

  const pool = getPool();

  if (pool) {
    try {
      await ensureTable();
      const saved = await dbLoad();

      if (saved) {
        _state = saved;
        _dbAvailable = true;
        console.log(`[storage] ✓ Loaded from PostgreSQL — balance $${_state.paperBalance.toFixed(4)}`);
      } else {
        // First deploy: migrate file → DB so the live balance is preserved
        const fromFile = fileLoad();
        _state = fromFile;
        _dbAvailable = true;
        await dbSave(fromFile);
        console.log(`[storage] ✓ Migrated file → PostgreSQL — balance $${_state.paperBalance.toFixed(4)}`);
      }
    } catch (err) {
      console.error('[storage] DB unavailable, falling back to file:', err);
      _state = fileLoad();
      _dbAvailable = false;
    }
  } else {
    console.warn('[storage] DATABASE_URL not set — using file storage (state will reset on publish)');
    _state = fileLoad();
    _dbAvailable = false;
  }

  // Back-compat guard
  if (!Array.isArray(_state.balanceLog)) _state.balanceLog = [];

  // Restore persisted activity log into the in-memory ring buffer
  const persisted = (_state as any).activityLog;
  if (Array.isArray(persisted) && persisted.length > 0) {
    activityLog.length = 0;
    activityLog.push(...persisted);
  }
}

// ─── Public: read ──────────────────────────────────────────────────────────────

export function loadState(): BotState {
  if (!_state) {
    // Sync fallback — should never happen if initStorage() was awaited at startup
    console.warn('[storage] loadState() before initStorage() — using file fallback');
    _state = fileLoad();
    if (!Array.isArray(_state.balanceLog)) _state.balanceLog = [];
  }
  return _state;
}

// ─── Public: write ─────────────────────────────────────────────────────────────

export function saveState(state?: BotState): void {
  if (state && state !== _state) _state = state;
  if (!_state) return;

  // 1. Always write to file (fast, synchronous backup)
  fileSave(_state);

  // 2. Async DB write — primary persistence; fire-and-forget is intentional so
  //    the hot path (tracker, scanner) isn't blocked on network I/O.
  if (_dbAvailable) {
    dbSave(_state).catch(err => console.error('[storage] DB save failed:', err));
  }
}

// ─── Utilities (unchanged from original) ──────────────────────────────────────

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

// ─── Deduplication + optional recalculation ────────────────────────────────────

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
 * 1. Remove duplicate completedSignals (same id processed more than once).
 * 2. Recalculate balance + counters from scratch — BUT ONLY when we have the
 *    full trade history in memory. If completedSignals is a partial window
 *    (e.g. after a manual state restore or a long-running deployment where old
 *    trades rolled off), the stored balance is preserved as-is to avoid
 *    incorrectly resetting it to a lower value.
 */
export function deduplicateAndRecalculate(state: BotState): DedupeReport {
  const before = {
    balance: state.paperBalance,
    tpHit:   state.totalTpHit,
    slHit:   state.totalSlHit,
    count:   state.test2TradeCount,
  };

  // ── Step 1: deduplicate by id ──────────────────────────────────────────────
  const seen = new Set<string>();
  const removed: DedupeReport['removed'] = [];

  state.completedSignals = state.completedSignals.filter(s => {
    if (seen.has(s.id)) {
      removed.push({
        id: s.id, symbol: s.symbol, direction: s.direction,
        status: s.status, resolvedAt: s.resolvedAt ?? 0,
      });
      return false;
    }
    seen.add(s.id);
    return true;
  });

  // ── Step 2: recalculate only when full history is present ─────────────────
  // "Full history" = every trade that has a riskAmt (i.e. was a Test-2 trade)
  // is still in completedSignals. If partial, we keep the stored balance.
  const tradesWithRisk = state.completedSignals.filter(s => s.riskAmt).length;
  const hasFullHistory  = tradesWithRisk >= state.test2TradeCount;

  if (hasFullHistory) {
    let balance = 100;
    let tpHit = 0, slHit = 0, tradeCount = 0;

    for (const s of state.completedSignals) {
      const pnl = s.finalPnlAmt ?? 0;
      if (s.riskAmt) {
        balance += pnl;
        tradeCount++;
        if (pnl >= 0) tpHit++; else slHit++;
      }
    }
    // Add partial TP already banked on still-open positions
    for (const s of state.activeSignals) {
      if (s.partialTpFired && s.partialTpPnlAmt) balance += s.partialTpPnlAmt;
    }

    balance = parseFloat(Math.max(0, balance).toFixed(4));
    state.paperBalance    = balance;
    state.totalTpHit      = tpHit;
    state.totalSlHit      = slHit;
    state.test2TradeCount = tradeCount;

    if (state.completedSignals.length >= 490) {
      console.warn('[storage] completedSignals near 500-entry cap — lifetime counters may undercount');
    }
  } else {
    // Partial history: only dedup was safe; keep stored balance + counters
    console.log(
      `[storage] Partial history (${tradesWithRisk} of ${state.test2TradeCount} trades in memory) ` +
      `— keeping stored balance $${state.paperBalance.toFixed(4)}`
    );
  }

  saveState(state);

  console.log(
    `[storage] Dedup complete — removed ${removed.length} duplicate(s). ` +
    `Balance: $${before.balance.toFixed(4)} → $${state.paperBalance.toFixed(4)} | ` +
    `Trades: ${before.count} → ${state.test2TradeCount}`
  );

  return {
    removedCount:      removed.length,
    removed,
    balanceBefore:     before.balance,
    balanceAfter:      state.paperBalance,
    totalTpHitBefore:  before.tpHit,
    totalTpHitAfter:   state.totalTpHit,
    totalSlHitBefore:  before.slHit,
    totalSlHitAfter:   state.totalSlHit,
    tradeCountBefore:  before.count,
    tradeCountAfter:   state.test2TradeCount,
  };
}

/**
 * Push the current paperBalance onto the running log.
 * Called every time the balance changes. Keeps last 100 entries.
 */
export function addToBalanceLog(state: BotState): void {
  const entry: BalanceLogEntry = {
    ts:      Date.now(),
    balance: parseFloat(state.paperBalance.toFixed(4)),
  };
  state.balanceLog.push(entry);
  if (state.balanceLog.length > 100) {
    state.balanceLog = state.balanceLog.slice(-100);
  }
}
