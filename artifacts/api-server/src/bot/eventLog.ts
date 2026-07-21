/**
 * In-memory ring buffers for the live dashboard.
 * These reset on process restart — that's fine, the dashboard is live-only.
 */

export interface ActivityEntry {
  ts: number;
  text: string;
  kind: 'signal' | 'tp' | 'sl' | 'watch' | 'drop' | 'scan' | 'auto_close' | 'partial_tp' | 'adjust';
  symbol: string | null;
}

export interface ScanEntry {
  symbol: string;
  row: number;
  outlook: string;
  ts: number;
}

const MAX_ACTIVITY = 60;
const MAX_SCAN_FEED = 60;

export const activityLog: ActivityEntry[] = [];
export const scanFeed: ScanEntry[] = [];

export function logActivity(entry: ActivityEntry) {
  activityLog.unshift(entry);
  if (activityLog.length > MAX_ACTIVITY) activityLog.length = MAX_ACTIVITY;
}

export function logScan(entry: ScanEntry) {
  // Avoid duplicate consecutive entries for same symbol+row
  if (scanFeed[0]?.symbol === entry.symbol && scanFeed[0]?.row === entry.row) return;
  scanFeed.unshift(entry);
  if (scanFeed.length > MAX_SCAN_FEED) scanFeed.length = MAX_SCAN_FEED;
}
