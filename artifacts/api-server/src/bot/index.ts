import { Telegraf, Markup } from 'telegraf';
import { loadState, saveState, getOrCreateDailyStats } from './storage.js';
import { openTrade } from './trader.js';
import {
  formatWinRate, formatDailyResults, formatActiveSignals,
  formatTestResults, formatRadar, fmtPrice, esc,
} from './formatter.js';
import { runFullScan, runWatchlistScan, initScanner, sendSignal, scanSymbol, getRadarData, lastScanSummary } from './scanner.js';
import { checkActiveSignals, initTracker, monitorPositionTheses } from './tracker.js';
import { runOfflineTests } from './tests.js';
import { MATRIX } from './matrix.js';

const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN']!;
const ADMIN_ID  = process.env['TELEGRAM_ADMIN_ID'] || process.env['TELEGRAM_CHAT_ID'] || '';

if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Telegraf(BOT_TOKEN);

// ─── Guards ───────────────────────────────────────────────────────────────────

function isAdmin(ctx: any): boolean {
  return String(ctx.from?.id) === String(ADMIN_ID);
}

// ─── Main menu ────────────────────────────────────────────────────────────────

function mainKeyboard(enabled: boolean, mode: import('./types.js').SignalMode) {
  const toggleLabel = enabled
    ? '🟢 Signals: ON  — tap to disable'
    : '🔴 Signals: OFF — tap to enable';
  const modeLabel = mode === 'LIMITED'
    ? '🔢 Mode: LIMITED (5 max) — tap to switch'
    : '♾️  Mode: UNLIMITED (all auto) — tap to switch';
  return Markup.inlineKeyboard([
    [Markup.button.callback(toggleLabel, 'toggle_signals')],
    [Markup.button.callback(modeLabel, 'toggle_mode')],
    [
      Markup.button.callback('📋 Active', 'show_active'),
      Markup.button.callback('📊 Win Rate', 'show_winrate'),
      Markup.button.callback('📅 Daily', 'show_daily'),
    ],
    [
      Markup.button.callback('🎯 Radar', 'show_radar'),
      Markup.button.callback('🧪 Run Tests', 'run_tests'),
    ],
  ]);
}

function mainMenuText(state: ReturnType<typeof loadState>): string {
  const total = state.totalTpHit + state.totalSlHit;
  const wr = total === 0 ? 'n/a' : `${(state.totalTpHit / total * 100).toFixed(1)}%`;
  const mode = state.signalMode ?? 'LIMITED';
  const cap = mode === 'LIMITED' ? '/5' : '/∞';
  const pendingLine = mode === 'LIMITED'
    ? `Pending: ${state.pendingSignals.length}\n`
    : '';
  return (
    `🤖 <b>Matrix Signal Bot</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Status:  ${state.signalsEnabled ? '🟢 Scanning (600 pairs)' : '🔴 Paused'}\n` +
    `Mode:    ${mode === 'LIMITED' ? '🔢 LIMITED (5 max, manual accept)' : '♾️  UNLIMITED (auto-track all)'}\n` +
    `Active:  ${state.activeSignals.length}${cap}\n` +
    pendingLine +
    `Radar:   ${Object.keys(state.watchlist).length} pairs diverging\n` +
    `Win rate: ${wr}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<i>OI + Price + Funding Rate matrix scanner</i>`
  );
}

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.reply('⛔ Unauthorized.');
  const state = loadState();
  await ctx.reply(mainMenuText(state), {
    parse_mode: 'HTML',
    reply_markup: mainKeyboard(state.signalsEnabled, state.signalMode ?? 'LIMITED').reply_markup,
  });
});

bot.command('status', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const state = loadState();
  await ctx.reply(mainMenuText(state), {
    parse_mode: 'HTML',
    reply_markup: mainKeyboard(state.signalsEnabled, state.signalMode ?? 'LIMITED').reply_markup,
  });
});

bot.command('reset', async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.reply('⛔ Unauthorized.');
  const state = loadState();
  // Wipe all paper stats — keep signals on/off and mode setting
  state.activeSignals    = [];
  state.pendingSignals   = [];
  state.completedSignals = [];
  state.dailyStats       = [];
  state.balanceLog       = [];
  state.watchlist        = {};
  state.paperBalance     = 100;
  state.totalSent        = 0;
  state.totalAccepted    = 0;
  state.totalIgnored     = 0;
  state.totalTpHit       = 0;
  state.totalSlHit       = 0;
  state.test2StartedAt   = 0;
  state.test2TradeCount  = 0;
  saveState(state);
  await ctx.reply('✅ Reset complete. Paper balance restarted at $100.00. All trade history cleared.');
});

