import type { Signal, BotState, TpTier } from './types.js';

// All messages use HTML parse_mode — more predictable than Markdown for dynamic content.

export function fmtPrice(p: number): string {
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(6);
  return p.toFixed(8);
}

function pctChange(from: number, to: number): string {
  const v = ((to - from) / from) * 100;
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtTime(ts: number): string {
  return new Date(ts).toUTCString().replace(' GMT', ' UTC');
}

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Auto-close (thesis invalidation) ────────────────────────────────────────

export function formatAutoCloseMessage(
  signal: Signal,
  exitPrice: number,
  prevRow: number,
  newRow: number,
): string {
  const pnlAmt = signal.finalPnlAmt;
  const pnlPct = exitPrice > 0 && signal.entry > 0
    ? (signal.direction === 'LONG'
        ? (exitPrice - signal.entry) / signal.entry * 100
        : (signal.entry - exitPrice) / signal.entry * 100)
    : 0;
  const pnlAmtStr = pnlAmt != null
    ? `  (${pnlAmt >= 0 ? '+' : ''}${pnlAmt.toFixed(4)})`
    : '';
  return (
    `🔄 <b>AUTO-CLOSE — ${esc(signal.symbol)}</b>\n` +
    `Direction: ${signal.direction}\n` +
    `Reason: Thesis invalidated — Row #${prevRow} → #${newRow}\n` +
    `Exit: <code>${fmtPrice(exitPrice)}</code>\n` +
    `P&L: <b>${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</b>${pnlAmtStr}\n` +
    `ID: <code>${signal.id}</code>`
  );
}

// ─── Partial TP + breakeven ───────────────────────────────────────────────────

export function formatPartialTpMessage(
  signal: Signal,
  exitPrice: number,
  pnlAmt: number,
): string {
  const pnlPct = exitPrice > 0 && signal.entry > 0
    ? (signal.direction === 'LONG'
        ? (exitPrice - signal.entry) / signal.entry * 100
        : (signal.entry - exitPrice) / signal.entry * 100)
    : 0;
  return (
    `⚡ <b>PARTIAL TP — ${esc(signal.symbol)}</b>\n` +
    `Direction: ${signal.direction}\n` +
    `50% closed at: <code>${fmtPrice(exitPrice)}</code>  (+${pnlPct.toFixed(2)}%)\n` +
    `Banked: <b>+${pnlAmt.toFixed(4)}</b>\n` +
    `SL moved to breakeven: <code>${fmtPrice(signal.entry)}</code>\n` +
    `<i>Remaining 50% tracking with free ride (SL = entry).</i>`
  );
}

// ─── Tier label ───────────────────────────────────────────────────────────────

function tierLabel(signal: Signal): string {
  const mult = signal.tpMultiplier ?? 2.0;
  const tier: TpTier = signal.tpTier ?? 'CLEAN';
  switch (tier) {
    case 'HIGH_DIVERGENCE':
      return `${mult}× ATR — HIGH priority divergence origin (Row #${signal.originRow})`;
    case 'MEDIUM_DIVERGENCE':
      return `${mult}× ATR — MEDIUM priority divergence origin (Row #${signal.originRow})`;
    default:
      return `${mult}× ATR — clean resolved row`;
  }
}

// ─── Live P&L for active signals ──────────────────────────────────────────────

function livePnl(signal: Signal): string {
  const price = signal.currentPrice;
  if (!price) return '  <i>Price loading…</i>';

  const pnl = signal.direction === 'LONG'
    ? ((price - signal.entry) / signal.entry) * 100
    : ((signal.entry - price) / signal.entry) * 100;

  const pnlStr = (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + '%';

  // Progress toward TP (0% = entry, 100% = TP)
  const tpDist = signal.direction === 'LONG'
    ? signal.tp - signal.entry
    : signal.entry - signal.tp;
  const slDist = signal.direction === 'LONG'
    ? signal.entry - signal.sl
    : signal.sl - signal.entry;
  const currentDist = signal.direction === 'LONG'
    ? price - signal.entry
    : signal.entry - price;

  let statusEmoji: string;
  let bar: string;

  if (currentDist <= -slDist * 0.8) {
    statusEmoji = '🚨';
    bar = 'near SL';
  } else if (currentDist < 0) {
    statusEmoji = '🔻';
    const slPct = Math.abs(currentDist / slDist * 100).toFixed(0);
    bar = `${slPct}% toward SL`;
  } else if (currentDist >= tpDist * 0.9) {
    statusEmoji = '🎯';
    bar = 'near TP!';
  } else if (currentDist > 0) {
    statusEmoji = '📈';
    const tpPct = (currentDist / tpDist * 100).toFixed(0);
    bar = `${tpPct}% toward TP`;
  } else {
    statusEmoji = '⚖️';
    bar = 'at entry';
  }

  const ago = signal.currentPriceAt
    ? Math.round((Date.now() - signal.currentPriceAt) / 1000)
    : null;
  const agoStr = ago !== null ? (ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`) : '';

  return (
    `  ${statusEmoji} <b>${pnlStr}</b>  <code>${fmtPrice(price)}</code>  ${esc(bar)}` +
    (agoStr ? `  <i>${agoStr}</i>` : '')
  );
}

// ─── Signal card ─────────────────────────────────────────────────────────────

export function formatSignalMessage(signal: Signal): string {
  const tpPct = pctChange(signal.entry, signal.tp);
  const slPct = pctChange(signal.entry, signal.sl);
  const rr = (signal.rr ?? 2).toFixed(1);

  return (
    `📡 <b>BITUNIX LONG SETUP</b>\n` +
    `<i>New-run candidate — no order has been placed yet.</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Pair      <code>${esc(signal.symbol)}</code>\n` +
    `Entry     <code>${fmtPrice(signal.entry)}</code>\n` +
    `Target    <code>${fmtPrice(signal.tp)}</code>  <b>${esc(tpPct)}</b>\n` +
    `Stop      <code>${fmtPrice(signal.sl)}</code>  <b>${esc(slPct)}</b>\n` +
    `Reward/Risk  <b>1:${rr}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Matrix    <b>#${signal.matrixRow}</b> — <i>${esc(signal.matrixMeaning)}</i>\n` +
    `Priority  ${esc(signal.originPriority)} · origin row #${signal.originRow}\n` +
    `ATR       <code>${fmtPrice(signal.atr)}</code> · ${((signal.atr / signal.entry) * 100).toFixed(2)}%\n` +
    `Data      Bitunix price/funding/ATR · Bybit public OI\n` +
    `Safety    Native Bitunix position stop required\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Accepting in live mode places an order only after the Bitunix fill and native stop are both confirmed.</i>`
  );
}

/**
 * Sent only after Bitunix has confirmed both the entry fill and the
 * position-bound protective stop. This is intentionally distinct from a setup
 * message so there is no ambiguity about a real order.
 */
export function formatLiveEntryConfirmedMessage(signal: Signal): string {
  const fill = signal.liveFillPrice ?? signal.entry;
  const qty = signal.liveQty ?? 0;
  const risk = signal.liveRiskDollar ?? signal.riskAmt ?? 0;
  return (
    `🟢 <b>LIVE ORDER CONFIRMED — BITUNIX</b>\n` +
    `<b>${esc(signal.symbol)} LONG</b> · <i>new-run live trade</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Fill      <code>${fmtPrice(fill)}</code>\n` +
    `Size      <code>${qty}</code>\n` +
    `Target    <code>${fmtPrice(signal.tp)}</code>\n` +
    `Stop      <code>${fmtPrice(signal.sl)}</code>\n` +
    `Risk      <b>$${risk.toFixed(4)}</b> (0.25% cap)\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Protection  <b>ACTIVE</b> — Bitunix native position stop accepted\n` +
    `Evidence    entry fill + stop order confirmed by Bitunix\n` +
    `Market data Bitunix · OI source Bybit public\n` +
    `Order ID    <code>${esc(signal.liveOrderId ?? 'confirmed')}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>This trade is now counted in the fresh confirmed-fill performance run.</i>`
  );
}

// ─── TP / SL hit alerts ───────────────────────────────────────────────────────

export function formatTpHitMessage(signal: Signal, exitPrice: number): string {
  const pnlPct = signal.direction === 'LONG'
    ? ((exitPrice - signal.entry) / signal.entry * 100)
    : ((signal.entry - exitPrice) / signal.entry * 100);

  // Actual achieved R/R = how far price moved vs the original SL distance
  const slDist  = Math.abs(signal.entry - signal.sl);
  const moveDist = Math.abs(exitPrice - signal.entry);
  const actualRR = slDist > 0 ? (moveDist / slDist).toFixed(2) : '?';

  const isTrailExit = signal.trailActive && signal.partialTpFired;

  if (isTrailExit) {
    return (
      `✅ <b>TRAIL EXIT — ${esc(signal.symbol)}</b>\n` +
      `Direction: ${signal.direction}\n` +
      `Entry: <code>${fmtPrice(signal.entry)}</code> → Trail stop: <code>${fmtPrice(exitPrice)}</code>\n` +
      `PnL (remaining 50%): <b>+${pnlPct.toFixed(2)}%</b>\n` +
      `Achieved R/R: <b>1:${actualRR}</b>  (planned: 1:${(signal.rr ?? 2).toFixed(1)})\n` +
      `ID: <code>${signal.id}</code>`
    );
  }

  return (
    `✅ <b>TP HIT — ${esc(signal.symbol)}</b>\n` +
    `Direction: ${signal.direction}\n` +
    `Entry: <code>${fmtPrice(signal.entry)}</code> → Exit: <code>${fmtPrice(exitPrice)}</code>\n` +
    `PnL: <b>+${pnlPct.toFixed(2)}%</b>  (R/R 1:${actualRR})\n` +
    `Tier: <i>${esc(tierLabel(signal))}</i>\n` +
    `ID: <code>${signal.id}</code>`
  );
}

export function formatSlHitMessage(signal: Signal, exitPrice: number): string {
  const isBreakeven = signal.partialTpFired;
  const lossPct = signal.direction === 'LONG'
    ? ((signal.entry - exitPrice) / signal.entry * 100).toFixed(2)
    : ((exitPrice - signal.entry) / signal.entry * 100).toFixed(2);

  if (isBreakeven) {
    return (
      `⚖️ <b>BREAKEVEN EXIT — ${esc(signal.symbol)}</b>\n` +
      `Direction: ${signal.direction}\n` +
      `50% banked at partial TP · remaining 50% exited at entry\n` +
      `Entry: <code>${fmtPrice(signal.entry)}</code> → Exit: <code>${fmtPrice(exitPrice)}</code>\n` +
      `Net on remaining: <b>±0%</b>  (profit locked from partial TP)\n` +
      `ID: <code>${signal.id}</code>`
    );
  }

  return (
    `❌ <b>SL HIT — ${esc(signal.symbol)}</b>\n` +
    `Direction: ${signal.direction}\n` +
    `Entry: <code>${fmtPrice(signal.entry)}</code> → Exit: <code>${fmtPrice(exitPrice)}</code>\n` +
    `Loss: <b>-${lossPct}%</b>\n` +
    `ID: <code>${signal.id}</code>`
  );
}

// ─── Win rate ─────────────────────────────────────────────────────────────────

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

// ─── Daily results ────────────────────────────────────────────────────────────

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

// ─── Active signals panel (with live P&L) ────────────────────────────────────

export function formatActiveSignals(state: BotState): string {
  if (state.activeSignals.length === 0) {
    return `📋 <b>Active Signals (0/5)</b>\n\n<i>No active signals. Accept a signal to start tracking.</i>`;
  }

  let msg = `📋 <b>Active Signals (${state.activeSignals.length}/5)</b>\n━━━━━━━━━━━━━━━━━━\n`;

  for (const s of state.activeSignals) {
    const ico = s.direction === 'LONG' ? '🟢' : '🔴';
    const rr = (s.rr ?? 2).toFixed(1);
    const ageMins = Math.round((Date.now() - s.createdAt) / 60000);
    const ageStr = ageMins < 60
      ? `${ageMins}m`
      : `${Math.floor(ageMins / 60)}h ${ageMins % 60}m`;

    msg += `${ico} <b>${esc(s.symbol)}</b> ${s.direction}  <i>(${ageStr} ago)</i>\n`;
    msg += `  Entry <code>${fmtPrice(s.entry)}</code>  TP <code>${fmtPrice(s.tp)}</code>  SL <code>${fmtPrice(s.sl)}</code>\n`;
    msg += `  R/R 1:${rr}  |  ${esc(tierLabel(s))}\n`;
    msg += livePnl(s) + '\n';
    msg += `  Row #${s.matrixRow} — <i>${esc(s.matrixMeaning)}</i>\n`;
    msg += `\n`;
  }

  const updatedAgo = state.activeSignals.some(s => s.currentPriceAt)
    ? Math.round((Date.now() - Math.max(...state.activeSignals.map(s => s.currentPriceAt ?? 0))) / 1000)
    : null;
  if (updatedAgo !== null) {
    msg += `<i>Prices updated ${updatedAgo}s ago. Tracker refreshes every 30s.</i>`;
  } else {
    msg += `<i>Prices load on next tracker cycle (30s intervals).</i>`;
  }

  return msg;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

export function formatTestResults(
  results: { label: string; passed: boolean }[],
  passed: number,
  failed: number
): string {
  let msg = `🧪 <b>Test Results</b>\n━━━━━━━━━━━━━━━━━━\n`;
  for (const r of results) msg += `${r.passed ? '✅' : '❌'} ${esc(r.label)}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n<b>${passed} passed, ${failed} failed</b>`;
  return msg;
}

// ─── Radar ────────────────────────────────────────────────────────────────────

export function formatRadar(
  state: BotState,
  radarData: { symbol: string; row: number; meaning: string; priority: string; cyclesWatched: number }[]
): string {
  if (radarData.length === 0) {
    return (
      `🎯 <b>Signal Radar</b>\n━━━━━━━━━━━━━━━━━━\n` +
      `<i>No pairs in divergence zone right now.\nScanner checks every 5 min.</i>`
    );
  }
  let msg = `🎯 <b>Signal Radar — ${radarData.length} pairs diverging</b>\n`;
  msg += `<i>These need 1 more confirmation to fire a signal.</i>\n━━━━━━━━━━━━━━━━━━\n`;
  for (const p of radarData) {
    const prio = p.priority === 'HIGH' ? '🔥' : '⚡';
    const tpHint = p.priority === 'HIGH' ? '3.5×' : '2.5×';
    msg += `${prio} <b>${esc(p.symbol)}</b>  Row #${p.row}  <i>${esc(p.meaning)}</i>\n`;
    msg += `   ${p.cyclesWatched} cycles watched  |  TP if fired: ${tpHint} ATR\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━\n<i>Tap "Send Signal" to fire manually for any pair.</i>`;
  return msg;
}
