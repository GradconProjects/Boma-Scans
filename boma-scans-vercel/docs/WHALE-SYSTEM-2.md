# Whale System 2

A separate system inside Boma Scans, added beside the Scanner, the original Whale system and Before Telegram. It reads their data and changes none of their logic.

Model version: `WS2-0.1`. Status: **shadow mode, unvalidated**. No order is ever placed.

## Backup and how to undo

- The version before this work is commit `f9e6350`, kept on GitHub as branch `backup/before-whale-system-2`.
- Whale System 2 lives only in these places. Deleting them removes it completely:
  - `app/lib/ws2/` (engine, outcome scoring, data-source registry)
  - `app/server/ws2/` (data gathering, records, scheduler)
  - `app/api/ws2/` and `app/api/cron/ws2/`
  - `app/whales-2/` and `app/components/ws2-view.tsx`
  - `tests/ws2-engine.test.mjs`, this document
- Three existing files gained additive lines only: one extra button in `app/components/system-switch.tsx`, one extra card in `app/start/page.tsx`, one extra `/ws2` command in `app/server/telegram-controls.ts`.
- Its database records all start with `ws2-` (`ws2-settings`, `ws2-log`, `ws2-schedule`). Its scheduler job is `boma-ws2`. No other system's record or job is written.

## Defects found in the existing positioning score (kept as is, for comparison)

| Existing behaviour | Why it is a problem | What System 2 does |
|---|---|---|
| LONG and SHORT scores are mirror images | The app must always prefer one side | Independent scores; both can be low; NO TRADE is a result |
| Whales short means follow short | No evidence yet that they predict; old profitable shorts are not new calls | New exposure counts fully; an established profitable book is flagged as an old call with profit-taking risk and weighted down |
| Binance and OKX top traders averaged into "smart money" | Different populations (top 20% by margin vs top 5% by position value) | Shown per exchange, never averaged; disagreement scores zero |
| Crowd long means short | Crowds can be right through a trend; 67% may be normal for the coin | Counts only at the 90th / 10th percentile of the coin's own history, only as fuel |
| Funding near zero means balanced leverage | Funding does not show leverage | Called ordinary; only extremes against its own history count |
| Open interest change in USD | A falling price lowers USD open interest with no position closed | Judged in coin units; the USD change is shown separately |
| Score read as confidence | It is not a probability | Labelled UNCALIBRATED HEURISTIC until calibrated |
| "Normal size is fine" from sentiment | Size must come from risk | Size = risk ÷ (stop distance + fees + slippage); not authorised until ENTRY READY |
| No idea whether the move already happened | Entering after a flush is chasing | Exhaustion score and a seven-stage squeeze lifecycle |

## Architecture

Nine independent scores, each 0–100:

1. Bullish directional bias
2. Bearish directional bias
3. LONG entry quality
4. SHORT entry quality
5. Long-squeeze potential (longs forced out, price falls)
6. Short-squeeze potential
7. Market exhaustion risk
8. Data reliability
9. Risk-adjusted opportunity

### Directional bias

Each component returns a bullish value and a bearish value from 0 to 1. Bias = Σ weight × value. An unavailable component returns 0 for both and its weight is **not** redistributed, so missing data lowers the achievable score.

| Component | Weight | Definition |
|---|---:|---|
| Price action and structure (1h) | 30 | EMA20 vs EMA50, EMA20 slope, close vs EMA20, last two confirmed swing highs and lows; plus the scanner's BOS and CHoCH |
| Open interest and execution flow | 20 | 4 h price change against 4 h coin-unit open-interest change (four quadrants), plus taker buy share when 200+ trades |
| Higher-timeframe trend | 15 | Same trend read on 4h (60%) and daily (40%) |
| Whale positioning | 10 | 60% new exposure in 24 h, 40% established book (20% when that book is over 5% in profit) |
| Exchange top traders | 10 | Both lean the same way: 1.0. One leans, the other neutral: 0.4. Opposite: 0 |
| Retail crowd | 5 | 0.6 against the crowd only at the 90th / 10th percentile of its own history |
| Funding | 5 | 0.5 only when funding per 8 h is at the 90th / 10th percentile and beyond ±0.03% |
| Bitcoin | 5 | BTC 1h and 4h trend scaled by the coin's correlation |

These weights are the provisional hypotheses supplied with the brief. They are **not fitted**.

### Exhaustion (0–100)

24 h move in daily ATRs (30) + distance from the 1h EMA20 in ATRs (25) + RSI extreme (15) + coin open interest falling during the move (15) + volume now under 60% of the move's peak (10) + rejection wick (5) + one-sided liquidations when a timestamped source exists (10).

### Squeeze lifecycle

