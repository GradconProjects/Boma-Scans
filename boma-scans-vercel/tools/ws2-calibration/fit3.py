"""Part 3: fit a win-probability model on train, choose the cut on validation, report test once. Market and pullback plans."""
import json, numpy as np
X = np.load("X.npy"); cols = json.load(open("cols.json"))["cols"]; C = {c: i for i, c in enumerate(cols)}; col = lambda n: X[:, C[n]]; t = col("t"); H = 3_600_000; N = len(X)
q60, q80 = np.quantile(t, 0.6), np.quantile(t, 0.8)
SETS = {"train": t <= q60, "val": (t > q60 + 30 * H) & (t <= q80), "test": t > q80 + 30 * H}
COMPS = ["stru", "flow", "htf", "ret", "fun", "btc"]
def side_rows(kind):
    """Stack a LONG row and a SHORT row per sample: features seen from that side, and that side's plan result."""
    out = []
    for s, own, opp, sq in (("L", "B", "S", "sqS"), ("S", "S", "B", "sqL")):
        f = [np.nan_to_num(col(c + own)) for c in COMPS] + [np.nan_to_num(col(c + opp)) for c in COMPS]
        f += [col("entry" + s) / 100, col("exh" + s) / 100, col("conf" + s), (col("loc" + s) == 1) * 1.0, (col("loc" + s) == 2) * 1.0, np.nan_to_num(col(s + kind + "_stopAtr"), nan=2.0) / 3, np.nan_to_num(col(s + kind + "_wR"), nan=2.0) / 4, col(sq) / 100]
        out.append((np.stack(f, 1), col(s + kind + "_netR"), col(s + kind + "_filled"), col(s + kind + "_res"), np.full(N, 1 if s == "L" else -1)))
    F = np.vstack([o[0] for o in out]); netR = np.r_[out[0][1], out[1][1]]; filled = np.r_[out[0][2], out[1][2]]; res = np.r_[out[0][3], out[1][3]]; side = np.r_[out[0][4], out[1][4]]
    return F, netR, filled, res, side, np.r_[t, t]
NAMES = [c + "_own" for c in COMPS] + [c + "_opp" for c in COMPS] + ["entry", "exh", "conf", "extended", "chasing", "stopAtr", "weightedR", "squeezeAgainstOtherSide"]
def logit(Xm, y, l2=5.0, iters=60):
    Xb = np.c_[np.ones(len(Xm)), Xm]; w = np.zeros(Xb.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(Xb @ w))); g = Xb.T @ (p - y) / len(y); g[1:] += l2 * w[1:] / len(y); Hs = (Xb * (p * (1 - p))[:, None]).T @ Xb / len(y); Hs[1:, 1:] += l2 * np.eye(len(w) - 1) / len(y); step = np.linalg.solve(Hs + 1e-9 * np.eye(len(w)), g); w -= step
        if np.abs(step).max() < 1e-7: break
    return w
def by_time(r, tt):
    u, i = np.unique(tt, return_inverse=True); cl = np.bincount(i, weights=r) / np.bincount(i); return float(cl.mean()), float(cl.std(ddof=1) / np.sqrt(len(cl))) if len(cl) > 1 else (float(cl.mean()), None)
def auc(score, y):
    o = np.argsort(score, kind="mergesort"); r = np.empty(len(o)); r[o] = np.arange(1, len(o) + 1); pos = y == 1; return float((r[pos].sum() - pos.sum() * (pos.sum() + 1) / 2) / (pos.sum() * (~pos).sum()))
report = {}
for kind, label in (("M", "market entry"), ("P", "pullback entry")):
    F, netR, filled, res, side, tt = side_rows(kind); ok = (filled == 1) & ~np.isnan(netR)
    S = {k: np.r_[m, m] for k, m in SETS.items()}
    tr = S["train"] & ok; w = logit(F[tr], (netR[tr] > 0).astype(float)); p = 1 / (1 + np.exp(-(np.c_[np.ones(len(F)), F] @ w)))
    rep = {"coefficients": {"intercept": round(float(w[0]), 3), **{n: round(float(c), 3) for n, c in zip(NAMES, w[1:])}}, "auc": {k: round(auc(p[m & ok], (netR[m & ok] > 0).astype(float)), 4) for k, m in S.items()}}
    # deciles of predicted probability (cut points from train), realised result per decile in each set
    cuts = np.quantile(p[tr], np.linspace(0, 1, 11)); cuts[0], cuts[-1] = 0, 1
    dec = {}
    for k, m in S.items():
        rows = []
        for i in range(10):
            mm = m & ok & (p >= cuts[i]) & (p < cuts[i + 1] if i < 9 else p <= 1)
            if mm.sum() < 30: rows.append(None); continue
            mean, se = by_time(netR[mm], tt[mm]); rows.append({"pFrom": round(float(cuts[i]), 3), "n": int(mm.sum()), "predicted": round(float(p[mm].mean()), 3), "won": round(float((netR[mm] > 0).mean()), 3), "avgNetR": round(float(netR[mm].mean()), 3), "byTime": round(mean, 3), "se": round(se, 3) if se else None, "longShare": round(float((side[mm] == 1).mean()), 2)})
        dec[k] = rows
    rep["deciles"] = dec
    # choose the probability cut on validation: best by-time mean net R among cuts keeping at least 1% of samples
    best = None
    for c in np.quantile(p[S["val"] & ok], np.linspace(0.5, 0.99, 50)):
        mm = S["val"] & ok & (p >= c)
        if mm.sum() < 0.01 * (S["val"] & ok).sum(): continue
        mean, se = by_time(netR[mm], tt[mm])
        if best is None or mean > best[1]: best = (float(c), mean, se, int(mm.sum()))
    rep["cutChosenOnValidation"] = {"p": round(best[0], 4), "valByTime": round(best[1], 3), "se": round(best[2], 3), "n": best[3]}
    for k in ("train", "test"):
        mm = S[k] & ok & (p >= best[0]); mean, se = by_time(netR[mm], tt[mm]) if mm.sum() > 30 else (None, None)
        rep[k + "AtCut"] = {"n": int(mm.sum()), "avgNetR": round(float(netR[mm].mean()), 3) if mm.sum() else None, "byTime": round(mean, 3) if mean is not None else None, "se": round(se, 3) if se else None, "won": round(float((netR[mm] > 0).mean()), 3) if mm.sum() else None, "longShare": round(float((side[mm] == 1).mean()), 2) if mm.sum() else None}
        for sd, nm in ((1, "LONG"), (-1, "SHORT")):
            m2 = mm & (side == sd)
            if m2.sum() > 30: a, b = by_time(netR[m2], tt[m2]); rep[k + "AtCut"][nm] = {"n": int(m2.sum()), "byTime": round(a, 3), "se": round(b, 3) if b else None}
    report[label] = rep
    print("\n=====", label); print("AUC", rep["auc"]); print("coef", rep["coefficients"])
    for k in ("train", "val", "test"): print(k, [(d["avgNetR"], d["byTime"], d["won"], d["longShare"]) if d else None for d in dec[k]])
    print("cut", rep["cutChosenOnValidation"], "| train", rep["trainAtCut"], "| TEST", rep["testAtCut"])
json.dump(report, open("report3.json", "w"), indent=1)
