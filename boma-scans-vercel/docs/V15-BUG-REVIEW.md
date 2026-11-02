# Version 15 bug review — 14 October 2026

Restored historical source commit `19eb6e23acc9462f6dc52ad4292f5b958879a1e9` into the already-created Version 15 Site. That Site had no published version. This review does not replace Version 5.

## Corrections

- Reject out-of-order, stale, invalid or implausibly future-dated quotes. REST ticker responses retain the exchange timestamp instead of being stamped fresh on arrival.
- Continue REST retries after socket/poll failures; accept fresh REST quotes for execution gates. Retry failed history loads and reload overdue candles.
- Bind loaded data to the selected symbol/timeframe so changing charts cannot briefly authorize entries using the previous chart's data.
- Avoid overlapping trade-price polls and ignore callbacks after subscriptions stop.
- Wait for restored preferences before starting scans; switching browser focus no longer restarts a scan that is running or not due.
- Handle unavailable preference storage without preventing initialization.
- Size current-price plans from the actual current entry, not a previous analyzed entry.
- Suppress add-size guidance on stale quotes, invalidated stops, liquidation warnings and exit recommendations. Do not use an expired or different trading mode's analysis for position guidance.
- Use last-traded prices for recorded exits and P&L; mark price remains the liquidation reference. Recorded P&L is gross and is not an exchange fill.
- Recheck quote freshness when recording exits or protective stops; reject invalid equity and exit prices, and make closing an already closed record idempotent.
- Reject malformed or unordered OHLC data; send integer candle limits.

## Verification and limits

34 automated engine/regression tests pass. TypeScript checking passes. Production build is required by the publication workflow.

Browser interaction and live exchange connectivity were not verified in this session. No claim of profitability, backtested accuracy, or zero remaining bugs is made. This historical version records paper/manual trades locally; it does not execute exchange orders or provide cross-device journal sync. Stop and TP guidance is advisory, not an exchange-hosted protective order.

Bybit protocol reference: https://bybit-exchange.github.io/docs/v5/websocket/public/ticker (snapshot/delta semantics and timestamp); https://bybit-exchange.github.io/docs/v5/guide (REST response time).
