# Signal recovery and backtest-calibrated policy

## Why signals stopped

The scoring engine did not change between Before-Telegram and W-Telegram. Both builds shipped a take-profit policy that made qualified entries almost impossible:

- All five targets had to sit inside a short volatility budget (2 ATR for Scalp, 3.5 ATR for Day).
- 75% of the position closed at TP1/TP2, so the weighted payoff was roughly a third of that budget.
- The stop is never closer than 0.65 normal candle ranges and is usually about 1 ATR.
- The plan still had to reach a 1.2R weighted reward.

In a replay of 48,000 scans (20 pairs, Scalp and Day) the engine approved **zero** entries, and the target check failed 99.9% of the time.

The Telegram build also lost several reliability fixes:

| Problem | Fix |
| --- | --- |
| Bybit proxy no longer retried 5xx, 429 or rate-limit responses | 3 attempts with backoff; retries HTTP 5xx/429 and Bybit retCode 10006/10016 |
| A failed bulk instrument download left every pair without contract limits, so nothing could size or qualify | Per-pair instrument fallback |
| Auto-scan timer aborted a scan that was still running; long scans restarted forever | The timer skips while a scan is running |
| Signals were only issued after the whole universe finished scanning | Each pair can alert as soon as it qualifies; withdrawals wait for a complete scan |
| Telegram server re-check used 600 candles instead of the scanner's 480/400/360 and required exact float equality of trigger/stop/confirmation time | Same history depths; trigger/stop tolerance of 15% of a normal candle range; a newer confirmation is accepted |

## Backtest method

- **Data:** Bybit's own public trade archive (`public.bybit.com/trading`), aggregated to 5m candles and rolled up to 15m/1H/4H/1D/1W. 2 years (Nov 2024 to Nov 2026) for 20 established USDT perpetuals; TRUMP, HYPE and FARTCOIN use their full listing history. About 4.6 million 5m candles in all.
- **Engine:** the app's own `analyzeMarket` and `analyzeBtcRelationship` code, replayed candle by candle with only closed candles visible. BTC-REJECT setups were excluded.
- **Fills:** entry at the live price when the plan is READY. Partial exits at each target. Stop on the remaining size, assumed hit before any target touched in the same candle (conservative). The app's runner timeout after TP2 is applied, with a maximum hold of 3 days on 1H.
- **Costs:** "maker" = 0.02% limit entry and limit take-profits plus 0.075% for stop exits. "taker" = 0.075% (0.055% fee + 0.02% slippage) on every fill. Funding is excluded.
- **Out-of-sample check:** rules were chosen on the most recent year (Sep 2025 to Nov 2026), then checked on the earlier year (Nov 2024 to Sep 2025).

## Findings

| Execution timeframe | Result after fees (best variant) |
| --- | --- |
| 5m (Scalp) | Loses in every variant: -0.05R to -0.2R per trade, even with maker fees. Fees cost about 0.7R per trade. |
| 15m (old Day) | About breakeven with maker fees; negative with taker fees. |
| **1H (Day / Swing)** | **Profitable in both years** (see below). |
| 4H (old Swing) | About breakeven, no edge (67 trades). |

On 1H, with stop at least 0.5% of price, ADX trending regime and the 1R to 5R ladder:

| Setup | Year | Trades | Win % | Avg R (maker) | Avg R (taker) | Profit factor (maker) |
| --- | --- | --- | --- | --- | --- | --- |
| Day rules @ 1H | Out-of-sample | 95 | 47 | +0.39 | +0.34 | 1.92 |
| Day rules @ 1H | Tuning year | 168 | 42 | +0.23 | +0.16 | 1.47 |
| Swing rules @ 1H | Out-of-sample | 98 | 48 | +0.43 | +0.37 | 2.01 |

Other evidence used:

- Stops under about 0.5% of price lost money in every mode, because fees consumed 0.3R or more.
- Weak-trend (ADX 15 to 25) entries underperformed trending (ADX 25+) entries in both years.
- The R-multiple ladder beat the structural target map and the other ladders tested on 1H.

## Policy now in the engine

1. **1H leads.** Day and Swing both execute on 1H (Swing keeps its wider style limits). Other chart timeframes stay available for analysis, but the "Validated signal timeframe" check holds them at WAIT, so they cannot produce READY signals or Telegram alerts.
2. **Targets: TA levels by default, R ladder optional.** TA levels snap each of the five targets to real chart structure (swing and liquidity levels, volume nodes, anchored VWAP bands, Fibonacci extensions, measured moves, candle projections) nearest to a desired-distance ladder of 0.9R/1.6R/2.5R/3.5R/5R, preferring the nearer level so targets are reachable; an R multiple fills a slot only when no structure exists in its window. The R ladder (1R..5R) remains available from the settings bar. Both close 30/25/20/15/10%. See the comparison below.
3. **Fee gate:** round-trip fee, slippage and spread must cost no more than 0.30R of the stop. At the default 0.055% fee and 0.02% slippage this needs a stop of at least about 0.5% of price.
4. **Regime:** only ADX 25+ (TRENDING) markets qualify; weak trend waits.
5. **All timeframes aligned:** a trend, breakout or pullback signal needs the execution frame (1H close vs EMA21), context frame (4H close vs EMA50) and macro frame (1D close vs EMA200) all on the trade's side. Two of three now shows WAIT. In the backtest, 2/3-aligned trend setups averaged about +0.12R against +0.30R to +0.47R for full alignment. CHoCH reversals trade against the higher frames by design and keep their one-frame requirement. ADX trend strength is measured on the context (4H) frame.
6. **Historic support and resistance.** Confirmed swing highs and lows on the daily chart (three closed candles either side) and the weekly chart (two either side), the yearly and multi-year extremes and the prior month's range are clustered into zones about 0.6 daily-ATR wide; a zone counts when it has two touches or one weekly / yearly reference. Zone edges enter the target map with the highest structural weight, so targets snap to historic levels, and every signal shows the nearest supporting and opposing level with frame and touch count and the room to it in R. The levels are **not** an entry gate: see the table below.
7. The old 1.2R weighted-reward minimum and the "all five targets structural" rule are removed. They blocked nearly every signal and did not improve results.

