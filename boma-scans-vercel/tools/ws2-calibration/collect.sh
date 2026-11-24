#!/bin/bash
# Replays Whale System 2 over every Bybit crypto pair through the deployed app and saves one file of rows per pair.
# Usage: WS2_ORIGIN=https://your-app.vercel.app WS2_CRON_KEY=<the scheduler key> bash collect.sh [days]
set -euo pipefail
cd "$(dirname "$0")"; B=${WS2_ORIGIN:?set WS2_ORIGIN}; KEY=${WS2_CRON_KEY:?set WS2_CRON_KEY}; DAYS=${1:-180}; export B KEY DAYS
mkdir -p rows; curl -s "$B/api/ws2/calibrate?key=$KEY&list=1" -o universe.json
python3 -I -c "import json;print('\n'.join(x['symbol'] for x in json.load(open('universe.json'))['universe']))" > symbols.txt
fetch(){ s=$1; [ -s rows/$s.json ] && return; for a in 1 2 3; do code=$(curl -s -m 75 "$B/api/ws2/calibrate?key=$KEY&symbol=$s&days=$DAYS" -o rows/$s.tmp -w "%{http_code}"); if [ "$code" = 200 ]; then mv rows/$s.tmp rows/$s.json; return; fi; sleep 3; done; echo "FAIL $s $code" >> fail.log; rm -f rows/$s.tmp; }
export -f fetch; xargs -P 5 -I{} bash -c 'fetch {}' < symbols.txt
echo "DONE $(ls rows | wc -l) pairs"; cat fail.log 2>/dev/null || true
