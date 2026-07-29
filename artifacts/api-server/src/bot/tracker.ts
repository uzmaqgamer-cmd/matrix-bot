import { getCurrentPrice, getAllCurrentPrices, getCachedPrices, getCloseSeries, getOpenInterestSeries, getFundingRateSeries } from './binance.js';
import { onTpSlHit, onPartialTp, onForceClose } from './trader.js';
import { classify } from './classifier.js';
import { lookupRow } from './matrix.js';
import { loadState, saveState, getOrCreateDailyStats, addToBalanceLog } from './storage.js';
import {
  formatTpHitMessage,
  formatSlHitMessage,
  formatPartialTpMessage,
  formatAutoCloseMessage,
} from './formatter.js';
import { logActivity } from './eventLog.js';
import { config } from './config.js';
import type { Telegram } from 'telegraf';
import type { Signal } from './types.js';

// ─── Rows that invalidate a thesis ───────────────────────────────────────────
/** Matrix rows that are bearish — invalidate a LONG trade. */
const BEARISH_ROWS = new Set([10, 16, 21]);
/** Matrix rows that are bullish — invalidate a SHORT trade. */
const BULLISH_ROWS = new Set([19]);

const CANDLE_INTERVAL = '15m';
const LOOKBACK_CANDLES = 20;
const FUNDING_LOOKBACK = 4;

let telegramRef: Telegram | null = null;
let adminChatId: string = '';
const CHANNEL_ID = process.env['TELEGRAM_CHANNEL_ID'] ?? '';

export function initTracker(telegram: Telegram, chatId: string) {
  telegramRef = telegram;
  adminChatId = chatId;
}

async function sendAlert(text: string, toChannel = false) {
  if (!telegramRef || !adminChatId) return;
  try {
    await telegramRef.sendMessage(adminChatId, text, { parse_mode: 'HTML' });
    if (toChannel && CHANNEL_ID) {
      await telegramRef.sendMessage(CHANNEL_ID, text, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('[tracker] sendAlert failed:', err);
  }
}

export async function sendDailySummary() {
  if (!telegramRef || !adminChatId) return;
  const state = loadState();
  const today = new Date().toISOString().slice(0, 10);
  const ds = state.dailyStats.find(d => d.date === today);
  const tp = ds?.tpHit ?? 0;
  const sl = ds?.slHit ?? 0;
  const total = tp + sl;
  const wr = total > 0 ? ((tp / total) * 100).toFixed(0) : '0';
  const text =
    `📊 <b>Daily Summary — ${today}</b>\n\n` +
    `✅ TP Hit: <b>${tp}</b>\n` +
    `❌ SL Hit: <b>${sl}</b>\n` +
    `📈 Win Rate: <b>${wr}%</b>\n` +
    `💰 Balance: <b>$${state.paperBalance.toFixed(2)}</b>`;
  try {
    await telegramRef.sendMessage(adminChatId, text, { parse_mode: 'HTML' });
    if (CHANNEL_ID) await telegramRef.sendMessage(CHANNEL_ID, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[tracker] sendDailySummary failed:', err);
  }
}

// ─── Balance helpers ──────────────────────────────────────────────────────────

/**
 * Apply a $ P&L change to the paper balance.
 * Returns the change amount (may be negative).
 */
function applyBalance(state: ReturnType<typeof loadState>, change: number): number {
  state.paperBalance = Math.max(0, parseFloat((state.paperBalance + change).toFixed(4)));
  addToBalanceLog(state);
  return change;
}

/**
 * Compute the balance change for closing (a fraction of) a position.
 * positionFraction: 1.0 = full position, 0.5 = half (after partial TP).
 * Uses signal.atr as the reference SL distance (always 1× ATR from entry).
 */
function computeCloseAmt(signal: Signal, exitPrice: number, positionFraction: number): number {
  if (!signal.riskAmt) return 0;
  const priceMoved = signal.direction === 'LONG'
    ? exitPrice - signal.entry
    : signal.entry - exitPrice;
  return positionFraction * (priceMoved / signal.atr) * signal.riskAmt;
}

// ─── Main price-check loop ────────────────────────────────────────────────────

/**
 * Run `factory(abortSignal)` with a hard timeout.
 * When the timeout fires the AbortSignal is triggered, which actually cancels
 * the underlying fetch() — preventing connection-leak buildup on slow symbols.
 */
function withTimeout<T>(factory: (sig: AbortSignal) => Promise<T>, ms: number, label: string): Promise<T> {
  const ctrl = new AbortController();
  return Promise.race([
    factory(ctrl.signal),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        ctrl.abort();
        reject(new Error(`[tracker] ${label} timed out after ${ms}ms`));
      }, ms)
    ),
  ]);
}

