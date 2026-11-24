import json, os, numpy as np
from datetime import datetime
from zoneinfo import ZoneInfo
H=3_600_000; X=np.load("X3.npy"); cols=json.load(open("cols.json"))["cols"]; C={c:i for i,c in enumerate(cols)}; col=lambda n:X[:,C[n]]; t=col("t")
tz=ZoneInfo("Australia/Melbourne"); ut=np.unique(t); m={u:datetime.fromtimestamp(u/1000,tz) for u in ut}; wd=np.array([m[x].isoweekday()%7 for x in t])
COMPS=["stru","flow","htf","ret","fun","btc"]; W=np.array([30,20,15,5,5,5]); bull=np.round(np.stack([np.nan_to_num(col(c+"B")) for c in COMPS],1)@W); bear=np.round(np.stack([np.nan_to_num(col(c+"S")) for c in COMPS],1)@W)
lead=np.where((bull>=35)&(bull-bear>=15),1,np.where((bear>=35)&(bear-bull>=15),-1,0)); net=np.where(lead==1,col("LM_netR"),col("SM_netR"))
def by_time(r,tt):
    u,i=np.unique(tt,return_inverse=True); cl=np.bincount(i,weights=r)/np.bincount(i); return float(cl.mean()), float(cl.std(ddof=1)/np.sqrt(len(cl)))
def st(mask,arr=net):
    f=mask&~np.isnan(arr); a,se=by_time(arr[f],t[f]); return f"{a:+.3f}±{se:.3f} (n={int(f.sum())})"
names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
print("System 2, follow the lead side (market entry), by Melbourne weekday of the reading:")
for i,n in enumerate(names): print("  ",n,st((lead!=0)&(wd==i)))
print("   Mon+Tue",st((lead!=0)&np.isin(wd,[1,2])),"| other days",st((lead!=0)&~np.isin(wd,[1,2])))
for y,a,b in (("2024",0,1733011200000),("2025",1733011200000,1764547200000),("2026",1764547200000,9e15)):
    mm=(lead!=0)&(t>=a)&(t<b); print("  ",y,"Mon+Tue",st(mm&np.isin(wd,[1,2])),"| other days",st(mm&~np.isin(wd,[1,2])))
print("Reference: always LONG / always SHORT by weekday (no system at all):")
for i,n in enumerate(names): print("  ",n,"LONG",st(wd==i,col("LM_netR")),"SHORT",st(wd==i,col("SM_netR")))
