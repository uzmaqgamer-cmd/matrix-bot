import { getCurrentPrice } from './binance.js';
import { loadState, saveState, getOrCreateDailyStats } from './storage.js';
import { formatTpHitMessage, formatSlHitMessage } from './formatter.js';
import type { Telegram } from 'telegraf';

let telegramRef: Telegram | null = null;
let adminChatId: string = '';

export function initTracker(telegram: Telegram, chatId: string) {
  telegramRef = telegram;
  adminChatId = chatId;
}

async function sendAlert(text: string) {
  if (!telegramRef || !adminChatId) return;
  try {
    await telegramRef.sendMessage(adminChatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[tracker] sendAlert failed:', err);
  }
}

export async function checkActiveSignals() {
  const state = loadState();
  if (state.activeSignals.length === 0) return;

  const toRemove: string[] = [];

  for (const signal of state.activeSignals) {
    try {
      const price = await getCurrentPrice(signal.symbol);

      let hit: 'tp' | 'sl' | null = null;

      if (signal.direction === 'LONG') {
        if (price >= signal.tp) hit = 'tp';
        else if (price <= signal.sl) hit = 'sl';
      } else {
        if (price <= signal.tp) hit = 'tp';
        else if (price >= signal.sl) hit = 'sl';
      }

      if (hit) {
        toRemove.push(signal.id);
        signal.status = hit === 'tp' ? 'tp_hit' : 'sl_hit';
        signal.resolvedAt = Date.now();

        // Move to completed
        state.completedSignals.push({ ...signal });
        if (state.completedSignals.length > 100) {
          state.completedSignals = state.completedSignals.slice(-100);
        }

        // Update stats
        if (hit === 'tp') {
          state.totalTpHit++;
          getOrCreateDailyStats(state).tpHit++;
          await sendAlert(formatTpHitMessage(signal, price));
        } else {
          state.totalSlHit++;
          getOrCreateDailyStats(state).slHit++;
          await sendAlert(formatSlHitMessage(signal, price));
        }

        console.log(`[tracker] ${signal.symbol} ${hit.toUpperCase()} hit @ ${price}`);
      }
    } catch (err) {
      console.warn(`[tracker] Error checking ${signal.symbol}:`, err);
    }
  }

  if (toRemove.length > 0) {
    state.activeSignals = state.activeSignals.filter(s => !toRemove.includes(s.id));
    saveState(state);
  }
}
