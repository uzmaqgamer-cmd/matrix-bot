import { getCloseSeries, getOpenInterestSeries, getFundingRateSeries, getTopSymbolsByVolume } from './binance.js';
import { classify } from './classifier.js';
import { lookupRow, isDivergenceRow } from './matrix.js';
import { updateWatchlist } from './watchlist.js';
import { buildSignal } from './signalBuilder.js';
import { loadState, saveState, getOrCreateDailyStats } from './storage.js';
import { formatSignalMessage } from './formatter.js';
import type { Telegram } from 'telegraf';
import { Markup } from 'telegraf';

const TOP_N = 600;
const CANDLE_INTERVAL = '15m';
const OI_PERIOD = '15m';
const LOOKBACK_CANDLES = 20;
const FUNDING_LOOKBACK = 4;

let telegramRef: Telegram | null = null;
let adminChatId: string = '';

export function initScanner(telegram: Telegram, chatId: string) {
  telegramRef = telegram;
  adminChatId = chatId;
}

export async function scanSymbol(symbol: string) {
  try {
    const [priceSeries, oiSeries, fundingSeries] = await Promise.all([
      getCloseSeries(symbol, CANDLE_INTERVAL, LOOKBACK_CANDLES),
      getOpenInterestSeries(symbol, OI_PERIOD, LOOKBACK_CANDLES),
      getFundingRateSeries(symbol, FUNDING_LOOKBACK + 1),
    ]);
    if (priceSeries.length < 2 || oiSeries.length < 2 || fundingSeries.length < 2) return null;
    const { oi, price, funding } = classify({ priceSeries, oiSeries, fundingSeries });
    return lookupRow(oi, price, funding);
  } catch {
    return null;
  }
}

export async function sendSignal(params: {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  matrixRow: number;
  matrixMeaning: string;
  originRow: number;
  originPriority: 'HIGH' | 'MEDIUM';
}, forceSend = false) {
  if (!telegramRef || !adminChatId) return;

  const state = loadState();
  if (!state.signalsEnabled && !forceSend) return;

  // Don't send if already pending or active for this symbol
  if (state.pendingSignals.some(s => s.symbol === params.symbol)) return;
  if (state.activeSignals.some(s => s.symbol === params.symbol)) return;

  const signal = await buildSignal(params);
  if (!signal) return;

  try {
    const text = formatSignalMessage(signal);
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('✅ Accept', `accept_${signal.id}`),
      Markup.button.callback('❌ Ignore', `ignore_${signal.id}`),
    ]);
    const msg = await telegramRef.sendMessage(adminChatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
    });
    signal.messageId = msg.message_id;
    signal.status = 'pending';

    state.pendingSignals.push(signal);
    state.totalSent++;
    getOrCreateDailyStats(state).sent++;
    saveState(state);

    console.log(`[scanner] Signal sent: ${params.symbol} ${params.direction}`);
  } catch (err) {
    console.error('[scanner] Failed to send signal:', err);
  }
}

// Last scan summary for /scan command
export let lastScanSummary: {
  startedAt: number;
  finishedAt: number | null;
  scanned: number;
  total: number;
  watchlistCount: number;
  signalsSent: number;
  inProgress: boolean;
} = { startedAt: 0, finishedAt: null, scanned: 0, total: 0, watchlistCount: 0, signalsSent: 0, inProgress: false };

export async function runFullScan(silent = false) {
  const state = loadState();
  if (!state.signalsEnabled) return;

  let symbols: string[];
  try {
    symbols = await getTopSymbolsByVolume(TOP_N);
  } catch (err) {
    console.warn('[scanner] Failed to get symbols:', err);
    return;
  }

  console.log(`[scanner] Full scan: ${symbols.length} pairs @ ${new Date().toISOString()}`);

  lastScanSummary = {
    startedAt: Date.now(),
    finishedAt: null,
    scanned: 0,
    total: symbols.length,
    watchlistCount: 0,
    signalsSent: 0,
    inProgress: true,
  };

  let signalsSent = 0;

  for (const symbol of symbols) {
    const matrixRow = await scanSymbol(symbol);
    lastScanSummary.scanned++;
    if (!matrixRow) continue;

    const freshState = loadState();
    const action = updateWatchlist(symbol, matrixRow, freshState);
    saveState(freshState);

    if (action.type === 'ESCALATED') {
      const direction = matrixRow.outlook === 'PUMP' ? 'LONG' : 'SHORT';
      await sendSignal({
        symbol,
        direction,
        matrixRow: matrixRow.row,
        matrixMeaning: matrixRow.meaning,
        originRow: action.originRow,
        originPriority: action.originPriority,
      });
      signalsSent++;
    }
  }

  const finalState = loadState();
  lastScanSummary.finishedAt = Date.now();
  lastScanSummary.watchlistCount = Object.keys(finalState.watchlist).length;
  lastScanSummary.signalsSent = signalsSent;
  lastScanSummary.inProgress = false;

  const elapsed = ((lastScanSummary.finishedAt - lastScanSummary.startedAt) / 1000).toFixed(1);
  console.log(`[scanner] Full scan done: ${symbols.length} pairs in ${elapsed}s | watchlist: ${lastScanSummary.watchlistCount} | signals: ${signalsSent}`);

  // Send summary to Telegram (non-silent mode or if signals were found)
  if (!silent && telegramRef && adminChatId && signalsSent === 0) {
    try {
      await telegramRef.sendMessage(
        adminChatId,
        `🔍 <b>Scan complete</b> — ${symbols.length} pairs in ${elapsed}s\n` +
        `Radar: <b>${lastScanSummary.watchlistCount}</b> diverging  |  Signals sent: <b>${signalsSent}</b>`,
        { parse_mode: 'HTML' }
      );
    } catch { /* non-critical */ }
  }
}

export async function runWatchlistScan() {
  const state = loadState();
  if (!state.signalsEnabled) return;

  const symbols = Object.keys(state.watchlist);
  if (symbols.length === 0) return;

  console.log(`[scanner] Watchlist scan: ${symbols.length} pairs`);

  for (const symbol of symbols) {
    const matrixRow = await scanSymbol(symbol);
    if (!matrixRow) continue;

    const freshState = loadState();
    const action = updateWatchlist(symbol, matrixRow, freshState);
    saveState(freshState);

    if (action.type === 'ESCALATED') {
      const direction = matrixRow.outlook === 'PUMP' ? 'LONG' : 'SHORT';
      await sendSignal({
        symbol,
        direction,
        matrixRow: matrixRow.row,
        matrixMeaning: matrixRow.meaning,
        originRow: action.originRow,
        originPriority: action.originPriority,
      });
    }
  }
}

/** Get current radar data — all watchlist pairs sorted by priority then cycles watched. */
export function getRadarData(state: ReturnType<typeof loadState>) {
  const entries = Object.entries(state.watchlist)
    .map(([symbol, entry]) => ({
      symbol,
      row: entry.row,
      priority: entry.priority,
      cyclesWatched: entry.cyclesWatched,
      meaning: '',  // filled below
    }));

  // Sort: HIGH priority first, then by cycles watched (most watched = closest to resolving)
  entries.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'HIGH' ? -1 : 1;
    return b.cyclesWatched - a.cyclesWatched;
  });

  return entries;
}
