---
name: Bitunix open-interest availability
description: Safety constraint for the Bitunix-only futures pilot.
---

Bitunix's documented public futures API exposes tickers, trading pairs, candles, depth, and funding, but not market-wide open interest or OI history. The pilot must fail closed instead of mixing another exchange's OI data into Bitunix execution or relabeling volume as open interest.

**Why:** The prior Bybit-data/Binance-execution split made both signal evidence and risk attribution unreliable.

**How to apply:** Keep automated scans and execution disabled until Bitunix offers an official OI source or the strategy is explicitly redesigned and revalidated without OI.