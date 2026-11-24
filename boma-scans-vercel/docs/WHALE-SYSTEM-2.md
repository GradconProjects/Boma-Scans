# Whale System 2

A separate system inside Boma Scans, added beside the Scanner, the original Whale system and Before Telegram. It reads their data and changes none of their logic.

Model version: `WS2-0.3`. Status: **shadow mode, calibrated on 511 pairs over three years; no profit edge shown**. No order is ever placed.

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

## Calibration (model WS2-0.3)

### What was run

- **Replay:** the engine was run every 4 hours over **511 Bybit crypto perpetuals** (every crypto pair listed today; stock and commodity contracts left out) from **2023-12-08 to 2026-11-23**, about three years: **2,150,992 readings**, collected in six 180-day chunks. Zero pairs failed. A pair enters the test when it has enough history, so older periods hold fewer pairs.
- **No look-ahead:** at each reading the engine saw only candles that had closed and open interest, account ratios and funding stamped by that time.
- **Outcomes:** for every reading both the LONG and the SHORT plan, pullback and market, were played forward on 15-minute candles. The entry must trade within 4 hours. A stop touched before the fill cancels the trade. 30/25/20/15/10% is closed at TP1–TP5, the stop is never moved, the remainder is lost at the stop or closed after 24 hours. A stop and target in one candle counts as the stop. Fees (0.055% each way) and slippage (0.02%) are deducted.
- **Split:** oldest 60% to fit, next 20% and final 20% to check, with a 30-hour gap between sets because outcome windows overlap.

| Period | Dates | Readings | Pairs | Typical coin per day | Share of times the market rose |
|---|---|---:|---:|---:|---:|
| Fitting | 2023-12-08 → 2026-01-22 | 1,290,940 | 446 | -0.47% | 47% |
| Check 1 | 2026-01-24 → 2026-06-28 | 426,780 | 481 | -0.64% | 44% |
| Check 2 | 2026-06-30 → 2026-11-23 | 426,981 | 511 | -0.39% | 46% |

### What it showed

1. **The rating separates bad setups from better ones, and that holds on unseen data** (ranking score 0.57 fitting, 0.554 and 0.561 on the checks; 0.50 is chance). The worst rating lost 0.59R on average in unseen data.
2. **No group of setups made money after fees.** The best rating averaged −0.04R in unseen data. System 2 has **not** shown a profit edge over three years.
3. **ENTRY READY was slightly negative in all three periods** (−0.01R, −0.03R, −0.04R). LONG entries lost in every period; SHORT entries were about break-even.
4. **The directional bias did not predict direction.** Against the next 24 hours it scored 0.477, 0.466 and 0.48, and below 0.50 in 5 of 6 half-years: mild mean reversion, not trend following.
5. **Retail crowding and funding carried almost no information** (0.50–0.51).
6. **The typical coin drifted down in every half-year.** Entering LONG at random lost more than entering SHORT at random in every block.

Rating table, market entry, unseen data (both checks pooled):

| Rating | Setups | Finished in profit | Average result | Error | Check 1 | Check 2 |
|---|---:|---:|---:|---:|---:|---:|
| 1/10 (blocked) | 182,502 | 30% | −0.59R | ±0.01 | −0.63R | −0.56R |
| 2/10 (blocked) | 166,718 | 37% | −0.14R | ±0.01 | −0.11R | −0.16R |
| 3/10 | 161,446 | 40% | −0.12R | ±0.01 | −0.09R | −0.14R |
| 4/10 | 169,684 | 41% | −0.12R | ±0.01 | −0.10R | −0.14R |
| 5/10 | 175,319 | 43% | −0.11R | ±0.01 | −0.09R | −0.13R |
| 6/10 | 181,361 | 45% | −0.06R | ±0.01 | −0.06R | −0.07R |
| 7/10 | 177,911 | 46% | −0.04R | ±0.01 | −0.04R | −0.04R |
| 8/10 | 169,830 | 46% | −0.04R | ±0.01 | −0.05R | −0.03R |
| 9/10 | 167,727 | 47% | −0.04R | ±0.01 | −0.05R | −0.02R |
| 10/10 | 155,008 | 48% | −0.04R | ±0.01 | −0.04R | −0.03R |

Rules compared (average result after fees, number of trades):

