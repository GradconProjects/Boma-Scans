# One-hour default, candle history and account sync

2 November 2026, Version 15 Site.

Default day/chart timeframe is 1h. Explicit saved account preferences can override it. Swing remains 4h. Initial primary/context/macro chart history requests 1,000 candles per frame. The chart offers exclusive-timestamp pagination in 1,000-candle pages back to the exchange's available start. Older loaded candles are preserved during refresh and stream updates; ALL displays the full loaded history.

Current primary OHLC candles reconcile against uncached Bybit REST every five seconds alongside the live socket. Returning to a visible tab triggers a complete recent-history reload. Freshness requires a current interval candle and a successful recent candle reconciliation; stale/missing verification blocks new entry gates. This does not guarantee exchange uptime or zero network latency. API routes are excluded from the service-worker cache.

Account sync stores selected symbol, timeframe, trading style, account-equity setting, fee/slippage settings, entry flexibility, auto-scan settings and paper/manual trade records. Account records are isolated using the platform-verified ChatGPT user ID. Local trade records import when absent in the account; an existing cloud record is authoritative on first connection. Data polls every five seconds and on return to a visible tab. Concurrent writes use expected revisions. Conflicts require an explicit cloud-load action, which first backs up the device copy locally. A failed connection leaves the device copy intact and shows the error. Both devices must use this Version 15 URL and the same ChatGPT account.

Raw candle streams, browser sound permission and chart zoom are device-local. Confirmed chart-plan locks remain session-local; journalled trade levels sync in the trade records. No sync operation submits, changes or cancels a Bybit order.

Verification: 42 engine/history tests, 3 API/SQLite auth/concurrency tests, TypeScript checking and production build. Preview confirms 1H and history/sync controls. Preview had no signed-in identity and its Bybit upstream failed, so real two-device sign-in and live exchange connectivity remain unverified. Publication provisions the D1 binding and schema migration.

## Telegram delivery

The bot credential is a hosted secret only. An authenticated owner connects a numeric Telegram chat ID by sending a test from the Telegram panel; the bot must have been started in that chat. The destination is stored per account. Automatic delivery is initiated by new completed foreground scans; it is not a background/24-hour scanner. A manual button can send currently qualified signals after connection.

Before delivery, the server independently refreshes execution/context/macro/BTC candles and the ticker, checks quote age, closed-candle readiness, matching fixed entry/stop levels and BTC divergence. It withholds stale, expired, changed or invalidated signals. A per-account delivery key prevents two active devices sending the same confirmed setup twice. Ambiguous/partial failures are not automatically retried. Messages include the original fixed plan, TA targets, entry/exit/cancellation logic and Melbourne timestamps. The bot does not monitor or manage exchange orders.

Actual Telegram delivery remains pending until the chat ID is connected. No message has been sent to an unspecified destination.