/** How long a signal can go without a successful price update before being force-closed. */
const STALE_SIGNAL_MS = 30 * 60 * 1000; // 30 minutes

export async function checkActiveSignals() {
  const state = loadState();
  if (state.activeSignals.length === 0) return;

  // ONE bulk request for all perp prices — avoids N concurrent calls that
  // trigger Binance rate-limits / connection timeouts on low-liquidity symbols.
  let priceMap: Map<string, number> | null = null;
  try {
    priceMap = await withTimeout(sig => getAllCurrentPrices(sig), 15_000, 'getAllCurrentPrices');
  } catch (err) {
    // Fall back to cached prices (≤2 min stale) so signals keep being monitored
    const cached = getCachedPrices(2 * 60 * 1000);
    if (cached) {
      console.warn('[tracker] Bulk price fetch failed — using cached prices (<2 min stale):', (err as Error).message);
      priceMap = cached;
    } else {
      console.warn('[tracker] Bulk price fetch failed — skipping cycle (cache too stale or empty):', (err as Error).message);
      return;
    }
  }

  const toRemove: string[] = [];
  let stateChanged = false;

  for (let idx = 0; idx < state.activeSignals.length; idx++) {
    const signal = state.activeSignals[idx];
    const price = priceMap.get(signal.symbol);
    try {
      if (price == null) throw new Error(`[tracker] ${signal.symbol} not found in bulk price response`);
      signal.currentPrice = price;
      signal.currentPriceAt = Date.now();
      signal.fetchFailCount = 0; // reset consecutive failure counter on success
      stateChanged = true;

      // ── Partial TP: fires once when price reaches 50% of the way to TP ──────
      if (
        !signal.partialTpFired &&
        signal.riskAmt != null &&
        signal.riskAmt > 0
      ) {
        const tpDist = signal.direction === 'LONG'
          ? signal.tp - signal.entry
          : signal.entry - signal.tp;
        const currentDist = signal.direction === 'LONG'
          ? price - signal.entry
          : signal.entry - price;
        const pctToTp = tpDist > 0 ? (currentDist / tpDist) * 100 : 0;

        if (pctToTp >= config.positionMonitoring.breakevenTriggerPct) {
          // Close 50% of the position at current price
          const partialChange = computeCloseAmt(signal, price, 0.5);

          signal.partialTpFired = true;
          signal.partialTpAt = Date.now();
          signal.partialTpPrice = price;
          signal.partialTpPnlAmt = partialChange;
          signal.breakevenMoved = true;
          signal.sl = signal.entry; // move SL to breakeven
          // Activate ATR trailing stop — starts at breakeven and only moves favourably
          signal.trailActive = true;
          signal.trailStop = signal.entry;

          applyBalance(state, partialChange);

          await sendAlert(formatPartialTpMessage(signal, price, partialChange), true);
          logActivity({
            ts: Date.now(),
            text: `[PARTIAL-TP] ${signal.symbol} ${signal.direction} | 50% closed at ${price.toPrecision(6)} | +$${partialChange.toFixed(4)} banked | SL moved to breakeven (${signal.entry.toPrecision(6)})`,
            kind: 'partial_tp',
            symbol: signal.symbol,
          });
          console.log(`[tracker] [PARTIAL-TP] ${signal.symbol}, 50% closed at $${price.toPrecision(6)}, SL moved to breakeven. P&L: +$${partialChange.toFixed(4)}`);
          // Live: close 50%, cancel old TP/SL, re-place for remaining half
          await onPartialTp(signal);
        }
      }

      // ── ATR trailing stop update (every tick while trail is active) ─────────
      // Trail can only move in the profitable direction; never retreats past entry.
      if (signal.partialTpFired && signal.trailActive && signal.trailStop != null) {
        const rawTrail = signal.direction === 'LONG'
          ? price - 2 * signal.atr
          : price + 2 * signal.atr;
        if (signal.direction === 'LONG') {
          signal.trailStop = Math.max(signal.trailStop, Math.max(rawTrail, signal.entry));
        } else {
          signal.trailStop = Math.min(signal.trailStop, Math.min(rawTrail, signal.entry));
        }
        stateChanged = true;
      }

      // ── TP / SL hit check ─────────────────────────────────────────────────
      let hit: 'tp' | 'sl' | null = null;
      if (signal.partialTpFired && signal.trailActive && signal.trailStop != null) {
        // After partial TP: trailing stop replaces the fixed TP target.
        // Trail exit is counted as 'tp' when above entry (profitable), 'sl' at breakeven.
        if (signal.direction === 'LONG') {
          if (price <= signal.trailStop)
            hit = signal.trailStop > signal.entry ? 'tp' : 'sl';
          // Safety: gap-down past original SL
          else if (price <= signal.sl) hit = 'sl';
        } else {
          if (price >= signal.trailStop)
            hit = signal.trailStop < signal.entry ? 'tp' : 'sl';
          // Safety: gap-up past original SL
          else if (price >= signal.sl) hit = 'sl';
        }
      } else {
        if (signal.direction === 'LONG') {
          if (price >= signal.tp) hit = 'tp';
          else if (price <= signal.sl) hit = 'sl'; // sl may now be at entry (breakeven)
        } else {
          if (price <= signal.tp) hit = 'tp';
          else if (price >= signal.sl) hit = 'sl';
        }
      }

      if (hit) {
        toRemove.push(signal.id);
        signal.status = hit === 'tp' ? 'tp_hit' : 'sl_hit';
        signal.resolvedAt = Date.now();
        // MARKET close for remaining position (tracker-managed — no standing orders)
        await onTpSlHit(signal, hit);

        let finalCloseAmt = 0;
        if (signal.riskAmt != null && signal.riskAmt > 0) {
          if (hit === 'tp') {
            const fraction = signal.partialTpFired ? 0.5 : 1.0;
            if (signal.trailActive) {
              // Trail exit: actual price movement, not a fixed R multiple
              finalCloseAmt = computeCloseAmt(signal, price, fraction);
            } else {
              finalCloseAmt = fraction * signal.rr * signal.riskAmt;
            }
          } else {
            // SL hit
            if (signal.breakevenMoved) {
              // Trail or plain breakeven — compute from actual exit price
              finalCloseAmt = signal.trailActive
                ? computeCloseAmt(signal, price, 0.5)
                : 0;
            } else {
              finalCloseAmt = -signal.riskAmt; // full loss
            }
          }
          applyBalance(state, finalCloseAmt);
          state.test2TradeCount++;
        }

        signal.finalPnlAmt = parseFloat(
          ((signal.partialTpPnlAmt ?? 0) + finalCloseAmt).toFixed(4)
        );

        // Update lifetime stats
        if (hit === 'tp') {
          state.totalTpHit++;
          getOrCreateDailyStats(state).tpHit++;
          await sendAlert(formatTpHitMessage(signal, price), true);
          const pnl = ((price - signal.entry) / signal.entry * 100);
          const pnlStr = signal.direction === 'LONG'
            ? ((price - signal.entry) / signal.entry * 100).toFixed(2)
            : ((signal.entry - price) / signal.entry * 100).toFixed(2);
          const balAmt = signal.finalPnlAmt != null ? ` | $${signal.finalPnlAmt >= 0 ? '+' : ''}${signal.finalPnlAmt.toFixed(4)}` : '';
          logActivity({
            ts: Date.now(),
            text: `TP HIT: ${signal.symbol} ${signal.direction} +${pnlStr}%${balAmt} @ ${price.toPrecision(6)} (R/R 1:${signal.rr.toFixed(1)})`,
            kind: 'tp',
            symbol: signal.symbol,
          });
          void pnl; // suppress unused warning
        } else {
          state.totalSlHit++;
          getOrCreateDailyStats(state).slHit++;
          await sendAlert(formatSlHitMessage(signal, price), true);
          const label = signal.breakevenMoved ? 'BREAKEVEN' : 'SL HIT';
          const lossStr = signal.direction === 'LONG'
            ? ((signal.entry - price) / signal.entry * 100).toFixed(2)
            : ((price - signal.entry) / signal.entry * 100).toFixed(2);
          const balAmt = signal.finalPnlAmt != null ? ` | $${signal.finalPnlAmt.toFixed(4)}` : '';
          logActivity({
            ts: Date.now(),
            text: `${label}: ${signal.symbol} ${signal.direction} ${signal.breakevenMoved ? '±0%' : `-${lossStr}%`}${balAmt} @ ${price.toPrecision(6)}`,
            kind: 'sl',
            symbol: signal.symbol,
          });
        }

        state.completedSignals.push({ ...signal });
        if (state.completedSignals.length > 500) {
          state.completedSignals = state.completedSignals.slice(-500);
        }

        console.log(`[tracker] ${signal.symbol} ${hit.toUpperCase()} hit @ ${price} | finalPnl: $${signal.finalPnlAmt?.toFixed(4)} | balance: $${state.paperBalance.toFixed(4)}`);
        stateChanged = true;
      }
    } catch (err) {
      signal.fetchFailCount = (signal.fetchFailCount ?? 0) + 1;
      console.warn(`[tracker] Error checking ${signal.symbol} (fail #${signal.fetchFailCount}):`, err);

      // Only force-close after 30 minutes with no successful price update.
      // This tolerates brief Binance outages / rate-limit bursts without nuking positions.
      const lastSeenMs = signal.currentPriceAt ?? signal.createdAt;
      if (Date.now() - lastSeenMs > STALE_SIGNAL_MS) {
        const exitPrice = signal.currentPrice ?? signal.entry;
        let closeAmt = 0;
        const positionFraction = signal.partialTpFired ? 0.5 : 1.0;
        if (signal.riskAmt) {
          closeAmt = computeCloseAmt(signal, exitPrice, positionFraction);
          applyBalance(state, closeAmt);
          state.test2TradeCount++;
        }
        signal.status = 'auto_closed';
        signal.resolvedAt = Date.now();
        signal.autoClosedAt = Date.now();
        signal.autoCloseReason = 'price_data_unavailable';
        signal.autoClosePrice = exitPrice;
        signal.finalPnlAmt = parseFloat(((signal.partialTpPnlAmt ?? 0) + closeAmt).toFixed(4));
        // Live: cancel TP/SL orders and market-close the position
        await onForceClose(signal);

        const acIsWin = (signal.finalPnlAmt ?? 0) >= 0;
        if (acIsWin) { state.totalTpHit++; getOrCreateDailyStats(state).tpHit++; }
        else          { state.totalSlHit++; getOrCreateDailyStats(state).slHit++; }

        toRemove.push(signal.id);
        state.completedSignals.push({ ...signal });
        if (state.completedSignals.length > 500) state.completedSignals = state.completedSignals.slice(-500);

        const pnlStr = `${signal.finalPnlAmt >= 0 ? '+' : ''}$${signal.finalPnlAmt.toFixed(4)}`;
        await sendAlert(`⚠️ FORCE-CLOSED: ${signal.symbol} ${signal.direction}\nReason: no price data for 30+ minutes\nExit: last known ${exitPrice.toPrecision(6)} | P&L: ${pnlStr}`, true);
        logActivity({ ts: Date.now(), text: `[FORCE-CLOSE] ${signal.symbol} — no price data for 30+ min | P&L: ${pnlStr}`, kind: 'auto_close', symbol: signal.symbol });
        console.log(`[tracker] [ZOMBIE-CLOSE] ${signal.symbol} — 30min without price data | P&L: ${pnlStr}`);
        stateChanged = true;
      }
    }
  }

  if (toRemove.length > 0) {
    state.activeSignals = state.activeSignals.filter(s => !toRemove.includes(s.id));
  }

  if (stateChanged) {
    saveState(state);
  }
}

