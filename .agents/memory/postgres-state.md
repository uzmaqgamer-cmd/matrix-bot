---
name: PostgreSQL bot state migration
description: How bot state is persisted — PostgreSQL primary, JSON file as backup/migration seed.
---

## Rule
`artifacts/api-server/src/bot/storage.ts` stores all bot state in a single `bot_state` JSONB row (id=1) in the project's PostgreSQL database.

## Architecture
- `initStorage()` — async, called once at startup in `src/index.ts` before the HTTP server starts. Loads from DB; if DB empty, migrates from `data/bot-state.json` and seeds DB.
- `loadState()` — synchronous; returns the in-memory singleton (safe after initStorage).
- `saveState()` — writes to file synchronously (fast backup) + DB async (fire-and-forget).
- `deduplicateAndRecalculate()` — skips balance recalculation when `completedSignals.length < test2TradeCount` (partial history guard). This prevents startup dedupe from resetting a manually restored balance.

## Why
Every publish was overwriting the deployed server's `data/bot-state.json` with workspace state, resetting the live balance. With PostgreSQL the production DB is never overwritten by a publish — only schema changes are applied.

## First deploy path
1. `data/bot-state.json` is seeded with the correct state.
2. Deployed server starts, finds prod DB empty → migrates file → seeds DB.
3. All subsequent saves go to prod DB. File is ignored after first migration.

## Dev DB state
Seeded at $118.5412, 47 TP / 66 SL, 110 trades on 2026-07-23.

## How to apply
- If state needs manual correction, update via `executeSql` UPDATE on `bot_state WHERE id=1`.
- Never rely on `data/bot-state.json` for live balance after initial migration.
- `deduplicateAndRecalculate` is safe to call via Telegram command only when all trades are in completedSignals (full history mode).
