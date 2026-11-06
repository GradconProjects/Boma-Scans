import {handleCommand} from "@/app/server/telegram-controls";
import {marketRead,bars} from "@/app/server/market-analysis";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/app/server/env";
import { getOwnerUser } from "@/app/server/owner-auth";
import { GET as bybit } from "@/app/api/bybit/route";
import { analyzeMarket, analyzeBtcRelationship, normalizeTicker, contextIntervals, INTERVAL_MS, type Candle } from "@/app/lib/market";
import { restoreEntryExecutionPlan, entryExecutionBlocker } from "@/app/lib/entry-execution";
import { appLink, parseSignalLedger, telegramSignalHtml } from "@/app/lib/signal-alerts";
import { telegramCall, telegramChunks } from "@/app/server/telegram";
import { memory, recordKey } from "@/app/server/memory-store";
export const dynamic="force-dynamic";

const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
type Config={chatId:string;enabled:boolean};
async function readRecord(userId:string,key:string):Promise<{payload:string}|null>{
  if(env.DB)return env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key=?").bind(userId,key).first<{payload:string}>();
  const row=memory().records.get(recordKey(userId,key));return row?{payload:row.payload}:null;
}
async function writeRecord(userId:string,key:string,payload:string){
  if(env.DB){await env.DB.prepare("INSERT INTO account_records(user_id,record_key,payload,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(user_id,record_key) DO UPDATE SET payload=excluded.payload,revision=account_records.revision+1,updated_at=excluded.updated_at").bind(userId,key,payload,Date.now()).run();return;}
  const store=memory().records,id=recordKey(userId,key),current=store.get(id);
  store.set(id,{payload,revision:(current?.revision??0)+1,updatedAt:Date.now()});
}
async function configuration(userId:string,email:string):Promise<Config|null>{
  const row=await readRecord(userId,"telegram");
  // TELEGRAM_OWNER_EMAIL is optional on single-owner hosting; when set, only that owner gets the default destination.
  if(env.TELEGRAM_OWNER_EMAIL && email.toLowerCase()!==env.TELEGRAM_OWNER_EMAIL.toLowerCase())return null;
  return row ? JSON.parse(row.payload) : env.TELEGRAM_CHAT_ID ? {chatId:env.TELEGRAM_CHAT_ID,enabled:true} : null;
}
export async function GET() {
  const user=await getOwnerUser();if(!user)return reply({error:"Sign in at /login to configure Telegram."},401);
  const config=await configuration(user.userId,user.email);
  let senders:unknown=[];
  try {const raw=await readRecord(user.userId,"telegram-senders");senders=raw?JSON.parse(raw.payload):[];} catch { /* none yet */ }
  // Which bot does the configured token belong to? (so the owner messages the right one)
  let bot:string|null=null;
  if(env.TELEGRAM_BOT_TOKEN){try {const me=await telegramCall(env.TELEGRAM_BOT_TOKEN,"getMe",{}) as {username?:string}|undefined;bot=me?.username??null;} catch { bot=null; }}
  return reply({configured:!!env.TELEGRAM_BOT_TOKEN,chatId:config?.chatId??"",enabled:config?.enabled??false,persistent:!!env.DB,senders,bot});
}
export async function POST(request:NextRequest) {
  const user=await getOwnerUser();if(!user)return reply({error:"Sign in at /login to configure Telegram."},401);
  if(request.headers.get("origin") && request.headers.get("origin")!==request.nextUrl.origin)return reply({error:"Origin rejected."},403);
  if(!env.TELEGRAM_BOT_TOKEN)return reply({error:"Telegram is not configured: add TELEGRAM_BOT_TOKEN in Vercel (Settings → Environment Variables), then Redeploy."},503);
  let body;
  try {const raw=await request.text();if(raw.length>120000)return reply({error:"Request too large."},413);body=JSON.parse(raw);}catch{return reply({error:"Invalid request."},400);}
  if(!body || typeof body!=="object")return reply({error:"Invalid request."},400);
  try {
    if(body.action==="connect") {
      if(typeof body.chatId!=="string" || !/^-?\d{5,20}$/.test(body.chatId))return reply({error:"Enter your numeric Telegram chat ID."},400);
      await telegramCall(env.TELEGRAM_BOT_TOKEN,"sendMessage",{chat_id:body.chatId,text:"✅ Boma Scans connected. Qualified scan alerts will include fixed entry, stop, five targets, technical reasoning and cancellation rules. Keep the scanner open for automatic delivery. No Bybit orders are placed."});
      const config={chatId:body.chatId,enabled:true};
      await writeRecord(user.userId,"telegram",JSON.stringify(config));
      return reply({message:env.DB?"Connected. Test message delivered.":"Connected. Test message delivered. No database is connected, so also set TELEGRAM_CHAT_ID="+body.chatId+" in Vercel to keep this after a restart.",enabled:true});
    }
    const config=await configuration(user.userId,user.email);
    if(body.action==="disable") {
      if(config) await writeRecord(user.userId,"telegram",JSON.stringify({...config,enabled:false}));
      return reply({message:"Telegram alerts disabled."});
    }
    if(body.action==="menu" && config) {await handleCommand(user.userId,config.chatId,"/menu",request.nextUrl.origin);return reply({message:"Telegram controls sent."});}
    if(body.action==="events") {
      if(!config?.enabled)return reply({sent:0,message:"Telegram is not connected."});
      const events=Array.isArray(body.events)?body.events.slice(0,10):[];
      const escape=(text:string)=>text.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
      let sent=0;
      for(const event of events) {
        if(!event || typeof event.key!=="string" || !/^(monitor|trade):[\w:.\- ]{1,200}$/.test(event.key) || !Array.isArray(event.lines))continue;
        const lines=event.lines.filter((line:unknown):line is string=>typeof line==="string" && line.length<=600).slice(0,12);
        if(!lines.length)continue;
        const key="event:"+event.key;
        let claimed:boolean;
        if(env.DB){claimed=!!(await env.DB.prepare("INSERT INTO telegram_deliveries(user_id,signal_key,status,created_at) VALUES(?,?,'PENDING',?) ON CONFLICT(user_id,signal_key) DO NOTHING RETURNING status").bind(user.userId,key,Date.now()).first());}
        else {const seen=memory().deliveries,id=recordKey(user.userId,key);claimed=!seen.has(id);if(claimed)seen.set(id,Date.now());}
        if(!claimed)continue;
        const text=lines.map((line:string,index:number)=>index===0?"<b>"+escape(line)+"</b>":escape(line)).filter(Boolean).join("\n");
        try {
          for(const chunk of telegramChunks(text))await telegramCall(env.TELEGRAM_BOT_TOKEN,"sendMessage",{chat_id:config.chatId,text:chunk,parse_mode:"HTML"});
          if(env.DB)await env.DB.prepare("UPDATE telegram_deliveries SET status='SENT' WHERE user_id=? AND signal_key=?").bind(user.userId,key).run();sent++;
        } catch(error) {
          if(env.DB)await env.DB.prepare("UPDATE telegram_deliveries SET status='UNCONFIRMED' WHERE user_id=? AND signal_key=?").bind(user.userId,key).run();
          return reply({sent,error:error instanceof Error?error.message:"Telegram delivery could not be confirmed."},502);
        }
      }
      return reply({sent,message:sent?"Follow-up delivered.":"Nothing new to send."});
    }
    if(body.action!=="signals")return reply({error:"Unknown Telegram action."},400);
    if(!config?.enabled)return reply({sent:0,message:"Telegram is not connected."});
    const ledger=parseSignalLedger(JSON.stringify({version:1,notifications:body.signals,scopes:{}}));
    let sent=0;
    for(const signal of ledger.notifications.slice(0,2)) {
      const plan=restoreEntryExecutionPlan(signal.executionPlan);
      if(!plan || Date.now()>=signal.expiresAt || signal.withdrawnAt)continue;
      const match=/^(\d+)([mh])$/.exec(plan.timeframe);if(!match)continue;
      const interval=String(Number(match[1])*(match[2]==="h"?60:1));if(!INTERVAL_MS[interval])continue;
      const [context,macro]=contextIntervals(interval);
      const [fast,contextBars,macroBars,btc,btcDaily,quote]=await Promise.all([bars(signal.symbol,interval),bars(signal.symbol,context,400),bars(signal.symbol,macro,360),bars("BTCUSDT",interval),bars("BTCUSDT","D",360).catch(()=>[] as Candle[]),marketRead({kind:"ticker",symbol:signal.symbol})]);
      if(fast.length<31 || contextBars.length<31 || macroBars.length<31 || !quote.time || Date.now()-quote.time>15000)continue;
      const ticker=normalizeTicker(quote.result!.list[0] as Record<string,unknown>);
      const analysis=analyzeMarket(fast,contextBars,macroBars,ticker,signal.style,{flexibility:signal.flexibility});
      const btcContext=analyzeBtcRelationship(signal.symbol,fast,btc,analysis,btcDaily);
      // Same plan = same side and the trigger/stop within 15% of a normal candle
      // range. Exact float equality silently dropped valid alerts whenever the
      // server saw one more candle or a slightly different history window.
      const tolerance=Math.max(plan.referenceAtr*0.15,plan.trigger*1e-6);
      const sameLevels = Math.abs(analysis.executionPlan.trigger-plan.trigger)<=tolerance && Math.abs(analysis.stop-plan.stop)<=tolerance;
      const stillConfirmed = analysis.executionPlan.confirmationTime!==null && (plan.confirmationTime===null || analysis.executionPlan.confirmationTime>=plan.confirmationTime);
      if(!sameLevels || !analysis.entryReady || analysis.bias!==signal.side || btcContext.divergenceVerdict==="REJECT" || entryExecutionBlocker(plan,ticker.lastPrice,Date.now()) || !stillConfirmed)continue;
      // Send the original fixed levels only while fresh analysis still approves the same plan.
      const key=[signal.symbol,interval,signal.side,plan.confirmationTime,plan.trigger,plan.stop].join(":");
      let claimed:boolean;
      if(env.DB){claimed=!!(await env.DB.prepare("INSERT INTO telegram_deliveries(user_id,signal_key,status,created_at) VALUES(?,?,'PENDING',?) ON CONFLICT(user_id,signal_key) DO NOTHING RETURNING status").bind(user.userId,key,Date.now()).first());}
      else {const seen=memory().deliveries,id=recordKey(user.userId,key);claimed=!seen.has(id);if(claimed)seen.set(id,Date.now());}
      if(!claimed)continue;
      try {
        const text=telegramSignalHtml({...signal,btcExplanation:btcContext.explanation},false,Date.now(),appLink(request.nextUrl.origin,signal.symbol));
        for(const chunk of telegramChunks(text))await telegramCall(env.TELEGRAM_BOT_TOKEN,"sendMessage",{chat_id:config.chatId,text:chunk,parse_mode:"HTML"});
        if(env.DB)await env.DB.prepare("UPDATE telegram_deliveries SET status='SENT' WHERE user_id=? AND signal_key=?").bind(user.userId,key).run();sent++;
      }catch {
        if(env.DB)await env.DB.prepare("UPDATE telegram_deliveries SET status='UNCONFIRMED' WHERE user_id=? AND signal_key=?").bind(user.userId,key).run();
        return reply({error:"Telegram delivery could not be confirmed. It will not auto-resend this setup, to avoid duplicate or partial alerts."},502);
      }
    }
    return reply({sent,message:sent?"Telegram alert delivered.":"No new still-valid signal to send."});
  } catch(error) {return reply({error:(error instanceof Error && error.message?error.message:"Telegram or fresh market analysis is unavailable.")+" No delivery was confirmed."},502);}
}
