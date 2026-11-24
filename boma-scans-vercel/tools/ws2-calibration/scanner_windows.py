import json, os, numpy as np
from datetime import datetime
from zoneinfo import ZoneInfo
H=3_600_000; data,pairs,cols=[],[],None
for d in ["sc_0","sc_1","sc_2","sc_3","sc_4","sc_5"]:
    for f in sorted(os.listdir(d)):
        if not f.endswith(".json"): continue
        j=json.load(open(os.path.join(d,f))); cols=cols or j.get("columns")
        if j.get("rows"): data.append(np.array([[np.nan if v is None else v for v in r] for r in j["rows"]],float)); pairs+=[f[:-5]]*len(j["rows"])
X=np.vstack(data); pair=np.array(pairs); key=np.char.add(pair,np.char.add("|",X[:,0].astype(np.int64).astype(str))); _,first=np.unique(key,return_index=True); first.sort(); X,pair=X[first],pair[first]
C={c:i for i,c in enumerate(cols)}; col=lambda n:X[:,C[n]]; t=col("t"); side=col("side"); N=len(X); o=np.lexsort((t,pair))
def first_of(mask):
    idx=o[mask[o]]; keep=np.zeros(N,bool); s2=(pair[idx][1:]==pair[idx][:-1])&(side[idx][1:]==side[idx][:-1])&(t[idx][1:]-t[idx][:-1]<=2*H); keep[idx[0]]=True; keep[idx[1:]]=~s2; return keep
def by_time(r,tt):
    u,i=np.unique(tt,return_inverse=True); cl=np.bincount(i,weights=r)/np.bincount(i); return float(cl.mean()), float(cl.std(ddof=1)/np.sqrt(len(cl))) if len(cl)>1 else 0.0
def st(mask):
    f=mask&(col("A_filled")==1)&~np.isnan(col("A_netR"))
    if f.sum()<15: return {"n":int(f.sum())}
    a,se=by_time(col("A_netR")[f],t[f]); return {"n":int(f.sum()),"avgNetR":round(a,3),"se":round(se,3),"won":round(float(np.mean(col("A_netR")[f]>0)),3)}
tz=ZoneInfo("Australia/Melbourne"); ut=np.unique(t); loc={u:datetime.fromtimestamp(u/1000,tz) for u in ut}
wd=np.array([loc[x].isoweekday()%7 for x in t]); hr=np.array([loc[x].hour for x in t])   # 0 Sunday … 6 Saturday
skipDay=np.isin(wd,[1,2]); dead=(hr>=3)&(hr<10); allowed=~skipDay&~dead
pick=col("pick")==1; gate=col("gate")==1
LV={"READY":first_of(pick),"major-event setups":first_of(gate),"all setups":first_of(np.ones(N,bool))}
yrs={"2024":(t<1733011200000),"2025":(t>=1733011200000)&(t<1764547200000),"2026":t>=1764547200000}
out={}
for ln,lm in LV.items():
    o2={"inside the backtested windows":st(lm&allowed),"outside (Mon, Tue or 03:00–10:00 Melbourne)":st(lm&~allowed),"Monday or Tuesday":st(lm&skipDay),"03:00–10:00 any day":st(lm&dead),"byYear inside":{y:st(lm&allowed&m) for y,m in yrs.items()},"byYear outside":{y:st(lm&~allowed&m) for y,m in yrs.items()},
        "byWeekday":{n:st(lm&(wd==i)) for i,n in enumerate(["Sun","Mon","Tue","Wed","Thu","Fri","Sat"])},"byHourBlock":{f"{a:02d}-{a+3:02d}":st(lm&(hr>=a)&(hr<a+3)) for a in range(0,24,3)}}
    out[ln]=o2; print("\n##",ln); [print("  ",k,json.dumps(v)) for k,v in o2.items()]
json.dump(out,open("scanner_windows.json","w"),indent=1)
