#!/bin/bash
cd "$(dirname "$0")"
B=${WS2_ORIGIN:?set WS2_ORIGIN}; KEY=${WS2_CRON_KEY:?set WS2_CRON_KEY}; NOW0=$(cat now0.txt); export B KEY NOW0
fetch(){ k=$1; s=$2; d=sc_$k; [ -s $d/$s.json ] && return; END=$((NOW0 - k*180*86400000)); for a in 1 2 3; do code=$(curl -s -m 85 "$B/api/ws2/calibrate?key=$KEY&symbol=$s&days=185&step=1&system=scanner&end=$END" -o $d/$s.tmp -w "%{http_code}"); if [ "$code" = 200 ]; then mv $d/$s.tmp $d/$s.json; return; fi; sleep 4; done; echo "FAIL $k $s $code" >> fail_sc.log; rm -f $d/$s.tmp; }
export -f fetch
for k in 0 1 2 3 4 5; do mkdir -p sc_$k; cat symbols.txt | xargs -P 8 -I{} bash -c "fetch $k {}"; echo "chunk $k done: $(ls sc_$k | wc -l)"; done
echo ALLDONE; cat fail_sc.log 2>/dev/null | head -20