| Rule | Fitting | Check 1 | Check 2 |
|---|---:|---:|---:|
| 0.1 ENTRY READY (market) | −0.01R (25,696) | −0.03R (8,882) | −0.04R (8,597) |
| ENTRY READY, LONG only | −0.07R (9,695) | −0.09R (2,395) | −0.07R (2,706) |
| ENTRY READY, SHORT only | +0.04R (16,001) | −0.01R (6,487) | −0.01R (5,891) |
| 0.2 blocked: lead side but rating 1-2 (pullback, what was avoided) | −0.07R (6,616) | −0.01R (1,821) | −0.06R (1,970) |
| 0.2 kept waiting setups: lead side, rating 3-10 (pullback) | +0.01R (347,897) | +0.00R (117,651) | +0.00R (114,985) |
| any lead side, rating 9-10 (market) | +0.01R (207,117) | −0.02R (66,424) | +0.00R (59,107) |
| any lead side, rating 1-2 (market) | −0.08R (11,327) | −0.04R (3,206) | −0.06R (3,344) |
| reference: always LONG (market) | −0.12R (1,290,940) | −0.16R (426,778) | −0.14R (426,975) |
| reference: always SHORT (market) | −0.06R (1,290,940) | −0.07R (426,778) | −0.11R (426,975) |

Half-year by half-year (average result after fees, number of trades). Only the last block is entirely unseen by the rating model; the ENTRY READY and reference columns are not fitted at all.

| Period | Pairs | Typical coin / day | ENTRY READY | Rating 9–10 | Rating 1–2 | Always LONG | Always SHORT | Bias vs direction |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2023-12-08 → 2024-05-27 | 216 | -0.33% | −0.03R (4,249) | −0.01R (30,673) | −0.12R (1,880) | −0.11R (188,415) | −0.06R (188,415) | 0.46 |
| 2024-05-27 → 2024-11-25 | 262 | -0.31% | +0.04R (5,138) | +0.04R (40,754) | −0.10R (2,083) | −0.13R (249,799) | −0.06R (249,799) | 0.50 |
| 2024-11-25 → 2025-05-26 | 330 | -0.61% | +0.01R (6,391) | +0.01R (48,492) | +0.03R (2,711) | −0.12R (308,621) | −0.03R (308,621) | 0.47 |
| 2025-05-26 → 2025-11-24 | 430 | -0.6% | −0.06R (7,229) | −0.00R (64,131) | −0.11R (3,537) | −0.13R (390,304) | −0.07R (390,304) | 0.47 |
| 2025-11-24 → 2026-05-25 | 475 | -0.53% | −0.03R (9,710) | −0.03R (75,573) | −0.06R (3,718) | −0.14R (494,389) | −0.09R (494,389) | 0.47 |
| 2026-05-25 → 2026-11-23 (unseen) | 511 | -0.53% | −0.04R (10,765) | +0.01R (73,973) | −0.08R (3,996) | −0.16R (519,456) | −0.09R (519,456) | 0.48 |

Did each input predict the next 24 hours? (0.50 = coin flip)

| Input | Fitting | Check 1 | Check 2 |
|---|---:|---:|---:|
| structure | 0.481 | 0.467 | 0.482 |
| flow | 0.494 | 0.484 | 0.485 |
| htf | 0.477 | 0.485 | 0.493 |
| retail | 0.513 | 0.505 | 0.498 |
| funding | 0.511 | 0.504 | 0.499 |
| btc | 0.484 | 0.494 | 0.481 |

### What changed in the app because of it

- Every reading carries a **calibrated rating from 1 to 10** with the record of similar setups in the unseen data: how often they finished in profit and the average result after fees.
- **Setups rated 1–2 are blocked** (status NO TRADE). That is the one rule the data supports in every period.
- ENTRY READY is worded as a fair entry, not a proven edge.
- **ENTRY READY is held on a Melbourne Monday or Tuesday.** Entries on those days lost money in both systems across three years; see `docs/SYSTEM-COMPARISON.md`.
- Each pair shows its own count and result of well-rated setups, marked as a small sample.
- The weights from the brief are unchanged: nothing in the test justified new ones, and the rating model now does the ranking.

### Limits that remain

- **Survivorship:** only pairs still listed today were replayed. Delisted coins, which mostly fell, are missing, so real results were probably a little worse for longs.
- **No broad rising market for alts in the sample.** The typical coin drifted down in every half-year, even when Bitcoin rose.
- **Not tested, no history exists:** whale positions, exchange top-trader ratios, taker flow, liquidations. They still enter the live bias at their provisional weights.
- **One model for all pairs.** A single pair has too few readings to fit separately.
- Readings every 4 hours overlap, so errors are grouped by timestamp; they are still approximate.
- No walk-forward re-fitting, no probability calibration beyond the ten rating bands, no portfolio or daily-loss limits.
- The Scanner comparison is in `docs/SYSTEM-COMPARISON.md`. The original whale system could not be replayed: whale positions have no history.

### Re-running the calibration

Tools and steps are in `tools/ws2-calibration/README.md`. The replay endpoint is `/api/ws2/calibrate` (scheduler key required); `end=<ms>` replays an older window.

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
