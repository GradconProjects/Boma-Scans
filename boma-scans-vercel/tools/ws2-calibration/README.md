# Whale System 2 calibration tools

Re-run these when the market changes character or after changing the engine.

1. `WS2_ORIGIN=https://<app> WS2_CRON_KEY=<scheduler key> bash collect.sh 180` replays every Bybit crypto pair on the server and saves `rows/<SYMBOL>.json`. About 15 minutes.
2. `python3 -I fit2.py rows` prints the baseline by period and side, reference strategies and each input's predictive power, and saves `X.npy` and `cols.json`.
3. `python3 -I fit3.py` fits the win model on the oldest 60%, picks a cut on the next 20% and reports the final 20%.
4. `python3 -I fit4.py` writes `calibration.json`. Copy it to `app/lib/ws2/calibration-data.json`, bump the version inside it, run the tests and deploy.

Needs Python 3 with numpy. The split is chronological with a 30-hour gap between sets, because outcome windows overlap. Errors are grouped by timestamp, since signals issued at the same time are not independent.
