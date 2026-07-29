import { getCloseSeries, getOpenInterestSeries, getFundingRateSeries, getTopSymbolsByVolume, getCachedSymbols } from './binance.js';
import { openTrade } from './trader.js';
import { classify } from './classifier.js';
import { lookupRow, isDivergenceRow, MATRIX } from './matrix.js';
import { updateWatchlist } from './watchlist.js';
import { buildSignal } from './signalBuilder.js';
import { loadState, saveState, getOrCreateDailyStats } from './storage.js';
import { config } from './config.js';
import { formatSignalMessage } from './formatter.js';
import { logActivity, logScan } from './eventLog.js';
import type { Telegram } from 'telegraf';
import { Markup } from 'telegraf';

const TOP_N = 600;
const CANDLE_INTERVAL = '15m';
const OI_PERIOD = '15m';
const LOOKBACK_CANDLES = 20;
const FUNDING_LOOKBACK = 4;

let telegramRef: Telegram | null = null;
let adminChatId: string = '';

const CHANNEL_ID = process.env['TELEGRAM_CHANNEL_ID'] ?? '';

export function initScanner(telegram: Telegram, chatId: string) {
  telegramRef = telegram;
  adminChatId = chatId;
}

async function broadcastSignal(text: string, options: object = {}) {
  await telegramRef!.sendMessage(adminChatId, text, options);
  if (CHANNEL_ID) {
    try { await telegramRef!.sendMessage(CHANNEL_ID, text, { parse_mode: 'HTML' }); }
    catch (e: any) { console.warn('[scanner] Channel send failed:', e.message); }
  }
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

  if (state.pendingSignals.some(s => s.symbol === params.symbol)) return;
  if (state.activeSignals.some(s => s.symbol === params.symbol)) return;

  // ── Max positions cap ────────────────────────────────────────────────────
  if (state.activeSignals.length >= config.positionMonitoring.maxActivePositions) {
    console.log(`[scanner] Max positions (${config.positionMonitoring.maxActivePositions}) reached — skipping ${params.symbol}`);
    return;
  }

  // ── Cooldown guard: prevent re-entry within 20 min of a closed position ──
  // Protects against the reversal-injection loop where auto-close → watchlist
  // re-inject → same matrix row still DUMP/PUMP → immediate re-escalation.
  const COOLDOWN_MS = 20 * 60 * 1000;
  const now = Date.now();
  const recentClose = state.completedSignals.find(
    s => s.symbol === params.symbol && s.resolvedAt && (now - s.resolvedAt) < COOLDOWN_MS
  );
  if (recentClose && !forceSend) {
    const minsAgo = Math.round((now - (recentClose.resolvedAt ?? 0)) / 60000);
    console.log(`[scanner] ${params.symbol} cooldown — closed ${minsAgo}m ago, skipping until ${COOLDOWN_MS / 60000}m elapsed`);
    return;
  }

  const signal = await buildSignal(params);
  if (!signal) return;

  const isUnlimited = state.signalMode === 'UNLIMITED';

  try {
    const text = formatSignalMessage(signal);

    if (isUnlimited) {
      // ─── UNLIMITED MODE: auto-accept, no user prompt ─────────────────────
      signal.status = 'accepted';
      // Stamp compounding risk amounts at the moment of acceptance (Test 2)
      signal.balanceAtEntry = state.paperBalance;
      signal.riskAmt = parseFloat((state.paperBalance * 0.01).toFixed(4));
      state.activeSignals.push(signal);
      state.totalSent++;
      state.totalAccepted++;
      const ds = getOrCreateDailyStats(state);
      ds.sent++;
      ds.accepted++;
      saveState(state);

      // Open a live Binance position if LIVE_TRADING=true on the VPS
      openTrade(signal).then(result => {
        if (result.ok) {
          signal.liveEnabled    = true;
          signal.liveQty        = result.quantity;
          signal.liveOrderId    = result.orderId;
          signal.liveTpOrderId  = result.tpOrderId;
          signal.liveSlOrderId  = result.slOrderId;
          signal.liveFillPrice  = result.fillPrice;
          signal.liveRiskDollar = result.riskDollar;
          console.log(`[scanner] Live trade stamped on signal ${signal.id}`);
        } else {
          signal.liveError = result.error;
          console.warn(`[scanner] Live trade skipped for ${signal.symbol}: ${result.error}`);
        }
        saveState(state);
      }).catch(err => console.error('[scanner] openTrade unexpected error:', err));

      // Admin gets verbose info; channel gets clean signal only
      const autoText =
        `⚡ <b>AUTO-TRACKED</b>\n` +
        text +
        `\n\n<i>Unlimited mode — tracking ${state.activeSignals.length} active signals.</i>`;
      await telegramRef!.sendMessage(adminChatId, autoText, { parse_mode: 'HTML' });
      if (CHANNEL_ID) {
        try { await telegramRef!.sendMessage(CHANNEL_ID, text, { parse_mode: 'HTML' }); }
        catch (e: any) { console.warn('[scanner] Channel send failed:', e.message); }
      }
    } else {
      // ─── LIMITED MODE: send with Accept / Ignore buttons ─────────────────
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('✅ Accept', `accept_${signal.id}`),
        Markup.button.callback('❌ Ignore', `ignore_${signal.id}`),
      ]);
      const msg = await telegramRef.sendMessage(adminChatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
      });
      if (CHANNEL_ID) {
        try { await telegramRef.sendMessage(CHANNEL_ID, text, { parse_mode: 'HTML' }); }
        catch (e: any) { console.warn('[scanner] Channel send failed:', e.message); }
      }
      signal.messageId = msg.message_id;
      signal.status = 'pending';
      state.pendingSignals.push(signal);
      state.totalSent++;
      getOrCreateDailyStats(state).sent++;
      saveState(state);
    }

    logActivity({
      ts: Date.now(),
      text: `SIGNAL ${params.direction}: ${params.symbol} | Row #${params.matrixRow} | R/R 1:${signal.rr}${isUnlimited ? ' [AUTO]' : ''}`,
      kind: 'signal',
      symbol: params.symbol,
    });

    console.log(`[scanner] Signal sent: ${params.symbol} ${params.direction}${isUnlimited ? ' (auto-accepted)' : ''}`);
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
    // Fall back to the last cached symbol list so the scanner never goes dark
    const cached = getCachedSymbols();
    if (cached) {
      console.warn(`[scanner] Symbol fetch failed (using cached ${cached.length}):`, (err as Error).message);
      symbols = cached;
    } else {
      console.warn('[scanner] Symbol fetch failed (no cache — skipping scan):', err);
      return;
    }
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

  // ── Scan symbols in parallel batches ────────────────────────────────────────
  // Each batch fires up to SCAN_BATCH concurrent scanSymbol calls (3 Binance
  // requests each), then state mutations happen sequentially after each batch.
  // This reduces a 600-symbol sequential scan (~18 min) to ~30 batches.
  const SCAN_BATCH = 20;
  const scanResults: Array<{ symbol: string; matrixRow: Awaited<ReturnType<typeof scanSymbol>> }> = [];

  for (let i = 0; i < symbols.length; i += SCAN_BATCH) {
    const batch = symbols.slice(i, i + SCAN_BATCH);
    const batchResults = await Promise.all(
      batch.map(async (symbol) => ({ symbol, matrixRow: await scanSymbol(symbol) }))
    );
    scanResults.push(...batchResults);
    lastScanSummary.scanned += batch.length;
  }

  // ── Process results sequentially (safe: single writer on state) ──────────
  // IMPORTANT: loadState() returns the shared in-memory singleton — same object
  // as `state` above. We call saveState() only ONCE at the end, NOT after every
  // symbol. The old per-symbol saveState() called writeFileSync 530 times per
  // scan, blocking the Node.js event loop for 10+ seconds, which is why
  // Telegram button presses took 15s to respond.
  // `state` is already declared above — reuse it here.
  let watchlistChanged = false;

  for (const { symbol, matrixRow } of scanResults) {
    if (!matrixRow) continue;

    // Feed scan entries to dashboard
    logScan({ symbol, row: matrixRow.row, outlook: matrixRow.outlook, ts: Date.now() });

    const action = updateWatchlist(symbol, matrixRow, state);

    if (action.type === 'ADDED') {
      watchlistChanged = true;
      logActivity({
        ts: Date.now(),
        text: `WATCH: ${symbol} → Row #${matrixRow.row} (${action.priority}) — ${matrixRow.meaning}`,
        kind: 'watch',
        symbol,
      });
    } else if (action.type === 'DROPPED_STABLE') {
      watchlistChanged = true;
      logActivity({
        ts: Date.now(),
        text: `DROP: ${symbol} — false alarm (timed out at Row #${matrixRow.row})`,
        kind: 'drop',
        symbol,
      });
    } else if (action.type === 'ESCALATED') {
      const direction = matrixRow.outlook === 'PUMP' ? 'LONG' : 'SHORT';
      // sendSignal calls saveState() internally when a signal is accepted —
      // that's a real event that must be persisted immediately.
      await sendSignal({
        symbol,
        direction,
        matrixRow: matrixRow.row,
        matrixMeaning: matrixRow.meaning,
        originRow: action.originRow,
        originPriority: action.originPriority,
      });
      signalsSent++;
      watchlistChanged = false; // sendSignal already saved
    }
  }

  // Persist watchlist mutations once at the end (1 write instead of 530)
  if (watchlistChanged) saveState(state);

  const finalState = loadState();
  lastScanSummary.finishedAt = Date.now();
  lastScanSummary.watchlistCount = Object.keys(finalState.watchlist).length;
  lastScanSummary.signalsSent = signalsSent;
  lastScanSummary.inProgress = false;

  const elapsed = ((lastScanSummary.finishedAt - lastScanSummary.startedAt) / 1000).toFixed(1);
  console.log(`[scanner] Full scan done: ${symbols.length} pairs in ${elapsed}s | watchlist: ${lastScanSummary.watchlistCount} | signals: ${signalsSent}`);

  logActivity({
    ts: Date.now(),
    text: `SCAN DONE: ${symbols.length} pairs in ${elapsed}s | radar: ${lastScanSummary.watchlistCount} | signals: ${signalsSent}`,
    kind: 'scan',
    symbol: null,
  });

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

  let watchlistChanged = false;

  for (const symbol of symbols) {
    const matrixRow = await scanSymbol(symbol);
    if (!matrixRow) continue;

    logScan({ symbol, row: matrixRow.row, outlook: matrixRow.outlook, ts: Date.now() });

    const action = updateWatchlist(symbol, matrixRow, state);

    if (action.type === 'ESCALATED') {
      const direction = matrixRow.outlook === 'PUMP' ? 'LONG' : 'SHORT';
      // sendSignal saves internally — no extra save needed
      await sendSignal({
        symbol,
        direction,
        matrixRow: matrixRow.row,
        matrixMeaning: matrixRow.meaning,
        originRow: action.originRow,
        originPriority: action.originPriority,
      });
      watchlistChanged = false;
    } else if (action.type !== 'unchanged') {
      watchlistChanged = true;
    }
  }

  // One write at the end instead of one per symbol
  if (watchlistChanged) saveState(state);
}

export function getRadarData(state: ReturnType<typeof loadState>) {
  const entries = Object.entries(state.watchlist)
    .map(([symbol, entry]) => ({
      symbol,
      row: entry.row,
      priority: entry.priority,
      cyclesWatched: entry.cyclesWatched,
      meaning: '',
    }));

  entries.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'HIGH' ? -1 : 1;
    return b.cyclesWatched - a.cyclesWatched;
  });

  return entries;
}
