import json, os, numpy as np
H=3_600_000; data,pairs,cols=[],[],None
for d in ["sc_0","sc_1","sc_2","sc_3","sc_4","sc_5"]:
    for f in sorted(os.listdir(d)):
        if not f.endswith(".json"): continue
        j=json.load(open(os.path.join(d,f))); cols=cols or j.get("columns")
        if j.get("rows"): data.append(np.array([[np.nan if v is None else v for v in r] for r in j["rows"]],float)); pairs+=[f[:-5]]*len(j["rows"])
X=np.vstack(data); pair=np.array(pairs); key=np.char.add(pair,np.char.add("|",X[:,0].astype(np.int64).astype(str))); _,first=np.unique(key,return_index=True); first.sort(); X,pair=X[first],pair[first]
C={c:i for i,c in enumerate(cols)}; col=lambda n:X[:,C[n]]; t=col("t"); side=col("side"); N=len(X)
o=np.lexsort((t,pair))
def first_of(mask):
    idx=o[mask[o]]; keep=np.zeros(N,bool)
    if len(idx)==0: return keep
    s2=(pair[idx][1:]==pair[idx][:-1])&(side[idx][1:]==side[idx][:-1])&(t[idx][1:]-t[idx][:-1]<=2*H); keep[idx[0]]=True; keep[idx[1:]]=~s2; return keep
def by_time(r,tt):
    u,i=np.unique(tt,return_inverse=True); cl=np.bincount(i,weights=r)/np.bincount(i); return float(cl.mean()), float(cl.std(ddof=1)/np.sqrt(len(cl))) if len(cl)>1 else 0.0
def st(mask,k="A"):
    f=mask&(col(k+"_filled")==1)&~np.isnan(col(k+"_netR"))
    if f.sum()<15: return f"n={int(f.sum())}"
    a,se=by_time(col(k+"_netR")[f],t[f]); r=col(k+"_netR")[f]; return f"{a:+.3f}±{se:.3f} n={int(f.sum())} won {np.mean(r>0):.2f} PF {r[r>0].sum()/max(1e-9,-r[r<0].sum()):.2f} long {np.mean(side[f]==1):.2f}"
uni=[x["symbol"] for x in json.load(open("universe.json"))["universe"]]; rank={s:i for i,s in enumerate(uni)}
old23=set(s+"USDT" for s in ['1000PEPE','ADA','APT','ARB','AVAX','BCH','BNB','BTC','DOGE','DOT','ETH','FARTCOIN','HYPE','LINK','LTC','NEAR','OP','SOL','SUI','TRUMP','TRX','WIF','XRP'])
rk=np.array([rank.get(p,999) for p in pair]); in23=np.isin(pair,list(old23))
pick=col("pick")==1; gate=col("gate")==1
LV={"all setups":first_of(np.ones(N,bool)),"major-event setups":first_of(gate),"READY":first_of(pick)}
TIERS={"the 23 pairs of the earlier backtest":in23,"top 25 by turnover today":rk<25,"rank 25-99":(rk>=25)&(rk<100),"rank 100-249":(rk>=100)&(rk<250),"rank 250+":rk>=250}
yr=lambda a,b:(t>=np.datetime64(a).astype("datetime64[ms]").astype(np.int64))&(t<np.datetime64(b).astype("datetime64[ms]").astype(np.int64))
res={}
for ln,lm in LV.items():
    print("\n##",ln)
    for tn,tm in TIERS.items():
        print("  ",tn,"|",st(lm&tm),"| LONG",st(lm&tm&(side==1)),"| SHORT",st(lm&tm&(side==-1)))
        res[ln+" · "+tn]=st(lm&tm)
    print("   23 pairs, same 2 years as the earlier test (Nov 2024 – Nov 2026):",st(lm&in23&yr("2024-11-20","2026-11-24")))
    print("   23 pairs by year:", " | ".join(y+": "+st(lm&in23&yr(a,b)) for y,a,b in (("2024","2023-12-01","2024-12-01"),("2025","2024-12-01","2025-12-01"),("2026","2025-12-01","2026-12-01"))))
print("\nREADY signals per pair-year: all pairs", round(LV["READY"].sum()/ (len(set(pair))*3),2), "| 23 pairs", round((LV["READY"]&in23).sum()/(23*3),2))
