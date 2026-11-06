import { env } from "@/app/server/env";
import {memory,recordKey} from "@/app/server/memory-store";
import {telegramCall,telegramChunks} from "@/app/server/telegram";
import {analyzePair} from "@/app/server/market-analysis";
import {appLink,compactSignalLines,renderTelegramHtml,snapshotSignal,telegramSignalHtml} from "@/app/lib/signal-alerts";
import {getMediumRiskShortlist} from "@/app/lib/recommendations";
import {BOT_FRAMES,parseBotCommand,botSetting} from "@/app/lib/telegram-commands";
import {formatPrice,STYLE_CONFIG,type TradingStyle} from "@/app/lib/market";
import {armPlan,evaluateMonitor,type MonitorMemory} from "@/app/lib/trigger-monitor";
import type {FlexibilityMode} from "@/app/lib/entry-policy";
type Workspace={symbol:string;interval:string;style:TradingStyle;flexibility:FlexibilityMode;equity:number;fee:number;slippage:number;autoScan:boolean;autoScanMinutes:number;targetStyle?:"TA"|"LADDER";[key:string]:unknown};
const defaults:Workspace={symbol:"BTCUSDT",interval:"60",style:"DAY",flexibility:"STRICT",equity:10000,fee:.055,slippage:.02,autoScan:true,autoScanMinutes:15};
export function menu(origin:string) {return {inline_keyboard:[
 [{text:"📊 Analyse BTC",callback_data:"analyse:BTCUSDT"},{text:"⚙️ Settings",callback_data:"settings"}],
 [{text:"⏱ 1h",callback_data:"tf:1h"},{text:"⏱ 2h",callback_data:"tf:2h"},{text:"⏱ 4h",callback_data:"tf:4h"}],
 [{text:"🛡 Strict",callback_data:"risk:STRICT"},{text:"⚖ Balanced",callback_data:"risk:BALANCED"},{text:"🔥 Flexible",callback_data:"risk:FLEXIBLE"}],
 [{text:"🔎 Scan",callback_data:"scan"},{text:"📒 Trades",callback_data:"trades"}],
 [{text:"🌐 Full dashboard & all controls",web_app:{url:origin}}],
]};}
async function read(userId:string,key:string) {
 if(env.DB)return env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key=?").bind(userId,key).first<{payload:string}>();
 const row=memory().records.get(recordKey(userId,key));return row?{payload:row.payload}:null;
}
async function write(userId:string,key:string,payload:string) {
 if(env.DB){await env.DB.prepare("INSERT INTO account_records(user_id,record_key,payload,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(user_id,record_key) DO UPDATE SET payload=excluded.payload,revision=account_records.revision+1,updated_at=excluded.updated_at").bind(userId,key,payload,Date.now()).run();return;}
 const store=memory().records,id=recordKey(userId,key);store.set(id,{payload,revision:(store.get(id)?.revision??0)+1,updatedAt:Date.now()});
}
async function workspace(userId:string) {
 const record=await read(userId,"workspace");
 return {...defaults,...(record?JSON.parse(record.payload):{})} as Workspace;
}
async function save(userId:string,value:Workspace) {await write(userId,"workspace",JSON.stringify(value));}
export async function handleCommand(userId:string,chatId:string,text:string,origin:string) {
 const token=env.TELEGRAM_BOT_TOKEN!;
 const send=async(message:string,keyboard=false,html=false)=>{for(const chunk of telegramChunks(message))await telegramCall(token,"sendMessage",{chat_id:chatId,text:chunk,...(html?{parse_mode:"HTML"}:{}),...(keyboard?{reply_markup:menu(origin)}:{})});};
 const {command,args}=parseBotCommand(text);const settings=await workspace(userId);
 if(["/start","/menu","/help"].includes(command)) {
  await send("📡 BOMA SCANS — CONTROL CENTRE\n\nType a pair: BTCUSDT\n/analyse ETHUSDT 1h\n/timeframe 1h | 2h | 4h\n/style DAY | SCALP | SWING | POSITION\n/targets TA | LADDER\n/entered BTCUSDT [price] · /skip BTCUSDT · /status\n/risk STRICT | BALANCED | FLEXIBLE\n/equity 10000\n/fee 0.055\n/slippage 0.02\n/interval 15 | 30 | 60 | 120 | 240\n/autoscan on | off\n/direction BOTH | LONG | SHORT\n/filter ALL | LOW | MEDIUM | HIGH\n/alerts on | off\n/settings · /scan · /trades\n\nTelegram commands sync with your website settings. Keep the website open on one device for command processing. Full dashboard opens all chart, journal and risk controls inside Telegram. No exchange orders are placed.",true);return;
 }
 if(command==="/settings") {
  await send("⚙️ CURRENT SETTINGS\nPair: "+settings.symbol+"\nCandle interval: "+settings.interval+"\nStyle: "+settings.style+"\nEntry flexibility: "+settings.flexibility+"\nEquity: "+settings.equity+" USDT\nFee: "+settings.fee+"% · slippage: "+settings.slippage+"%\nAuto-scan: "+(settings.autoScan?"on":"off")+" / "+settings.autoScanMinutes+" minutes\nDirection: "+(settings.directionFilter??"BOTH")+" · grade filter: "+(settings.riskFilter??"ALL")+"\n\nNew plans scale out at 1R/2R/3R/4R/5R (30/25/20/15/10%); entry signals are issued on the 1H chart. Existing trade levels stay fixed.",true);return;
 }
 const patch=botSetting(command,args[0]??"");
 if(patch) {await save(userId,{...settings,...patch});await send("✅ Setting saved and synced: "+JSON.stringify(patch),true);return;}
 if(command==="/scan") {await save(userId,{...settings,scanRequestedAt:Date.now()});await send("🔎 Scan requested on your open dashboard. Qualified new setups will arrive after fresh analysis completes.",true);return;}
 if(command==="/alerts"&&["on","off"].includes(args[0])) {
  await write(userId,"telegram",JSON.stringify({chatId,enabled:args[0]==="on"}));
  await send("🔔 Telegram signal alerts "+args[0]+". Commands remain available while the dashboard is open.",true);return;
 }
 if(command==="/entered"||command==="/skip"||command==="/status") {
  const key=userId+"\u0000monitor-memory";
  const read=async()=>{try{const raw=env.DB?(await env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key='monitor-memory'").bind(userId).first<{payload:string}>())?.payload:memory().records.get(key)?.payload;return (raw?JSON.parse(raw):{symbols:{}}) as {symbols:Record<string,MonitorMemory>;autoMonitored?:string[]};}catch{return {symbols:{}} as {symbols:Record<string,MonitorMemory>;autoMonitored?:string[]};}};
  const persist=async(value:unknown)=>{await write(userId,"monitor-memory",JSON.stringify(value));};
  const mem=await read();
  if(command==="/status") {
   const lines=Object.entries(mem.symbols).map(([symbol,m])=>"• "+symbol+(m.armed?" · IN TRADE from "+formatPrice(m.armed.entry)+" · next T"+(m.armed.hit+1)+(m.armed.confirmed?" (confirmed)":" (assumed)"):m.seen?" · "+(m.alerted?.state??"watching"):" · watching"));
   await send("📡 MONITOR STATUS\n"+(lines.length?lines.join("\n"):"No pairs monitored yet. Monitor one in the app, or send /entered BTCUSDT after you fill.")+"\n\nAuto-monitored: "+((mem.autoMonitored??[]).join(", ")||"none"),true);return;
  }
  const symbol=(args[0]??"").toUpperCase().replace(/[^A-Z0-9]/g,"");const pair=symbol.endsWith("USDT")?symbol:symbol+"USDT";
  if(!/^[A-Z0-9]{2,24}USDT$/.test(pair)){await send("Use /entered BTCUSDT [your fill price] or /skip BTCUSDT.");return;}
  mem.symbols[pair]??={};
  if(command==="/skip") {
   const planKey=mem.symbols[pair].seen?.planKey??mem.symbols[pair].armed?.planKey??pair+":skipped";
   mem.symbols[pair]={...mem.symbols[pair],armed:null,skipped:planKey};
   await persist(mem);await send("❌ "+pair+" marked as skipped. No exit alerts for this plan; you will still hear about a new plan for the pair.",true);return;
  }
  const fill=Number(args[1]);
  let armed=mem.symbols[pair].armed;
  if(!armed) {
   const {row}=await analyzePair(pair,STYLE_CONFIG[settings.style].interval,settings.style,settings.flexibility,settings.fee,settings.slippage,settings.targetStyle==="LADDER"?"LADDER":"TA");
   armed=armPlan(row,Date.now());
   const entry=evaluateMonitor(pair,row,row.price);mem.symbols[pair].seen={planKey:entry.planKey,ready:entry.ready,status:row.executionPlan.status};
  }
  armed={...armed,confirmed:true,entry:Number.isFinite(fill)&&fill>0?fill:armed.entry};
  mem.symbols[pair]={...mem.symbols[pair],armed,skipped:undefined};
  if(!(mem.autoMonitored??[]).includes(pair))mem.autoMonitored=[...(mem.autoMonitored??[]),pair].slice(-12);
  await persist(mem);
  const sign=armed.side==="LONG"?1:-1,risk=Math.max(Math.abs(armed.entry-armed.stop),armed.entry*0.0001);
  await send("✅ "+pair+" "+armed.side+" · entry "+formatPrice(armed.entry)+" recorded.\n🛑 Stop "+formatPrice(armed.stop)+"\n"+armed.targets.map((t,i)=>"🎯 Target "+(i+1)+": "+formatPrice(t)+"   "+(sign*(t-armed!.entry)/risk).toFixed(1)+"R · close "+armed!.weights[i]+"%").join("\n")+"\n\nYou will be told at each target, at the stop, on a structure change against the trade, and when the runner should be closed.",true);return;
 }
 if(["/trades","/journal"].includes(command)) {
  const trades=env.DB?(await env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key LIKE 'trade/%' ORDER BY updated_at DESC LIMIT 15").bind(userId).all<{payload:string}>()).results.map(row=>JSON.parse(row.payload)):[];
  await send("📒 SYNCED TRADE JOURNAL\n"+(trades.length?trades.map(trade=>trade.symbol+" · "+trade.side+" · "+trade.status+"\nEntry "+formatPrice(trade.entryPrice)+" · stop "+formatPrice(trade.stop)+" · remaining "+trade.remainingPct+"%").join("\n\n"):"No synced trades yet.")+"\n\nOpen Full dashboard to record actual fills, partial exits, stops or manual trades.",true);return;
 }
 if(command==="/analyse") {
  const symbol=(args[0]??settings.symbol).toUpperCase().replace(/[^A-Z0-9]/g,"");
  const pair=symbol.endsWith("USDT")?symbol:symbol+"USDT";
  const interval=args[1]?BOT_FRAMES[args[1].toLowerCase()]:settings.interval;
  if(!/^[A-Z0-9]{2,24}USDT$/.test(pair)||!interval){await send("Use /analyse BTCUSDT 1h, or just type ETHUSDT.");return;}
  await send("🔎 Checking fresh Bybit candles for "+pair+"…");
  const {analysis,row,relationship}=await analyzePair(pair,interval,settings.style,settings.flexibility,settings.fee,settings.slippage,settings.targetStyle==="LADDER"?"LADDER":"TA");
  const pick=getMediumRiskShortlist([row],settings.equity,true,1)[0];
  if(pick) {await send(telegramSignalHtml(snapshotSignal(pick),false,Date.now(),appLink(origin,pair)),true,true);}
  else {
   const plan=analysis.executionPlan;
   const card=compactSignalLines({symbol:pair,side:analysis.bias,entryLow:plan.entryLow,entryHigh:plan.entryHigh,entry:analysis.entry,trigger:plan.trigger,timeframe:plan.timeframe,stop:analysis.stop,targets:analysis.takeProfits,expiresAt:plan.expiresAt,zoneLow:plan.zoneLow,zoneHigh:plan.zoneHigh});
   await send(renderTelegramHtml(["⏸ "+pair+" "+analysis.bias+" · WAIT · "+plan.status.replaceAll("_"," "),"📍 Price "+formatPrice(row.price),"",...card,"","⏳ "+plan.reason,"₿ "+relationship.explanation,"🔗 Open in app: "+appLink(origin,pair)]),true,true);
  }
  return;
 }
 await send("Unknown command or invalid setting. Send /menu for buttons and examples.",true);
}
