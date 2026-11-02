"use client";
import {useEffect,useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import type {SignalSnapshot} from "@/app/lib/signal-alerts";
export function TelegramPanel({signals,deliveryStatus}:{signals:SignalSnapshot[];deliveryStatus:string}) {
 const [chatId,setChatId]=useState("");const [configured,setConfigured]=useState(false);const [enabled,setEnabled]=useState(false);
 const [status,setStatus]=useState("Checking Telegram configuration…");const [busy,setBusy]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  fetch("/api/telegram",{cache:"no-store",signal:controller.signal}).then(async response=>{
   const data=await response.json() as {configured?:boolean;enabled?:boolean;chatId?:string;error?:string};
   if(!response.ok)throw new Error(data.error||"Telegram unavailable.");
   setConfigured(!!data.configured);setEnabled(!!data.enabled);setChatId(data.chatId??"");setStatus(data.enabled?"Telegram destination configured. Use Connect & send test to verify delivery.":"Enter your Telegram chat ID to connect.");
  }).catch(error=>{if(!controller.signal.aborted)setStatus(error instanceof Error?error.message:"Telegram unavailable.");});
  return ()=>controller.abort();
 },[]);
 const [commandStatus,setCommandStatus]=useState("");
 useEffect(()=>{
  if(!configured)return;
  let stopped=false,busy=false;const controller=new AbortController();
  async function poll(){
   if(stopped||busy)return;busy=true;
   try{
    const response=await fetch("/api/telegram/poll",{method:"POST",signal:controller.signal});
    const result=await response.json() as {error?:string};
    if(!stopped)setCommandStatus(response.ok?"Telegram commands active while this dashboard is open.":result.error??"Commands unavailable.");
   }catch{if(!stopped)setCommandStatus("Telegram commands paused; reconnect this dashboard.");}finally{busy=false;}
  }
  void poll();const timer=window.setInterval(()=>void poll(),10000);
  return ()=>{stopped=true;controller.abort();clearInterval(timer);};
 },[configured]);
 async function act(action:"connect"|"disable"|"signals"|"menu") {
  setBusy(true);
  try{
   const response=await fetch("/api/telegram",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,chatId:chatId.trim(),signals:action==="signals"?signals:undefined})});
   const data=await response.json() as {error?:string;message?:string};
   if(!response.ok)throw new Error(data.error||"Telegram request failed.");
   setStatus(data.message??"Telegram settings updated.");if(action==="connect")setEnabled(true);if(action==="disable")setEnabled(false);
  }catch(error){setStatus(error instanceof Error?error.message:"Telegram request failed.");}finally{setBusy(false);}
 }
 return <details className="my-4 rounded-2xl border border-cyan-300/20 bg-slate-950/40 p-4">
  <summary className="cursor-pointer text-base font-semibold text-cyan-200">📨 Telegram delivery · {enabled?"connected":"connect your chat"}</summary>
  <p className="mt-3 text-sm leading-6 text-slate-300">Open your bot in Telegram and press Start first. Enter your numeric chat ID below. Connecting sends a test message and enables qualified long/short alerts for this account.</p>
  <label className="mt-3 block text-sm text-slate-300" htmlFor="telegram-chat-id">Telegram chat ID</label>
  <Input id="telegram-chat-id" value={chatId} onChange={event=>setChatId(event.target.value)} placeholder="Your numeric chat ID" className="mt-1 max-w-sm"/>
  <div className="mt-3 flex flex-wrap gap-2"><Button disabled={busy||!configured||!chatId.trim()} onClick={()=>void act("connect")}>Connect & send test</Button><Button variant="outline" disabled={busy||!configured} onClick={()=>void act("menu")}>Send Telegram controls</Button><Button variant="outline" disabled={busy||!enabled||!signals.length} onClick={()=>void act("signals")}>Send active signals now</Button><Button variant="outline" disabled={busy||!enabled} onClick={()=>void act("disable")}>Disable Telegram</Button></div>
  <p className="mt-3 text-sm text-slate-300" role="status">{status}</p>
  <p className="mt-1 text-sm text-slate-400">{commandStatus}</p>
  {deliveryStatus&&<p className="mt-1 text-sm text-slate-400">Last scan delivery: {deliveryStatus}</p>}
  <p className="mt-2 text-sm leading-6 text-slate-400">Messages include fixed entry, SL, five TA targets, ratings, BTC context, entry/exit steps and cancellation rules. The server rechecks Bybit before sending. Alerts run while the scanner is open; keep one device running. Delivery does not place or cancel orders on Bybit.</p>
 </details>;
}
