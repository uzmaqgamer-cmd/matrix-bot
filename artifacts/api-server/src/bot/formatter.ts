import type { Signal, BotState, DailyStats } from './types.js';

function pct(entry: number, target: number): string {
  return (((target - entry) / entry) * 100).toFixed(2);
}

function fmtPrice(p: number): string {
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(6);
  return p.toFixed(8);
}

function fmtTime(ts: number): string {
  return new Date(ts).toUTCString().replace(' GMT', ' UTC');
}

export function formatSignalMessage(signal: Signal): string {
  const emoji = signal.direction === 'LONG' ? '🟢' : '🔴';
  const dir = signal.direction === 'LONG' ? 'LONG' : 'SHORT';
  const tpPct = signal.direction === 'LONG'
    ? `+${pct(signal.entry, signal.tp)}%`
    : `${pct(signal.entry, signal.tp)}%`;
  const slPct = signal.direction === 'LONG'
    ? `${pct(signal.entry, signal.sl)}%`
    : `+${Math.abs(parseFloat(pct(signal.entry, signal.sl))).toFixed(2)}%`;

  return (
    `${emoji} *MATRIX SIGNAL — ${dir}*\n` +
    `Pair: \`${signal.symbol}\`\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Entry:  \`${fmtPrice(signal.entry)}\`\n` +
    `TP:     \`${fmtPrice(signal.tp)}\` (${tpPct})\n` +
    `SL:     \`${fmtPrice(signal.sl)}\` (${slPct})\n` +
    `R/R:    1:${signal.rr.toFixed(1)}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Matrix: Row #${signal.matrixRow} — _${signal.matrixMeaning}_\n` +
    `Triggered from Row #${signal.originRow} (${signal.originPriority} priority)\n` +
    `ATR: \`${fmtPrice(signal.atr)}\`\n` +
    `Time: ${fmtTime(signal.createdAt)}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `_Accept to start tracking. Max 5 active signals._`
  );
}

export function formatTpHitMessage(signal: Signal, exitPrice: number): string {
  const pnl = signal.direction === 'LONG'
    ? ((exitPrice - signal.entry) / signal.entry * 100).toFixed(2)
    : ((signal.entry - exitPrice) / signal.entry * 100).toFixed(2);
  return (
    `✅ *TP HIT — ${signal.symbol}*\n` +
    `Direction: ${signal.direction}\n` +
    `Entry: \`${fmtPrice(signal.entry)}\` → Exit: \`${fmtPrice(exitPrice)}\`\n` +
    `PnL: +${pnl}% (R/R 1:${signal.rr.toFixed(1)})\n` +
    `Signal ID: \`${signal.id}\``
  );
}

export function formatSlHitMessage(signal: Signal, exitPrice: number): string {
  const loss = signal.direction === 'LONG'
    ? ((signal.entry - exitPrice) / signal.entry * 100).toFixed(2)
    : ((exitPrice - signal.entry) / signal.entry * 100).toFixed(2);
  return (
    `❌ *SL HIT — ${signal.symbol}*\n` +
    `Direction: ${signal.direction}\n` +
    `Entry: \`${fmtPrice(signal.entry)}\` → Exit: \`${fmtPrice(exitPrice)}\`\n` +
    `Loss: -${loss}%\n` +
    `Signal ID: \`${signal.id}\``
  );
}

export function formatWinRate(state: BotState): string {
  const total = state.totalTpHit + state.totalSlHit;
  const wr = total === 0 ? 0 : (state.totalTpHit / total * 100);
  const active = state.activeSignals.length;
  return (
    `📊 *Win Rate Stats*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Total signals sent:    ${state.totalSent}\n` +
    `Accepted:              ${state.totalAccepted}\n` +
    `Ignored:               ${state.totalIgnored}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `TP hits (wins):        ✅ ${state.totalTpHit}\n` +
    `SL hits (losses):      ❌ ${state.totalSlHit}\n` +
    `Win rate:              ${wr.toFixed(1)}%\n` +
    `Active signals:        ${active}/5\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    (total === 0 ? '_No closed trades yet._' : `_Based on ${total} closed signals._`)
  );
}

export function formatDailyResults(state: BotState): string {
  const today = new Date().toISOString().slice(0, 10);
  const stats = state.dailyStats.find(d => d.date === today);

  // Active signals today
  const todayActive = state.activeSignals.filter(s => {
    const d = new Date(s.createdAt).toISOString().slice(0, 10);
    return d === today;
  });

  // Completed today
  const todayDone = state.completedSignals.filter(s => {
    const d = new Date(s.resolvedAt ?? s.createdAt).toISOString().slice(0, 10);
    return d === today;
  });

  let msg = `📅 *Daily Results — ${today}*\n━━━━━━━━━━━━━━━━━━\n`;
  if (!stats && todayActive.length === 0 && todayDone.length === 0) {
    return msg + '_No signals today yet._';
  }
  if (stats) {
    msg += `Signals sent:     ${stats.sent}\n`;
    msg += `Accepted:         ${stats.accepted}\n`;
    msg += `TP hits:          ✅ ${stats.tpHit}\n`;
    msg += `SL hits:          ❌ ${stats.slHit}\n`;
    const total = stats.tpHit + stats.slHit;
    if (total > 0) msg += `Win rate today:   ${(stats.tpHit / total * 100).toFixed(1)}%\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
  }
  if (todayActive.length > 0) {
    msg += `*Active (${todayActive.length}):*\n`;
    for (const s of todayActive) {
      msg += `  ${s.direction === 'LONG' ? '🟢' : '🔴'} ${s.symbol} — entry \`${fmtPrice(s.entry)}\` | TP \`${fmtPrice(s.tp)}\` | SL \`${fmtPrice(s.sl)}\`\n`;
    }
  }
  if (todayDone.length > 0) {
    msg += `*Closed today:*\n`;
    for (const s of todayDone) {
      const icon = s.status === 'tp_hit' ? '✅' : '❌';
      msg += `  ${icon} ${s.symbol} ${s.direction} — ${s.status === 'tp_hit' ? 'TP' : 'SL'}\n`;
    }
  }
  return msg;
}

export function formatActiveSignals(state: BotState): string {
  if (state.activeSignals.length === 0) {
    return `📋 *Active Signals (0/5)*\n\n_No active signals. Accept a signal to start tracking._`;
  }
  let msg = `📋 *Active Signals (${state.activeSignals.length}/5)*\n━━━━━━━━━━━━━━━━━━\n`;
  for (const s of state.activeSignals) {
    msg += `${s.direction === 'LONG' ? '🟢' : '🔴'} *${s.symbol}* — ${s.direction}\n`;
    msg += `  Entry: \`${fmtPrice(s.entry)}\`\n`;
    msg += `  TP: \`${fmtPrice(s.tp)}\` | SL: \`${fmtPrice(s.sl)}\`\n\n`;
  }
  return msg;
}
