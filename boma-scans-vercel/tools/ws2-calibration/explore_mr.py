"""Mean-reversion check on the 3-year System 2 replay. Hypotheses fixed before looking; judged on train, val and test separately."""
import json, os, numpy as np
H = 3_600_000
if os.path.exists("X3.npy"):
    X = np.load("X3.npy"); cols = json.load(open("cols.json"))["cols"]
else:
    data, cols = [], None
    for d in ["rows", "rows_1", "rows_2", "rows_3", "rows_4", "rows_5"]:
        for f in sorted(os.listdir(d)):
            if not f.endswith(".json"): continue
            j = json.load(open(os.path.join(d, f)))
            if not j.get("rows"): continue
            cols = cols or j["columns"]; n = 56
            data.append(np.c_[np.array([[np.nan if v is None else v for v in r[:n]] for r in j["rows"]], dtype=np.float64), np.full(len(j["rows"]), hash(f) % 1000003)])
    X = np.vstack(data); del data
    k = X[:, 0] * 1000003 + X[:, -1]; _, first = np.unique(k, return_index=True); X = X[np.sort(first)]; np.save("X3.npy", X)
C = {c: i for i, c in enumerate(cols)}; col = lambda n: X[:, C[n]]; t = col("t"); N = len(X)
q60, q80 = np.quantile(t, 0.6), np.quantile(t, 0.8); SETS = {"train": t <= q60, "val": (t > q60 + 30 * H) & (t <= q80), "test": t > q80 + 30 * H}
COMPS = ["stru", "flow", "htf", "ret", "fun", "btc"]; W = np.array([30, 20, 15, 5, 5, 5])
bull = np.round(np.stack([np.nan_to_num(col(c + "B")) for c in COMPS], 1) @ W); bear = np.round(np.stack([np.nan_to_num(col(c + "S")) for c in COMPS], 1) @ W)
def by_time(r, tt):
    u, i = np.unique(tt, return_inverse=True); cl = np.bincount(i, weights=r) / np.bincount(i); return float(cl.mean()), float(cl.std(ddof=1) / np.sqrt(len(cl)))
def res(mask, sidearr, kind):
    """sidearr: +1 take LONG plan, -1 take SHORT plan."""
    net = np.where(sidearr == 1, col("L" + kind + "_netR"), col("S" + kind + "_netR")); fil = np.where(sidearr == 1, col("L" + kind + "_filled"), col("S" + kind + "_filled"))
    out = []
    for nm, m in SETS.items():
        mm = mask & m & (fil == 1) & ~np.isnan(net)
        if mm.sum() < 50: out.append(f"{nm}: n={int(mm.sum())}"); continue
        a, se = by_time(net[mm], t[mm]); out.append(f"{nm}: {a:+.3f}±{se:.3f} (n={int(mm.sum())}, won {np.mean(net[mm] > 0):.2f})")
    return " | ".join(out)
lead = np.where((bull >= 35) & (bull - bear >= 15), 1, np.where((bear >= 35) & (bear - bull >= 15), -1, 0)); fade = -lead
exhLead = np.where(lead == 1, col("exhL"), col("exhS")); confFade = np.where(fade == 1, col("confL"), col("confS")); gap = np.abs(bull - bear)
locFadeGood = np.where(fade == 1, col("locL"), col("locS"))
tests = {
 "H0 follow the lead (market)": (lead != 0, lead, "M"),
 "H1 fade the lead (market)": (lead != 0, fade, "M"), "H1 fade the lead (pullback)": (lead != 0, fade, "P"),
 "H2 fade when the move is exhausted, exh>=60 (market)": ((lead != 0) & (exhLead >= 60), fade, "M"), "H2 same (pullback)": ((lead != 0) & (exhLead >= 60), fade, "P"),
 "H3 fade exhausted + 15m turn confirmed (market)": ((lead != 0) & (exhLead >= 60) & (confFade == 1), fade, "M"),
 "H4 fade extreme: gap>=40 and exh>=75 (market)": ((lead != 0) & (gap >= 40) & (exhLead >= 75), fade, "M"),
 "H5 fade very exhausted exh>=85 + confirmed (market)": ((lead != 0) & (exhLead >= 85) & (confFade == 1), fade, "M"),
 "H6 follow lead only when NOT stretched: exh<20, confirmed (market)": ((lead != 0) & (exhLead < 20) & (np.where(lead == 1, col("confL"), col("confS")) == 1), lead, "M"),
}
for k, (m, s, kind) in tests.items(): print(k, "\n    ", res(m, s, kind))
# by side for the most promising
for nm, sd in (("LONG fades", 1), ("SHORT fades", -1)):
    print("H3", nm, res((lead != 0) & (exhLead >= 60) & (confFade == 1) & (fade == sd), fade, "M"))
