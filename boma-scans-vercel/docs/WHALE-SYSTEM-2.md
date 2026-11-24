# Whale System 2

A separate system inside Boma Scans, added beside the Scanner, the original Whale system and Before Telegram. It reads their data and changes none of their logic.

Model version: `WS2-0.2`. Status: **shadow mode, calibrated on 511 pairs; no profit edge shown**. No order is ever placed.

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

## Calibration (model WS2-0.2)

### What was run

- **Replay:** the engine was run every 4 hours over **511 Bybit crypto perpetuals** (every crypto pair listed; stock and commodity contracts left out) from 2026-05-28 to 2026-11-23: **513,764 readings**. Zero pairs failed.
- **No look-ahead:** at each reading the engine saw only candles that had closed and open interest, account ratios and funding stamped by that time.
- **Outcomes:** for every reading both the LONG and the SHORT plan, pullback and market, were played forward on 15-minute candles. The entry must trade within 4 hours. A stop touched before the fill cancels the trade. 30/25/20/15/10% is closed at TP1–TP5, the stop is never moved, the remainder is lost at the stop or closed after 24 hours. A stop and target in one candle counts as the stop. Fees (0.055% each way) and slippage (0.02%) are deducted.
- **Split:** oldest 60% to fit, next 20% and final 20% to check, with a 30-hour gap between sets because outcome windows overlap.

| Period | Dates | Readings | Typical coin per day | Share of times the market rose |
|---|---|---:|---:|---:|
| Fitting | 2026-05-28 → 2026-09-16 | 308,625 | -0.41% | 43% |
| Check 1 | 2026-09-17 → 2026-10-20 | 99,034 | -0.22% | 54% |
| Check 2 | 2026-10-22 → 2026-11-23 | 99,157 | -1.15% | 42% |

### What it showed

1. **The rating separates bad setups from better ones, and that holds on unseen data** (ranking score 0.573 fitting, 0.552 and 0.559 on the checks; 0.50 is chance).
2. **No group of setups made money after fees.** The best rating is about break-even. System 2 has **not** shown a profit edge.
3. **The directional bias did not predict direction.** Against the next 24 hours it scored 0.477, 0.489 and 0.447: slightly worse than a coin flip, i.e. mild mean reversion.
4. **Retail crowding and funding carried no measurable information** (0.49–0.51).
5. **The market fell in all three periods.** Shorts did well late in the test because of the market, as the "always SHORT" row shows.

Rating table, market entry, unseen data (both checks pooled):

| Rating | Setups | Finished in profit | Average result | Error | Check 1 | Check 2 |
|---|---:|---:|---:|---:|---:|---:|
| 1/10 (blocked) | 44,857 | 30% | −0.47R | ±0.03 | −0.54R | −0.40R |
| 2/10 (blocked) | 41,269 | 38% | −0.14R | ±0.03 | −0.15R | −0.13R |
| 3/10 | 39,114 | 41% | −0.10R | ±0.02 | −0.12R | −0.09R |
| 4/10 | 37,054 | 42% | −0.10R | ±0.02 | −0.13R | −0.08R |
| 5/10 | 36,604 | 44% | −0.08R | ±0.01 | −0.09R | −0.07R |
| 6/10 | 37,788 | 46% | −0.04R | ±0.01 | −0.04R | −0.03R |
| 7/10 | 38,695 | 47% | −0.03R | ±0.02 | −0.02R | −0.03R |
| 8/10 | 40,310 | 48% | −0.00R | ±0.02 | −0.01R | +0.00R |
| 9/10 | 40,181 | 47% | −0.01R | ±0.02 | −0.02R | −0.00R |
| 10/10 | 40,504 | 45% | −0.02R | ±0.02 | −0.03R | −0.02R |

Rules compared (average result after fees, number of trades):

