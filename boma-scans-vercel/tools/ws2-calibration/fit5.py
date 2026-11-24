"""Whale System 2 calibration over several replay chunks (long history).
Usage: python3 -I fit5.py <out.json> <rows_dir> [<rows_dir> ...]
Chronological 60 / 20 / 20 split with a 30 h gap; the shipped model is fitted on the oldest 60% and checked on the newest 40%.
Also reports every half-year block separately (regime, references, rule, ratings) so rising and falling markets can be compared."""
import json, os, sys, numpy as np
out_path, dirs = sys.argv[1], sys.argv[2:]; H = 3_600_000
data, pairs, cols = [], [], None
for d in dirs:
    for f in sorted(os.listdir(d)):
        if not f.endswith(".json"): continue
        try: j = json.load(open(os.path.join(d, f)))
        except Exception: continue
        if not j.get("rows"): continue
        cols = cols or j["columns"]; n = len(cols)
        a = np.array([[np.nan if v is None else v for v in r[:n]] for r in j["rows"]], dtype=np.float64); data.append(a); pairs += [f[:-5]] * len(a)
X = np.vstack(data); pair = np.array(pairs); del data
# drop duplicate readings from overlapping chunks
key = np.char.add(pair, np.char.add("|", X[:, 0].astype(np.int64).astype(str))); _, first = np.unique(key, return_index=True); first.sort(); X, pair = X[first], pair[first]
C = {c: i for i, c in enumerate(cols)}; col = lambda n: X[:, C[n]]; t = col("t"); N = len(X)
day = lambda ms: str(np.datetime64(int(ms), "ms"))[:10]
q60, q80 = np.quantile(t, 0.6), np.quantile(t, 0.8)
SETS = {"train": t <= q60, "val": (t > q60 + 30 * H) & (t <= q80), "test": t > q80 + 30 * H}
COMPS = ["stru", "flow", "htf", "ret", "fun", "btc"]; KEYS = ["structure", "flow", "htf", "retail", "funding", "btc"]
BASE_W = np.array([30, 20, 15, 5, 5, 5]); T = dict(leadBias=35, leadGap=15, readyBias=45, readyEntry=65, chasingExhaustion=60, readyMaxExhaustion=50, readyReliability=60)
cB = np.stack([np.nan_to_num(col(c + "B")) for c in COMPS], 1); cS = np.stack([np.nan_to_num(col(c + "S")) for c in COMPS], 1)
def feats(s, kind):
    own, opp, sq = (cB, cS, col("sqS")) if s == "L" else (cS, cB, col("sqL"))
    return np.c_[own, opp, col("entry" + s) / 100, col("exh" + s) / 100, col("conf" + s), (col("loc" + s) == 1) * 1.0, (col("loc" + s) == 2) * 1.0, np.nan_to_num(col(s + kind + "_stopAtr"), nan=2.0) / 3, np.nan_to_num(col(s + kind + "_wR"), nan=2.0) / 4, sq / 100]
NAMES = [k + "Own" for k in KEYS] + [k + "Opp" for k in KEYS] + ["entry", "exhaustion", "confirmed", "extended", "chasing", "stopAtr", "weightedR", "squeezeOther"]
def logit(Xm, y, l2=5.0):
    Xb = np.c_[np.ones(len(Xm)), Xm]; w = np.zeros(Xb.shape[1])
    for _ in range(60):
        p = 1 / (1 + np.exp(-(Xb @ w))); g = Xb.T @ (p - y) / len(y); g[1:] += l2 * w[1:] / len(y); Hs = (Xb * (p * (1 - p))[:, None]).T @ Xb / len(y); Hs[1:, 1:] += l2 * np.eye(len(w) - 1) / len(y); st = np.linalg.solve(Hs + 1e-9 * np.eye(len(w)), g); w -= st
        if np.abs(st).max() < 1e-8: break
    return w
def by_time(r, tt):
    u, i = np.unique(tt, return_inverse=True); cl = np.bincount(i, weights=r) / np.bincount(i); return float(cl.mean()), (float(cl.std(ddof=1) / np.sqrt(len(cl))) if len(cl) > 1 else 0.0)
def auc(score, y):
    if y.sum() == 0 or (1 - y).sum() == 0: return float("nan")
    o = np.argsort(score, kind="mergesort"); r = np.empty(len(o)); r[o] = np.arange(1, len(o) + 1); pos = y == 1; return float((r[pos].sum() - pos.sum() * (pos.sum() + 1) / 2) / (pos.sum() * (~pos).sum()))