bot.command('winrate', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const state = loadState();
  await ctx.reply(formatWinRate(state), { parse_mode: 'HTML' });
});

bot.command('daily', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const state = loadState();
  await ctx.reply(formatDailyResults(state), { parse_mode: 'HTML' });
});

bot.command('active', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const state = loadState();
  await ctx.reply(formatActiveSignals(state), { parse_mode: 'HTML' });
});

bot.command('radar', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await handleRadar(ctx);
});

bot.command('scan', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const s = lastScanSummary;
  const state = loadState();

  if (s.inProgress) {
    const pct = s.total > 0 ? ((s.scanned / s.total) * 100).toFixed(0) : '0';
    await ctx.reply(
      `⏳ <b>Scan in progress…</b>\n` +
      `Checked ${s.scanned}/${s.total} pairs (${pct}%)\n` +
      `Radar so far: ${Object.keys(state.watchlist).length} diverging`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (s.startedAt === 0) {
    await ctx.reply(
      `📡 <b>No scan run yet.</b>\n` +
      `Signals ${state.signalsEnabled ? 'are ON' : 'are OFF — tap /start to enable'}.\n` +
      `First full scan fires 5 min after enabling.\n\n` +
      `Use /forcescan to run one immediately.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const elapsed = s.finishedAt
    ? ((s.finishedAt - s.startedAt) / 1000).toFixed(1)
    : '—';
  const ago = s.finishedAt
    ? Math.round((Date.now() - s.finishedAt) / 1000)
    : null;
  const agoStr = ago !== null
    ? ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`
    : '—';

  await ctx.reply(
    `📡 <b>Last Scan Report</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Finished: ${agoStr}\n` +
    `Pairs scanned: <b>${s.scanned}</b> / ${s.total}\n` +
    `Time taken: ${elapsed}s\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🎯 Radar (diverging): <b>${s.watchlistCount}</b>\n` +
    `📤 Signals sent: <b>${s.signalsSent}</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<i>Next full scan in ~5 min. Use /forcescan to run now.</i>`,
    { parse_mode: 'HTML' }
  );
});

bot.command('forcescan', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const state = loadState();
  if (!state.signalsEnabled) {
    await ctx.reply('⚠️ Signals are OFF. Enable them first via /start.', { parse_mode: 'HTML' });
    return;
  }
  await ctx.reply('🔍 <b>Manual scan started</b> — scanning 600 pairs now. I\'ll update you when done.', { parse_mode: 'HTML' });
  runFullScan(false).catch(console.error);
});

bot.command('test', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply('🧪 Running offline logic tests...');
  const { results, passed, failed } = runOfflineTests();
  await ctx.reply(formatTestResults(results, passed, failed), { parse_mode: 'HTML' });
});

// ─── Toggle ───────────────────────────────────────────────────────────────────

bot.action('toggle_signals', async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.answerCbQuery('⛔ Unauthorized');
  const state = loadState();
  state.signalsEnabled = !state.signalsEnabled;
  saveState(state);
  await ctx.answerCbQuery(state.signalsEnabled ? '🟢 Signals enabled!' : '🔴 Signals disabled');
  try {
    await ctx.editMessageText(mainMenuText(state), {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard(state.signalsEnabled, state.signalMode ?? 'LIMITED').reply_markup,
    });
  } catch { /* message may be stale */ }
  if (state.signalsEnabled) {
    setImmediate(() => runFullScan().catch(console.error));
  }
});

// ─── Mode toggle ──────────────────────────────────────────────────────────────

bot.action('toggle_mode', async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.answerCbQuery('⛔ Unauthorized');
  const state = loadState();
  const prev = state.signalMode ?? 'LIMITED';
  state.signalMode = prev === 'LIMITED' ? 'UNLIMITED' : 'LIMITED';
  saveState(state);

  const label = state.signalMode === 'LIMITED'
    ? '🔢 Switched to LIMITED — signals need manual accept (max 5)'
    : '♾️ Switched to UNLIMITED — all signals auto-tracked immediately';
  await ctx.answerCbQuery(label);

  try {
    await ctx.editMessageText(mainMenuText(state), {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard(state.signalsEnabled, state.signalMode).reply_markup,
    });
  } catch { /* message may be stale */ }
});