// ─── Thesis invalidation monitor ─────────────────────────────────────────────

export async function monitorPositionTheses() {
  const state = loadState();
  if (state.activeSignals.length === 0) return;

  // Fetch all signals' OI/price/funding data concurrently with a 10s timeout.
  const seriesResults = await Promise.allSettled(
    state.activeSignals.map(s =>
      withTimeout(
        sig => Promise.all([
          getCloseSeries(s.symbol, CANDLE_INTERVAL, LOOKBACK_CANDLES, sig),
          getOpenInterestSeries(s.symbol, CANDLE_INTERVAL, LOOKBACK_CANDLES, sig),
          getFundingRateSeries(s.symbol, FUNDING_LOOKBACK + 1, sig),
        ]),
        10_000,
        `thesis series(${s.symbol})`
      )
    )
  );

  const toRemove: string[] = [];
  let stateChanged = false;

  for (let idx = 0; idx < state.activeSignals.length; idx++) {
    const signal = state.activeSignals[idx];
    const seriesResult = seriesResults[idx];
    try {
      if (seriesResult.status === 'rejected') throw seriesResult.reason;
      const [priceSeries, oiSeries, fundingSeries] = seriesResult.value;

      if (priceSeries.length < 2 || oiSeries.length < 2 || fundingSeries.length < 2) continue;

      const { oi, price: priceDir, funding } = classify({ priceSeries, oiSeries, fundingSeries });
      const matrixRow = lookupRow(oi, priceDir, funding);

      signal.currentMatrixRow = matrixRow.row;
      stateChanged = true;

      const isBearish = matrixRow.outlook === 'DUMP' || BEARISH_ROWS.has(matrixRow.row);
      const isBullish = matrixRow.outlook === 'PUMP' || BULLISH_ROWS.has(matrixRow.row);

      const isInvalidated =
        (signal.direction === 'LONG' && isBearish) ||
        (signal.direction === 'SHORT' && isBullish);

      if (!isInvalidated) continue;

      // ── Auto-close ──────────────────────────────────────────────────────────
      // Use current price (cached from checkActiveSignals, or fetch fresh).
      let exitPrice = signal.currentPrice ?? 0;
      if (exitPrice === 0) {
        try { exitPrice = await getCurrentPrice(signal.symbol); } catch { /* ignore */ }
      }

      const prevRow = signal.matrixRow;

      const positionFraction = signal.partialTpFired ? 0.5 : 1.0;
      const closeAmt = signal.riskAmt ? computeCloseAmt(signal, exitPrice, positionFraction) : 0;

      signal.status = 'auto_closed';
      signal.resolvedAt = Date.now();
      signal.autoClosedAt = Date.now();
      signal.autoCloseReason = 'thesis_invalidated';
      signal.autoClosePrice = exitPrice;
      signal.finalPnlAmt = parseFloat(
        ((signal.partialTpPnlAmt ?? 0) + closeAmt).toFixed(4)
      );
      // Live: cancel TP/SL orders and market-close the position
      await onForceClose(signal);

      if (signal.riskAmt) {
        applyBalance(state, closeAmt);
        state.test2TradeCount++;
      }

      // Count auto-closes toward the same TP/SL totals used by the center stats
      const acIsWin = (signal.finalPnlAmt ?? 0) >= 0;
      if (acIsWin) {
        state.totalTpHit++;
        getOrCreateDailyStats(state).tpHit++;
      } else {
        state.totalSlHit++;
        getOrCreateDailyStats(state).slHit++;
      }

      toRemove.push(signal.id);
      state.completedSignals.push({ ...signal });
      if (state.completedSignals.length > 500) {
        state.completedSignals = state.completedSignals.slice(-500);
      }

      // ── Reversal injection ────────────────────────────────────────────────
      // The matrix just flipped to the opposite outlook. Inject the symbol
      // into the watchlist using its original divergence row as the stored
      // entry. The next 1-min watchlist scan will fetch the current (PUMP/DUMP)
      // row, hit the ESCALATED branch, and fire a reversal signal automatically.
      const reversalDirection = signal.direction === 'LONG' ? 'SHORT' : 'LONG';
      state.watchlist[signal.symbol] = {
        row: signal.matrixRow,   // original divergence row (used as originRow in the escalation)
        priority: 'HIGH',        // was already a real signal — treat as top priority
        addedAt: Date.now(),
        cyclesWatched: 0,
      };
      logActivity({
        ts: Date.now(),
        text: `REVERSAL QUEUED: ${signal.symbol} → ${reversalDirection} (will fire on next watchlist scan)`,
        kind: 'watch',
        symbol: signal.symbol,
      });
      console.log(`[tracker] Reversal queued: ${signal.symbol} ${reversalDirection} — injected into watchlist`);

      await sendAlert(formatAutoCloseMessage(signal, exitPrice, prevRow, matrixRow.row), true);

      const pnlPct = exitPrice > 0 && signal.entry > 0
        ? (signal.direction === 'LONG'
            ? (exitPrice - signal.entry) / signal.entry * 100
            : (signal.entry - exitPrice) / signal.entry * 100
          )
        : 0;

      const pnlStr = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` +
        (signal.finalPnlAmt != null ? ` ($${signal.finalPnlAmt >= 0 ? '+' : ''}${signal.finalPnlAmt.toFixed(4)})` : '');

      logActivity({
        ts: Date.now(),
        text: `[AUTO-CLOSE] ${signal.symbol} ${signal.direction} | thesis invalidated | Row #${prevRow} → #${matrixRow.row} | P&L: ${pnlStr}`,
        kind: 'auto_close',
        symbol: signal.symbol,
      });

      console.log(`[tracker] [AUTO-CLOSE] ${signal.symbol}, reason: thesis invalidated, row #${prevRow} -> #${matrixRow.row}, P&L: ${pnlStr}`);
    } catch (err) {
      console.warn(`[tracker] Thesis check failed for ${signal.symbol}:`, err);
    }
  }

  if (toRemove.length > 0) {
    state.activeSignals = state.activeSignals.filter(s => !toRemove.includes(s.id));
    stateChanged = true;
  }

  if (stateChanged) {
    saveState(state);
  }
}