| Rule | Fitting | Check 1 | Check 2 |
|---|---:|---:|---:|
| 0.1 ENTRY READY (market) | −0.06R (6,364) | −0.08R (1,769) | +0.08R (2,441) |
| 0.2 ENTRY READY: 0.1 rule and rating 8-10 (market) | −0.07R (2,106) | −0.12R (579) | +0.10R (1,066) |
| 0.2 blocked: lead side but rating 1-2 (pullback, what was avoided) | −0.12R (1,871) | −0.03R (646) | −0.07R (646) |
| 0.2 kept waiting setups: lead side, rating 3-10 (pullback) | −0.02R (83,120) | +0.03R (26,042) | +0.09R (28,967) |
| any lead side, rating 9-10 (market) | −0.01R (54,507) | −0.01R (16,816) | +0.07R (21,947) |
| any lead side, rating 1-2 (market) | −0.10R (4,180) | −0.04R (1,484) | −0.07R (1,347) |
| reference: always LONG (market) | −0.15R (308,620) | −0.07R (99,034) | −0.30R (99,154) |
| reference: always SHORT (market) | −0.15R (308,620) | −0.13R (99,034) | +0.12R (99,154) |

Did each input predict the next 24 hours? (0.50 = coin flip)

| Input | Fitting | Check 1 | Check 2 |
|---|---:|---:|---:|
| structure | 0.485 | 0.497 | 0.451 |
| flow | 0.486 | 0.481 | 0.477 |
| htf | 0.475 | 0.496 | 0.472 |
| retail | 0.501 | 0.496 | 0.502 |
| funding | 0.498 | 0.493 | 0.509 |
| btc | 0.500 | 0.464 | 0.439 |

### What changed in the app because of it

- Every reading carries a **calibrated rating from 1 to 10** with the record of similar setups in the unseen data: how often they finished in profit and the average result after fees.
- **Setups rated 1–2 are blocked** (status NO TRADE). That is the one rule the data supports in every period.
- ENTRY READY is worded as a fair entry, not a proven edge.
- Each pair shows its own count and result of well-rated setups, marked as a small sample.
- The weights from the brief are unchanged: nothing in the test justified new ones, and the rating model now does the ranking.

### Limits that remain

- **180 days, one falling market.** Results in a rising or flat market are unknown. Re-run when the market changes.
- **Not tested, no history exists:** whale positions, exchange top-trader ratios, taker flow, liquidations. They still enter the live bias at their provisional weights.
- **One model for all pairs.** A single pair has about 1,000 readings, too few to fit separately.
- Readings every 4 hours overlap, so errors are grouped by timestamp; they are still approximate.
- No walk-forward re-fitting, no probability calibration beyond the ten rating bands, no portfolio or daily-loss limits.
- The 0.2 rule was not compared with the original whale system; that needs logged outcomes from both.

### Re-running the calibration

Tools and steps are in `tools/ws2-calibration/README.md`. The replay endpoint is `/api/ws2/calibrate` (scheduler key required).

## Market coverage

System 2 is a general engine. No coin has special rules; NEAR is only the regression example.

- Every 15 minutes the scan reads the priority watchlist plus the next 10 of the most-traded Bybit USDT perpetuals by 24 h turnover (20, 40 or 80 pairs, default 40), so the whole universe is covered about once an hour.
- The universe is whatever trades most that day. Nothing is hand-picked.
- The Market board lists the latest reading for every coin from the last 24 hours, ranked by opportunity.
- A coin gets a new log entry only when its status or side changes, or after 4 hours, so the log records decisions and not repeats.
- Any coin can also be analysed on demand on the page or with `/ws2 COIN`.

## Validation plan (prospective)

1. The 15-minute job analyses the System 2 watchlist and freezes each signal in `ws2-log` with its inputs, scores and plan.
2. After the signal's life, `scoreOutcome` scores it once against the following 15-minute candles: the entry must trade within 4 hours; a stop touched first cancels the trade with no loss; exits are partial at the five targets (30/25/20/15/10%), the stop is never moved, a stop and target in one candle counts as the stop, and fees and slippage are deducted.
3. The page shows 7, 30 and 90-day results, labelled INSUFFICIENT SAMPLE under 30 filled trades and PRELIMINARY under 100.

## Recalibrating later

1. Collect at least 100 filled, scored signals across different market conditions.
2. Split by time: fit on the oldest 60%, check on the next 20%, report on the final 20% once.
3. For each component, compare outcomes with it removed (ablation). Drop or down-weight components that add nothing.
4. Change `WS2_WEIGHTS` / `WS2_THRESHOLDS`, bump `WS2_VERSION`, and keep the old log entries untouched so versions can be compared.
5. Only after that, consider fitting a probability model (logistic or isotonic) and replacing the UNCALIBRATED label.