## End-to-end result of the finished engine

These figures come from replaying the final engine. They count only plans that reached READY (all required checks passed, BTC not REJECT), using the exact take-profits the app produces. Period: 2 years of Bybit 1H data, 23 pairs; one open trade per pair at a time.

| Mode (1H) | Signals | Win % | Avg R, maker / taker fees | Out-of-sample yr (maker) | Tuning yr (maker) | Profitable months (maker) | Max drawdown (maker) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Swing, Strict | 206 | 44 | +0.30 / +0.24 | +0.51 | +0.19 | 14 of 20 | 10.7R |
| Day, Strict | 200 | 43 | +0.26 / +0.20 | +0.44 | +0.16 | 13 of 20 | 10.7R |
| Day, Balanced | 209 | 42 | +0.25 / +0.18 | +0.44 | +0.14 | 13 of 20 | 11.8R |

"R" is the amount risked per trade. At 1% risk per trade, +0.26R per trade is +0.26% of equity per trade on average, before funding. Expect losing months: a drawdown of about 11R is about 11% of equity at 1% risk.


## Target styles compared (2 years, Day rules on 1H, READY signals only)

| Style | Signals | Win % | Avg R (limit / market fees) | Profit factor | Profitable months | Max drawdown | Out-of-sample yr | Tuning yr |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **TA levels** (default) | 203 | **51** | +0.23 / +0.17 | 1.54 | **14 of 20** | **9.2R** | +0.34 | **+0.17** |
| R ladder | 200 | 43 | +0.26 / +0.20 | 1.55 | 13 of 20 | 10.7R | +0.44 | +0.16 |

TA levels trade a little average reward for a higher hit rate, a smaller drawdown and more profitable months, with the same profit factor; average TP1 sits at 0.82R instead of 1.0R. The ladder earned more in the out-of-sample year, TA levels slightly more in the recent year. Choose by temperament: TA levels if missed targets bother you more than a smaller runner, the ladder if you prefer letting winners run.

## Historic levels: targets help, a room-to-level gate hurts

Same 2 years, 23 pairs, 1H, Strict, TA targets, limit fees. "Info" computes the zones but changes nothing; "Targets" adds zone edges to the target map; "Gate" also requires 1R of room before the next major zone.

| Mode | Day signals | Day avg R | Day total R | Day max DD | Swing signals | Swing avg R | Swing total R | Swing max DD | Profitable months (Swing) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Info (no change) | 168 | +0.18 | 31 | 9.4R | 203 | +0.26 | 53 | 9.4R | 14 of 20 |
| **Targets (adopted)** | 168 | +0.19 | 32 | 9.1R | 203 | +0.27 | 54 | **8.9R** | **15 of 20** |
| Gate (room ≥ 1R) | 130 | +0.19 | 25 | 11.9R | 157 | +0.24 | 38 | 11.9R | 14 of 19 |

The gate removed 76 Day trades that averaged **+0.43R** (59% winners) and kept trades averaging +0.12R: in a trending regime the signals that break through a historic level are the better ones. So the engine uses the levels for targets and shows them on every signal, with the honest note that a level inside the first target's path means "expect a reaction, take the partial", not "do not trade".

## Additional filters tested (my own candidates)

Tested on the 186 READY 1H signals of the finished engine, checked separately on each year. Only rules that held in both years were adopted.

| Candidate | Result | Decision |
| --- | --- | --- |
| Trade with BTC's daily trend (close vs 200-day EMA) | Aligned +0.31R vs against +0.22R per trade; aligned better in both years | **Adopted as half size** against the trend, with a badge. Not a block: against-trend trades were still positive. |
| Move the stop to breakeven after TP1 | Win rate 44% → 65%, but average fell from +0.28R to +0.23R | Not adopted by default. Choose it if you prefer a smoother equity curve over total return. |
| Trail the stop to the previous target | Slightly worse than the fixed plan | Not adopted. |
| Session (UTC hours) | Asia/London strongest in both years; New York 13-21 UTC weakest (negative in the tuning year, positive in the other) | Shown in the levels panel; not gated. |
| Volatility (ATR % of price), setup type, score bands, weekends | Promising in one year, flipped in the other | Shown for judgement; not gated. |

Order-book balance (bid vs ask depth within 1% of price, from Bybit's 50-level book) cannot be backtested from candle data. It is shown as an execution aid: do not chase into opposing depth, and never treat it as an entry trigger on its own; resting orders can be pulled within seconds.

## Limits

- This is a historical simulation of 23 liquid pairs, not a guarantee. Past results do not predict future returns.
- 1H signals are infrequent: a few hundred across 2 years and 23 pairs. Your live scanner covers more pairs, so expect more alerts, but still patience-level frequency.
- Limit-order (maker) entries and take-profits make a large difference. Place limit orders where the plan allows.
- Funding, partial fills, gaps through stops beyond one candle, and exchange outages are not modelled.
- Keep a journal and compare live results per mode after costs before changing these thresholds.
