/**
 * Binance USDT-M Futures live trading module.
 *
 * All execution is gated behind LIVE_TRADING=true so paper trading remains
 * the default until explicitly enabled on the VPS.
 *
 * Required env vars (set in /opt/matrix-bot/.env on the VPS):
 *   BINANCE_API_KEY    — Futures read+trade API key
 *   BINANCE_API_SECRET — Matching secret
 *   LIVE_TRADING       — Must be exactly "true" to place real orders
 *   TRADE_RISK_PCT     — % of free USDT balance to risk per trade (default 2)
 *   TRADE_LEVERAGE     — Cross-margin leverage to set per symbol (default 10)
 */

import crypto from 'crypto';
import type { Signal } from './types.js';

const FAPI      = 'https://fapi.binance.com';
const RISK_PCT  = parseFloat(process.env['TRADE_RISK_PCT']  ?? '2')  / 100; // e.g. 0.02
const LEVERAGE  = parseInt (process.env['TRADE_LEVERAGE']   ?? '10', 10);

// ─── Guard ────────────────────────────────────────────────────────────────────

export function isLiveTradingEnabled(): boolean {
  return (
    process.env['LIVE_TRADING']         === 'true' &&
    !!process.env['BINANCE_API_KEY']               &&
    !!process.env['BINANCE_API_SECRET']
  );
}

// ─── Authenticated REST helper ────────────────────────────────────────────────