// ─── Menu buttons ─────────────────────────────────────────────────────────────

bot.action('show_active', async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.answerCbQuery('⛔');
  await ctx.answerCbQuery();
  const state = loadState();
  await ctx.reply(formatActiveSignals(state), { parse_mode: 'HTML' });
});

bot.action('show_winrate', async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.answerCbQuery('⛔');
  await ctx.answerCbQuery();
  const state = loadState();
  await ctx.reply(formatWinRate(state), { parse_mode: 'HTML' });
});

bot.action('show_daily', async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.answerCbQuery('⛔');
  await ctx.answerCbQuery();
  const state = loadState();
  await ctx.reply(formatDailyResults(state), { parse_mode: 'HTML' });
});

bot.action('run_tests', async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.answerCbQuery('⛔');
  await ctx.answerCbQuery('Running tests...');
  const { results, passed, failed } = runOfflineTests();
  await ctx.reply(formatTestResults(results, passed, failed), { parse_mode: 'HTML' });
});

// ─── Radar ────────────────────────────────────────────────────────────────────

async function handleRadar(ctx: any) {
  await ctx.answerCbQuery?.();
  const state = loadState();
  const radarEntries = getRadarData(state);

  // Enrich with meaning from matrix
  const enriched = radarEntries.map(e => {
    const row = MATRIX.find(r => r.row === e.row);
    return { ...e, meaning: row?.meaning ?? '' };
  });

  const text = formatRadar(state, enriched.slice(0, 20)); // show top 20

  // Build inline keyboard: "Send Signal" button for top 8 pairs
  const topPairs = enriched.slice(0, 8);
  const buttons = topPairs.map(p =>
    Markup.button.callback(
      `${p.priority === 'HIGH' ? '🔥' : '⚡'} ${p.symbol}`,
      `radar_signal_${p.symbol}`
    )
  );
  // Group into rows of 2
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([Markup.button.callback('🔄 Refresh', 'show_radar')]);
  const keyboard = Markup.inlineKeyboard(rows);

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
}

bot.action('show_radar', async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.answerCbQuery('⛔');
  await handleRadar(ctx);
});

// Dynamic: fire a manual signal for a radar pair
bot.action(/^radar_signal_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.answerCbQuery('⛔');
  const symbol = ctx.match[1];
  await ctx.answerCbQuery(`Scanning ${symbol}...`);

  const state = loadState();
  const entry = state.watchlist[symbol];
  if (!entry) {
    await ctx.reply(`⚠️ <b>${esc(symbol)}</b> is no longer in the radar (may have resolved).`, { parse_mode: 'HTML' });
    return;
  }

  await ctx.reply(`🔍 Scanning <b>${esc(symbol)}</b> and building signal...`, { parse_mode: 'HTML' });

  try {
    const matrixRow = await scanSymbol(symbol);
    if (!matrixRow) {
      await ctx.reply(`⚠️ Could not fetch data for <b>${esc(symbol)}</b>.`, { parse_mode: 'HTML' });
      return;
    }

    const direction = matrixRow.outlook === 'DUMP' ? 'SHORT' : 'LONG';
    await sendSignal({
      symbol,
      direction,
      matrixRow: matrixRow.row,
      matrixMeaning: matrixRow.meaning,
      originRow: entry.row,
      originPriority: entry.priority,
    }, true /* forceSend */);
  } catch (err) {
    console.error('[radar_signal] Error:', err);
    await ctx.reply(`❌ Failed to build signal for <b>${esc(symbol)}</b>.`, { parse_mode: 'HTML' });
  }
});

// ─── Accept / Ignore ──────────────────────────────────────────────────────────

