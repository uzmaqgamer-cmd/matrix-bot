import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startBot } from "./bot/index.js";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

// Start the Telegram bot (non-blocking — runs alongside the HTTP server).
// A 409 Conflict means the deployed VM instance already owns the Telegram
// polling connection. In that case we step back gracefully: the HTTP server
// and all scanning intervals keep running so the dashboard and state remain
// functional — only Telegram message sending is unavailable in this instance.
startBot().catch((err) => {
  const is409 = err?.response?.error_code === 409 ||
                (err?.message ?? '').includes('409');
  if (is409) {
    logger.warn(
      'Telegram 409 Conflict — another instance (deployed VM) is already ' +
      'polling. Telegram disabled in this instance; HTTP server and scanners remain active.'
    );
    // Do NOT exit — HTTP API and scanning loops stay alive.
    return;
  }
  logger.error({ err }, "Telegram bot crashed");
  process.exit(1);
});
