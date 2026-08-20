/**
 * Bitunix-only live execution. A trade is live only after its market fill and
 * exchange-native position stop both succeed; otherwise it is flattened.
 */
import { bitunixPrivate, getAllPerpSymbols } from './bitunix.js';
import type { Signal } from './types.js';
import { config } from './config.js';
import { loadState } from './storage.js';

interface Position { positionId?: string; symbol?: string; qty?: string; positionQty?: string }
interface OrderDetail {
  orderId?: string; status?: string; avgPrice?: string; tradeQty?: string;
  fee?: string; realizedPNL?: string;
}
interface TradeFill {
  positionId?: string; fee?: string; realizedPNL?: string; ctime?: number | string;
}

const LEVERAGE = Math.max(1, Number.parseInt(process.env['BITUNIX_LEVERAGE'] ?? '10', 10));

export function isLiveTradingEnabled(): boolean {
  return process.env['LIVE_TRADING'] === 'true' &&
    !!process.env['BITUNIX_API_KEY'] &&
    !!process.env['BITUNIX_API_SECRET'];
}

function num(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function floorPrecision(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.floor((value + Number.EPSILON) * factor) / factor;
}

async function getOrderDetail(orderId: string) {
  return bitunixPrivate<OrderDetail>('GET', '/api/v1/futures/trade/get_order_detail', { orderId });
}

async function waitForFill(orderId: string): Promise<OrderDetail> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const order = await getOrderDetail(orderId);
    if (order.status === 'FILLED' && num(order.avgPrice) > 0 && num(order.tradeQty) > 0) return order;
    if (['CANCELED', 'REJECTED', 'EXPIRED'].includes(order.status ?? '')) {
      throw new Error(`Bitunix order ${orderId} ended as ${order.status}`);
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`Bitunix order ${orderId} did not confirm filled within 3.2 seconds`);
}

async function positions(): Promise<Position[]> {
  return bitunixPrivate<Position[]>('GET', '/api/v1/futures/position/get_pending_positions');
}

export async function getUsdtBalance(): Promise<number> {
  const account = await bitunixPrivate<Record<string, unknown>>('GET', '/api/v1/futures/account', { marginCoin: 'USDT' });
  const nested = account.account as Record<string, unknown> | undefined;
  const balance = [account.availableBalance, account.available, account.usdtAvailable, nested?.availableBalance, nested?.available]
    .map(num).find(value => value > 0);
  if (!balance) throw new Error('Bitunix account response has no positive available USDT balance');
  return balance;
}

async function marketOrder(
  symbol: string, side: 'BUY' | 'SELL', qty: number, tradeSide: 'OPEN' | 'CLOSE', positionId?: string,
): Promise<string> {
  const result = await bitunixPrivate<{ orderId?: string }>('POST', '/api/v1/futures/trade/place_order', {}, {
    symbol, side, orderType: 'MARKET', qty: String(qty), tradeSide, effect: 'IOC',
    reduceOnly: tradeSide === 'CLOSE', ...(positionId ? { positionId } : {}),
    clientId: `matrix-${Date.now()}`,
  });
  if (!result.orderId) throw new Error('Bitunix returned no order ID');
  return result.orderId;
}

async function getLivePosition(signal: Signal): Promise<{ position: Position; quantity: number; precision: number }> {
  const [instruments, open] = await Promise.all([getAllPerpSymbols(), positions()]);
  const instrument = instruments.find(item => item.symbol === signal.symbol);
  if (!instrument) throw new Error(`${signal.symbol} is not an eligible Bitunix USDT perpetual`);
  const position = open.find(item => item.symbol === signal.symbol && num(item.qty ?? item.positionQty) > 0);
  if (!position?.positionId) throw new Error(`No open Bitunix position found for ${signal.symbol}`);
  const quantity = floorPrecision(num(position.qty ?? position.positionQty), instrument.basePrecision);
  if (quantity <= 0) throw new Error(`Bitunix returned an invalid close quantity for ${signal.symbol}`);
  return { position, quantity, precision: instrument.basePrecision };
}

async function reconcileNativeStopExit(signal: Signal): Promise<boolean> {
  if (!signal.livePositionId) return false;
  const page = await bitunixPrivate<any>('GET', '/api/v1/futures/trade/get_history_trades', {
    symbol: signal.symbol, positionId: signal.livePositionId, limit: 20,
  });
  const trades: TradeFill[] = Array.isArray(page)
    ? page
    : (page.tradeList ?? page.list ?? page.orderList ?? []);
  const latest = trades
    .filter((trade: TradeFill) => trade.realizedPNL != null || trade.fee != null)
    .sort((a: TradeFill, b: TradeFill) => num(b.ctime) - num(a.ctime))[0];
  if (!latest) return false;
  signal.liveExitConfirmed = true;
  signal.liveFeeExit = num(latest.fee) * (1 - config.bitunixFeeCashback);
  signal.liveExitRealizedPnl = num(latest.realizedPNL);
  recordConfirmedExit(signal);
  return true;
}

