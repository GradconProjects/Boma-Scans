"""Whale System 2 calibration, part 2. Loads replay rows, describes the market regime, evaluates the baseline by side,
checks which inputs carry information, searches thresholds on train, confirms on validation, reports the test set once."""
import json, os, sys, itertools
import numpy as np
rows_dir = sys.argv[1]; H = 3_600_000
COMPS = ["stru", "flow", "htf", "ret", "fun", "btc"]; KEYS = ["structure", "flow", "htf", "retail", "funding", "btc"]
BASE_W = dict(structure=30, flow=20, htf=15, retail=5, funding=5, btc=5)
BASE_T = dict(leadBias=35, leadGap=15, readyBias=45, readyEntry=65, noTradeBelow=30, chasingExhaustion=60, readyMaxExhaustion=50, minReliability=45, readyReliability=60)
data, pairs = [], []
for f in sorted(os.listdir(rows_dir)):
    if not f.endswith(".json"): continue
    d = json.load(open(os.path.join(rows_dir, f)))
    if not d.get("rows"): continue
    cols = d["columns"]; a = np.array([[np.nan if v is None else v for v in r] for r in d["rows"]], dtype=float); data.append(a); pairs += [f[:-5]] * len(a)
X = np.vstack(data); pair = np.array(pairs); C = {c: i for i, c in enumerate(cols)}; col = lambda n: X[:, C[n]]; t = col("t"); N = len(X)
q60, q80 = np.quantile(t, 0.6), np.quantile(t, 0.8)
SETS = {"train": t <= q60, "val": (t > q60 + 30 * H) & (t <= q80), "test": t > q80 + 30 * H}
day = lambda ms: str(np.datetime64(int(ms), "ms"))[:10]
out = {"samples": int(N), "pairs": len(set(pairs)), "from": day(t.min()), "to": day(t.max()), "split": {k: {"n": int(v.sum()), "from": day(t[v].min()), "to": day(t[v].max())} for k, v in SETS.items()}}
cB = np.stack([np.nan_to_num(col(c + "B")) for c in COMPS], 1); cS = np.stack([np.nan_to_num(col(c + "S")) for c in COMPS], 1)
f4, f24 = col("fwd4"), col("fwd24")
# market regime: median coin move per timestamp
ut, inv = np.unique(t, return_inverse=True); med24 = np.array([np.nanmedian(f24[inv == i]) for i in range(len(ut))]); mkt = med24[inv]
out["regime"] = {k: {"medianCoin24hMovePct": round(float(np.nanmean(med24[np.isin(ut, t[m])])), 3), "shareOfTimesMarketRose": round(float(np.nanmean(med24[np.isin(ut, t[m])] > 0)), 3)} for k, m in SETS.items()}

def decide(w, T):
    wv = np.array([w[k] for k in KEYS]); bull, bear = np.round(cB @ wv), np.round(cS @ wv)
    side = np.where((bull >= T["leadBias"]) & (bull - bear >= T["leadGap"]), 1, np.where((bear >= T["leadBias"]) & (bear - bull >= T["leadGap"]), -1, 0)); L = side == 1
    b = np.where(L, bull, bear); q = np.where(L, col("entryL"), col("entryS")); conf = np.where(L, col("confL"), col("confS")); loc = np.where(L, col("locL"), col("locS")); exh = np.where(L, col("exhL"), col("exhS")); rel = col("rel")
    st = np.full(N, "WATCHING", dtype=object); st[(side == 0) & (bull < T["noTradeBelow"]) & (bear < T["noTradeBelow"])] = "NO TRADE"
    lead = side != 0; chasing = lead & ((exh >= T["chasingExhaustion"]) | (loc == 2))
    ready = lead & ~chasing & (q >= T["readyEntry"]) & (conf == 1) & (exh < T["readyMaxExhaustion"]) & (rel >= T["readyReliability"]) & (b >= T["readyBias"])
    pull = lead & ~chasing & ~ready & (loc == 1); rest = lead & ~chasing & ~ready & ~pull
    st[chasing] = "CHASING RISK"; st[ready] = "ENTRY READY"; st[pull] = "AWAITING PULLBACK"; st[rest & (b >= T["readyBias"])] = "AWAITING CONFIRMATION"; st[rest & (b < T["readyBias"])] = "SETUP FORMING"; st[rel < T["minReliability"]] = "DATA UNAVAILABLE"
    return side, st, b, q
def plan(side, kind):
    g = lambda s: np.where(side == 1, col("L" + kind + "_" + s), col("S" + kind + "_" + s)); return g("filled"), g("res"), g("netR")
