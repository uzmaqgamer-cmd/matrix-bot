const BASE = 'https://fapi.binance.com';

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Binance API ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
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
  return tickers
    .filter((t: any) => perpSet.has(t.symbol))
    .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, n)
    .map((t: any) => t.symbol);
}

export async function getCloseSeries(symbol: string, interval = '15m', limit = 20): Promise<number[]> {
  const data = await getJson(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return data.map((k: any) => parseFloat(k[4]));
}

export async function getOpenInterestSeries(symbol: string, period = '15m', limit = 20): Promise<number[]> {
  const data = await getJson(`/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`);
  return data.map((d: any) => parseFloat(d.sumOpenInterest));
}

export async function getFundingRateSeries(symbol: string, limit = 4): Promise<number[]> {
  const data = await getJson(`/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`);
  return data.map((d: any) => parseFloat(d.fundingRate) * 100);
}

export async function getCurrentPrice(symbol: string): Promise<number> {
  const data = await getJson(`/fapi/v1/ticker/price?symbol=${symbol}`);
  return parseFloat(data.price);
}

/** Get OHLC candles for ATR calculation. Returns array of {high, low, close}. */
export async function getOhlcSeries(symbol: string, interval = '15m', limit = 15): Promise<{high: number; low: number; close: number}[]> {
  const data = await getJson(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return data.map((k: any) => ({
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
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
