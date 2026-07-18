# Matrix Signal Bot — @cryptomatrixAI_bot

Telegram signal bot that scans Binance USDT-M perpetuals using a 27-row OI + Price + Funding Rate matrix, sends actionable LONG/SHORT signals with TP/SL levels, and tracks outcomes in real time.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + bot (port 8080)
- `pnpm run typecheck` — full typecheck
- Bot logs appear in the API Server workflow output

## Secrets / Env Required

- `TELEGRAM_BOT_TOKEN` — Replit Secret (already set)
- `TELEGRAM_CHAT_ID` — shared env var (set to admin's Telegram ID)
- `TELEGRAM_ADMIN_ID` — shared env var (same as CHAT_ID)
- Bot state is persisted to `/home/runner/workspace/data/bot-state.json`

## Bot Commands

- `/start` — main panel with signals toggle button + quick stats
- `/status` — same as /start
- `/active` — show current active signals (max 5)
- `/winrate` — win rate, TP/SL counts, acceptance stats
- `/daily` — today's signals and results
- `/test` — run offline logic tests (no network needed)

## Signal Flow

1. Scanner runs every 5 min (top 50 USDT-M perps by volume)
2. Watchlist scanner runs every 60s for flagged pairs
3. When a divergence resolves into PUMP/DUMP → bot sends signal with Accept/Ignore buttons
4. **Accepted** signals: tracked against real-time Binance price (checked every 30s)
5. **Ignored** signals: discarded, do NOT count toward the 5-signal limit
6. When TP or SL hit → bot notifies immediately with result
7. Stats (win rate, daily) updated automatically

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Bot: Telegraf v4
- Market data: Binance Futures API (no key needed — public endpoints)
- Risk management: ATR-based TP/SL (2:1 R/R), 15m candles
- State persistence: JSON file at `data/bot-state.json`
- Server: Express 5 (keeps workflow alive)

## Where things live

- `artifacts/api-server/src/bot/` — all bot logic
  - `index.ts` — Telegraf bot, all commands and button handlers
  - `scanner.ts` — Binance scan loop (full + watchlist)
  - `tracker.ts` — real-time TP/SL monitoring
  - `signalBuilder.ts` — ATR-based TP/SL calculation
  - `formatter.ts` — all message templates
  - `watchlist.ts` — divergence tracking
  - `matrix.ts` — 27-row lookup table
  - `classifier.ts` — RISING/STABLE/FALLING classifier
  - `binance.ts` — Binance Futures API client
  - `storage.ts` — JSON persistence
  - `tests.ts` — offline test suite (17 checks)
  - `types.ts` — shared TypeScript types

## User preferences

- Admin Telegram ID: 5629038273
- Max 5 active (accepted) signals at a time
- Ignored signals don't count toward the limit
- Signals auto-enabled/disabled via toggle button in /start
