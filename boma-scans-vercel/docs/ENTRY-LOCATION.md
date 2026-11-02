# Boma Scans 1.6 — entry location and retest repair

This update addresses identifiable execution weaknesses. It has not been backtested for profitability on the user's trades. No entry rule eliminates stop losses, and scores are not win probabilities.

## What changed

- Removed the unconditional planned-trigger pass for non-scalp continuation/breakout trades. No-chase now runs before either timing route can pass, including Balanced/Flexible and the close-target alternative.
- Zones come from closed-candle structure: CHoCH/broken swing retest, pullback, order block, FVG, or EMA21. A quote update cannot drag the zone to the pumped/dumped market price. Recent break levels survive into the later retest.
- A sharp directional candle or three-candle impulse requires a subsequent retest. Its own candle cannot count as that later retest. Confirmation requires a directional rejection close beyond the trigger; an unfinished candle cannot confirm.
- Entry has an explicit permitted range. Buying higher or shorting lower is blocked; losing the reclaim level is also blocked. Two-candle expiry is checked by recommendations and again on the trade-confirmation click.
- Stops stay outside the whole selected zone and observed retest wick with a normal-range buffer. Removed the previous 2.2 ATR inward cap. If the required stop is too wide, reject that entry rather than clipping the stop. Risk sizing reduces quantity for wider stops, subject to the existing account and portfolio limits.
- Ready plans use the executable side of the quote when evaluating price and targets. Conditional plans use the trigger as a planning reference, rather than reporting an unfilled zone midpoint as an executed price.
- The scanner fetches a fresh per-pair quote after loading candles. A quote captured at universe discovery is no longer stamped as fresh after a long scan. Live quote updates cannot alter a candle whose time bucket has ended.
- The manager no longer proposes automatic breakeven at +0.75R or a TP1 touch. A tighter stop requires a recorded partial, later confirmed protective structure, a valid analysis window and room from current price. Suggestions never loosen the recorded stop; no existing trade stop is automatically changed. Partial-exit text uses the position's frozen weights.

## Simple workflow

1. Open a pair's live chart. **WAIT RETEST** means do not enter at the current price; watch the numeric retest zone.
2. Wait for the displayed execution candle to close beyond the numeric trigger. The card explains whether confirmation has completed.
3. Only when the card says **READY**, check the permitted range and follow the displayed BUY LIMIT / SELL LIMIT instruction. Skip a missed price; cancel an unfilled order if the zone fails, the stop is touched, or the confirmation expires.
4. Use the displayed stop and five target quantities. Position size follows the stop distance. A larger stop is not permission to increase account risk.

The same instructions appear beside the chart, in expanded market rows, signal cards, Telegram-style copies and the trade manager. Charts show the retest band and MAX BUY / MIN SELL line. Notifications remain dated snapshots, not current entry authorizations.

## Policy limits

`app/lib/entry-execution.ts` is the common location policy. Its reference range is the lesser of ATR and the median true range from the 21 candles preceding the latest three candles, floored at 0.01% of price. This reduces inflation of the chase allowance by the impulse being screened.

| Check | Current policy |
| --- | --- |
| Sharp candle | Range >= 1.8 reference ranges and directional body >= 0.8 |
| Three-bar impulse | Directional move >= 2.4 ranges, with all three bodies directional |
| EMA21 extension | Maximum 1.8 reference ranges |
| Entry chase allowance | Lesser of 0.35 reference ranges and 0.25 of structural stop risk |
| Trigger | 0.04 reference ranges beyond the retest band |
| Confirmation | Later zone touch and directional close beyond trigger, >=60% directional range finish; candle range <1.8 reference ranges |
| Stop | Outside full zone / recent retest wick, 0.20 range buffer, at least 0.65 range from trigger |
| Stop width | Reject when trigger-to-stop distance exceeds 3 reference ranges |
| Confirmation life | Two execution candles after the confirmation candle closes |
| Profit protection | Realized TP1, later confirmed structure that protects entry, >=0.6 ATR room from quote; tightening only |

These are transparent engineering limits, not statistically optimized trading parameters. Existing TA, liquidity, participation, target, BTC, sizing, exchange and portfolio gates still apply. Closer targets never bypass location or move a structural stop inward.

## Verification and limits

Regression scenarios cover long and short mirrored retests, pump/dump rejection in all three modes, a valid post-pump retest, unconfirmed candles, pre-entry stop sweeps, failed reclaims, expiry, zone stability under quote updates, full-engine preferred/immediate rejection, and oversized structural stops. Manager tests cover premature breakeven, frozen partial weights, stale advice and never loosening stops. Existing target, risk, notification and sound tests remain included. Synthetic scenarios verify behavior, not win rate or realized profitability.

Bybit identifies a closed WebSocket candle with `confirm=true`; unfinished candles update until closure ([Bybit kline documentation](https://bybit-exchange.github.io/docs/v5/websocket/public/kline)). The engine excludes the forming candle. Brief final-candle delivery delays can postpone confirmation; there is no zero-latency guarantee.

The app remains advisory/paper tracking. It does not submit limit orders or amend live Bybit stops. Market quotes and limit prices can change before a manual order fills. Match the exchange's stop trigger basis to your intended risk; the manager's tracked valuation uses mark price, while chart entries use traded/executable quotes. Funding and actual fills still affect realized returns. A user trade export would be needed to investigate specific losses and validate these policies against outcomes.
