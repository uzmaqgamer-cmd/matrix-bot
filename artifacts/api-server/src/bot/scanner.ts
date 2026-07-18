import { getCloseSeries, getOpenInterestSeries, getFundingRateSeries, getTopSymbolsByVolume } from './binance.js';
import { classify } from './classifier.js';
import { lookupRow } from './matrix.js';
import { updateWatchlist } from './watchlist.js';
import { buildSignal } from './signalBuilder.js';
import { loadState, saveState, getOrCreateDailyStats } from './storage.js';
import { formatSignalMessage } from './formatter.js';
import type { Telegram } from 'telegraf';
import { Markup } from 'telegraf';

const TOP_N = 50; // Scan top 50 by volume (reduces API load)
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

async function scanSymbol(symbol: string) {
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

async function sendSignal(params: {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  matrixRow: number;
  matrixMeaning: string;
  originRow: number;
  originPriority: 'HIGH' | 'MEDIUM';
}) {
  if (!telegramRef || !adminChatId) return;

  const state = loadState();
  if (!state.signalsEnabled) return;

  // Don't send if already pending a signal for this symbol
  if (state.pendingSignals.some(s => s.symbol === params.symbol)) return;
  // Don't send if already active for this symbol
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
      parse_mode: 'Markdown',
      reply_markup: keyboard.reply_markup,
    });
    signal.messageId = msg.message_id;
    signal.status = 'pending';

    state.pendingSignals.push(signal);
    state.totalSent++;
    getOrCreateDailyStats(state).sent++;
    saveState(state);

    console.log(`[scanner] Signal sent for ${params.symbol} ${params.direction}`);
  } catch (err) {
    console.error('[scanner] Failed to send signal:', err);
  }
}

export async function runFullScan() {
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

  for (const symbol of symbols) {
    const matrixRow = await scanSymbol(symbol);
    if (!matrixRow) continue;

    const action = updateWatchlist(symbol, matrixRow, state);
    saveState(state);

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

export async function runWatchlistScan() {
  const state = loadState();
  if (!state.signalsEnabled) return;

  const symbols = Object.keys(state.watchlist);
  if (symbols.length === 0) return;

  console.log(`[scanner] Watchlist scan: ${symbols.length} pairs`);

  for (const symbol of symbols) {
    const matrixRow = await scanSymbol(symbol);
    if (!matrixRow) continue;

    const action = updateWatchlist(symbol, matrixRow, state);
    saveState(state);

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
