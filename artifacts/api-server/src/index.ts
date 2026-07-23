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

// Only start the bot + scanners in the deployed production environment.
// In development (NODE_ENV !== 'production') the HTTP server stays alive for
// the dashboard preview, but no Telegram polling or scanning runs — this
// prevents the dev instance from fighting the deployed VM for the Telegram
// connection and sending duplicate notifications / corrupting state.
if (process.env.NODE_ENV === 'production') {
  startBot().catch((err) => {
    logger.error({ err }, "Telegram bot crashed");
    process.exit(1);
  });
} else {
  logger.warn(
    'DEV mode — Telegram bot and scanners are disabled. ' +
    'Only the HTTP API is active. Deploy to production to run the full bot.'
  );
}
