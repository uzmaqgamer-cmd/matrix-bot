import { isDivergenceRow, isHighPriority } from './matrix.js';
import type { BotState, WatchlistEntry, MatrixRow } from './types.js';

const WATCHLIST_TIMEOUT_CYCLES = 20;

export type WatchlistAction =
  | { type: 'ADDED'; symbol: string; matrixRow: MatrixRow; priority: 'HIGH' | 'MEDIUM' }
  | { type: 'ESCALATED'; symbol: string; matrixRow: MatrixRow; originRow: number; originPriority: 'HIGH' | 'MEDIUM'; cyclesElapsed: number }
  | { type: 'DROPPED_STABLE'; symbol: string; matrixRow: MatrixRow }
  | { type: 'STILL_WATCHING'; symbol: string; matrixRow: MatrixRow; cyclesWatched: number }
  | { type: 'EXPIRED'; symbol: string; matrixRow: MatrixRow; cyclesWatched: number }
  | { type: 'NONE'; symbol: string; matrixRow: MatrixRow };

export function updateWatchlist(symbol: string, matrixRow: MatrixRow, state: BotState): WatchlistAction {
  const onList = !!state.watchlist[symbol];

  if (isDivergenceRow(matrixRow.row)) {
    if (!onList) {
      const priority = isHighPriority(matrixRow.row) ? 'HIGH' : 'MEDIUM';
      state.watchlist[symbol] = { row: matrixRow.row, priority, addedAt: Date.now(), cyclesWatched: 0 };
      return { type: 'ADDED', symbol, matrixRow, priority };
    }
    const entry = state.watchlist[symbol];
    entry.cyclesWatched += 1;
    entry.row = matrixRow.row;
    if (entry.cyclesWatched >= WATCHLIST_TIMEOUT_CYCLES) {
      delete state.watchlist[symbol];
      return { type: 'EXPIRED', symbol, matrixRow, cyclesWatched: entry.cyclesWatched };
    }
    return { type: 'STILL_WATCHING', symbol, matrixRow, cyclesWatched: entry.cyclesWatched };
  }

  if (onList) {
    const entry = state.watchlist[symbol];
    delete state.watchlist[symbol];
    if (matrixRow.outlook === 'PUMP' || matrixRow.outlook === 'DUMP') {
      return {
        type: 'ESCALATED', symbol, matrixRow,
        originRow: entry.row, originPriority: entry.priority,
        cyclesElapsed: entry.cyclesWatched,
      };
    }
    return { type: 'DROPPED_STABLE', symbol, matrixRow };
  }

  return { type: 'NONE', symbol, matrixRow };
}