async function closeCurrentPosition(signal: Signal, fraction = 1): Promise<{ order: OrderDetail | null; quantity: number }> {
  let live: { position: Position; quantity: number; precision: number };
  try {
    live = await getLivePosition(signal);
  } catch (error) {
    if (await reconcileNativeStopExit(signal)) return { order: null, quantity: 0 };
    throw error;
  }
  const { position, quantity, precision } = live;
  const closeQty = floorPrecision(quantity * fraction, precision);
  if (closeQty <= 0) throw new Error(`Close quantity rounds to zero for ${signal.symbol}`);
  const id = await marketOrder(
    signal.symbol,
    signal.direction === 'LONG' ? 'SELL' : 'BUY',
    closeQty,
    'CLOSE',
    position.positionId,
  );
  return { order: await waitForFill(id), quantity: closeQty };
}

async function closeKnownFill(signal: Signal, qty: number, positionId?: string): Promise<OrderDetail> {
  const id = await marketOrder(signal.symbol, signal.direction === 'LONG' ? 'SELL' : 'BUY', qty, 'CLOSE', positionId);
  return waitForFill(id);
}

function recordConfirmedExit(signal: Signal): void {
  signal.livePnlGross = parseFloat(
    ((signal.livePartialRealizedPnl ?? 0) + (signal.liveExitRealizedPnl ?? 0)).toFixed(6),
  );
  signal.liveFeesTotal = parseFloat(
    ((signal.liveFeeEntry ?? 0) + (signal.liveFeePartialExit ?? 0) + (signal.liveFeeExit ?? 0)).toFixed(6),
  );
  signal.livePnlNet = parseFloat((signal.livePnlGross - signal.liveFeesTotal).toFixed(6));
}

function requireBitunixCloseAccess(signal: Signal): boolean {
  // Paper signals are intentionally local-only. Every live signal must either
  // be closed through its original Bitunix venue or remain active for operator
  // reconciliation; it is never silently finalized.
  if (!signal.liveEnabled) return false;
  if (signal.liveVenue !== 'BITUNIX') {
    throw new Error(`Legacy live signal ${signal.symbol} is quarantined; it cannot be closed through the Bitunix adapter`);
  }
  if (!isLiveTradingEnabled()) {
    throw new Error(`Bitunix credentials are unavailable; ${signal.symbol} remains active for reconciliation`);
  }
  return true;
}

/**
 * The documented Bitunix position TP/SL endpoint closes the attached position
 * at market on trigger. Binding it to positionId makes it reduce-only by design.
 */
async function placePositionStop(symbol: string, positionId: string, sl: number): Promise<string> {
  const result = await bitunixPrivate<{ orderId?: string }>('POST', '/api/v1/futures/tpsl/position/place_order', {}, {
    symbol, positionId, slPrice: String(sl), slStopType: 'MARK_PRICE',
  });
  if (!result.orderId) throw new Error('Bitunix did not return a protective-stop order ID');
  return result.orderId;
}

export interface OpenTradeResult {
  ok: true; orderId: string; tpOrderId: string; slOrderId: string; quantity: number;
  fillPrice: number; riskDollar: number; feeEntry: number; positionId: string;
}
export interface OpenTradeError {
  ok: false; error: string;
  unreconciled?: { orderId: string; quantity: number; fillPrice: number; positionId?: string };
}
export type OpenTradeOutcome = OpenTradeResult | OpenTradeError;

