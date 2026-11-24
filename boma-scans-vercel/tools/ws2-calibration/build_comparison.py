import json, numpy as np
from datetime import datetime
from zoneinfo import ZoneInfo
H=3_600_000; X=np.load("X3.npy"); cols=json.load(open("cols.json"))["cols"]; C={c:i for i,c in enumerate(cols)}; col=lambda n:X[:,C[n]]; t=col("t")
tz=ZoneInfo("Australia/Melbourne"); ut=np.unique(t); mp={u:datetime.fromtimestamp(u/1000,tz) for u in ut}; wd=np.array([mp[x].isoweekday()%7 for x in t]); early=np.isin(wd,[1,2])
COMPS=["stru","flow","htf","ret","fun","btc"]; W=np.array([30,20,15,5,5,5]); bull=np.round(np.stack([np.nan_to_num(col(c+"B")) for c in COMPS],1)@W); bear=np.round(np.stack([np.nan_to_num(col(c+"S")) for c in COMPS],1)@W)
side=np.where((bull>=35)&(bull-bear>=15),1,np.where((bear>=35)&(bear-bull>=15),-1,0)); L=side==1; pick=lambda a,b:np.where(L,a,b)
b=pick(bull,bear); q=pick(col("entryL"),col("entryS")); conf=pick(col("confL"),col("confS")); loc=pick(col("locL"),col("locS")); exh=pick(col("exhL"),col("exhS")); lead=side!=0
ready=lead&~((exh>=60)|(loc==2))&(q>=65)&(conf==1)&(exh<50)&(col("rel")>=60)&(b>=45); net=pick(col("LM_netR"),col("SM_netR"))
def by_time(r,tt):
    u,i=np.unique(tt,return_inverse=True); cl=np.bincount(i,weights=r)/np.bincount(i); return float(cl.mean()), float(cl.std(ddof=1)/np.sqrt(len(cl))) if len(cl)>1 else 0.0
def st(mask,arr=None):
    arr=net if arr is None else arr; f=mask&~np.isnan(arr)
    if f.sum()<20: return {"n":int(f.sum())}
    a,se=by_time(arr[f],t[f]); return {"n":int(f.sum()),"avgNetR":round(a,3),"se":round(se,3),"won":round(float(np.mean(arr[f]>0)),3)}
yrs={"2024":(t<1733011200000),"2025":(t>=1733011200000)&(t<1764547200000),"2026":t>=1764547200000}; names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
ws2={"ENTRY READY, all days":st(ready),"ENTRY READY, Monday or Tuesday":st(ready&early),"ENTRY READY, other days":st(ready&~early),"ENTRY READY other days by year":{y:st(ready&~early&m) for y,m in yrs.items()},"ENTRY READY Mon/Tue by year":{y:st(ready&early&m) for y,m in yrs.items()},
     "lead side, all days":st(lead),"lead side, Monday or Tuesday":st(lead&early),"lead side, other days":st(lead&~early),"lead side by weekday":{n:st(lead&(wd==i)) for i,n in enumerate(names)},"lead Mon/Tue by year":{y:st(lead&early&m) for y,m in yrs.items()},"lead other days by year":{y:st(lead&~early&m) for y,m in yrs.items()},
     "always LONG":st(np.ones(len(X),bool),col("LM_netR")),"always SHORT":st(np.ones(len(X),bool),col("SM_netR"))}
sc=json.load(open("scanner3y.json")); win=json.load(open("scanner_windows.json")); cal=json.load(open("calibration3y.json"))
cell=lambda o:{k:o.get(k) for k in ("filled","won","avgNetR","se")} if "avgNetR" in o else {"filled":o.get("filled",0)}
scanner={"pairs":sc["pairs"],"hourlyEvaluations":sc["hourlyEvaluations"],"from":sc["from"],"to":sc["to"],
  "levels":{k:{"signals":v["count"],"all":cell(v["ownHorizon"]["all"]),"LONG":cell(v["ownHorizon"]["LONG"]),"SHORT":cell(v["ownHorizon"]["SHORT"]),"ws2Horizon":cell(v["ws2Horizon"]["all"])} for k,v in sc["levels"].items()},
  "windows":{lv:{k:win[lv][k] for k in ("inside the backtested windows","outside (Mon, Tue or 03:00–10:00 Melbourne)","Monday or Tuesday","03:00–10:00 any day","byWeekday","byYear inside","byYear outside")} for lv in win},
  "blocks":[{"from":bk["from"],"to":bk["to"],**{k:cell(v) for k,v in bk.items() if isinstance(v,dict)}} for bk in sc["blocks"]]}
out={"builtFrom":{"ws2Readings":int(len(X)),"ws2Pairs":cal["pairs"],"from":cal["from"],"to":cal["to"]},"ws2":ws2,"scanner":scanner,
 "earlierBacktest":{"note":"Earlier Scanner backtest: 23 pairs, 2 years, about 185 READY trades. Re-run on the current engine with its own harness.","withFormingCandles":{"n":184,"avgRTaker":0.069,"avgRMaker":0.135},"closedCandlesOnly":{"n":185,"avgRTaker":0.054,"avgRMaker":0.120},"sameReplay23Pairs":{"n":212,"avgNetR":-0.073,"se":0.075}}}
json.dump(out,open("comparison.json","w"),separators=(",",":"))
print(json.dumps(ws2,indent=1)[:2600]); import os; print(os.path.getsize("comparison.json"),"bytes")