`1 No conditions → 2 Building → 3 Initial trigger → 4 Active → 5 Late-stage → 6 Potential exhaustion → 7 Recovery or reversal`, from the maximum 24 h displacement in daily ATRs, how much has been reclaimed, coin open interest and fading pressure.

### Entry quality

Location relative to the 1h EMA20 (35) + 15-minute confirmation, a closed candle beyond its EMA20 with a lower high or higher low (25) + structure in the direction (20) + weighted reward (20) − 0.3 × exhaustion.

### Status

`DATA UNAVAILABLE` (reliability under 45) → `NO TRADE` (both biases under 30) → `WATCHING` (no side leads by 15 with at least 35) → `CHASING RISK` (exhaustion 60+ or price over 1.5 ATR past fair value) → `ENTRY READY` (bias 45+, entry quality 65+, 15m confirmed, exhaustion under 50, reliability 60+) → `AWAITING PULLBACK` → `AWAITING CONFIRMATION` / `SETUP FORMING`.

Thresholds live in `WS2_THRESHOLDS` and weights in `WS2_WEIGHTS` in `app/lib/ws2/engine.ts`.

### Levels and size

- Pullback entry around the 1h EMA20; market entry recalculated from the current price with its own stop and targets.
- Stop: beyond the 20-candle structure plus 0.3 ATR, kept between 1.2 and 3 ATR.
- Five targets from confirmed 1h, 4h and daily swings, at least 0.5R apart; a volatility multiple is used, and labelled, only where no structure exists.
- Weighted reward uses 30/25/20/15/10% exits, not the distance to TP5.
- Size = equity × risk % ÷ (stop distance + round-trip fees + slippage). Leverage sets margin only. The estimated liquidation price must sit beyond the stop.

## Data sources

The full registry is in `app/lib/ws2/registry.ts` and on the page under "Data sources & method". Key limits:

- **Liquidations:** Bybit publishes no liquidation history over REST. Always UNAVAILABLE live. Nothing is estimated.
- **Bybit account ratio:** about 20 days of hourly history, so percentiles are short-window.
- **Open interest:** about 8 days of hourly history.
- **Whales:** Hyperliquid only. A futures position may hedge spot held elsewhere. Wallet transfers are not used.
- **Predicted funding, order-book depth, CVD history:** not used.

## Testing actually run

- `tests/ws2-engine.test.mjs`: 8 tests, all passing.
- The mandatory NEAR/USDT regression test uses the captured readings (Binance 62% long, OKX 51%, Bybit 67% unchanged, coin open interest +0.18% with USD about −11%, funding −0.002262% against a displayed +0.0050%, 95% long liquidations, whale exposure not supplied). The general engine, with no NEAR-specific code, returns bearish bias, top traders "do not support shorts", retail "normal for this coin", the USD/coin open-interest distinction, exhaustion 90/100, long squeeze at "potential exhaustion", the funding discrepancy flag, whales UNAVAILABLE, size NOT AUTHORISED, and status CHASING RISK.
- The existing 102 tests still pass unchanged.

## Testing NOT run (unresolved)

- **No historical backtest of System 2 has been run.** Exchanges publish only days to weeks of positioning, open-interest and account-ratio history, so a 12–24 month test of those inputs is not possible from public data. No win rate, profit factor or drawdown is claimed.
- **No comparison against the original system** exists yet. It needs logged outcomes from both.
- **No probability calibration.** Scores are heuristics.
- **No walk-forward, ablation or regime breakdown** yet; they need the log.
- Daily loss limits, portfolio exposure and correlation limits are not implemented; sizing is per trade.

## Validation plan (prospective)

1. The 15-minute job analyses the System 2 watchlist and freezes each signal in `ws2-log` with its inputs, scores and plan.
2. After the signal's life, `scoreOutcome` scores it once against the following 15-minute candles: the entry must trade within 4 hours; a stop touched first cancels the trade with no loss; a stop and target in one candle counts as a stop; fees and slippage are deducted.
3. The page shows 7, 30 and 90-day results, labelled INSUFFICIENT SAMPLE under 30 filled trades and PRELIMINARY under 100.

## Recalibrating later

1. Collect at least 100 filled, scored signals across different market conditions.
2. Split by time: fit on the oldest 60%, check on the next 20%, report on the final 20% once.
3. For each component, compare outcomes with it removed (ablation). Drop or down-weight components that add nothing.
4. Change `WS2_WEIGHTS` / `WS2_THRESHOLDS`, bump `WS2_VERSION`, and keep the old log entries untouched so versions can be compared.
5. Only after that, consider fitting a probability model (logistic or isotonic) and replacing the UNCALIBRATED label.
