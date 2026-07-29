/**
 * Central configuration for all tunable bot parameters.
 * Adjust here; all modules import from this file.
 */
export const config = {
  /**
   * Minimum ATR as a percentage of entry price.
   * Signals where ATR/price*100 < this value are skipped entirely.
   * Original value was 0.5%; raised to 1.1% to filter low-volatility noise.
   */
  minAtrPercentOfPrice: 1.1,

  positionMonitoring: {
    /**
     * How often to re-run the matrix classifier on every open position
     * to detect thesis invalidation (ms). Default: 60 seconds.
     */
    rescanIntervalMs: 60_000,

    /**
     * When unrealized P&L reaches this fraction (%) of the entry→TP
     * distance, automatically move the paper SL to breakeven.
     * Default: 50 — i.e. halfway to TP.
     */
    breakevenTriggerPct: 50,

    /**
     * Auto-close paper positions that have been open longer than this
     * without hitting SL/TP or triggering an auto-close rule (ms).
     * Default: 6 hours.
     */
    maxHoldMs: 6 * 60 * 60 * 1000,

    /**
     * Maximum number of simultaneously open positions.
     * New signals are silently skipped when this cap is reached.
     * Default: 8.
     */
    maxActivePositions: 8,
  },
} as const;
