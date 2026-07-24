const BASE = 'https://fapi.binance.com';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Fetch JSON from Binance with automatic retry on transient errors.
 * Retries up to 2 times on HTTP 451 (geo-block), 429 (rate-limit), 5xx,
 * and network failures. Respects the AbortSignal so withTimeout() still works.
 */
async function getJson(path: string, signal?: AbortSignal): Promise<any> {
  const MAX_RETRIES = 2;
  let lastErr: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error(`[binance] Aborted: ${path}`);
    try {
      const res = await fetch(`${BASE}${path}`, signal ? { signal } : undefined);
      if (!res.ok) {
        const text = await res.text();
        // Retry on geo-block (451), rate-limit (429), or server errors (5xx)
        const retriable = res.status === 451 || res.status === 429 || res.status >= 500;
        if (retriable && attempt < MAX_RETRIES && !signal?.aborted) {
          lastErr = new Error(`Binance API ${res.status} on ${path}: ${text}`);
          await sleep(1000 * (attempt + 1)); // 1s, 2s
          continue;
        }
        throw new Error(`Binance API ${res.status} on ${path}: ${text}`);
      }
      return res.json();
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ─── Symbol list cache ────────────────────────────────────────────────────────
let _cachedSymbols: string[] | null = null;
let _cachedSymbolsAt = 0;
const SYMBOL_CACHE_TTL = 30 * 60 * 1000; // 30 min — top-530 list is stable

/** Return the last successfully-fetched symbol list (up to 30 min stale). */
export function getCachedSymbols(): string[] | null {
  if (_cachedSymbols && Date.now() - _cachedSymbolsAt < SYMBOL_CACHE_TTL) return _cachedSymbols;
  return null;
}

export async function getAllPerpSymbols(): Promise<string[]> {
  const data = await getJson('/fapi/v1/exchangeInfo');
  return data.symbols
    .filter((s: any) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
    .map((s: any) => s.symbol);
}

export async function get24hTickers(): Promise<any[]> {
  return getJson('/fapi/v1/ticker/24hr');
}

export async function getTopSymbolsByVolume(n: number): Promise<string[]> {
  const [perpSymbols, tickers] = await Promise.all([getAllPerpSymbols(), get24hTickers()]);
  const perpSet = new Set(perpSymbols);
  const result = tickers
    .filter((t: any) => perpSet.has(t.symbol))
    .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, n)
    .map((t: any) => t.symbol);
  // Cache on success
  _cachedSymbols = result;
  _cachedSymbolsAt = Date.now();
  return result;
}

export async function getCloseSeries(symbol: string, interval = '15m', limit = 20, signal?: AbortSignal): Promise<number[]> {
  const data = await getJson(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, signal);
  return data.map((k: any) => parseFloat(k[4]));
}

export async function getOpenInterestSeries(symbol: string, period = '15m', limit = 20, signal?: AbortSignal): Promise<number[]> {
  const data = await getJson(`/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`, signal);
  return data.map((d: any) => parseFloat(d.sumOpenInterest));
}

export async function getFundingRateSeries(symbol: string, limit = 4, signal?: AbortSignal): Promise<number[]> {
  const data = await getJson(`/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`, signal);
  return data.map((d: any) => parseFloat(d.fundingRate) * 100);
}

export async function getCurrentPrice(symbol: string, signal?: AbortSignal): Promise<number> {
  const data = await getJson(`/fapi/v1/ticker/price?symbol=${symbol}`, signal);
  return parseFloat(data.price);
}

// ─── Bulk price cache ─────────────────────────────────────────────────────────
let _cachedPrices: Map<string, number> | null = null;
let _cachedPricesAt = 0;

/**
 * Return the last successfully-fetched bulk price map if it is younger than
 * `maxAgeMs` (default 2 minutes). Returns null when the cache is too stale.
 */
export function getCachedPrices(maxAgeMs = 2 * 60 * 1000): Map<string, number> | null {
  if (_cachedPrices && Date.now() - _cachedPricesAt < maxAgeMs) return _cachedPrices;
  return null;
}

/**
 * Fetch ALL perp futures prices in a single request.
 * Returns a symbol → price map.
 * Use this in the tracker instead of N individual getCurrentPrice calls
 * to avoid rate-limiting timeouts when there are many active signals.
 */
export async function getAllCurrentPrices(signal?: AbortSignal): Promise<Map<string, number>> {
  const data: Array<{ symbol: string; price: string }> = await getJson('/fapi/v1/ticker/price', signal);
  const map = new Map<string, number>();
  for (const item of data) map.set(item.symbol, parseFloat(item.price));
  // Cache on success
  _cachedPrices = map;
  _cachedPricesAt = Date.now();
  return map;
}

/** Get OHLC candles for ATR calculation. Returns array of {high, low, close}. */
export async function getOhlcSeries(symbol: string, interval = '15m', limit = 15): Promise<{high: number; low: number; close: number}[]> {
  const data = await getJson(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return data.map((k: any) => ({
    high:  parseFloat(k[2]),
    low:   parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}

/** Calculate ATR (Average True Range) from OHLC data. */
export function calcATR(ohlc: {high: number; low: number; close: number}[]): number {
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
