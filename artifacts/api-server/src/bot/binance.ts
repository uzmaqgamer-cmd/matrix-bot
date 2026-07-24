/**
 * Market-data layer — Bybit USDT Perpetuals public API.
 *
 * Bybit is used instead of Binance because Replit's infrastructure IPs are
 * blocked by Binance's CloudFront CDN (HTTP 403/451 on every endpoint).
 * Bybit's public market-data API is accessible from the Replit workspace VM
 * and provides identical data: USDT perpetual OI, klines, funding rates, prices.
 *
 * All exported function signatures are identical to the former Binance version
 * so no other file needs to change.
 */

const BASE = 'https://api.bybit.com';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Convert Binance-style interval to Bybit kline interval. */
function toBybitInterval(interval: string): string {
  const map: Record<string, string> = {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
    '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
    '1d': 'D', '1w': 'W', '1M': 'M',
  };
  return map[interval] ?? interval;
}

/** Convert Binance-style period to Bybit OI intervalTime. */
function toBybitOiPeriod(period: string): string {
  const map: Record<string, string> = {
    '5m': '5min', '15m': '15min', '30m': '30min',
    '1h': '1h', '4h': '4h', '1d': '1d',
  };
  return map[period] ?? period;
}

/**
 * Fetch JSON from Bybit with automatic retry on 429/5xx and network errors.
 * Returns `data.result` on success. Respects AbortSignal.
 */
async function getJson(path: string, signal?: AbortSignal): Promise<any> {
  const MAX_RETRIES = 2;
  let lastErr: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error(`[bybit] Aborted: ${path}`);
    try {
      const res = await fetch(`${BASE}${path}`, signal ? { signal } : undefined);
      if (!res.ok) {
        const text = await res.text();
        const retriable = res.status === 429 || res.status >= 500;
        if (retriable && attempt < MAX_RETRIES && !signal?.aborted) {
          lastErr = new Error(`Bybit HTTP ${res.status} on ${path}: ${text}`);
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new Error(`Bybit HTTP ${res.status} on ${path}: ${text}`);
      }
      const data = await res.json();
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error ${data.retCode} on ${path}: ${data.retMsg}`);
      }
      return data.result;
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ─── Symbol list cache (30 min TTL) ──────────────────────────────────────────
let _cachedSymbols: string[] | null = null;
let _cachedSymbolsAt = 0;
const SYMBOL_CACHE_TTL = 30 * 60 * 1000;

export function getCachedSymbols(): string[] | null {
  if (_cachedSymbols && Date.now() - _cachedSymbolsAt < SYMBOL_CACHE_TTL) return _cachedSymbols;
  return null;
}

// ─── Bulk price cache (2 min TTL) ────────────────────────────────────────────
let _cachedPrices: Map<string, number> | null = null;
let _cachedPricesAt = 0;

export function getCachedPrices(maxAgeMs = 2 * 60 * 1000): Map<string, number> | null {
  if (_cachedPrices && Date.now() - _cachedPricesAt < maxAgeMs) return _cachedPrices;
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getAllPerpSymbols(): Promise<string[]> {
  const result = await getJson('/v5/market/instruments-info?category=linear&limit=1000');
  return (result.list as any[])
    .filter((s: any) =>
      s.contractType === 'LinearPerpetual' &&
      s.quoteCoin === 'USDT' &&
      s.status === 'Trading',
    )
    .map((s: any) => s.symbol);
}

export async function get24hTickers(): Promise<any[]> {
  const result = await getJson('/v5/market/tickers?category=linear');
  return result.list as any[];
}

export async function getTopSymbolsByVolume(n: number): Promise<string[]> {
  const [perpSymbols, tickers] = await Promise.all([getAllPerpSymbols(), get24hTickers()]);
  const perpSet = new Set(perpSymbols);
  const result = (tickers as any[])
    .filter((t: any) => perpSet.has(t.symbol))
    .sort((a: any, b: any) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
    .slice(0, n)
    .map((t: any) => t.symbol);
  _cachedSymbols = result;
  _cachedSymbolsAt = Date.now();
  return result;
}

export async function getCloseSeries(
  symbol: string, interval = '15m', limit = 20, signal?: AbortSignal,
): Promise<number[]> {
  const result = await getJson(
    `/v5/market/kline?category=linear&symbol=${symbol}&interval=${toBybitInterval(interval)}&limit=${limit}`,
    signal,
  );
  // Bybit returns newest-first — reverse to chronological; close = index 4
  return (result.list as string[][]).reverse().map(k => parseFloat(k[4]));
}

export async function getOpenInterestSeries(
  symbol: string, period = '15m', limit = 20, signal?: AbortSignal,
): Promise<number[]> {
  const result = await getJson(
    `/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=${toBybitOiPeriod(period)}&limit=${limit}`,
    signal,
  );
  // Bybit returns newest-first — reverse to chronological
  return (result.list as any[]).reverse().map((d: any) => parseFloat(d.openInterest));
}

export async function getFundingRateSeries(
  symbol: string, limit = 4, signal?: AbortSignal,
): Promise<number[]> {
  const result = await getJson(
    `/v5/market/funding/history?category=linear&symbol=${symbol}&limit=${limit}`,
    signal,
  );
  // fundingRate is decimal (e.g. 0.0001); ×100 to match the % format callers expect
  return (result.list as any[]).map((d: any) => parseFloat(d.fundingRate) * 100);
}

export async function getCurrentPrice(symbol: string, signal?: AbortSignal): Promise<number> {
  const result = await getJson(
    `/v5/market/tickers?category=linear&symbol=${symbol}`, signal,
  );
  return parseFloat(result.list[0].lastPrice);
}

export async function getAllCurrentPrices(signal?: AbortSignal): Promise<Map<string, number>> {
  const result = await getJson('/v5/market/tickers?category=linear', signal);
  const map = new Map<string, number>();
  for (const item of result.list as any[]) {
    map.set(item.symbol, parseFloat(item.lastPrice));
  }
  _cachedPrices = map;
  _cachedPricesAt = Date.now();
  return map;
}

export async function getOhlcSeries(
  symbol: string, interval = '15m', limit = 15,
): Promise<{ high: number; low: number; close: number }[]> {
  const result = await getJson(
    `/v5/market/kline?category=linear&symbol=${symbol}&interval=${toBybitInterval(interval)}&limit=${limit}`,
  );
  return (result.list as string[][]).reverse().map(k => ({
    high:  parseFloat(k[2]),
    low:   parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}

export function calcATR(ohlc: { high: number; low: number; close: number }[]): number {
  if (ohlc.length < 2) return 0;
  const trValues: number[] = [];
  for (let i = 1; i < ohlc.length; i++) {
    const prevClose = ohlc[i - 1].close;
    const tr = Math.max(
      ohlc[i].high - ohlc[i].low,
      Math.abs(ohlc[i].high - prevClose),
      Math.abs(ohlc[i].low - prevClose),
    );
    trValues.push(tr);
  }
  return trValues.reduce((a, b) => a + b, 0) / trValues.length;
}
