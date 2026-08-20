import { getOhlcSeries, calcATR, getCurrentPrice } from './bitunix.js';
import { config } from './config.js';
import type { Signal, SignalDirection, TpTier } from './types.js';

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
  if (originPriority === 'HIGH' || HIGH_DIVERGENCE_ORIGIN_ROWS.has(originRow)) {
    return {
      multiplier: 3.5,
      tier: 'HIGH_DIVERGENCE',
      tierLabel: `3.5× ATR — HIGH priority divergence origin (Row #${originRow})`,
    };
  }
  if (CLEAN_ORIGIN_ROWS.has(originRow) || originRow === 0) {
    return {
      multiplier: 2.0,
      tier: 'CLEAN',
      tierLabel: '2× ATR — clean resolved row (no divergence origin)',
    };
  }
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

    // ── ATR minimum gate ─────────────────────────────────────────────────────
    // Signals with stops so tight that normal volatility triggers them are useless.
    const atrPct = (atr / entry) * 100;
    if (atrPct < config.minAtrPercentOfPrice || atrPct > config.maxAtrPercentOfPrice) {
      console.log(
        `[SKIP] ${params.symbol} → ATR ${atrPct.toFixed(2)}% outside ${config.minAtrPercentOfPrice}%–${config.maxAtrPercentOfPrice}% Bitunix pilot range`
      );
      return null;
    }

    // ── Conviction-scaled TP multiplier ──────────────────────────────────────
    const { multiplier, tier, tierLabel } = getConvictionTier(
      params.originRow,
      params.originPriority
    );

    let tp: number;
    let sl: number;

    if (params.direction === 'LONG') {
      tp = entry + atr * multiplier;
      sl = entry - atr;
    } else {
      tp = entry - atr * multiplier;
      sl = entry + atr;
    }

    const rr = multiplier; // SL is always 1× so R/R = multiplier

    console.log(
      `[signalBuilder] ${params.symbol} ${params.direction} | ATR=${atrPct.toFixed(2)}% | tier=${tier} | TP=${multiplier}× | R/R=1:${rr}`
    );

    return {
      id: genId(),
      symbol: params.symbol,
      direction: params.direction,
      marketVenue: 'BITUNIX',
      oiSource: 'BYBIT_PUBLIC',
      entry,
      tp: parseFloat(tp.toPrecision(6)),
      sl: parseFloat(sl.toPrecision(6)),
      originalSl: parseFloat(sl.toPrecision(6)),
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