export async function openTrade(signal: Signal): Promise<OpenTradeOutcome> {
  if (!isLiveTradingEnabled()) return { ok: false, error: 'LIVE_TRADING is not enabled with Bitunix credentials' };
  if (signal.direction !== 'LONG') return { ok: false, error: 'Bitunix pilot is LONG-only; SHORT execution is blocked' };

  let confirmedEntry: { orderId: string; quantity: number; fillPrice: number } | null = null;
  try {
    const [instruments, balance, open] = await Promise.all([getAllPerpSymbols(), getUsdtBalance(), positions()]);
    const instrument = instruments.find(item => item.symbol === signal.symbol);
    if (!instrument) throw new Error(`${signal.symbol} is not an eligible Bitunix USDT perpetual`);
    const openCount = open.filter(item => num(item.qty ?? item.positionQty) !== 0).length;
    if (openCount >= config.positionMonitoring.maxActivePositions) throw new Error(`Bitunix position cap reached (${openCount}/4)`);

    const riskDollar = balance * config.riskPerPosition;
    const allocatedRisk = loadState().activeSignals
      .filter(item => item.liveEnabled)
      .reduce((sum, item) => sum + (item.liveRiskDollar ?? 0), 0);
    if (allocatedRisk + riskDollar > balance * config.maxAggregateRisk) {
      throw new Error('Portfolio risk cap would exceed 1% of available balance');
    }

    const stopDistance = Math.abs(signal.entry - signal.sl);
    if (stopDistance <= 0) throw new Error('Signal has no valid stop distance');
    const qty = floorPrecision(riskDollar / stopDistance, instrument.basePrecision);
    if (qty < num(instrument.minTradeVolume)) throw new Error('Risk-sized quantity is below Bitunix minimum trade volume');

    await bitunixPrivate('POST', '/api/v1/futures/account/change_leverage', {}, {
      symbol: signal.symbol, leverage: Math.min(LEVERAGE, instrument.maxLeverage), marginCoin: 'USDT',
    });

    const entryId = await marketOrder(signal.symbol, 'BUY', qty, 'OPEN');
    const entry = await waitForFill(entryId);
    const filledQty = num(entry.tradeQty);
    confirmedEntry = { orderId: entryId, quantity: filledQty, fillPrice: num(entry.avgPrice) };
    const actualRisk = filledQty * Math.abs(confirmedEntry.fillPrice - signal.sl);
    if (actualRisk > riskDollar + 0.000001) {
      throw new Error(
        `Fill-to-stop risk $${actualRisk.toFixed(6)} exceeds the $${riskDollar.toFixed(6)} position cap`,
      );
    }
    const livePosition = (await positions()).find(item => item.symbol === signal.symbol && num(item.qty ?? item.positionQty) > 0);
    if (!livePosition?.positionId) throw new Error('Bitunix fill has no position ID for protective stop');

    let stopId: string;
    try {
      stopId = await placePositionStop(signal.symbol, livePosition.positionId, signal.sl);
    } catch (stopError) {
      throw new Error(`Protective stop rejected: ${(stopError as Error).message}`);
    }

    return {
      ok: true, orderId: entryId, tpOrderId: '', slOrderId: stopId, quantity: filledQty,
      fillPrice: num(entry.avgPrice), riskDollar: actualRisk,
      feeEntry: num(entry.fee) * (1 - config.bitunixFeeCashback),
      positionId: livePosition.positionId,
    };
  } catch (error) {
    const message = (error as Error).message;
    if (confirmedEntry) {
      try {
        await closeKnownFill(signal, confirmedEntry.quantity);
        return { ok: false, error: `${message}; confirmed entry was immediately flattened` };
      } catch (flattenError) {
        const critical = `${message}; CRITICAL: confirmed entry could not be flattened: ${(flattenError as Error).message}`;
        console.error(`[trader] ${critical}`);
        return {
          ok: false,
          error: critical,
          unreconciled: { ...confirmedEntry },
        };
      }
    }
    console.error(`[trader] Bitunix open failed for ${signal.symbol}: ${message}`);
    return { ok: false, error: message };
  }
}

export async function onTpSlHit(signal: Signal, _hit: 'tp' | 'sl'): Promise<void> {
  if (!requireBitunixCloseAccess(signal) || !signal.liveQty) return;
  const exit = await closeCurrentPosition(signal);
  if (!exit.order) return; // native stop closure reconciled from trade history
  signal.liveExitConfirmed = true;
  signal.liveFeeExit = num(exit.order.fee) * (1 - config.bitunixFeeCashback);
  signal.liveExitRealizedPnl = num(exit.order.realizedPNL);
  recordConfirmedExit(signal);
}

export async function onPartialTp(signal: Signal): Promise<void> {
  if (!requireBitunixCloseAccess(signal) || !signal.liveQty) return;
  const exit = await closeCurrentPosition(signal, 0.5);
  if (!exit.order) return; // a native stop already closed the position
  signal.liveHalfQtyClosed = exit.quantity;
  signal.liveFeePartialExit = num(exit.order.fee) * (1 - config.bitunixFeeCashback);
  signal.livePartialRealizedPnl = num(exit.order.realizedPNL);
}

export async function onForceClose(signal: Signal): Promise<void> {
  if (!requireBitunixCloseAccess(signal) || !signal.liveQty) return;
  const exit = await closeCurrentPosition(signal);
  if (!exit.order) return; // native stop closure reconciled from trade history
  signal.liveExitConfirmed = true;
  signal.liveFeeExit = num(exit.order.fee) * (1 - config.bitunixFeeCashback);
  signal.liveExitRealizedPnl = num(exit.order.realizedPNL);
  recordConfirmedExit(signal);
}