cal = {"version": "WS2-0.3", "samples": int(N), "pairs": int(len(set(pair))), "from": day(t.min()), "to": day(t.max()), "stepHours": 4, "features": NAMES, "models": {}}
P = {}
for kind, label in (("M", "market"), ("P", "pullback")):
    F = np.vstack([feats("L", kind), feats("S", kind)]); netR = np.r_[col("L" + kind + "_netR"), col("S" + kind + "_netR")]; filled = np.r_[col("L" + kind + "_filled"), col("S" + kind + "_filled")]; tt = np.r_[t, t]
    ok = (filled == 1) & ~np.isnan(netR); S2 = {k: np.r_[m, m] for k, m in SETS.items()}; tr = S2["train"] & ok
    w = logit(F[tr], (netR[tr] > 0).astype(float)); p = 1 / (1 + np.exp(-(np.c_[np.ones(len(F)), F] @ w))); P[kind] = (p[:N], p[N:])
    cuts = np.quantile(p[tr], np.linspace(0.1, 0.9, 9)); dec = np.searchsorted(cuts, p, side="right") + 1
    table = []
    for dnum in range(1, 11):
        row = {"decile": dnum}
        for nm, m in (("train", S2["train"]), ("check", S2["val"] | S2["test"]), ("val", S2["val"]), ("test", S2["test"])):
            mm = m & ok & (dec == dnum); mean, se = by_time(netR[mm], tt[mm]) if mm.sum() else (0.0, 0.0); row[nm] = {"n": int(mm.sum()), "won": round(float((netR[mm] > 0).mean()), 3) if mm.sum() else 0, "avgNetR": round(mean, 3), "se": round(se, 3)}
        table.append(row)
    cal["models"][label] = {"intercept": round(float(w[0]), 4), "coef": [round(float(c), 4) for c in w[1:]], "decileCuts": [round(float(c), 4) for c in cuts], "auc": {k: round(auc(p[m & ok], (netR[m & ok] > 0).astype(float)), 3) for k, m in S2.items()}, "deciles": table}
    del F
bull, bear = np.round(cB @ BASE_W), np.round(cS @ BASE_W)
side = np.where((bull >= T["leadBias"]) & (bull - bear >= T["leadGap"]), 1, np.where((bear >= T["leadBias"]) & (bear - bull >= T["leadGap"]), -1, 0)); L = side == 1; pick = lambda a, b: np.where(L, a, b)
b = pick(bull, bear); q = pick(col("entryL"), col("entryS")); conf = pick(col("confL"), col("confS")); loc = pick(col("locL"), col("locS")); exh = pick(col("exhL"), col("exhS")); rel = col("rel"); lead = side != 0
chasing = lead & ((exh >= T["chasingExhaustion"]) | (loc == 2)); ready01 = lead & ~chasing & (q >= T["readyEntry"]) & (conf == 1) & (exh < T["readyMaxExhaustion"]) & (rel >= T["readyReliability"]) & (b >= T["readyBias"])
def decile(kind): return np.searchsorted(np.array(cal["models"]["market" if kind == "M" else "pullback"]["decileCuts"]), pick(*P[kind]), side="right") + 1
dM, dP = decile("M"), decile("P")
mNet = pick(col("LM_netR"), col("SM_netR")); pNet = pick(col("LP_netR"), col("SP_netR")); pFill = pick(col("LP_filled"), col("SP_filled"))
def st(mask, net, fill=None):
    m = mask & ~np.isnan(net) & ((fill == 1) if fill is not None else True)
    if m.sum() < 20: return {"n": int(m.sum())}
    mean, se = by_time(net[m], t[m]); return {"n": int(m.sum()), "won": round(float((net[m] > 0).mean()), 3), "avgNetR": round(mean, 3), "se": round(se, 3), "longShare": round(float((side[m] == 1).mean()), 2)}
RULES = lambda m: {
    "0.1 ENTRY READY (market)": st(m & ready01, mNet),
    "ENTRY READY, LONG only": st(m & ready01 & (side == 1), mNet), "ENTRY READY, SHORT only": st(m & ready01 & (side == -1), mNet),
    "0.2 blocked: lead side but rating 1-2 (pullback, what was avoided)": st(m & lead & (dP <= 2), pNet, pFill),
    "0.2 kept waiting setups: lead side, rating 3-10 (pullback)": st(m & lead & ~ready01 & (dP >= 3), pNet, pFill),
    "any lead side, rating 9-10 (market)": st(m & lead & (dM >= 9), mNet), "any lead side, rating 1-2 (market)": st(m & lead & (dM <= 2), mNet),
    "reference: always LONG (market)": st(m, col("LM_netR")), "reference: always SHORT (market)": st(m, col("SM_netR"))}