bot.action(/^accept_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.answerCbQuery('⛔');
  const signalId = ctx.match[1];
  const state = loadState();

  const idx = state.pendingSignals.findIndex(s => s.id === signalId);
  if (idx === -1) return void ctx.answerCbQuery('Signal already handled.');

  if ((state.signalMode ?? 'LIMITED') === 'LIMITED' && state.activeSignals.length >= 5) {
    return void ctx.answerCbQuery('⚠️ 5 active signals already. Switch to Unlimited mode or close one first.');
  }

  const signal = state.pendingSignals[idx];
  signal.status = 'accepted';
  // Stamp compounding risk amounts at the moment of acceptance (Test 2)
  signal.balanceAtEntry = state.paperBalance;
  signal.riskAmt = parseFloat((state.paperBalance * 0.01).toFixed(4));
  state.activeSignals.push(signal);
  state.pendingSignals.splice(idx, 1);
  state.totalAccepted++;
  getOrCreateDailyStats(state).accepted++;
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
    } else {
      signal.liveError = result.error;
    }
    saveState(state);
  }).catch(err => console.error('[bot] openTrade unexpected error:', err));

  await ctx.answerCbQuery('✅ Signal accepted! Tracking started.');
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[{ text: '✅ Accepted — Tracking', callback_data: 'noop' }]],
    });
  } catch { /* ok */ }

  const cap = (state.signalMode ?? 'LIMITED') === 'LIMITED' ? '/5' : '/∞';
  await ctx.reply(
    `✅ <b>Tracking: ${esc(signal.symbol)}</b>\n` +
    `Entry <code>${fmtPrice(signal.entry)}</code>  |  TP <code>${fmtPrice(signal.tp)}</code>  |  SL <code>${fmtPrice(signal.sl)}</code>\n` +
    `Active: ${state.activeSignals.length}${cap}`,
    { parse_mode: 'HTML' }
  );
});

bot.action(/^ignore_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return void ctx.answerCbQuery('⛔');
  const signalId = ctx.match[1];
  const state = loadState();

  const idx = state.pendingSignals.findIndex(s => s.id === signalId);
  if (idx === -1) return void ctx.answerCbQuery('Signal not found.');

  const signal = state.pendingSignals[idx];
  signal.status = 'ignored';
  state.pendingSignals.splice(idx, 1);
  state.totalIgnored++;
  getOrCreateDailyStats(state).ignored++;
  saveState(state);

  await ctx.answerCbQuery('❌ Ignored — not counted toward limit.');
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[{ text: '❌ Ignored', callback_data: 'noop' }]],
    });
  } catch { /* ok */ }
});

bot.action('noop', (ctx) => ctx.answerCbQuery());

// ─── Error handler ────────────────────────────────────────────────────────────

bot.catch((err: any) => {
  console.error('[bot] Error:', err?.message ?? err);
});

// ─── Start ────────────────────────────────────────────────────────────────────

/**
 * Start scanner + tracker loops only — no Telegram polling.
 * Safe to call in any environment; Telegram alerts (sendMessage) still work
 * because bot.telegram is an HTTP client that doesn't need bot.launch().
 * Called in both dev and production so the dashboard always shows live data.
 */
export function startScanners(): void {
  initScanner(bot.telegram, ADMIN_ID);
  initTracker(bot.telegram, ADMIN_ID);

  let checkInProgress = false;
  setInterval(() => {
    if (checkInProgress) {
      console.log('[tracker] checkActiveSignals skipped — previous run still in progress');
      return;
    }
    checkInProgress = true;
    checkActiveSignals()
      .catch(console.error)
      .finally(() => { checkInProgress = false; });
  }, 5 * 1000);

  // Full scan every 5 minutes — fire immediately on startup too
  setInterval(() => runFullScan().catch(console.error), 5 * 60 * 1000);
  setImmediate(() => runFullScan().catch(console.error));

  // Watchlist tight scan every 60 seconds
  setInterval(() => runWatchlistScan().catch(console.error), 60 * 1000);

  // Thesis invalidation monitor
  setInterval(() => monitorPositionTheses().catch(console.error), 60 * 1000);

  console.log('[bot] Scanners and tracker started.');
}

/**
 * Full production start: scanners + Telegram command polling.
 * Only call this in production to avoid 409 Conflict with the deployed bot.
 */
export function startBot(): void {
  startScanners();

  // ── Connect Telegram separately with auto-retry ────────────────────────────
  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  function launchTelegram(): void {
    console.log('[bot] Connecting to Telegram…');
    bot.launch({ dropPendingUpdates: true })
      .then(() => {
        console.log('[bot] Telegram connected. Matrix Signal Bot fully online.');
      })
      .catch((err: Error & { response?: { error_code?: number } }) => {
        const is409 = err?.response?.error_code === 409 ||
                      (err?.message ?? '').includes('409');
        if (is409) {
          console.error('[bot] 409 Conflict — two instances running simultaneously. Exiting.');
          process.exit(1);
        }
        console.warn('[bot] Telegram launch failed, retrying in 60s:', err.message);
        setTimeout(launchTelegram, 60_000);
      });
  }

  launchTelegram();
  console.log('[bot] Connecting to Telegram in background…');
}

export { bot };
