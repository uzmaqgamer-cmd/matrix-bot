import { getOhlcSeries, calcATR, getCurrentPrice } from './binance.js';
import type { Signal, SignalDirection } from './types.js';

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

    // Use 2:1 risk/reward with ATR-based levels
    // Minimum ATR = 0.3% of price to avoid tiny levels
    const minATR = entry * 0.003;
    const effectiveATR = Math.max(atr, minATR);

    let tp: number;
    let sl: number;

    if (params.direction === 'LONG') {
      tp = entry + effectiveATR * 2;
      sl = entry - effectiveATR * 1;
    } else {
      tp = entry - effectiveATR * 2;
      sl = entry + effectiveATR * 1;
    }

    const rr = 2.0;

    return {
      id: genId(),
      symbol: params.symbol,
      direction: params.direction,
      entry,
      tp: parseFloat(tp.toPrecision(6)),
      sl: parseFloat(sl.toPrecision(6)),
      rr,
      atr: parseFloat(effectiveATR.toPrecision(4)),
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
