# Merge daily 5m files -> per-symbol JSON with 5m,15m,1H,4H,1D (Bybit-style UTC buckets)
import os, json, sys
out = {}
for s in sorted(os.listdir("out")):
    rows = {}
    for f in sorted(os.listdir(f"out/{s}")):
        if not f.endswith(".csv"): continue
        for line in open(f"out/{s}/{f}"):
            t,o,h,l,c,v = line.split(","); rows[int(t)] = [int(t),float(o),float(h),float(l),float(c),float(v)]
    five = [rows[k] for k in sorted(rows)]
    res = {"5m": five}
    for name, ms in (("15m",9e5),("1H",36e5),("4H",144e5),("1D",864e5)):
        agg = {}
        for r in five:
            b = int(r[0]//ms*ms)
            a = agg.get(b)
            if a is None: agg[b] = [b, r[1], r[2], r[3], r[4], r[5]]
            else: a[2]=max(a[2],r[2]); a[3]=min(a[3],r[3]); a[4]=r[4]; a[5]+=r[5]
        res[name] = [agg[k] for k in sorted(agg)]
    out[s.replace("USDT","")] = res
    print(s, {k: len(v) for k, v in res.items()}, file=sys.stderr)
json.dump(out, open(sys.argv[1], "w"))
