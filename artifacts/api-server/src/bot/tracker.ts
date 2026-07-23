import { getCurrentPrice, getCloseSeries, getOpenInterestSeries, getFundingRateSeries } from './binance.js';
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

export function initTracker(telegram: Telegram, chatId: string) {
  telegramRef = telegram;
  adminChatId = chatId;
}

async function sendAlert(text: string) {
  if (!telegramRef || !adminChatId) return;
  try {
    await telegramRef.sendMessage(adminChatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[tracker] sendAlert failed:', err);
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

/** Reject a promise after `ms` milliseconds — prevents a single slow Binance
 *  call from holding up the entire tracker run. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[tracker] ${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function checkActiveSignals() {
  const state = loadState();
  if (state.activeSignals.length === 0) return;

  // Fetch ALL prices concurrently with a 10s timeout per call.
  // Old sequential loop: N × latency (e.g. 10 signals × 30s slow Binance = 300s).
  // Now: max(single latency) capped at 10s → worst case ~10s total.
  const priceResults = await Promise.allSettled(
    state.activeSignals.map(s =>
      withTimeout(getCurrentPrice(s.symbol), 10_000, `getCurrentPrice(${s.symbol})`)
    )
  );

  const toRemove: string[] = [];
  let stateChanged = false;

  for (let idx = 0; idx < state.activeSignals.length; idx++) {
    const signal = state.activeSignals[idx];
    const priceResult = priceResults[idx];
    try {
      if (priceResult.status === 'rejected') throw priceResult.reason;
      const price = priceResult.value;
      signal.currentPrice = price;
      signal.currentPriceAt = Date.now();
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

          applyBalance(state, partialChange);

          await sendAlert(formatPartialTpMessage(signal, price, partialChange));
          logActivity({
            ts: Date.now(),
            text: `[PARTIAL-TP] ${signal.symbol} ${signal.direction} | 50% closed at ${price.toPrecision(6)} | +$${partialChange.toFixed(4)} banked | SL moved to breakeven (${signal.entry.toPrecision(6)})`,
            kind: 'partial_tp',
            symbol: signal.symbol,
          });
          console.log(`[tracker] [PARTIAL-TP] ${signal.symbol}, 50% closed at $${price.toPrecision(6)}, SL moved to breakeven. P&L: +$${partialChange.toFixed(4)}`);
        }
      }

      // ── TP / SL hit check ─────────────────────────────────────────────────
      let hit: 'tp' | 'sl' | null = null;
      if (signal.direction === 'LONG') {
        if (price >= signal.tp) hit = 'tp';
        else if (price <= signal.sl) hit = 'sl'; // sl may now be at entry (breakeven)
      } else {
        if (price <= signal.tp) hit = 'tp';
        else if (price >= signal.sl) hit = 'sl';
      }

      if (hit) {
        toRemove.push(signal.id);
        signal.status = hit === 'tp' ? 'tp_hit' : 'sl_hit';
        signal.resolvedAt = Date.now();

        let finalCloseAmt = 0;
        if (signal.riskAmt != null && signal.riskAmt > 0) {
          if (hit === 'tp') {
            // Remaining 50% (or full if no partial TP) hits the target
            const fraction = signal.partialTpFired ? 0.5 : 1.0;
            finalCloseAmt = fraction * signal.rr * signal.riskAmt;
          } else {
            // SL hit
            if (signal.breakevenMoved) {
              finalCloseAmt = 0; // SL is at entry — breakeven, no additional loss
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
          await sendAlert(formatTpHitMessage(signal, price));
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
          await sendAlert(formatSlHitMessage(signal, price));
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
      console.warn(`[tracker] Error checking ${signal.symbol}:`, err);
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
        Promise.all([
          getCloseSeries(s.symbol, CANDLE_INTERVAL, LOOKBACK_CANDLES),
          getOpenInterestSeries(s.symbol, CANDLE_INTERVAL, LOOKBACK_CANDLES),
          getFundingRateSeries(s.symbol, FUNDING_LOOKBACK + 1),
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

      await sendAlert(formatAutoCloseMessage(signal, exitPrice, prevRow, matrixRow.row));

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
