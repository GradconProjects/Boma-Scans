# Boma Scans backtest tools

These tools replay the app's own engine (`app/lib/market.ts`) over historical Bybit data. Results and the policy they support are in `docs/BACKTEST-AND-SIGNAL-POLICY.md` inside `Boma-W-Telegram-v2.zip`.

## 1. Download Bybit history (trade archive to 5m candles)

```bash
pip install isal && gcc -O2 -o agg agg.c
echo "SOLUSDT 2026-10-29" | xargs -L 1 ./day.sh   # one "SYMBOL YYYY-MM-DD" per line; run with xargs -P 10 for many
python3 build.py candles.json                    # rolls 5m up to 15m / 1H / 4H / 1D
```

The source is `https://public.bybit.com/trading/<SYMBOL>/`, which has daily trade files from each pair's listing date.

## 2. Replay the engine

```bash
npm i typescript
FRAMES=1H,4H,1D node collect.mjs <unzipped Boma-W-Telegram folder> DAY candles.json out.json STRICT
STYLE=DAY BAR=1H node final.mjs candles.json out.json   # READY signals, after fees, by year and month
```

`sim2.mjs` assumes the following, which you can change at the top of the file:
- A stop and a target touched in the same candle counts as a stop (conservative).
- The app's runner timeout after TP2 applies.
- Maximum hold is 3 days on 1H.
- Maker fees are 0.02%; taker fee plus slippage is 0.075% per side.