def stats(mask, side, kind):
    filled, res, netR = plan(side, kind); m = mask & (side != 0) & ~np.isnan(res) & (res != 9); f = m & (filled == 1) & ~np.isnan(netR); n, nf = int(m.sum()), int(f.sum())
    if nf < 5: return {"signals": n, "filled": nf}
    r = netR[f]; tp = (res[f] >= 3) & (res[f] <= 7); st = res[f] == 2
    # standard error clustered by timestamp (signals at the same time are not independent)
    tt = t[f]; u, i2 = np.unique(tt, return_inverse=True); cl = np.bincount(i2, weights=r) / np.bincount(i2); se = float(cl.std(ddof=1) / np.sqrt(len(cl))) if len(cl) > 1 else None
    return {"signals": n, "filled": nf, "fillRate": round(nf / n, 3), "tp1First": round(float(tp.mean()), 3), "stoppedFirst": round(float(st.mean()), 3), "avgNetR": round(float(r.mean()), 3), "avgNetR_byTime": round(float(cl.mean()), 3), "se_byTime": round(se, 3) if se else None, "winShare": round(float((r > 0).mean()), 3), "profitFactor": round(float(r[r > 0].sum() / max(1e-9, -r[r < 0].sum())), 2), "netRPerSignal": round(float(r.sum() / n), 3)}
def table(w, T, sets=SETS):
    side, st, b, q = decide(w, T); res = {}
    for name, m in sets.items():
        o = {}
        for label, sm in [("both", side != 0), ("LONG", side == 1), ("SHORT", side == -1)]:
            o["ENTRY READY market · " + label] = stats(m & sm & (st == "ENTRY READY"), side, "M")
        for s in ["AWAITING CONFIRMATION", "SETUP FORMING", "AWAITING PULLBACK", "CHASING RISK"]:
            o[s + " pullback · both"] = stats(m & (st == s), side, "P")
        o["share"] = {s: round(float((st[m] == s).mean()), 3) for s in sorted(set(st))}
        res[name] = o
    return res
out["baseline"] = table(BASE_W, BASE_T)
ones = np.ones(N)
out["references"] = {name: {"always LONG market": stats(m, ones, "M"), "always SHORT market": stats(m, -ones, "M"), "always LONG pullback": stats(m, ones, "P"), "always SHORT pullback": stats(m, -ones, "P")} for name, m in SETS.items()}

# ── information content of each input: rank correlation with the side's market-plan result, by period, both raw and market-neutral
def auc(score, y):
    ok = ~np.isnan(score) & ~np.isnan(y); score, y = score[ok], y[ok]
    if y.sum() == 0 or (1 - y).sum() == 0: return None
    o = np.argsort(score, kind="mergesort"); r = np.empty(len(o)); r[o] = np.arange(1, len(o) + 1); pos = y == 1
    return round(float((r[pos].sum() - pos.sum() * (pos.sum() + 1) / 2) / (pos.sum() * (~pos).sum())), 4)
D = cB - cS
info = {}
for i, k in enumerate(KEYS):
    info[k] = {name: {"dir4h": auc(D[m, i], (f4[m] > 0).astype(float)), "dir24h": auc(D[m, i], (f24[m] > 0).astype(float)), "vsMarket24h": auc(D[m, i], ((f24 - mkt)[m] > 0).astype(float))} for name, m in SETS.items()}
bw = np.array([BASE_W[k] for k in KEYS]); info["baseline bias (bull − bear)"] = {name: {"dir4h": auc((D @ bw)[m], (f4[m] > 0).astype(float)), "dir24h": auc((D @ bw)[m], (f24[m] > 0).astype(float)), "vsMarket24h": auc((D @ bw)[m], ((f24 - mkt)[m] > 0).astype(float))} for name, m in SETS.items()}
out["information"] = info
# entry-quality inputs against the trade result for the side traded (stack long and short rows)
def stacked(m):
    return dict(entry=np.r_[col("entryL")[m], col("entryS")[m]], exh=np.r_[col("exhL")[m], col("exhS")[m]], conf=np.r_[col("confL")[m], col("confS")[m]], loc=np.r_[col("locL")[m], col("locS")[m]], bias=np.r_[(cB @ bw)[m], (cS @ bw)[m]], gap=np.r_[(D @ bw)[m], -(D @ bw)[m]], win=np.r_[(col("LM_netR")[m] > 0).astype(float), (col("SM_netR")[m] > 0).astype(float)], netR=np.r_[col("LM_netR")[m], col("SM_netR")[m]], side=np.r_[np.ones(m.sum()), -np.ones(m.sum())])
out["entryInputs_aucVsWin"] = {name: {k: auc(s[k], s["win"]) for k in ["entry", "exh", "conf", "bias", "gap"]} for name, m in SETS.items() for s in [stacked(m)]}
json.dump(out, open("report2.json", "w"), indent=1); np.save("X.npy", X); json.dump({"cols": cols}, open("cols.json", "w"))
p = lambda o: json.dumps(o, indent=None)
print(p({k: out[k] for k in ["samples", "pairs", "from", "to", "split", "regime"]}))
for name in SETS: print("\n==", name); [print("  ", k, p(v)) for k, v in out["baseline"][name].items()]; [print("  REF", k, p(v)) for k, v in out["references"][name].items()]
print("\nINFO"); [print("  ", k, p(v)) for k, v in info.items()]
print("ENTRY", p(out["entryInputs_aucVsWin"]))
