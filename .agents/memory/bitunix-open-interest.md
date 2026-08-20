---
name: Bitunix open-interest availability
description: Safety constraint for the Bitunix-only futures pilot.
---

Bitunix's documented public futures API exposes tickers, trading pairs, candles, depth, and funding, but not market-wide open interest or OI history. The user explicitly approved Bybit's public API as the sole external input, and only for OI values/history; execution and every other market input remain Bitunix.

**Why:** The OI dimension is integral to the matrix classifier, while using external price, funding, or execution data would recreate the prior cross-venue mismatch.

**How to apply:** Value Bybit's linear-contract OI with the Bitunix ticker price for the $10M gate. Do not use Bybit price, funding, candles, volume, listing data, or execution. If the Bybit OI request fails, skip that pair rather than fabricate OI.