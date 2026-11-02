#!/bin/bash
# $1=SYMBOL $2=YYYY-MM-DD  -> out/SYMBOL/DATE.csv of 5m bars: start_ms,open,high,low,close,volume
s=$1; d=$2; o=out/$s/$d.csv
[ -s "$o" ] && exit 0
mkdir -p out/$s
for try in 1 2 3 4; do
  curl -sf -m 300 "https://public.bybit.com/trading/$s/$s$d.csv.gz" | python3 -m isal.igzip -dc 2>/dev/null | ./agg > $o.tmp
  if [ -s $o.tmp ]; then mv $o.tmp $o; exit 0; fi
  sleep $((try*3))
done
echo "FAILED $s $d" >&2; rm -f $o.tmp
