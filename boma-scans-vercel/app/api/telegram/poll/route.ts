import {NextRequest,NextResponse} from "next/server";
import { env } from "@/app/server/env";
import { getOwnerUser } from "@/app/server/owner-auth";
import {telegramCall} from "@/app/server/telegram";
import {handleCommand} from "@/app/server/telegram-controls";
import {memory,recordKey} from "@/app/server/memory-store";
export const dynamic="force-dynamic";

const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:NextRequest) {
 const user=await getOwnerUser();if(!user)return reply({error:"Sign in at /login to process Telegram commands."},401);
 if(request.headers.get("origin")&&request.headers.get("origin")!==request.nextUrl.origin)return reply({error:"Origin rejected."},403);
 if(!env.TELEGRAM_BOT_TOKEN)return reply({error:"Telegram is not configured: add TELEGRAM_BOT_TOKEN in Vercel, then Redeploy."},403);
 if(env.TELEGRAM_OWNER_EMAIL && user.email.toLowerCase()!==env.TELEGRAM_OWNER_EMAIL.toLowerCase())return reply({error:"Owner Telegram configuration unavailable."},403);
 const saved=env.DB?await env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key='telegram'").bind(user.userId).first<{payload:string}>():(memory().records.get(recordKey(user.userId,"telegram"))??null);
 const chatId=saved?JSON.parse(saved.payload).chatId:env.TELEGRAM_CHAT_ID;if(!chatId)return reply({processed:0});
 const now=Date.now();
 let lease:{offset:number}|null;
 if(env.DB){lease=await env.DB.prepare("INSERT INTO telegram_runtime(id,\"offset\",lease_until) VALUES('bot',0,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE telegram_runtime.lease_until<? RETURNING \"offset\"").bind(now+45000,now).first<{offset:number}>();}
 else {const rt=memory().runtime;lease=rt.leaseUntil<now?(rt.leaseUntil=now+45000,{offset:rt.offset}):null;}
 if(!lease)return reply({processed:0});
 let processed=0;
 try {
  const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({offset:lease.offset,limit:5,timeout:0,allowed_updates:["message","callback_query"]}),signal:AbortSignal.timeout(10000)});
  const data=await response.json() as {ok:boolean;result:Array<{update_id:number;message?:{text?:string;date:number;chat:{id:number};from?:{id:number}};callback_query?:{id:string;data?:string;from:{id:number};message?:{chat:{id:number};date:number}}}>};
  if(!response.ok||!data.ok)return reply({error:"Telegram command polling unavailable; an existing webhook or connection error may be blocking it."},502);
  for(const update of data.result) {
   let claim:boolean;
   if(env.DB){
    await env.DB.prepare("UPDATE telegram_runtime SET \"offset\"=CASE WHEN \"offset\">? THEN \"offset\" ELSE ? END,lease_until=? WHERE id='bot'").bind(update.update_id+1,update.update_id+1,Date.now()+45000).run();
    claim=!!(await env.DB.prepare("INSERT INTO telegram_updates(id,received_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING RETURNING id").bind(update.update_id,Date.now()).first());
   } else {const m=memory();m.runtime.offset=Math.max(m.runtime.offset,update.update_id+1);m.runtime.leaseUntil=Date.now()+45000;claim=!m.updates.has(update.update_id);if(claim)m.updates.set(update.update_id,Date.now());}
   if(!claim)continue;
   const message=update.message;const callback=update.callback_query;
   const target=message?.chat.id??callback?.message?.chat.id;const sender=message?.from?.id??callback?.from.id;
   if(String(target)!==String(chatId)||String(sender)!==String(chatId))continue;
   const date=message?.date??0;if(message && Date.now()-date*1000>30*60000)continue;
   let text=message?.text??"";
   if(callback) {
    await telegramCall(env.TELEGRAM_BOT_TOKEN,"answerCallbackQuery",{callback_query_id:callback.id});
    const [action,value]=String(callback.data??"").split(":");
    text=action==="tf"?"/timeframe "+value:action==="risk"?"/risk "+value:action==="analyse"?"/analyse "+value:"/"+action;
   }
   if(!text)continue;
   try {await handleCommand(user.userId,String(chatId),text,request.nextUrl.origin);processed++;}
   catch {await telegramCall(env.TELEGRAM_BOT_TOKEN,"sendMessage",{chat_id:chatId,text:"⚠️ Fresh analysis or command processing failed. No entry approved. Try again or open the dashboard."});}
  }
  return reply({processed});
 } catch {return reply({error:"Telegram command processing could not complete."},502);}
 finally {if(env.DB)await env.DB.prepare("UPDATE telegram_runtime SET lease_until=0 WHERE id='bot'").run();else memory().runtime.leaseUntil=0;}
}
