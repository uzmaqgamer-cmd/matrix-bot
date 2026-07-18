import type { MatrixRow, Direction } from './types.js';

const R: Direction = 'RISING';
const S: Direction = 'STABLE';
const F: Direction = 'FALLING';

export const MATRIX: MatrixRow[] = [
  { row: 1,  oi: R, price: R, funding: R, outlook: 'PUMP',       meaning: 'but late-stage, squeeze risk' },
  { row: 2,  oi: R, price: R, funding: S, outlook: 'PUMP',       meaning: 'healthy' },
  { row: 3,  oi: R, price: R, funding: F, outlook: 'BIG_COMING', meaning: 'fight forming' },
  { row: 4,  oi: F, price: R, funding: R, outlook: 'PUMP',       meaning: 'expensive, fragile' },
  { row: 5,  oi: F, price: R, funding: S, outlook: 'STABLE',     meaning: 'weak bounce, fade risk' },
  { row: 6,  oi: F, price: R, funding: F, outlook: 'STABLE',     meaning: 'rally stalling' },
  { row: 7,  oi: S, price: R, funding: R, outlook: 'PUMP',       meaning: 'mild, low conviction' },
  { row: 8,  oi: S, price: R, funding: S, outlook: 'STABLE',     meaning: 'thin, reversal-prone' },
  { row: 9,  oi: S, price: R, funding: F, outlook: 'BIG_COMING', meaning: 'divergence' },
  { row: 10, oi: R, price: F, funding: R, outlook: 'BIG_COMING', meaning: 'crowded shorts, squeeze risk' },
  { row: 11, oi: R, price: F, funding: S, outlook: 'DUMP',       meaning: 'healthy downtrend' },
  { row: 12, oi: R, price: F, funding: F, outlook: 'BIG_COMING', meaning: 'fight forming' },
  { row: 13, oi: F, price: F, funding: R, outlook: 'BIG_COMING', meaning: 'mixed signal' },
  { row: 14, oi: F, price: F, funding: S, outlook: 'DUMP',       meaning: 'losing steam' },
  { row: 15, oi: F, price: F, funding: F, outlook: 'BIG_COMING', meaning: 'short covering into weakness' },
  { row: 16, oi: S, price: F, funding: R, outlook: 'BIG_COMING', meaning: 'stubborn longs, flush risk' },
  { row: 17, oi: S, price: F, funding: S, outlook: 'DUMP',       meaning: 'weak, low conviction' },
  { row: 18, oi: S, price: F, funding: F, outlook: 'DUMP',       meaning: 'quiet control by shorts' },
  { row: 19, oi: R, price: S, funding: R, outlook: 'BIG_COMING', meaning: 'upside squeeze setup' },
  { row: 20, oi: R, price: S, funding: S, outlook: 'BIG_COMING', meaning: 'direction unclear' },
  { row: 21, oi: R, price: S, funding: F, outlook: 'BIG_COMING', meaning: 'downside squeeze setup' },
  { row: 22, oi: F, price: S, funding: R, outlook: 'BIG_COMING', meaning: 'fragile, unwind risk' },
  { row: 23, oi: F, price: S, funding: S, outlook: 'STABLE',     meaning: 'quiet unwinding' },
  { row: 24, oi: F, price: S, funding: F, outlook: 'BIG_COMING', meaning: 'indecision' },
  { row: 25, oi: S, price: S, funding: R, outlook: 'BIG_COMING', meaning: 'coiling, upside lean' },
  { row: 26, oi: S, price: S, funding: S, outlook: 'STABLE',     meaning: 'true equilibrium' },
  { row: 27, oi: S, price: S, funding: F, outlook: 'BIG_COMING', meaning: 'coiling, downside lean' },
];

export const DIVERGENCE_ROWS = [3, 9, 10, 12, 13, 15, 16, 19, 20, 21, 22, 24, 25, 27];
export const HIGH_PRIORITY_ROWS = [10, 16, 19, 21];

export function lookupRow(oi: Direction, price: Direction, funding: Direction): MatrixRow {
  const match = MATRIX.find(r => r.oi === oi && r.price === price && r.funding === funding);
  if (!match) throw new Error(`No matrix row for oi=${oi} price=${price} funding=${funding}`);
  return match;
}

export function isDivergenceRow(rowNum: number): boolean {
  return DIVERGENCE_ROWS.includes(rowNum);
}

export function isHighPriority(rowNum: number): boolean {
  return HIGH_PRIORITY_ROWS.includes(rowNum);
}
