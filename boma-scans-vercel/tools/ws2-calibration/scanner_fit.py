"""Scanner vs Whale System 2 on the same footing. Usage: python3 -I scanner_fit.py <ws2 calibration.json> <out.json> <sc_dir> [...]"""
import json, os, sys, numpy as np
calp, outp, dirs = sys.argv[1], sys.argv[2], sys.argv[3:]; H = 3_600_000
cal = json.load(open(calp)); data, pairs, cols = [], [], None; evaluated = 0; files = 0
for d in dirs:
    for f in sorted(os.listdir(d)):
        if not f.endswith(".json"): continue
        try: j = json.load(open(os.path.join(d, f)))
        except Exception: continue
        files += 1; evaluated += j.get("meta", {}).get("evaluated", 0); cols = cols or j.get("columns")
        if j.get("rows"): data.append(np.array([[np.nan if v is None else v for v in r] for r in j["rows"]], float)); pairs += [f[:-5]] * len(j["rows"])
X = np.vstack(data); pair = np.array(pairs)
key = np.char.add(pair, np.char.add("|", X[:, 0].astype(np.int64).astype(str))); _, first = np.unique(key, return_index=True); first.sort(); X, pair = X[first], pair[first]
C = {c: i for i, c in enumerate(cols)}; col = lambda n: X[:, C[n]]; t = col("t"); side = col("side"); N = len(X)
day = lambda ms: str(np.datetime64(int(ms), "ms"))[:10]; ms = lambda s: np.datetime64(s).astype("datetime64[ms]").astype(np.int64)
# a signal that stays valid for several hours is one opportunity: keep the first hour of each run (same pair and side, consecutive hours)
order = np.lexsort((t, pair)); new = np.ones(N, bool); o = order
same = (pair[o][1:] == pair[o][:-1]) & (side[o][1:] == side[o][:-1]) & (t[o][1:] - t[o][:-1] <= 2 * H); new[o[1:]] = ~same
def first_of(mask):
    """First hour of each run within a subset (e.g. the first hour a setup became READY)."""
    idx = o[mask[o]]; keep = np.zeros(N, bool)
    if len(idx) == 0: return keep
    s2 = (pair[idx][1:] == pair[idx][:-1]) & (side[idx][1:] == side[idx][:-1]) & (t[idx][1:] - t[idx][:-1] <= 2 * H); keep[idx[0]] = True; keep[idx[1:]] = ~s2; return keep
R = cal["regime"]; SETS = {"train": t <= ms(R["train"]["to"]) + 24 * H, "val": (t >= ms(R["val"]["from"])) & (t <= ms(R["val"]["to"]) + 24 * H), "test": t >= ms(R["test"]["from"])}
def by_time(r, tt):
    u, i = np.unique(tt, return_inverse=True); cl = np.bincount(i, weights=r) / np.bincount(i); return float(cl.mean()), (float(cl.std(ddof=1) / np.sqrt(len(cl))) if len(cl) > 1 else 0.0)
def st(mask, k):
    filled, res, net = col(k + "_filled"), col(k + "_res"), col(k + "_netR"); m = mask & (res != 9) & ~np.isnan(res); f = m & (filled == 1) & ~np.isnan(net)
    if f.sum() < 15: return {"signals": int(m.sum()), "filled": int(f.sum())}
    mean, se = by_time(net[f], t[f]); r = net[f]
    return {"signals": int(m.sum()), "filled": int(f.sum()), "fillRate": round(float(f.sum() / m.sum()), 2), "won": round(float((r > 0).mean()), 3), "stoppedFirst": round(float((res[f] == 2).mean()), 3), "avgNetR": round(mean, 3), "se": round(se, 3), "plain": round(float(r.mean()), 3), "profitFactor": round(float(r[r > 0].sum() / max(1e-9, -r[r < 0].sum())), 2), "longShare": round(float((side[f] == 1).mean()), 2)}
pick, gate = col("pick") == 1, col("gate") == 1
LEVELS = {"all setups (engine calls a setup)": first_of(np.ones(N, bool)), "setups with a major event (CHoCH, break, sweep; stop 2+ ATR)": first_of(gate), "READY (every check passed)": first_of(pick), "READY + major event (what Telegram sends)": first_of(pick & gate)}
out = {"files": files, "pairs": int(len(set(pair))), "hourlyEvaluations": int(evaluated), "setupReadings": int(N), "from": day(t.min()), "to": day(t.max()), "levels": {}}
for name, lm in LEVELS.items():
    out["levels"][name] = {"count": int(lm.sum()), "ownHorizon": {**{k: st(lm & m, "A") for k, m in SETS.items()}, "all": st(lm, "A"), "LONG": st(lm & (side == 1), "A"), "SHORT": st(lm & (side == -1), "A")}, "ws2Horizon": {**{k: st(lm & m, "B") for k, m in SETS.items()}, "all": st(lm, "B"), "LONG": st(lm & (side == 1), "B"), "SHORT": st(lm & (side == -1), "B")}}
# does the Scanner's score rank its setups?
fs = LEVELS["all setups (engine calls a setup)"]; sc = col("score"); qs = np.nanquantile(sc[fs], [0.2, 0.4, 0.6, 0.8]); band = np.searchsorted(qs, sc, side="right")
out["scoreBands"] = [{"band": int(b) + 1, "scoreFrom": round(float(sc[fs & (band == b)].min()), 0), **st(fs & (band == b), "A")} for b in range(5)]
out["byFrames"] = {str(int(k)): st(fs & (col("frames") == k), "A") for k in sorted(set(col("frames")[~np.isnan(col("frames"))]))}
out["byRegime"] = {"TRENDING": st(fs & (col("regimeTrending") == 1), "A"), "not trending": st(fs & (col("regimeTrending") == 0), "A")}
# half-year blocks
blocks = []; step = 182 * 24 * H; edges = np.arange(t.max() + 1, t.min() - step, -step)[::-1]
for lo, hi in zip(edges[:-1], edges[1:]):
    m = (t >= lo) & (t < hi)
    if m.sum() < 500: continue
    blocks.append({"from": day(lo), "to": day(hi - 1), **{name: st(lm & m, "A") for name, lm in LEVELS.items()}})
out["blocks"] = blocks
json.dump(out, open(outp, "w"), indent=1)
P = lambda o: json.dumps(o)
print(out["files"], "files", out["pairs"], "pairs", out["hourlyEvaluations"], "hourly evaluations", N, "setup readings", out["from"], out["to"])
for name, v in out["levels"].items():
    print("\n##", name, "| distinct signals:", v["count"])
    for hz in ("ownHorizon", "ws2Horizon"): print("  ", hz); [print("     ", k, P(x)) for k, x in v[hz].items()]
print("\nscore bands", *[P(b) for b in out["scoreBands"]], sep="\n  "); print("frames", P(out["byFrames"])); print("regime", P(out["byRegime"]))
print("\nBLOCKS"); [print("  ", b["from"], b["to"], {k[:28]: (v.get("avgNetR"), v.get("filled")) for k, v in b.items() if isinstance(v, dict)}) for b in blocks]
