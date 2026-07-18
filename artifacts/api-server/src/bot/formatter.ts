import type { Signal, BotState } from './types.js';

// All messages use HTML parse_mode — more predictable than Markdown for dynamic content.

function fmtPrice(p: number): string {
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(6);
  return p.toFixed(8);
}

function pctChange(entry: number, target: number): string {
  const v = ((target - entry) / entry) * 100;
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtTime(ts: number): string {
  return new Date(ts).toUTCString().replace(' GMT', ' UTC');
}

function esc(s: string): string {
  // Escape HTML special chars for Telegram HTML mode
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatSignalMessage(signal: Signal): string {
  const emoji = signal.direction === 'LONG' ? '🟢' : '🔴';
  const tpPct = pctChange(signal.entry, signal.tp);
  const slPct = pctChange(signal.entry, signal.sl);
  return (
    `${emoji} <b>MATRIX SIGNAL — ${signal.direction}</b>\n` +
    `Pair: <code>${esc(signal.symbol)}</code>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Entry:  <code>${fmtPrice(signal.entry)}</code>\n` +
    `TP:     <code>${fmtPrice(signal.tp)}</code>  (${esc(tpPct)})\n` +
    `SL:     <code>${fmtPrice(signal.sl)}</code>  (${esc(slPct)})\n` +
    `R/R:    1:${signal.rr.toFixed(1)}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Matrix Row #${signal.matrixRow} — <i>${esc(signal.matrixMeaning)}</i>\n` +
    `Origin: Row #${signal.originRow} (${esc(signal.originPriority)} priority)\n` +
    `ATR: <code>${fmtPrice(signal.atr)}</code>\n` +
    `Time: ${esc(fmtTime(signal.createdAt))}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<i>Accept to track (max 5 active). Ignored signals don't count.</i>`
  );
}

export function formatTpHitMessage(signal: Signal, exitPrice: number): string {
  const pnl = signal.direction === 'LONG'
    ? ((exitPrice - signal.entry) / signal.entry * 100).toFixed(2)
    : ((signal.entry - exitPrice) / signal.entry * 100).toFixed(2);
  return (
    `✅ <b>TP HIT — ${esc(signal.symbol)}</b>\n` +
    `Direction: ${signal.direction}\n` +
    `Entry: <code>${fmtPrice(signal.entry)}</code> → Exit: <code>${fmtPrice(exitPrice)}</code>\n` +
    `PnL: <b>+${pnl}%</b>  (R/R 1:${signal.rr.toFixed(1)})\n` +
    `ID: <code>${signal.id}</code>`
  );
}

export function formatSlHitMessage(signal: Signal, exitPrice: number): string {
  const loss = signal.direction === 'LONG'
    ? ((signal.entry - exitPrice) / signal.entry * 100).toFixed(2)
    : ((exitPrice - signal.entry) / signal.entry * 100).toFixed(2);
  return (
    `❌ <b>SL HIT — ${esc(signal.symbol)}</b>\n` +
    `Direction: ${signal.direction}\n` +
    `Entry: <code>${fmtPrice(signal.entry)}</code> → Exit: <code>${fmtPrice(exitPrice)}</code>\n` +
    `Loss: <b>-${loss}%</b>\n` +
    `ID: <code>${signal.id}</code>`
  );
}

export function formatWinRate(state: BotState): string {
  const total = state.totalTpHit + state.totalSlHit;
  const wr = total === 0 ? 0 : (state.totalTpHit / total * 100);
  return (
    `📊 <b>Win Rate Stats</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Signals sent:    ${state.totalSent}\n` +
    `Accepted:        ${state.totalAccepted}\n` +
    `Ignored:         ${state.totalIgnored}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `✅ TP hits (wins): ${state.totalTpHit}\n` +
    `❌ SL hits (loss): ${state.totalSlHit}\n` +
    `Win rate:        <b>${wr.toFixed(1)}%</b>\n` +
    `Active:          ${state.activeSignals.length}/5\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    (total === 0 ? '<i>No closed trades yet.</i>' : `<i>Based on ${total} closed signals.</i>`)
  );
}

export function formatDailyResults(state: BotState): string {
  const today = new Date().toISOString().slice(0, 10);
  const stats = state.dailyStats.find(d => d.date === today);

  const todayActive = state.activeSignals.filter(s =>
    new Date(s.createdAt).toISOString().slice(0, 10) === today
  );
  const todayDone = state.completedSignals.filter(s =>
    new Date(s.resolvedAt ?? s.createdAt).toISOString().slice(0, 10) === today
  );

  let msg = `📅 <b>Daily Results — ${today}</b>\n━━━━━━━━━━━━━━━━━━\n`;
  if (!stats && todayActive.length === 0 && todayDone.length === 0) {
    return msg + '<i>No signals today yet.</i>';
  }
  if (stats) {
    const total = stats.tpHit + stats.slHit;
    msg += `Sent: ${stats.sent}  |  Accepted: ${stats.accepted}\n`;
    msg += `✅ TP: ${stats.tpHit}  |  ❌ SL: ${stats.slHit}\n`;
    if (total > 0) msg += `Win rate: <b>${(stats.tpHit / total * 100).toFixed(1)}%</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
  }
  if (todayActive.length > 0) {
    msg += `<b>Active (${todayActive.length}):</b>\n`;
    for (const s of todayActive) {
      const ico = s.direction === 'LONG' ? '🟢' : '🔴';
      msg += `  ${ico} ${esc(s.symbol)} | TP <code>${fmtPrice(s.tp)}</code> | SL <code>${fmtPrice(s.sl)}</code>\n`;
    }
  }
  if (todayDone.length > 0) {
    msg += `<b>Closed:</b>\n`;
    for (const s of todayDone) {
      const ico = s.status === 'tp_hit' ? '✅' : '❌';
      msg += `  ${ico} ${esc(s.symbol)} ${s.direction}\n`;
    }
  }
  return msg;
}

export function formatActiveSignals(state: BotState): string {
  if (state.activeSignals.length === 0) {
    return `📋 <b>Active Signals (0/5)</b>\n\n<i>No active signals. Accept a signal to start tracking.</i>`;
  }
  let msg = `📋 <b>Active Signals (${state.activeSignals.length}/5)</b>\n━━━━━━━━━━━━━━━━━━\n`;
  for (const s of state.activeSignals) {
    const ico = s.direction === 'LONG' ? '🟢' : '🔴';
    msg += `${ico} <b>${esc(s.symbol)}</b> — ${s.direction}\n`;
    msg += `  Entry: <code>${fmtPrice(s.entry)}</code>\n`;
    msg += `  TP: <code>${fmtPrice(s.tp)}</code>  |  SL: <code>${fmtPrice(s.sl)}</code>\n\n`;
  }
  return msg;
}

export function formatTestResults(results: {label: string; passed: boolean}[], passed: number, failed: number): string {
  let msg = `🧪 <b>Test Results</b>\n━━━━━━━━━━━━━━━━━━\n`;
  for (const r of results) msg += `${r.passed ? '✅' : '❌'} ${esc(r.label)}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n<b>${passed} passed, ${failed} failed</b>`;
  return msg;
}

export function formatRadar(state: BotState, radarData: {symbol: string; row: number; meaning: string; priority: string; cyclesWatched: number}[]): string {
  if (radarData.length === 0) {
    return `🎯 <b>Signal Radar</b>\n━━━━━━━━━━━━━━━━━━\n<i>No pairs in divergence zone right now.\nScanner checks every 5 min.</i>`;
  }
  let msg = `🎯 <b>Signal Radar — ${radarData.length} pairs diverging</b>\n`;
  msg += `<i>These need 1 more confirmation to fire a signal.</i>\n━━━━━━━━━━━━━━━━━━\n`;
  for (const p of radarData) {
    const prio = p.priority === 'HIGH' ? '🔥' : '⚡';
    msg += `${prio} <b>${esc(p.symbol)}</b>  Row #${p.row}\n`;
    msg += `   <i>${esc(p.meaning)}</i>  |  ${p.cyclesWatched} cycles\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━\n<i>Use "Send Signal" buttons to manually fire a signal now.</i>`;
  return msg;
}

export { fmtPrice, esc };
