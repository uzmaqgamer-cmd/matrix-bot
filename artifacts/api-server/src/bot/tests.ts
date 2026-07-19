import { classify } from './classifier.js';
import { lookupRow } from './matrix.js';
import type { BotState } from './types.js';
import { updateWatchlist } from './watchlist.js';

interface TestResult {
  label: string;
  passed: boolean;
}

function check(label: string, cond: boolean): TestResult {
  return { label, passed: cond };
}

export function runOfflineTests(): { results: TestResult[]; passed: number; failed: number; output: string } {
  const results: TestResult[] = [];
  let output = '';

  const makeState = (): BotState => ({
    signalsEnabled: false, signalMode: 'LIMITED',
    activeSignals: [], pendingSignals: [], completedSignals: [],
    dailyStats: [], watchlist: {}, totalSent: 0, totalAccepted: 0,
    totalIgnored: 0, totalTpHit: 0, totalSlHit: 0,
  });

  // Test 1: Row 2 PUMP scenario
  output += '--- Test 1: PUMP scenario (row 2: OI up, price up, funding stable) ---\n';
  {
    const r = classify({
      priceSeries: [100, 105, 110, 115, 120],
      oiSeries: [1000, 1020, 1040, 1060, 1080],
      fundingSeries: [0.01, 0.011],
    });
    results.push(check('oi = RISING', r.oi === 'RISING'));
    results.push(check('price = RISING', r.price === 'RISING'));
    results.push(check('funding = STABLE', r.funding === 'STABLE'));
    const row = lookupRow(r.oi, r.price, r.funding);
    results.push(check('matches row #2 (PUMP, healthy)', row.row === 2 && row.outlook === 'PUMP'));
  }

  // Test 2: DUMP scenario
  output += '--- Test 2: DUMP scenario (row 17) ---\n';
  {
    const r = classify({
      priceSeries: [100, 97, 94, 91, 88],
      oiSeries: [1000, 1005, 998, 1002, 999],
      fundingSeries: [0.02, 0.019],
    });
    const row = lookupRow(r.oi, r.price, r.funding);
    results.push(check('matches row #17 (DUMP, weak low conviction)', row.row === 17 && row.outlook === 'DUMP'));
  }

  // Test 3: ESPORTSUSDT scenario
  output += '--- Test 3: ESPORTS scenario (row 15: short covering into weakness) ---\n';
  {
    const r = classify({
      priceSeries: [0.0374, 0.0350, 0.0320, 0.0300, 0.0290],
      oiSeries: [2.6, 2.4, 2.0, 1.8, 1.7],
      fundingSeries: [0.05, -0.175],
    });
    const row = lookupRow(r.oi, r.price, r.funding);
    results.push(check('matches row #15 (BIG_COMING, short covering)', row.row === 15 && row.outlook === 'BIG_COMING'));
  }

  // Test 4: Watchlist lifecycle → DUMP escalation
  output += '--- Test 4: Watchlist divergence → DUMP escalation ---\n';
  {
    const state = makeState();
    const row10 = lookupRow('RISING', 'FALLING', 'RISING');
    const a1 = updateWatchlist('TESTUSDT', row10, state);
    results.push(check('first hit → ADDED', a1.type === 'ADDED'));
    results.push(check('row 10 = HIGH priority', a1.type === 'ADDED' && a1.priority === 'HIGH'));
    const a2 = updateWatchlist('TESTUSDT', row10, state);
    results.push(check('still divergent → STILL_WATCHING', a2.type === 'STILL_WATCHING'));
    const dumpRow = lookupRow('RISING', 'FALLING', 'STABLE');
    const a3 = updateWatchlist('TESTUSDT', dumpRow, state);
    results.push(check('resolves to DUMP → ESCALATED', a3.type === 'ESCALATED'));
    results.push(check('remembers origin row 10', a3.type === 'ESCALATED' && a3.originRow === 10));
  }

  // Test 5: False alarm (resolves STABLE)
  output += '--- Test 5: False alarm → DROPPED_STABLE ---\n';
  {
    const state = makeState();
    const row9 = lookupRow('STABLE', 'RISING', 'FALLING');
    updateWatchlist('FAKEUSDT', row9, state);
    const stableRow = lookupRow('STABLE', 'STABLE', 'STABLE');
    const a = updateWatchlist('FAKEUSDT', stableRow, state);
    results.push(check('resolves stable → DROPPED_STABLE', a.type === 'DROPPED_STABLE'));
  }

  // Test 6: Watchlist timeout
  output += '--- Test 6: Stale expiry ---\n';
  {
    const state = makeState();
    const row25 = lookupRow('STABLE', 'STABLE', 'RISING');
    updateWatchlist('STALEUSDT', row25, state);
    let last: any;
    for (let i = 0; i < 20; i++) {
      last = updateWatchlist('STALEUSDT', row25, state);
    }
    results.push(check('expires after 20 cycles → EXPIRED', last?.type === 'EXPIRED'));
  }

  // Test 7: Matrix completeness (all 27 rows reachable)
  output += '--- Test 7: Matrix completeness ---\n';
  {
    const dirs = ['RISING', 'STABLE', 'FALLING'] as const;
    let found = 0;
    for (const oi of dirs) for (const price of dirs) for (const funding of dirs) {
      try { lookupRow(oi, price, funding); found++; } catch { /* skip */ }
    }
    results.push(check('all 27 matrix rows reachable', found === 27));
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  return { results, passed, failed, output };
}
