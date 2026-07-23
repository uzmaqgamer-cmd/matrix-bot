import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startBot } from "./bot/index.js";
import { initStorage, loadState, deduplicateAndRecalculate } from "./bot/storage.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Async startup ──────────────────────────────────────────────────────────────
// initStorage() must complete before the HTTP server accepts requests so that
// loadState() always returns a populated singleton. We boot in an async IIFE
// so the rest of the file stays clean.
(async () => {
  try {
    // 1. Load state from PostgreSQL (or migrate from file on first deploy)
    await initStorage();
  } catch (err) {
    logger.error({ err }, 'initStorage failed — continuing with in-memory defaults');
  }

  // 2. Start HTTP server
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  // 3. Production-only: bot + scanners
  if (process.env.NODE_ENV === 'production') {
    // Auto-deduplicate on every startup: removes crash-duplicate entries.
    // The new partial-history guard prevents this from overwriting a manually
    // restored balance when completedSignals is a partial window.
    try {
      const state  = loadState();
      const report = deduplicateAndRecalculate(state);
      if (report.removedCount > 0) {
        logger.warn(
          { removed: report.removedCount, balanceBefore: report.balanceBefore, balanceAfter: report.balanceAfter },
          'Startup dedup: removed duplicate trade entries and recomputed balance'
        );
      } else {
        logger.info('Startup dedup: no duplicates found, state is clean');
      }
    } catch (err) {
      logger.error({ err }, 'Startup dedup failed — continuing anyway');
    }

    startBot();
  } else {
    logger.warn(
      'DEV mode — Telegram bot and scanners are disabled. ' +
      'Only the HTTP API is active. Deploy to production to run the full bot.'
    );
  }
})();
