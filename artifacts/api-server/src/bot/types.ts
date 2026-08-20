export type Direction = 'RISING' | 'STABLE' | 'FALLING';
export type Outlook = 'PUMP' | 'DUMP' | 'STABLE' | 'BIG_COMING';
export type SignalDirection = 'LONG' | 'SHORT';
export type SignalStatus =
  | 'pending'
  | 'accepted'
  | 'ignored'
  | 'tp_hit'
  | 'sl_hit'
  | 'expired'
  | 'auto_closed'; // closed by thesis-invalidation monitor

/** Which conviction tier determined the TP multiplier. */
export type TpTier = 'CLEAN' | 'HIGH_DIVERGENCE' | 'MEDIUM_DIVERGENCE';

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
  /** Venue that supplied the signal inputs; required before Bitunix execution. */
  marketVenue?: 'BITUNIX';
  entry: number;
  tp: number;
  sl: number;
  rr: number;           // risk/reward ratio (floats: 2.0 | 2.5 | 3.5)
  atr: number;
  tpMultiplier: number; // 2.0 | 2.5 | 3.5
  tpTier: TpTier;       // which conviction tier fired
  matrixRow: number;
  matrixMeaning: string;
  originRow: number;
  originPriority: 'HIGH' | 'MEDIUM';
  status: SignalStatus;
  createdAt: number;
  resolvedAt?: number;
  messageId?: number;        // telegram message ID for editing
  currentPrice?: number;     // last known market price (updated by tracker every 30s)
  currentPriceAt?: number;   // timestamp of last price update
  pnlPct?: number | null;
  tpProgressPct?: number | null;

  // ── Test 2: compounding 1% risk per trade ──────────────────────────────────
  balanceAtEntry?: number;   // paper balance snapshot at the moment this signal was accepted
  riskAmt?: number;          // 1% of balanceAtEntry — dollar risk on this trade
  finalPnlAmt?: number;      // total $ P&L including partial close, set when trade closes

  // ── Partial TP + breakeven ─────────────────────────────────────────────────
  originalSl?: number;       // SL at creation time — immutable; sl field changes when breakevenMoved fires
  partialTpFired?: boolean;  // true once the 50%-of-distance partial close has fired
  partialTpAt?: number;
  partialTpPrice?: number;
  partialTpPnlAmt?: number;  // $ banked from partial close (already applied to balance)
  breakevenMoved?: boolean;  // SL has been moved to entry price

  // ── Thesis / position monitoring ──────────────────────────────────────────
  currentMatrixRow?: number; // most recent matrix row from position re-scan
  autoClosedAt?: number;
  autoCloseReason?: string;  // e.g. 'thesis_invalidated' | 'price_data_unavailable'
  autoClosePrice?: number;

  // ── Live fee + net P&L tracking ───────────────────────────────────────────
  liveFeeEntry?:        number; // taker fee paid on entry (qty × fillPrice × 0.0004)
  liveFeePartialExit?:  number; // taker fee paid on the 50% partial-TP close
  liveFeeExit?:         number; // taker fee paid on final close
  liveFeesTotal?:       number; // sum of all fees for this trade
  livePnlGross?:        number; // raw P&L from price movement (no fees)
  livePnlNet?:          number; // net P&L after all fees

  // ── ATR trailing stop (active after partial TP fires) ─────────────────────
  trailActive?: boolean;     // true once partial TP fires and trail takes over from fixed TP
  trailStop?:   number;      // current trail stop level; only moves in the favourable direction

  // ── Fetch failure tracking ─────────────────────────────────────────────────
  fetchFailCount?: number;   // consecutive price-fetch failures; auto-close at threshold

  // ── Live trading (Binance Futures) ─────────────────────────────────────────
  livePendingOpen?: boolean;
  liveHalfQtyClosed?: number;   // qty actually sent at partial-TP close; used to avoid dust residuals // true from the moment openTrade() is called until the fill is stamped
  liveEnabled?:    boolean;  // true once a real position is open on Binance
  liveQty?:        number;   // position size in base asset (coins)
  liveOrderId?:    string;   // entry market order ID
  liveTpOrderId?:  string;   // active TP order ID (updated after partial-TP)
  liveSlOrderId?:  string;   // active SL order ID (updated after partial-TP)
  liveFillPrice?:  number;   // actual entry fill price from Binance
  liveRiskDollar?: number;   // dollar risk at entry (freeBalance × RISK_PCT)
  liveError?:      string;   // order-placement error message (if open failed)
  liveVenue?:      'BITUNIX';
  livePositionId?: string;
  liveFillConfirmed?: boolean;
  liveProtectionConfirmed?: boolean;
  liveExitConfirmed?: boolean;
  liveFeeCashback?: number;
  livePartialRealizedPnl?: number;
  liveExitRealizedPnl?: number;
}

export interface DailyStats {
  date: string;         // YYYY-MM-DD
  sent: number;
  accepted: number;
  ignored: number;
  tpHit: number;
  slHit: number;
}

export interface BalanceLogEntry {
  ts: number;
  balance: number;
}

/** Signal tracking mode.
 *  LIMITED   — max 5 active signals; each signal needs manual Accept/Ignore.
 *  UNLIMITED — no cap; signals are auto-accepted the moment they fire. */
export type SignalMode = 'LIMITED' | 'UNLIMITED';

export interface BotState {
  signalsEnabled: boolean;
  signalMode: SignalMode;
  activeSignals: Signal[];
  pendingSignals: Signal[];     // sent to user, awaiting accept/ignore (LIMITED mode only)
  completedSignals: Signal[];   // tp_hit / sl_hit / auto_closed (last 100)
  dailyStats: DailyStats[];     // last 30 days
  watchlist: Record<string, WatchlistEntry>;
  totalSent: number;
  totalAccepted: number;
  totalIgnored: number;
  totalTpHit: number;
  totalSlHit: number;

  // ── Test 2: post-fix paper trading ─────────────────────────────────────────
  paperBalance: number;         // live running balance; Test 2 starts at $100.00
  test2StartedAt: number;       // timestamp when Test 2 was activated (first boot after this code)
  test2TradeCount: number;      // number of closed trades in Test 2
  balanceLog: BalanceLogEntry[]; // running balance after each Test 2 close event (last 100)

  // ── Real exchange balance (VPS / live trading only) ────────────────────────
  realBalance?:    number;            // latest Binance USDT available balance
  realBalanceAt?:  number;            // timestamp of last successful sync
  realBalanceLog?: BalanceLogEntry[]; // sampled after each trade close (last 100)

  // ── Activity log persistence ────────────────────────────────────────────────
  activityLog?: import('./eventLog.js').ActivityEntry[]; // persisted so restarts don't wipe history
}
