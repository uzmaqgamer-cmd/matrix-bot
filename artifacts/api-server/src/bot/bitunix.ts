/**
 * Bitunix Futures API adapter.
 *
 * Market data and execution are intentionally kept in one venue adapter.  A
 * failed or incomplete venue check must stop a live order rather than falling
 * back to another exchange.
 */
import crypto from 'crypto';
import { config } from './config.js';

const BASE = 'https://fapi.bitunix.com';
const RETRIES = 2;

export interface BitunixInstrument {
  symbol: string;
  base: string;
  quote: string;
  minTradeVolume: string;
  basePrecision: number;
  quotePrecision: number;
  maxLeverage: number;
  symbolStatus: string;
  isApiSupported: boolean;
}

interface BitunixTicker {
  symbol: string;
  lastPrice: string;
  quoteVol: string;
}

interface BybitOiResponse {
  retCode?: number;
  retMsg?: string;
  result?: { list?: Array<{ openInterest?: string }> };
}

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

function queryString(params: Record<string, string | number | undefined>) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
}

async function request<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const qs = queryString(params);
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
  let lastError: Error = new Error('Unknown Bitunix request failure');

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url, signal ? { signal } : undefined);
      const body = await response.json() as { code?: number; msg?: string; data?: T };
      if (!response.ok || body.code !== 0) {
        throw new Error(`Bitunix ${path}: ${body.code ?? response.status} ${body.msg ?? response.statusText}`);
      }
      return body.data as T;
    } catch (error) {
      if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
      lastError = error as Error;
      if (attempt < RETRIES) await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

function privateHeaders(
  apiKey: string,
  apiSecret: string,
  queryParams: Record<string, string | number | undefined> = {},
  body = '',
) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = String(Date.now());
  // Bitunix requires sorted key+value pairs with no separators.
  const sortedParams = Object.entries(queryParams)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}${value}`)
    .join('');
  const digest = crypto.createHash('sha256')
    .update(`${nonce}${timestamp}${apiKey}${sortedParams}${body}`)
    .digest('hex');
  const sign = crypto.createHash('sha256').update(`${digest}${apiSecret}`).digest('hex');
  return {
    'api-key': apiKey,
    nonce,
    timestamp,
    sign,
    'Content-Type': 'application/json',
    language: 'en-US',
  };
}

export async function bitunixPrivate<T>(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | number | undefined> = {},
  payload?: Record<string, unknown>,
): Promise<T> {
  const apiKey = process.env['BITUNIX_API_KEY'];
  const apiSecret = process.env['BITUNIX_API_SECRET'];
  if (!apiKey || !apiSecret) throw new Error('Bitunix credentials are not configured');

  const body = payload ? JSON.stringify(payload) : '';
  const qs = method === 'GET' ? queryString(params) : '';
  const response = await fetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers: privateHeaders(apiKey, apiSecret, method === 'GET' ? params : {}, body),
    body: method === 'POST' ? body : undefined,
  });
  const result = await response.json() as { code?: number; msg?: string; data?: T };
  if (!response.ok || result.code !== 0) {
    throw new Error(`Bitunix ${method} ${path}: ${result.code ?? response.status} ${result.msg ?? response.statusText}`);
  }
  return result.data as T;
}

// ─── Public market data ───────────────────────────────────────────────────────

let cachedSymbols: string[] | null = null;
let cachedSymbolsAt = 0;
let cachedPrices: Map<string, number> | null = null;
let cachedPricesAt = 0;
const SYMBOL_CACHE_TTL = 30 * 60_000;

export function getCachedSymbols(): string[] | null {
  return cachedSymbols && Date.now() - cachedSymbolsAt < SYMBOL_CACHE_TTL ? cachedSymbols : null;
}

export function getCachedPrices(maxAgeMs = 2 * 60_000): Map<string, number> | null {
  return cachedPrices && Date.now() - cachedPricesAt < maxAgeMs ? cachedPrices : null;
}

export async function getAllPerpSymbols(): Promise<BitunixInstrument[]> {
  const instruments = await request<BitunixInstrument[]>('/api/v1/futures/market/trading_pairs');
  return instruments.filter(item =>
    item.quote === 'USDT' &&
    item.symbolStatus === 'OPEN' &&
    item.isApiSupported === true,
  );
}

export async function get24hTickers(): Promise<BitunixTicker[]> {
  return request<BitunixTicker[]>('/api/v1/futures/market/tickers');
}

/**
 * Checks the documented 30 day listing-age requirement with a daily candle
 * inside the 31–30 day old window.  Bitunix does not return listedAt in
 * trading-pair metadata, so this is the exchange-native evidence available.
 */
async function hasThirtyDayHistory(symbol: string): Promise<boolean> {
  const endTime = Date.now() - 30 * 24 * 60 * 60_000;
  const startTime = endTime - 24 * 60 * 60_000;
  const candles = await request<Array<{ time: string }>>('/api/v1/futures/market/kline', {
    symbol, interval: '1d', limit: 2, startTime, endTime, type: 'LAST_PRICE',
  });
  return candles.length > 0;
}

export function assertOpenInterestSupported(): void {
  // OI is the one explicitly approved external input. All other market data
  // and execution remain Bitunix-only.
}

async function getBybitOpenInterest(symbol: string, intervalTime = '15min', limit = 20, signal?: AbortSignal): Promise<number[]> {
  const url = new URL('https://api.bybit.com/v5/market/open-interest');
  url.searchParams.set('category', 'linear');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('intervalTime', intervalTime);
  url.searchParams.set('limit', String(Math.min(limit, 200)));
  const response = await fetch(url, signal ? { signal } : undefined);
  const body = await response.json() as BybitOiResponse;
  if (!response.ok || body.retCode !== 0) {
    throw new Error(`Bybit OI request failed: ${body.retCode ?? response.status} ${body.retMsg ?? response.statusText}`);
  }
  return (body.result?.list ?? [])
    .map(item => Number(item.openInterest))
    .filter(Number.isFinite)
    .reverse();
}

/** OI is intentionally the only external venue input. */
export async function getOpenInterestSeries(
  symbol: string, _period = '15m', limit = 20, signal?: AbortSignal,
): Promise<number[]> {
  return getBybitOpenInterest(symbol, '15min', limit, signal);
}

/**
 * Converts the one approved external input (Bybit linear-contract OI) into a
 * USD gate using a Bitunix price. No Bybit price/funding/candle data is used.
 */
export async function getOpenInterestUsd(symbol: string, knownBitunixPrice?: number): Promise<number> {
  const [oiContracts, bitunixPrice] = await Promise.all([
    getOpenInterestSeries(symbol, '15m', 1),
    knownBitunixPrice != null ? Promise.resolve(knownBitunixPrice) : getCurrentPrice(symbol),
  ]);
  const contracts = oiContracts[0] ?? 0;
  if (contracts <= 0 || !Number.isFinite(bitunixPrice) || bitunixPrice <= 0) {
    throw new Error(`No usable external OI or Bitunix price for ${symbol}`);
  }
  return contracts * bitunixPrice;
}

export async function getTopSymbolsByVolume(n: number): Promise<string[]> {
  const [instruments, tickers] = await Promise.all([getAllPerpSymbols(), get24hTickers()]);
  const allowed = new Set(instruments.map(item => item.symbol));
  const liquid = tickers
    .filter(ticker => allowed.has(ticker.symbol) && Number(ticker.quoteVol) >= 50_000_000)
    .sort((a, b) => Number(b.quoteVol) - Number(a.quoteVol));

  const selected: string[] = [];
  // Check candidates in modest batches to respect Bitunix's 10 request/sec IP limit.
  for (let index = 0; index < liquid.length && selected.length < n; index += 8) {
    const batch = liquid.slice(index, index + 8);
    const aged = await Promise.all(batch.map(async ticker => ({
      symbol: ticker.symbol,
      eligible: await (async () => {
        const hasAge = await hasThirtyDayHistory(ticker.symbol).catch(() => false);
        if (!hasAge) return false;
        const oiUsd = await getOpenInterestUsd(ticker.symbol, Number(ticker.lastPrice)).catch(() => 0);
        return oiUsd >= config.minOpenInterestUsd;
      })(),
    })));
    selected.push(...aged.filter(item => item.eligible).map(item => item.symbol));
    if (index + 8 < liquid.length && selected.length < n) await sleep(1_000);
  }
  cachedSymbols = selected.slice(0, n);
  cachedSymbolsAt = Date.now();
  return cachedSymbols;
}

export async function getCloseSeries(symbol: string, interval = '15m', limit = 20, signal?: AbortSignal): Promise<number[]> {
  const data = await request<Array<{ close: string }>>('/api/v1/futures/market/kline', {
    symbol, interval, limit, type: 'LAST_PRICE',
  }, signal);
  return data.reverse().map(candle => Number(candle.close)).filter(Number.isFinite);
}

export async function getFundingRateSeries(symbol: string, limit = 4, signal?: AbortSignal): Promise<number[]> {
  const data = await request<Array<{ fundingRate: string }>>('/api/v1/futures/market/get_funding_rate_history', {
    symbol, limit,
  }, signal);
  return data.reverse().map(item => Number(item.fundingRate)).filter(Number.isFinite);
}

export async function getCurrentPrice(symbol: string, signal?: AbortSignal): Promise<number> {
  const tickers = await request<BitunixTicker[]>('/api/v1/futures/market/tickers', { symbols: symbol }, signal);
  const price = Number(tickers[0]?.lastPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Bitunix did not return a price for ${symbol}`);
  return price;
}

export async function getAllCurrentPrices(signal?: AbortSignal): Promise<Map<string, number>> {
  const tickers = await get24hTickers();
  if (signal?.aborted) throw new Error('Bitunix bulk price request aborted');
  const prices = new Map<string, number>();
  for (const ticker of tickers) {
    const price = Number(ticker.lastPrice);
    if (Number.isFinite(price) && price > 0) prices.set(ticker.symbol, price);
  }
  cachedPrices = prices;
  cachedPricesAt = Date.now();
  return prices;
}

export async function getOhlcSeries(
  symbol: string, interval = '15m', limit = 15,
): Promise<{ high: number; low: number; close: number }[]> {
  const data = await request<Array<{ high: string; low: string; close: string }>>('/api/v1/futures/market/kline', {
    symbol, interval, limit, type: 'LAST_PRICE',
  });
  return data.reverse().map(candle => ({
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
  })).filter(candle => Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close));
}

export function calcATR(ohlc: { high: number; low: number; close: number }[]): number {
  if (ohlc.length < 2) return 0;
  const ranges = ohlc.slice(1).map((candle, index) => Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - ohlc[index].close),
    Math.abs(candle.low - ohlc[index].close),
  ));
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}