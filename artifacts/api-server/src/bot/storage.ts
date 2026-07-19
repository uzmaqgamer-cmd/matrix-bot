import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { BotState } from './types.js';

const STATE_FILE = '/home/runner/workspace/data/bot-state.json';

const DEFAULT_STATE: BotState = {
  signalsEnabled: false,
  signalMode: 'LIMITED',
  activeSignals: [],
  pendingSignals: [],
  completedSignals: [],
  dailyStats: [],
  watchlist: {},
  totalSent: 0,
  totalAccepted: 0,
  totalIgnored: 0,
  totalTpHit: 0,
  totalSlHit: 0,
};

export function loadState(): BotState {
  try {
    if (!existsSync(STATE_FILE)) return { ...DEFAULT_STATE };
    const raw = readFileSync(STATE_FILE, 'utf-8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: BotState): void {
  try {
    const dir = dirname(STATE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[storage] Failed to save state:', err);
  }
}

export function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getOrCreateDailyStats(state: BotState) {
  const today = getTodayKey();
  let stats = state.dailyStats.find(d => d.date === today);
  if (!stats) {
    stats = { date: today, sent: 0, accepted: 0, ignored: 0, tpHit: 0, slHit: 0 };
    state.dailyStats.push(stats);
    // Keep last 30 days only
    if (state.dailyStats.length > 30) {
      state.dailyStats = state.dailyStats.slice(-30);
    }
  }
  return stats;
}
