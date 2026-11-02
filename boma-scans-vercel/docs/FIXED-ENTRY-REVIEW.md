# Fixed entry and pullback review

14 October 2026, Version 15 Site only.

- Confirmed preferred entry is the fixed structural trigger, not the changing last quote.
- The current chart automatically freezes a fully qualified plan's entry, stop, targets, direction and expiry. It is not replaced automatically after cancellation. The discard button explicitly requests new analysis. Developing, unconfirmed setups remain labelled drafts and can change. Chart locks are in-memory for this chart session; journalled trade targets remain stored as before.
- Stop touches, including a later observed wick in the capture candle, and subsequent closed-candle zone failures cancel locked plans. A recovered quote cannot revive the cancelled plan. Missed data is not proof no stop was touched; inspect the exchange after disconnection.
- Pullbacks require a later closed candle above the rejection candle high for longs, or below its low for shorts. Balanced/Flexible shortcuts cannot bypass this requirement.
- Pullback stops cover the recent 12-candle extreme, zone and wick plus a 0.30 normal-range buffer. Excessively wide structural stops still block entry; there is no automatic widening of an open trade's stop.
- Day and swing defaults are 4h; 2h is selectable. Scans analyze the selected timeframe. The 15-minute automatic refresh frequency is separate from signal candle duration. Smaller frames remain explicitly selectable.
- Expandable entry tutor explains confirmation, limit entries, cancellation, risk sizing, actual-fill recording and trade management. Entry expiry is shown in Melbourne time.

40 regression tests and TypeScript checks pass before publication. Browser and live-exchange verification are unavailable. These rules address identified premature-entry and moving-level mechanisms; no trade-log study or backtest establishes a change in win rate. A structural stop can still be hit. The app does not submit or cancel Bybit orders, and paper trades recorded at the current quote do not establish fills of resting limit orders.
