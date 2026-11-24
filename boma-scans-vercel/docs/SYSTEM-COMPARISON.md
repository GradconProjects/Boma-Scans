# Scanner and Whale System 2 compared on the same footing

Both engines were replayed over the same three years (2023-12-08 to 2026-11-23) on every Bybit crypto perpetual listed today, with identical rules.

## Method

- **No look-ahead.** At each check an engine saw only candles that had closed, plus the current price.
- **Scanner:** Day style (1h signals, 4h and daily context, Strict), checked **every hour**: 8,312,598 checks on 489 pairs. Turnover came from the real previous 24 hours. A signal that stayed valid for several hours counts once.
- **System 2:** checked every four hours: 2,055,320 readings on 511 pairs.
- **Scoring, the same for both:** 30/25/20/15/10% closed at the five targets, the stop never moved, a stop and target in one 15-minute candle counts as the stop, taker fees (0.055% each way) and 0.02% slippage deducted. The Scanner is scored on its own horizon (24 h to fill, 72 h in the trade); System 2 on its own (4 h and 24 h).
- **Errors** are grouped by timestamp, because signals issued at the same time are not independent.
- **Not replayed for either system:** the AI second read, whale positions, exchange top-trader ratios, the order-book spread.

## Results

| Rule | Trades | Finished in profit | Average result after fees | Error | LONG only | SHORT only |
|---|---:|---:|---:|---:|---:|---:|
| Scanner · every setup the engine calls | 152,600 | 39% | −0.02R | ±0.01 | −0.06R | +0.00R |
| Scanner · setups with a major event (CHoCH, break or sweep; stop 2+ ATR) | 12,256 | 45% | −0.01R | ±0.01 | −0.04R | +0.03R |
| Scanner · READY (every check passed) | 2,184 | 36% | −0.09R | ±0.03 | −0.19R | +0.01R |
| System 2 · ENTRY READY | 41,669 | 46% | −0.02R | ±0.01 |  |  |
| System 2 · any reading with a lead side | 1,195,521 | 46% | −0.01R | ±0.01 |  |  |
| No system · always LONG | 2,055,315 | 40% | −0.11R | ±0.01 |  |  |
| No system · always SHORT | 2,055,315 | 45% | −0.05R | ±0.01 |  |  |

1. **Neither system showed a profit edge after fees.** Both lose less than entering at random.
2. **The Scanner's READY signals did worst** (−0.09R). Its setups with a major event did best, at about break-even.
3. **LONG entries lost in both systems.** SHORT entries were about break-even. The typical coin drifted down in every half-year.
4. **READY and "major event" almost never coincide.** The current Telegram rule needs both, and that happened 2 times in three years of hourly checks. In practice the Scanner sends almost no entry calls under that rule.
5. **Trading against a stretched move was tested** on System 2's data and was worse than following the bias: about −0.08 to −0.10R in all three periods.

## The one timing effect that held: early in the week

Average result after fees by Melbourne weekday:

| System | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---:|---:|---:|---:|---:|---:|---:|
| System 2 · lead side | −0.07R | −0.06R | −0.07R | +0.05R | +0.03R | +0.04R | −0.02R |
| Scanner · major-event setups | −0.15R | −0.05R | −0.04R | +0.08R | +0.09R | +0.05R | +0.01R |
| Scanner · every setup | −0.08R | −0.05R | −0.04R | +0.04R | −0.01R | −0.00R | −0.03R |

- **Monday and Tuesday lost money in both systems.** System 2 lead side: −0.06R on Monday/Tuesday against +0.01R on other days, and the same sign in each year (2024 −0.04R, 2025 −0.05R, 2026 −0.09R).
- **Scanner major-event setups outside Monday, Tuesday and 03:00–10:00:** +0.05R ±0.02 over 6,278 trades; by year 2024 +0.06R, 2025 +0.08R, 2026 +0.01R. This is the only group in all the testing that came out ahead, and the margin is small.
- **The 03:00–10:00 "dead zone" was not confirmed.** Scanner major-event setups in those hours: −0.02R, no different from other hours.
- Random entries show no such weekday pattern, so this is about trend-style setups failing early in the week.

Caution: the weekday rule was first chosen on the earlier small test and is confirmed here on a far larger one, including a year and 460-odd pairs that test never saw. Wednesday also looks weak in System 2's data; that was noticed here and has not been confirmed elsewhere, so it is reported, not applied.

## Correction to the earlier Scanner backtest

`docs/BACKTEST-AND-SIGNAL-POLICY.md` reported about +0.3 to +0.4R per READY trade and up to 69% winners inside the trading windows, from 23 pairs and roughly 100 to 200 trades.

- Re-running that same harness on the current engine gives **+0.07R** after taker fees (184 trades).
- That harness let the engine see the unfinished 4-hour, daily and weekly candle in full, a look-ahead error. With only closed candles it gives **+0.05R**. The effect is real but small. `backtest-tools/collect.mjs` is fixed.
- On those same 23 pairs this replay gives **−0.07R ± 0.07** (212 trades).
- A sample of about 200 trades has an error of roughly ±0.08R. It cannot tell a small gain from a small loss. The earlier headline figures should be treated as superseded by this replay.

## What was changed: flags only, no restrictions

The owner's instruction is no restrictions: flag and briefly explain. Nothing found here blocks, holds or hides a signal.

- **Whale System 2** shows a short flag list on a reading when it applies: low rating (1–2 out of 10), Monday or Tuesday in Melbourne, LONG side. Each flag is one sentence with the figure from the test. The status and size note the engine gave are left as they are.
- **Scanner cards** (Telegram entry calls and the `/analyse` card) carry the same flags, plus whether a major event is present. Which signals the Scanner sends is unchanged.
- **Trading windows** are now the weekday only. The 03:00–10:00 rule is dropped because it was not confirmed. By default the window is a flag ("CAUTION DAY" on Monday and Tuesday); it holds calls only if the owner switches that on.

## Limits

- Only pairs still listed today were replayed; delisted coins are missing.
- The typical coin fell in every half-year, so a broad rising market for alts is not represented.
- Small average results near zero are sensitive to fee and slippage assumptions.
- Tools to reproduce everything: `tools/ws2-calibration/` (`collect_scanner.sh`, `scanner_fit.py`, `scanner_tiers.py`, `scanner_windows.py`, `weekday_check.py`, `explore_mr.py`, `build_comparison.py`).
