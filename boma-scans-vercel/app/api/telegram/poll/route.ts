import {NextRequest,NextResponse} from "next/server";
import {env} from "@/app/server/env";
import {memory,recordKey} from "@/app/server/memory-store";
import {getOwnerUser} from "@/app/server/owner-auth";
import {pollTelegram} from "@/app/server/telegram-poll";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:NextRequest) {
 const user=await getOwnerUser();if(!user)return reply({error:"Sign in at /login to process Telegram commands."},401);
 if(request.headers.get("origin")&&request.headers.get("origin")!==request.nextUrl.origin)return reply({error:"Origin rejected."},403);
 if(!env.TELEGRAM_BOT_TOKEN)return reply({error:"Telegram is not configured: add TELEGRAM_BOT_TOKEN in Vercel, then Redeploy."},403);
 if(env.TELEGRAM_OWNER_EMAIL && user.email.toLowerCase()!==env.TELEGRAM_OWNER_EMAIL.toLowerCase())return reply({error:"Owner Telegram configuration unavailable."},403);
 const saved=env.DB?await env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key='telegram'").bind(user.userId).first<{payload:string}>():(memory().records.get(recordKey(user.userId,"telegram"))??null);
 const chatId=saved?JSON.parse(saved.payload).chatId:env.TELEGRAM_CHAT_ID;if(!chatId)return reply({processed:0});
 const result=await pollTelegram(user.userId,String(chatId),request.nextUrl.origin);
 return result.error?reply({error:result.error},502):reply({processed:result.processed});
}
