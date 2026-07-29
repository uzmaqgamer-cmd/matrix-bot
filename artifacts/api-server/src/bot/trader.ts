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
import { config } from './config.js';

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

// ─── Position mode cache (One-Way vs Hedge) ───────────────────────────────────
// Checked once per session. Hedge mode requires positionSide on every order.

let _positionMode: 'oneway' | 'hedge' | null = null;

async function getPositionMode(): Promise<'oneway' | 'hedge'> {
  if (_positionMode) return _positionMode;
  try {
    const res = await fapi('GET', '/fapi/v1/positionSide/dual');
    _positionMode = res.dualSidePosition ? 'hedge' : 'oneway';
  } catch {
    _positionMode = 'oneway'; // safe default
  }
  console.log(`[trader] Position mode: ${_positionMode}`);
  return _positionMode;
}

// ─── Exchange info cache (LOT_SIZE + PRICE_FILTER per symbol) ─────────────────
// Refreshed once per hour — avoids hitting exchangeInfo on every trade.

interface SymbolMeta { stepSize: number; tickSize: number; minNotional: number }
const _metaCache    = new Map<string, SymbolMeta>();
let   _metaFetchedAt = 0;

async function getSymbolMeta(symbol: string): Promise<SymbolMeta | null> {
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
  // Return null if symbol doesn't exist on Binance Futures
  return _metaCache.get(symbol) ?? null;
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

/**
 * Count open positions on Binance (any symbol with non-zero positionAmt).
 * Used as a hard exchange-side cap before opening new trades.
 */
async function countOpenBinancePositions(): Promise<number> {
  const positions = await fapi('GET', '/fapi/v2/positionRisk') as any[];
  return positions.filter((p: any) => parseFloat(p.positionAmt ?? '0') !== 0).length;
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

/**
 * TP order — plain LIMIT order in the close direction.
 * Sits in the order book; fills when price reaches the TP level.
 * Universally supported on all Binance Futures account types.
 */
async function placeTpOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  positionSide: 'LONG' | 'SHORT',
  quantity: number,         // always required for LIMIT
  tpPrice: number,
  tick: number,
): Promise<number> {
  const mode   = await getPositionMode();
  const price  = String(roundTick(tpPrice, tick));
  const params: Record<string, string | number> = {
    symbol, side,
    type:        'LIMIT',
    price,
    quantity:    String(quantity),
    timeInForce: 'GTC',
  };
  if (mode === 'hedge') {
    params['positionSide'] = positionSide;
  } else {
    params['reduceOnly'] = 'true';
  }
  const res = await fapi('POST', '/fapi/v1/order', params);
  return res.orderId;
}

/**
 * SL order — STOP (stop-limit) order in the close direction.
 * When mark price reaches stopPrice, a LIMIT order at price fires.
 * price is set slightly beyond stopPrice to ensure fill in a fast move.
 */
async function placeSlOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  positionSide: 'LONG' | 'SHORT',
  quantity: number,         // always required
  slPrice: number,
  tick: number,
): Promise<number> {
  const mode      = await getPositionMode();
  const stopPrice = roundTick(slPrice, tick);
  // Limit price: for a SELL SL move slightly below trigger; for BUY SL slightly above
  const limitPrice = side === 'SELL'
    ? roundTick(stopPrice * 0.997, tick)   // 0.3% slip buffer
    : roundTick(stopPrice * 1.003, tick);
  const params: Record<string, string | number> = {
    symbol, side,
    type:        'STOP',
    stopPrice:   String(stopPrice),
    price:       String(limitPrice),
    quantity:    String(quantity),
    timeInForce: 'GTC',
    workingType: 'MARK_PRICE',
  };
  if (mode === 'hedge') {
    params['positionSide'] = positionSide;
  } else {
    params['reduceOnly'] = 'true';
  }
  const res = await fapi('POST', '/fapi/v1/order', params);
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
    if (!meta) return { ok: false, error: `${signal.symbol} not listed on Binance Futures — skipping` };

    // Hard exchange-side cap: count actual open Binance positions, not just bot state.
    // This catches cases where state is stale or positions were opened outside the bot.
    const openCount = await countOpenBinancePositions();
    if (openCount >= config.positionMonitoring.maxActivePositions) {
      return { ok: false, error: `Exchange cap: ${openCount} positions already open (max ${config.positionMonitoring.maxActivePositions})` };
    }

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

    // Set leverage — fall back to lower tiers if symbol cap is below requested
    const LEVERAGE_TIERS = [LEVERAGE, 50, 20, 10, 5];
    let usedLeverage = LEVERAGE;
    for (const lev of LEVERAGE_TIERS) {
      try {
        await fapi('POST', '/fapi/v1/leverage', { symbol: signal.symbol, leverage: lev });
        usedLeverage = lev;
        break;
      } catch (e: any) {
        if (e.message?.includes('-4028') || e.message?.includes('leverage')) continue;
        throw e; // unrelated error — rethrow
      }
    }

    const entrySide: 'BUY' | 'SELL' = signal.direction === 'LONG' ? 'BUY' : 'SELL';

    // Market entry — tracker monitors price and fires MARKET closes for TP/SL/partial
    const { orderId, avgPrice } = await placeMarket(signal.symbol, entrySide, qty);
    const fillPrice = avgPrice > 0 ? avgPrice : signal.entry;

    console.log(
      `[trader] ✅ LIVE OPEN  ${signal.direction} ${signal.symbol} | ` +
      `qty=${qty} fill≈${fillPrice} TP=${signal.tp} SL=${signal.sl} ` +
      `lev=${usedLeverage}× risk=$${riskDollar.toFixed(2)} — tracker will close`,
    );

    return { ok: true, orderId: String(orderId), tpOrderId: '', slOrderId: '', quantity: qty, fillPrice, riskDollar };
  } catch (err: any) {
    const msg = err.message ?? String(err);
    // Suppress noisy logs for known non-error conditions
    if (msg.includes('not listed on Binance Futures')) {
      console.log(`[trader] ⏭ ${signal.symbol} not on Binance Futures — paper only`);
    } else {
      console.error(`[trader] ❌ openTrade ${signal.symbol}: ${msg}`);
    }
    return { ok: false, error: msg };
  }
}

