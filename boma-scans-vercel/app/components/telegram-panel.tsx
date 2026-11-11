"use client";
import { AiReviewerBox } from "@/app/components/ai-reviewer-box";
import {useEffect,useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import type {SignalSnapshot} from "@/app/lib/signal-alerts";
export function TelegramPanel({signals,deliveryStatus}:{signals:SignalSnapshot[];deliveryStatus:string}) {
 const [chatId,setChatId]=useState("");const [configured,setConfigured]=useState(false);const [enabled,setEnabled]=useState(false);
 const [status,setStatus]=useState("Checking Telegram configuration…");const [busy,setBusy]=useState(false);
 const [senders,setSenders]=useState<Array<{chatId:string;name:string;text:string;at:number}>>([]);
 const [bot,setBot]=useState("");
 const [cron,setCron]=useState<{monitorUrl:string;scanUrl:string;derived:boolean;schedule?:{ok:boolean;at:number;error?:string}|null}|null>(null);
 const [server,setServer]=useState<{lastRunAt?:number;autoMonitored?:string[];inTrade?:string[];lastError?:string}>({});
 const load=(query="",controller=new AbortController())=>{
  fetch("/api/telegram"+query,{cache:"no-store",signal:controller.signal}).then(async response=>{
   const data=await response.json() as {configured?:boolean;enabled?:boolean;chatId?:string;error?:string;senders?:Array<{chatId:string;name:string;text:string;at:number}>;bot?:string|null;cron?:{monitorUrl:string;scanUrl:string;derived:boolean;schedule?:{ok:boolean;at:number;error?:string}|null}|null;server?:{lastRunAt?:number;autoMonitored?:string[];inTrade?:string[];lastError?:string}};
   if(Array.isArray(data.senders))setSenders(data.senders);if(data.bot)setBot(data.bot);if(data.cron)setCron(data.cron);if(data.server)setServer(data.server);
   if(!response.ok)throw new Error(data.error||"Telegram unavailable.");
   setConfigured(!!data.configured);setEnabled(!!data.enabled);setChatId(data.chatId??"");setStatus(!data.configured?"Telegram bot token is not set. In Vercel → Settings → Environment Variables add TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (your numeric chat ID, from @userinfobot), then Redeploy. With both set, Telegram is on automatically; no connect step is needed.":data.enabled?"Telegram destination configured"+(data.chatId?" (chat "+data.chatId+")":"")+". Use Connect & send test to verify delivery, or Send Telegram controls for the command menu.":"Enter your Telegram chat ID to connect, or set TELEGRAM_CHAT_ID in Vercel.");
  }).catch(error=>{if(!controller.signal.aborted)setStatus(error instanceof Error?error.message:"Telegram unavailable.");});
 };
 useEffect(()=>{const controller=new AbortController();load("",controller);return ()=>controller.abort();},[]);
 const [commandStatus,setCommandStatus]=useState("");
 useEffect(()=>{
  if(!configured)return;
  let stopped=false,busy=false;const controller=new AbortController();
  async function poll(){
   if(stopped||busy)return;busy=true;
   try{
    const response=await fetch("/api/telegram/poll",{method:"POST",signal:controller.signal});
    const result=await response.json() as {error?:string};
    try {const state=await (await fetch("/api/telegram",{cache:"no-store",signal:controller.signal})).json() as {senders?:Array<{chatId:string;name:string;text:string;at:number}>};if(!stopped&&Array.isArray(state.senders))setSenders(state.senders);} catch { /* keep the last list */ }
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
  }catch(error){const text=error instanceof Error?error.message:"Telegram request failed.";setStatus(/403/.test(text)?"Telegram refused (403): the bot cannot message chat "+chatId.trim()+" yet. Open your bot in Telegram, press Start (or unblock it), then try Connect & send test again.":text);}finally{setBusy(false);}
 }
 return <details className="my-4 rounded-2xl border border-cyan-300/20 bg-slate-950/40 p-4">
  <summary className="cursor-pointer text-base font-semibold text-cyan-200">📨 Telegram delivery · {enabled?"connected":configured?"connect your chat":"set TELEGRAM_BOT_TOKEN in Vercel"}</summary>
  <p className="mt-3 text-sm leading-6 text-slate-300">Easiest setup: put <code className="font-mono text-cyan-100">TELEGRAM_BOT_TOKEN</code> and <code className="font-mono text-cyan-100">TELEGRAM_CHAT_ID</code> in Vercel environment variables and redeploy; alerts are then on for every sign-in. Otherwise open your bot in Telegram, press Start, and enter your numeric chat ID below. Connecting sends a test message.</p>
  <label className="mt-3 block text-sm text-slate-300" htmlFor="telegram-chat-id">Telegram chat ID</label>
  <Input id="telegram-chat-id" value={chatId} onChange={event=>setChatId(event.target.value)} placeholder="Your numeric chat ID" className="mt-1 max-w-sm"/>
  <div className="mt-3 flex flex-wrap gap-2"><Button disabled={busy||!configured||!chatId.trim()} onClick={()=>void act("connect")}>Connect & send test</Button><Button variant="outline" disabled={busy||!configured} onClick={()=>void act("menu")}>Send Telegram controls</Button><Button variant="outline" disabled={busy||!enabled||!signals.length} onClick={()=>void act("signals")}>Send active signals now</Button><Button variant="outline" disabled={busy||!enabled} onClick={()=>void act("disable")}>Disable Telegram</Button></div>
  <p className="mt-3 text-sm text-slate-300" role="status">{status}</p>
  {senders.length>0&&<div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3"><p className="text-sm font-semibold text-cyan-100">Chats that messaged this bot</p><p className="mt-1 text-xs text-slate-400">Telegram only lets the bot reply to a chat that has messaged it. If your configured chat ID is rejected, use one of these.</p><ul className="mt-2 space-y-1">{senders.map(sender=><li key={sender.chatId} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span><span className="font-mono text-slate-100">{sender.chatId}</span> <span className="text-slate-400">· {sender.name}{sender.text?" · “"+sender.text+"”":""}</span></span>{sender.chatId!==chatId.trim()&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>{setChatId(sender.chatId);}}>Use this chat</Button>}</li>)}</ul></div>}
  {cron&&<div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-3"><p className="text-sm font-semibold text-emerald-100">🤖 Autonomous monitoring (works with the app closed)</p><p className="mt-1 text-xs leading-5 text-slate-400">{server.lastRunAt?"Last server run "+new Date(server.lastRunAt).toLocaleTimeString("en-AU",{timeZone:"Australia/Melbourne",hour:"2-digit",minute:"2-digit"})+" Melbourne"+(server.inTrade?.length?" · in trade: "+server.inTrade.join(", "):"")+(server.autoMonitored?.length?" · auto-monitored: "+server.autoMonitored.join(", "):"")+(server.lastError?" · last problem: "+server.lastError:""):"No server run yet."}</p>{cron.schedule?.ok?<p className="mt-2 text-xs leading-5 text-emerald-200">✅ Scheduled from your Supabase database: monitor every minute, full scan every 3 hours. Nothing else to set up.</p>:<p className="mt-2 text-xs leading-5 text-amber-200">Database scheduling {cron.schedule?.error?"failed: "+cron.schedule.error:"not confirmed yet"}. <button type="button" className="underline" onClick={()=>void load("?schedule=retry")}>Retry</button>, or point a free scheduler such as cron-job.org at the links below.</p>}<ul className="mt-2 space-y-1 text-xs"><li><span className="text-slate-400">Every 1 minute → </span><code className="break-all font-mono text-cyan-100">{cron.monitorUrl}</code></li><li><span className="text-slate-400">Every 3 hours → </span><code className="break-all font-mono text-cyan-100">{cron.scanUrl}</code></li></ul><p className="mt-2 text-xs leading-5 text-slate-400">When a pair reaches its entry range the message carries <b>Entered</b> / <b>Skipped</b> buttons. Entered (or <code className="font-mono">/entered BTCUSDT 68500</code>) tracks exits from your fill: targets, stop, a structure change against the trade, the runner rule after target 2 and a maximum hold. <code className="font-mono">/status</code> lists what is being followed.</p>{cron.derived&&<p className="mt-2 text-[11px] text-slate-500">The key is derived from your owner password; if you change the password the schedule is re-registered on the next visit here. Set CRON_SECRET in Vercel for an independent key.</p>}</div>}
  <AiReviewerBox/>
  {bot&&<p className="mt-2 text-sm text-cyan-100">Your token belongs to <a className="underline" href={"https://t.me/"+bot} target="_blank" rel="noreferrer">@{bot}</a>. Message that bot (not another one) from the Telegram account that should receive alerts.</p>}
  {senders.length===0&&configured&&<p className="mt-2 text-xs text-slate-400">Tip: send <span className="font-mono">/start</span> to your bot from the Telegram account you want alerts on; its chat ID will appear here within about 10 seconds while this dashboard is open.</p>}
  <p className="mt-1 text-sm text-slate-400">{commandStatus}</p>
  {deliveryStatus&&<p className="mt-1 text-sm text-slate-400">Last scan delivery: {deliveryStatus}</p>}
  <p className="mt-2 text-sm leading-6 text-slate-400">Messages include fixed entry, SL, five TA targets, ratings, BTC context, entry/exit steps and cancellation rules. The server rechecks Bybit before sending. Alerts run while the scanner is open; keep one device running. Delivery does not place or cancel orders on Bybit.</p>
 </details>;
}