cal["rules"] = {nm: RULES(m) for nm, m in SETS.items()}
f24, f4 = col("fwd24"), col("fwd4"); D = (cB - cS) @ BASE_W
A = lambda sc, y, m: round(auc(sc[m & ~np.isnan(y)], (y[m & ~np.isnan(y)] > 0).astype(float)), 3)
cal["directionAuc"] = {nm: {"bias vs 4h direction": A(D, f4, m), "bias vs 24h direction": A(D, f24, m)} for nm, m in SETS.items()}
cal["componentAuc24h"] = {k: {nm: A((cB - cS)[:, i], f24, m) for nm, m in SETS.items()} for i, k in enumerate(KEYS)}
ut, inv = np.unique(t, return_inverse=True); cnt = np.bincount(inv); order = np.argsort(inv, kind="mergesort"); sp = np.split(f24[order], np.cumsum(cnt)[:-1]); med = np.array([np.nanmedian(x) if np.isfinite(x).any() else np.nan for x in sp])
REG = lambda m: {"from": day(t[m].min()), "to": day(t[m].max()), "n": int(m.sum()), "pairs": int(len(set(pair[m]))), "typicalCoin24hPct": round(float(np.nanmean(med[np.isin(ut, t[m])])), 2), "timesMarketRose": round(float(np.nanmean(med[np.isin(ut, t[m])] > 0)), 2)}
cal["regime"] = {nm: REG(m) for nm, m in SETS.items()}
# half-year blocks, oldest first: how each rule did in each market
blocks = []; step = 182 * 24 * H; edges = np.arange(t.max() + 1, t.min() - step, -step)[::-1]
for lo, hi in zip(edges[:-1], edges[1:]):
    m = (t >= lo) & (t < hi)
    if m.sum() < 2000: continue
    r = RULES(m); blocks.append({**REG(m), "unseen": bool(lo > q60 + 30 * H), "biasVs24h": A(D, f24, m), "ratingRank": round(auc(pick(*P["M"])[m & lead & ~np.isnan(mNet)], (mNet[m & lead & ~np.isnan(mNet)] > 0).astype(float)), 3), "rules": {k: r[k] for k in ["0.1 ENTRY READY (market)", "any lead side, rating 9-10 (market)", "any lead side, rating 1-2 (market)", "reference: always LONG (market)", "reference: always SHORT (market)"]}})
cal["blocks"] = blocks
ps = {}
for sym in sorted(set(pair)):
    am = pair == sym; m = am & lead & (dM >= 8) & ~np.isnan(mNet); ps[sym] = [int(am.sum()), int(m.sum()), round(float((mNet[m] > 0).mean()), 2) if m.sum() else None, round(float(mNet[m].mean()), 2) if m.sum() else None]
cal["pairStats"] = ps
json.dump(cal, open(out_path, "w"), separators=(",", ":"))
print(N, "readings", cal["pairs"], "pairs", cal["from"], "to", cal["to"]); print({k: (v["from"], v["to"], v["n"], v["typicalCoin24hPct"]) for k, v in cal["regime"].items()})
for k in ("market", "pullback"):
    print(k, cal["models"][k]["auc"]); [print("  d%d" % r["decile"], "train", r["train"]["avgNetR"], "| check n", r["check"]["n"], "won", r["check"]["won"], "avg", r["check"]["avgNetR"], "±", r["check"]["se"], "| val", r["val"]["avgNetR"], "test", r["test"]["avgNetR"]) for r in cal["models"][k]["deciles"]]
for nm in SETS: print("\n", nm); [print("   ", k, v) for k, v in cal["rules"][nm].items()]
print("\nBLOCKS"); [print(" ", bk["from"], bk["to"], "pairs", bk["pairs"], "n", bk["n"], "coin/day", bk["typicalCoin24hPct"], "unseen", bk["unseen"], "bias24h", bk["biasVs24h"], "rank", bk["ratingRank"], {k.split(" (")[0][:22]: (v.get("avgNetR"), v["n"]) for k, v in bk["rules"].items()}) for bk in blocks]
print(cal["directionAuc"]); print(cal["componentAuc24h"]); print(os.path.getsize(out_path), "bytes")
