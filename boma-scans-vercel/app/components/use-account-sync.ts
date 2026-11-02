"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type RecordValue={key:string;value:unknown};
type CloudRecord=RecordValue & {revision:number};
export function useAccountSync(scope:"workspace"|"trade", records:RecordValue[], apply:(records:RecordValue[])=>void, ready:boolean) {
  const latest=useRef(records); const applyRef=useRef(apply);
  useEffect(()=>{latest.current=records;applyRef.current=apply;},[records,apply]);
  const known=useRef(new Map<string,{revision:number;json:string}>());
  const conflicts=useRef<CloudRecord[]>([]);
  const [status,setStatus]=useState("Waiting for account sync…");
  const [conflict,setConflict]=useState(false);
  useEffect(()=>{
    if (!ready) return;
    let stopped=false,busy=false;
    const controller=new AbortController();
    async function sync() {
      if (busy || stopped) return; busy=true;
      try {
        const response=await fetch("/api/sync?scope="+scope,{cache:"no-store",signal:controller.signal});
        const payload=await response.json() as {error?:string;records:CloudRecord[]};
        if (!response.ok) throw new Error(payload.error || "Sync unavailable; device copy retained.");
        const local=new Map(latest.current.map(item=>[item.key,item]));
        const updates:RecordValue[]=[];
        for (const remote of payload.records as CloudRecord[]) {
          const base=known.current.get(remote.key); const device=local.get(remote.key);
          const json=JSON.stringify(remote.value);
          if (base && base.revision!==remote.revision && device && JSON.stringify(device.value)!==base.json && JSON.stringify(device.value)!==json) {
            conflicts.current=[...conflicts.current.filter(item=>item.key!==remote.key),remote];continue;
          }
          if (!base || base.revision!==remote.revision || !device) {
            updates.push(remote);local.set(remote.key,remote);
          }
          known.current.set(remote.key,{revision:remote.revision,json});
        }
        if (stopped) return;
        if (updates.length) applyRef.current(updates);
        if (conflicts.current.length) {setConflict(true);setStatus("Sync conflict: your device copy is preserved. Load cloud changes to continue.");return;}
        for (const item of local.values()) {
          if (stopped) return;
          const base=known.current.get(item.key);const json=JSON.stringify(item.value);
          if (base?.json===json) continue;
          const result=await fetch("/api/sync",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...item,revision:base?.revision??0}),signal:controller.signal});
          const saved=await result.json() as {error?:string;revision:number};
          if (result.status===409) {
            const refreshed=await fetch("/api/sync?scope="+scope,{cache:"no-store",signal:controller.signal});
            if (!refreshed.ok) throw new Error("Conflict detected. Retry when account sync is available.");
            const cloud=await refreshed.json() as {records:CloudRecord[]};
            conflicts.current=cloud.records.filter(row=>row.key===item.key);
            setConflict(true);setStatus("Changed on another device. Back up this device and load cloud changes.");return;
          }
          if (!result.ok) throw new Error(saved.error || "Sync failed; device copy retained.");
          known.current.set(item.key,{revision:saved.revision,json});
        }
        if (!stopped) {setConflict(false);setStatus("Account synced · checks every 15 seconds");}
      } catch(error) {if (!stopped) setStatus(error instanceof Error ? error.message : "Sync unavailable; device copy retained.");}
      finally {busy=false;}
    }
    void sync();const timer=window.setInterval(()=>void sync(),15000);
    const visible=()=>{if(document.visibilityState==="visible") void sync();};
    document.addEventListener("visibilitychange",visible);
    return ()=>{stopped=true;controller.abort();clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[ready,scope]);
  const loadCloud=useCallback(()=>{
    try {localStorage.setItem("boma-sync-conflict-backup:"+scope,JSON.stringify(latest.current));} catch {setStatus("Backup failed. Export your device data before resolving this conflict.");return;}
    for(const item of conflicts.current) known.current.set(item.key,{revision:item.revision,json:JSON.stringify(item.value)});
    applyRef.current(conflicts.current);conflicts.current=[];setConflict(false);setStatus("Cloud changes loaded; device copy backed up locally.");
  },[scope]);
  return {status,conflict,loadCloud};
}
