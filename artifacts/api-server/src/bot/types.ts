export type Direction = 'RISING' | 'STABLE' | 'FALLING';
export type Outlook = 'PUMP' | 'DUMP' | 'STABLE' | 'BIG_COMING';
export type SignalDirection = 'LONG' | 'SHORT';
export type SignalStatus = 'pending' | 'accepted' | 'ignored' | 'tp_hit' | 'sl_hit' | 'expired';

export interface MatrixRow {
  row: number;
  oi: Direction;
  price: Direction;
  funding: Direction;
  outlook: Outlook;
  meaning: string;
}

export interface WatchlistEntry {
  row: number;
  priority: 'HIGH' | 'MEDIUM';
  addedAt: number;
  cyclesWatched: number;
}

export interface Signal {
  id: string;
  symbol: string;
  direction: SignalDirection;
  entry: number;
  tp: number;
  sl: number;
  rr: number;           // risk/reward ratio
  atr: number;
  matrixRow: number;
  matrixMeaning: string;
  originRow: number;
  originPriority: 'HIGH' | 'MEDIUM';
  status: SignalStatus;
  createdAt: number;
  resolvedAt?: number;
  messageId?: number;   // telegram message ID for editing
}

export interface DailyStats {
  date: string;         // YYYY-MM-DD
  sent: number;
  accepted: number;
  ignored: number;
  tpHit: number;
  slHit: number;
}

export interface BotState {
  signalsEnabled: boolean;
  activeSignals: Signal[];      // accepted, currently being tracked (max 5)
  pendingSignals: Signal[];     // sent to user, awaiting accept/ignore
  completedSignals: Signal[];   // tp_hit or sl_hit (last 100)
  dailyStats: DailyStats[];     // last 30 days
  watchlist: Record<string, WatchlistEntry>;
  totalSent: number;
  totalAccepted: number;
  totalIgnored: number;
  totalTpHit: number;
  totalSlHit: number;
}
