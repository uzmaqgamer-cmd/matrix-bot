import { Telegraf, Markup } from 'telegraf';
import { loadState, saveState, getOrCreateDailyStats } from './storage.js';
import { formatWinRate, formatDailyResults, formatActiveSignals, formatSignalMessage } from './formatter.js';
import { runFullScan, runWatchlistScan, initScanner } from './scanner.js';
import { checkActiveSignals, initTracker } from './tracker.js';
import { runOfflineTests } from './tests.js';

const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN']!;
const ADMIN_ID = process.env['TELEGRAM_ADMIN_ID'] || process.env['TELEGRAM_CHAT_ID'] || '';

if (!BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
}

const bot = new Telegraf(BOT_TOKEN);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAdmin(ctx: any): boolean {
  return String(ctx.from?.id) === String(ADMIN_ID);
}

function signalsToggleKeyboard(enabled: boolean) {
  const label = enabled ? '🟢 Signals: ON  — tap to disable' : '🔴 Signals: OFF — tap to enable';
  return Markup.inlineKeyboard([
    [Markup.button.callback(label, 'toggle_signals')],
    [
      Markup.button.callback('📋 Active', 'show_active'),
      Markup.button.callback('📊 Win Rate', 'show_winrate'),
      Markup.button.callback('📅 Daily', 'show_daily'),
    ],
    [Markup.button.callback('🧪 Run Tests', 'run_tests')],
  ]);
}

function mainMenuText(state: ReturnType<typeof loadState>): string {
  const active = state.activeSignals.length;
  const pending = state.pendingSignals.length;
  const wr = (state.totalTpHit + state.totalSlHit) === 0
    ? 'n/a'
    : `${(state.totalTpHit / (state.totalTpHit + state.totalSlHit) * 100).toFixed(1)}%`;
  return (
    `🤖 *Matrix Signal Bot*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Status: ${state.signalsEnabled ? '🟢 Scanning' : '🔴 Paused'}\n` +
    `Active signals: ${active}/5\n` +
    `Pending: ${pending}\n` +
    `Win rate: ${wr}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `_OI + Price + Funding Rate matrix scanner_`
  );
}

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Unauthorized.');
  const state = loadState();
  await ctx.reply(mainMenuText(state), {
    parse_mode: 'Markdown',
    reply_markup: signalsToggleKeyboard(state.signalsEnabled).reply_markup,
  });
});

bot.command('winrate', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const state = loadState();
  await ctx.reply(formatWinRate(state), { parse_mode: 'Markdown' });
});

bot.command('daily', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const state = loadState();
  await ctx.reply(formatDailyResults(state), { parse_mode: 'Markdown' });
});

bot.command('active', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const state = loadState();
  await ctx.reply(formatActiveSignals(state), { parse_mode: 'Markdown' });
});

bot.command('status', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const state = loadState();
  await ctx.reply(mainMenuText(state), {
    parse_mode: 'Markdown',
    reply_markup: signalsToggleKeyboard(state.signalsEnabled).reply_markup,
  });
});

bot.command('test', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply('🧪 Running offline logic tests...');
  const { results, passed, failed } = runOfflineTests();
  let msg = `🧪 *Test Results*\n━━━━━━━━━━━━━━━━━━\n`;
  for (const r of results) {
    msg += `${r.passed ? '✅' : '❌'} ${r.label}\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━\n${passed} passed, ${failed} failed`;
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ─── Inline button actions ────────────────────────────────────────────────────

bot.action('toggle_signals', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Unauthorized');
  const state = loadState();
  state.signalsEnabled = !state.signalsEnabled;
  saveState(state);
  await ctx.answerCbQuery(state.signalsEnabled ? '🟢 Signals enabled!' : '🔴 Signals disabled');
  await ctx.editMessageText(mainMenuText(state), {
    parse_mode: 'Markdown',
    reply_markup: signalsToggleKeyboard(state.signalsEnabled).reply_markup,
  });
  if (state.signalsEnabled) {
    // Kick off a scan immediately when enabled
    setImmediate(() => runFullScan().catch(console.error));
  }
});

bot.action('show_active', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
  const state = loadState();
  await ctx.answerCbQuery();
  await ctx.reply(formatActiveSignals(state), { parse_mode: 'Markdown' });
});

bot.action('show_winrate', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
  const state = loadState();
  await ctx.answerCbQuery();
  await ctx.reply(formatWinRate(state), { parse_mode: 'Markdown' });
});

bot.action('show_daily', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
  const state = loadState();
  await ctx.answerCbQuery();
  await ctx.reply(formatDailyResults(state), { parse_mode: 'Markdown' });
});

bot.action('run_tests', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
  await ctx.answerCbQuery('Running tests...');
  const { results, passed, failed } = runOfflineTests();
  let msg = `🧪 *Test Results*\n━━━━━━━━━━━━━━━━━━\n`;
  for (const r of results) msg += `${r.passed ? '✅' : '❌'} ${r.label}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n*${passed} passed, ${failed} failed*`;
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ─── Accept / Ignore signal ───────────────────────────────────────────────────

bot.action(/^accept_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
  const signalId = ctx.match[1];
  const state = loadState();

  const idx = state.pendingSignals.findIndex(s => s.id === signalId);
  if (idx === -1) return ctx.answerCbQuery('Signal not found or already handled.');

  const signal = state.pendingSignals[idx];

  if (state.activeSignals.length >= 5) {
    await ctx.answerCbQuery('⚠️ Max 5 active signals reached. Close one first.');
    return;
  }

  // Move from pending → active
  signal.status = 'accepted';
  state.activeSignals.push(signal);
  state.pendingSignals.splice(idx, 1);
  state.totalAccepted++;
  getOrCreateDailyStats(state).accepted++;
  saveState(state);

  await ctx.answerCbQuery('✅ Signal accepted! Tracking started.');
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ Accepted — Tracking', callback_data: 'noop' }]] });
  } catch { /* message may be too old */ }
  await ctx.reply(
    `✅ *Tracking started for ${signal.symbol}*\n` +
    `Entry: \`${signal.entry}\` | TP: \`${signal.tp}\` | SL: \`${signal.sl}\`\n` +
    `Active signals: ${state.activeSignals.length}/5`,
    { parse_mode: 'Markdown' }
  );
});