function buildQs(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

function sign(qs: string): string {
  return crypto
    .createHmac('sha256', process.env['BINANCE_API_SECRET']!)
    .update(qs)
    .digest('hex');
}

async function fapi(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, string | number> = {},
): Promise<any> {
  const qs  = buildQs({ ...params, timestamp: Date.now() });
  const sig = sign(qs);
  const key = process.env['BINANCE_API_KEY']!;

  let url: string;
  let init: RequestInit;

  if (method === 'GET' || method === 'DELETE') {
    url  = `${FAPI}${path}?${qs}&signature=${sig}`;
    init = { method, headers: { 'X-MBX-APIKEY': key } };
  } else {
    url  = `${FAPI}${path}`;
    init = {
      method,
      headers: {
        'X-MBX-APIKEY': key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `${qs}&signature=${sig}`,
    };
  }

  const res  = await fetch(url, init);
  const data = await res.json() as any;
  if (!res.ok) throw new Error(`Binance ${method} ${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ─── Exchange info cache (LOT_SIZE + PRICE_FILTER per symbol) ─────────────────
// Refreshed once per hour — avoids hitting exchangeInfo on every trade.

interface SymbolMeta { stepSize: number; tickSize: number; minNotional: number }
const _metaCache    = new Map<string, SymbolMeta>();
let   _metaFetchedAt = 0;

async function getSymbolMeta(symbol: string): Promise<SymbolMeta> {
  const STALE = 60 * 60_000; // 1 hour
  if (_metaCache.has(symbol) && Date.now() - _metaFetchedAt < STALE) {
    return _metaCache.get(symbol)!;
  }
  const res  = await fetch(`${FAPI}/fapi/v1/exchangeInfo`);
  const data = await res.json() as any;
  _metaFetchedAt = Date.now();
  for (const sym of data.symbols as any[]) {
    const lot   = sym.filters.find((f: any) => f.filterType === 'LOT_SIZE');
    const price = sym.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
    const notio = sym.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');
    if (lot && price) {
      _metaCache.set(sym.symbol, {
        stepSize:    parseFloat(lot.stepSize),
        tickSize:    parseFloat(price.tickSize),
        minNotional: parseFloat(notio?.notional ?? '5'),
      });
    }
  }
  return _metaCache.get(symbol) ?? { stepSize: 0.001, tickSize: 0.01, minNotional: 5 };
}

function roundStep(value: number, step: number): number {
  if (step <= 0) return value;
  const p = Math.max(0, Math.round(-Math.log10(step)));
  return parseFloat((Math.floor(value / step) * step).toFixed(p));
}

function roundTick(value: number, tick: number): number {
  if (tick <= 0) return value;
  const p = Math.max(0, Math.round(-Math.log10(tick)));
  return parseFloat((Math.round(value / tick) * tick).toFixed(p));
}

// ─── Account ─────────────────────────────────────────────────────────────────

export async function getUsdtBalance(): Promise<number> {
  const balances = await fapi('GET', '/fapi/v2/balance') as any[];
  const usdt = balances.find(b => b.asset === 'USDT');
  return parseFloat(usdt?.availableBalance ?? '0');
}

// ─── Order helpers ────────────────────────────────────────────────────────────

async function placeMarket(
  symbol: string, side: 'BUY' | 'SELL', quantity: number,
): Promise<{ orderId: number; avgPrice: number }> {
  const res = await fapi('POST', '/fapi/v1/order', {
    symbol, side, type: 'MARKET', quantity: String(quantity),
  });
  return { orderId: res.orderId, avgPrice: parseFloat(res.avgPrice ?? '0') };
}

async function placeTpOrder(
  symbol: string, side: 'BUY' | 'SELL', quantity: number, stopPrice: number, tick: number,
): Promise<number> {
  const res = await fapi('POST', '/fapi/v1/order', {
    symbol, side,
    type:        'TAKE_PROFIT_MARKET',
    quantity:    String(quantity),
    stopPrice:   String(roundTick(stopPrice, tick)),
    reduceOnly:  'true',
    timeInForce: 'GTE_GTC',
  });
  return res.orderId;
}

async function placeSlOrder(
  symbol: string, side: 'BUY' | 'SELL', quantity: number, stopPrice: number, tick: number,
): Promise<number> {
  const res = await fapi('POST', '/fapi/v1/order', {
    symbol, side,
    type:        'STOP_MARKET',
    quantity:    String(quantity),
    stopPrice:   String(roundTick(stopPrice, tick)),
    reduceOnly:  'true',
    timeInForce: 'GTE_GTC',
  });
  return res.orderId;
}

async function cancelOrder(symbol: string, orderId: string | number): Promise<void> {
  try {
    await fapi('DELETE', '/fapi/v1/order', { symbol, orderId: Number(orderId) });
  } catch (err: any) {
    // Already filled or cancelled — safe to ignore
    console.warn(`[trader] Cancel ${symbol} #${orderId}: ${err.message}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OpenTradeResult {
  ok: true;
  orderId:    string;
  tpOrderId:  string;
  slOrderId:  string;
  quantity:   number;
  fillPrice:  number;
  riskDollar: number;
}
export interface OpenTradeError  { ok: false; error: string }
export type OpenTradeOutcome = OpenTradeResult | OpenTradeError;

/**
 * Opens a live Binance Futures position for the given signal.
 *
 * Sizing: quantity = (freeBalance × RISK_PCT) / |entry − sl|
 * After entry fills, places TP (TAKE_PROFIT_MARKET) and SL (STOP_MARKET)
 * with reduceOnly=true so they can only reduce the position.
 *
 * Caller is responsible for stamping liveEnabled/liveQty/liveOrderId/etc.
 * onto the signal and calling saveState().
 */
export async function openTrade(signal: Signal): Promise<OpenTradeOutcome> {
  if (!isLiveTradingEnabled()) return { ok: false, error: 'LIVE_TRADING not enabled' };

  try {
    const meta    = await getSymbolMeta(signal.symbol);
    const balance = await getUsdtBalance();

    // Position sizing — risk a fixed % of balance
    const riskDollar = balance * RISK_PCT;
    const slDist     = Math.abs(signal.entry - signal.sl);
    if (slDist === 0) throw new Error('SL distance is zero');

    const qty = roundStep(riskDollar / slDist, meta.stepSize);
    if (qty <= 0) throw new Error(`Quantity rounds to 0 (balance=${balance.toFixed(2)}, step=${meta.stepSize})`);

    const notional = qty * signal.entry;
    if (notional < meta.minNotional) {
      throw new Error(`Notional $${notional.toFixed(2)} < min $${meta.minNotional} — account balance too small for this SL distance`);
    }

    // Set cross-margin leverage
    await fapi('POST', '/fapi/v1/leverage', { symbol: signal.symbol, leverage: LEVERAGE });

    const entrySide: 'BUY' | 'SELL' = signal.direction === 'LONG' ? 'BUY'  : 'SELL';
    const closeSide: 'BUY' | 'SELL' = signal.direction === 'LONG' ? 'SELL' : 'BUY';

    // Market entry
    const { orderId, avgPrice } = await placeMarket(signal.symbol, entrySide, qty);
    const fillPrice = avgPrice > 0 ? avgPrice : signal.entry;

    // TP + SL (both sized to full position quantity)
    const tpOrderId = await placeTpOrder(signal.symbol, closeSide, qty, signal.tp, meta.tickSize);
    const slOrderId = await placeSlOrder(signal.symbol, closeSide, qty, signal.sl, meta.tickSize);

    console.log(
      `[trader] ✅ LIVE OPEN  ${signal.direction} ${signal.symbol} | ` +
      `qty=${qty} fill≈${fillPrice} TP=${signal.tp} SL=${signal.sl} risk=$${riskDollar.toFixed(2)}`,
    );

    return { ok: true, orderId: String(orderId), tpOrderId: String(tpOrderId), slOrderId: String(slOrderId), quantity: qty, fillPrice, riskDollar };
  } catch (err: any) {
    console.error(`[trader] ❌ openTrade ${signal.symbol}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Called when the tracker detects TP or SL hit.
 * Binance already closed the position automatically via the standing order —
 * we just cancel the opposite order so it doesn't linger.
 */
export async function onTpSlHit(signal: Signal, hit: 'tp' | 'sl'): Promise<void> {
  if (!isLiveTradingEnabled() || !signal.liveEnabled) return;
  const cancelId = hit === 'tp' ? signal.liveSlOrderId : signal.liveTpOrderId;
  if (cancelId) await cancelOrder(signal.symbol, cancelId);
  console.log(`[trader] ${hit.toUpperCase()} confirmed — cancelled opposite order for ${signal.symbol}`);
}

/**
 * Called when the tracker fires the paper partial-TP (price reached 50% to TP).
 * 1. Cancels existing TP + SL (sized for full position).
 * 2. Market-closes 50% of the position.
 * 3. Re-places TP + SL sized for the remaining 50%, SL moved to entry (breakeven).
 * Mutates signal.liveTpOrderId and signal.liveSlOrderId in place.
 */
export async function onPartialTp(signal: Signal): Promise<void> {
  if (!isLiveTradingEnabled() || !signal.liveEnabled || !signal.liveQty) return;

  try {
    const meta      = await getSymbolMeta(signal.symbol);
    const closeSide: 'BUY' | 'SELL' = signal.direction === 'LONG' ? 'SELL' : 'BUY';
    const halfQty   = roundStep(signal.liveQty * 0.5, meta.stepSize);

    // Cancel full-position TP and SL
    if (signal.liveTpOrderId) await cancelOrder(signal.symbol, signal.liveTpOrderId);
    if (signal.liveSlOrderId) await cancelOrder(signal.symbol, signal.liveSlOrderId);

    // Close 50% at market
    await placeMarket(signal.symbol, closeSide, halfQty);

    // Re-place for remaining 50% — SL at entry (breakeven)
    const newTpId = await placeTpOrder(signal.symbol, closeSide, halfQty, signal.tp, meta.tickSize);
    const newSlId = await placeSlOrder(signal.symbol, closeSide, halfQty, signal.entry, meta.tickSize);

    signal.liveTpOrderId = String(newTpId);
    signal.liveSlOrderId = String(newSlId);

    console.log(`[trader] PARTIAL-TP ${signal.symbol}: 50% closed, new TP/SL placed for remaining half`);
  } catch (err: any) {
    console.error(`[trader] onPartialTp ${signal.symbol}: ${err.message}`);
  }
}

/**
 * Force-closes a live position (thesis invalidation or zombie-close).
 * Cancels both TP and SL, then sends a market close for the remaining qty.
 */
export async function onForceClose(signal: Signal): Promise<void> {
  if (!isLiveTradingEnabled() || !signal.liveEnabled || !signal.liveQty) return;

  try {
    const meta      = await getSymbolMeta(signal.symbol);
    const closeSide: 'BUY' | 'SELL' = signal.direction === 'LONG' ? 'SELL' : 'BUY';
    const fraction  = signal.partialTpFired ? 0.5 : 1.0;
    const closeQty  = roundStep(signal.liveQty * fraction, meta.stepSize);

    if (signal.liveTpOrderId) await cancelOrder(signal.symbol, signal.liveTpOrderId);
    if (signal.liveSlOrderId) await cancelOrder(signal.symbol, signal.liveSlOrderId);
    if (closeQty > 0) await placeMarket(signal.symbol, closeSide, closeQty);

    console.log(`[trader] FORCE-CLOSE ${signal.symbol}: market ${closeSide} ${closeQty}`);
  } catch (err: any) {
    console.error(`[trader] onForceClose ${signal.symbol}: ${err.message}`);
  }
}
