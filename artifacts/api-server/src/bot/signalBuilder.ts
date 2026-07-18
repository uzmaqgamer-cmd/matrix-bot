import { getOhlcSeries, calcATR, getCurrentPrice } from './binance.js';
import type { Signal, SignalDirection, TpTier } from './types.js';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Minimum ATR/price ratio. Signals with tighter ATR are suppressed entirely. */
const MIN_ATR_RATIO = 0.005; // 0.5% of entry price

/** Matrix rows that are pure trend rows — no divergence buildup in origin. */
const CLEAN_ORIGIN_ROWS = new Set([1, 2, 4, 7, 11, 14, 17, 18]);

/** HIGH-conviction divergence origin rows — compression before expansion. */
const HIGH_DIVERGENCE_ORIGIN_ROWS = new Set([10, 16, 19, 21]);

// ─── Conviction tier lookup ───────────────────────────────────────────────────

function getConvictionTier(originRow: number, originPriority: 'HIGH' | 'MEDIUM'): {
  multiplier: number;
  tier: TpTier;
  tierLabel: string;
} {
  // HIGH-priority divergence origin (compression → explosion setups)
  if (originPriority === 'HIGH' || HIGH_DIVERGENCE_ORIGIN_ROWS.has(originRow)) {
    return {
      multiplier: 3.5,
      tier: 'HIGH_DIVERGENCE',
      tierLabel: `3.5× ATR — HIGH priority divergence origin (Row #${originRow})`,
    };
  }

  // Clean signal: origin was itself a pure trend row (not BIG_COMING)
  if (CLEAN_ORIGIN_ROWS.has(originRow) || originRow === 0) {
    return {
      multiplier: 2.0,
      tier: 'CLEAN',
      tierLabel: '2× ATR — clean resolved row (no divergence origin)',
    };
  }

  // MEDIUM-priority divergence origin
  return {
    multiplier: 2.5,
    tier: 'MEDIUM_DIVERGENCE',
    tierLabel: `2.5× ATR — MEDIUM priority divergence origin (Row #${originRow})`,
  };
}

// ─── Builder ──────────────────────────────────────────────────────────────────

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function buildSignal(params: {
  symbol: string;
  direction: SignalDirection;
  matrixRow: number;
  matrixMeaning: string;
  originRow: number;
  originPriority: 'HIGH' | 'MEDIUM';
}): Promise<Signal | null> {
  try {
    const [ohlc, entry] = await Promise.all([
      getOhlcSeries(params.symbol, '15m', 15),
      getCurrentPrice(params.symbol),
    ]);

    const atr = calcATR(ohlc);
    if (atr === 0 || entry === 0) return null;

    // ── Minimum ATR gate ─────────────────────────────────────────────────────
    // Suppress signals where the ATR is too tight relative to price.
    // These setups have TP/SL so close to entry they're not worth tracking.
    const atrRatio = atr / entry;
    if (atrRatio < MIN_ATR_RATIO) {
      console.log(
        `[signalBuilder] ${params.symbol} suppressed — ATR ratio ${(atrRatio * 100).toFixed(3)}% < ${MIN_ATR_RATIO * 100}% minimum`
      );
      return null;
    }

    // ── Conviction-scaled TP multiplier ──────────────────────────────────────
    const { multiplier, tier, tierLabel } = getConvictionTier(
      params.originRow,
      params.originPriority
    );

    // SL stays at 1× ATR in all cases
    let tp: number;
    let sl: number;

    if (params.direction === 'LONG') {
      tp = entry + atr * multiplier;
      sl = entry - atr * 1;
    } else {
      tp = entry - atr * multiplier;
      sl = entry + atr * 1;
    }

    const rr = multiplier; // SL is always 1× so R/R = multiplier

    console.log(
      `[signalBuilder] ${params.symbol} ${params.direction} | ATR=${(atrRatio * 100).toFixed(3)}% | tier=${tier} | TP=${multiplier}× | R/R=1:${rr}`
    );

    return {
      id: genId(),
      symbol: params.symbol,
      direction: params.direction,
      entry,
      tp: parseFloat(tp.toPrecision(6)),
      sl: parseFloat(sl.toPrecision(6)),
      rr,
      atr: parseFloat(atr.toPrecision(4)),
      tpMultiplier: multiplier,
      tpTier: tier,
      matrixRow: params.matrixRow,
      matrixMeaning: params.matrixMeaning,
      originRow: params.originRow,
      originPriority: params.originPriority,
      status: 'pending',
      createdAt: Date.now(),
    };
  } catch (err) {
    console.error(`[signalBuilder] Failed for ${params.symbol}:`, err);
    return null;
  }
}