bot.action(/^ignore_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
  const signalId = ctx.match[1];
  const state = loadState();

  const idx = state.pendingSignals.findIndex(s => s.id === signalId);
  if (idx === -1) return ctx.answerCbQuery('Signal not found.');

  const signal = state.pendingSignals[idx];
  signal.status = 'ignored';
  state.pendingSignals.splice(idx, 1);
  state.totalIgnored++;
  getOrCreateDailyStats(state).ignored++;
  saveState(state);

  await ctx.answerCbQuery('❌ Signal ignored.');
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '❌ Ignored', callback_data: 'noop' }]] });
  } catch { /* ok */ }
});

bot.action('noop', (ctx) => ctx.answerCbQuery());

// ─── Error handler ────────────────────────────────────────────────────────────

bot.catch((err: any) => {
  console.error('[bot] Error:', err?.message ?? err);
});

// ─── Start ────────────────────────────────────────────────────────────────────

export async function startBot() {
  initScanner(bot.telegram, ADMIN_ID);
  initTracker(bot.telegram, ADMIN_ID);

  // TP/SL tracker: check every 30 seconds
  setInterval(() => checkActiveSignals().catch(console.error), 30 * 1000);

  // Full scan every 5 minutes
  setInterval(() => runFullScan().catch(console.error), 5 * 60 * 1000);

  // Watchlist scan every 60 seconds
  setInterval(() => runWatchlistScan().catch(console.error), 60 * 1000);

  await bot.launch({ dropPendingUpdates: true });
  console.log('[bot] Matrix Signal Bot started. Polling Telegram...');

  // Graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export { bot };