/**
 * Called when the tracker detects TP or SL hit.
 * No standing orders exist — fire a MARKET close for the remaining position.
 */
export async function onTpSlHit(signal: Signal, hit: 'tp' | 'sl'): Promise<void> {
  if (!isLiveTradingEnabled() || !signal.liveEnabled || !signal.liveQty) return;
  try {
    const meta      = await getSymbolMeta(signal.symbol);
    if (!meta) return;
    const closeSide: 'BUY' | 'SELL' = signal.direction === 'LONG' ? 'SELL' : 'BUY';
    const fraction  = signal.partialTpFired ? 0.5 : 1.0;
    const closeQty  = roundStep(signal.liveQty * fraction, meta.stepSize);
    if (closeQty > 0) await placeMarket(signal.symbol, closeSide, closeQty);
    console.log(`[trader] ${hit.toUpperCase()} CLOSE ${signal.symbol}: market ${closeSide} ${closeQty}`);
  } catch (err: any) {
    console.error(`[trader] onTpSlHit ${signal.symbol}: ${err.message}`);
  }
}

/**
 * Called when tracker detects price reached 50% of TP.
 * Market-closes 50% of the position. Tracker will monitor remaining half
 * and fire onTpSlHit when full TP or breakeven SL is reached.
 */
export async function onPartialTp(signal: Signal): Promise<void> {
  if (!isLiveTradingEnabled() || !signal.liveEnabled || !signal.liveQty) return;
  try {
    const meta     = await getSymbolMeta(signal.symbol);
    if (!meta) return;
    const closeSide: 'BUY' | 'SELL' = signal.direction === 'LONG' ? 'SELL' : 'BUY';
    const halfQty  = roundStep(signal.liveQty * 0.5, meta.stepSize);
    if (halfQty > 0) await placeMarket(signal.symbol, closeSide, halfQty);
    console.log(`[trader] PARTIAL-TP ${signal.symbol}: market-closed 50% (${halfQty})`);
  } catch (err: any) {
    console.error(`[trader] onPartialTp ${signal.symbol}: ${err.message}`);
  }
}

/**
 * Force-closes a live position (thesis invalidation or zombie-close).
 * Sends a MARKET close for the remaining quantity.
 */
export async function onForceClose(signal: Signal): Promise<void> {
  if (!isLiveTradingEnabled() || !signal.liveEnabled || !signal.liveQty) return;
  try {
    const meta     = await getSymbolMeta(signal.symbol);
    if (!meta) return;
    const closeSide: 'BUY' | 'SELL' = signal.direction === 'LONG' ? 'SELL' : 'BUY';
    const fraction = signal.partialTpFired ? 0.5 : 1.0;
    const closeQty = roundStep(signal.liveQty * fraction, meta.stepSize);
    if (closeQty > 0) await placeMarket(signal.symbol, closeSide, closeQty);
    console.log(`[trader] FORCE-CLOSE ${signal.symbol}: market ${closeSide} ${closeQty}`);
  } catch (err: any) {
    console.error(`[trader] onForceClose ${signal.symbol}: ${err.message}`);
  }
}
