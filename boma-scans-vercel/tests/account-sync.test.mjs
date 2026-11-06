import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import Module,{createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url);
const realModules=new Map();
function loadReal(relative){
 const file=new URL('../'+relative,import.meta.url).pathname;
 if(realModules.has(file))return realModules.get(file).exports;
 const m=new Module(file);realModules.set(file,m);
 m.require=spec=>spec.startsWith('@/')?loadReal(spec.slice(2)+'.ts'):require(spec);
 m._compile(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
 return m.exports;
}
const memoryFile=new URL('../app/server/memory-store.ts',import.meta.url).pathname;
const memoryMod=new Module(memoryFile);memoryMod.require=require;
memoryMod._compile(ts.transpileModule(readFileSync(memoryFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,memoryFile);
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../drizzle/0000_stiff_leader.sql',import.meta.url),'utf8'));
sqlite.exec(readFileSync(new URL('../drizzle/0001_abnormal_zemo.sql',import.meta.url),'utf8'));
let user={userId:'alice'};
const env={DB:{prepare(sql){return {async run(){return sqlite.prepare(sql).run();},bind(...args){return {async run(){return sqlite.prepare(sql).run(...args);},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args)};}};}};}}};
const file=new URL('../app/api/sync/route.ts',import.meta.url).pathname;
const mod=new Module(file);
mod.require=spec=>{
 if(spec==='@/app/server/env')return {env};
 if(spec==='@/app/server/memory-store')return memoryMod.exports;
 if(spec==='@/app/server/owner-auth')return {getOwnerUser:async()=>user};
 if(spec==='@/app/lib/trade-manager')return {parseStoredTrades:value=>JSON.parse(value).filter(item=>item.id&&item.entryPrice>0)};
 return require(spec);
};
mod._compile(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const api=mod.exports;
function request(method,body,origin='https://app.local'){
 return {nextUrl:new URL('https://app.local/api/sync?scope=workspace'),headers:new Headers({origin}),text:async()=>JSON.stringify(body)};
}
const workspace={symbol:'BTCUSDT',interval:'60',style:'DAY'};
test('Account sync rejects anonymous writes and cross-origin requests',async()=>{
 user=null;assert.equal((await api.GET(request('GET'))).status,401);
 assert.equal((await api.PUT(request('PUT',{key:'workspace',value:workspace,revision:0}))).status,401);
 user={userId:'alice'};
 assert.equal((await api.PUT(request('PUT',{key:'workspace',value:workspace,revision:0},'https://other.local'))).status,403);
});
test('Two devices cannot overwrite a shared revision, and users are isolated',async()=>{
 user={userId:'alice'};
 assert.equal((await api.PUT(request('PUT',{key:'workspace',value:workspace,revision:0}))).status,200);
 const first=await (await api.GET(request('GET'))).json();
 assert.equal(first.records[0].revision,1);
 assert.equal((await api.PUT(request('PUT',{key:'workspace',value:{...workspace,symbol:'ETHUSDT'},revision:1}))).status,200);
 assert.equal((await api.PUT(request('PUT',{key:'workspace',value:{...workspace,symbol:'SOLUSDT'},revision:1}))).status,409);
 const final=await (await api.GET(request('GET'))).json();
 assert.equal(final.records[0].value.symbol,'ETHUSDT');
 user={userId:'bob'};assert.deepEqual((await (await api.GET(request('GET'))).json()).records,[]);
 assert.equal((await api.PUT(request('PUT',{key:'workspace',value:workspace,revision:0}))).status,200);
 user={userId:'alice'};assert.equal((await (await api.GET(request('GET'))).json()).records[0].value.symbol,'ETHUSDT');
});
test('Sync rejects invalid symbols, invalid revisions and malformed records',async()=>{
 user={userId:'alice'};
 for(const body of [{key:'workspace',value:{...workspace,symbol:'bad'},revision:1},{key:'workspace',value:workspace,revision:-1},{key:'other',value:workspace,revision:0}]) assert.equal((await api.PUT(request('PUT',body))).status,400);
});

const telegramFile=new URL('../app/api/telegram/route.ts',import.meta.url).pathname;
const telegramMod=new Module(telegramFile);
telegramMod.require=spec=>{
 if(spec==='@/app/server/env')return {env};
 if(spec==='@/app/server/memory-store')return memoryMod.exports;
 if(spec==='@/app/server/owner-auth')return {getOwnerUser:async()=>user};
 if(spec==='@/app/server/telegram')return {telegramCall:async(...args)=>{telegramSent.push(args);return {};},telegramChunks:text=>[text]};
 if(spec==='@/app/lib/signal-alerts')return loadReal('app/lib/signal-alerts.ts');
 if(spec==='@/app/server/cron-auth')return {cronKey:async()=>"",cronAuthorized:async()=>false};
 if(spec.startsWith('@/')) return {};
 return require(spec);
};
const telegramSent=[];
telegramMod._compile(ts.transpileModule(readFileSync(telegramFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,telegramFile);
test('Default Telegram destination is owner-only and can be disabled persistently',async()=>{
 env.TELEGRAM_BOT_TOKEN='TEST_ONLY';env.TELEGRAM_CHAT_ID='123456';env.TELEGRAM_OWNER_EMAIL='alice@example.test';
 user={userId:'alice',email:'alice@example.test'};
 assert.equal((await (await telegramMod.exports.GET()).json()).enabled,true);
 assert.equal((await telegramMod.exports.POST(request('POST',{action:'disable'}))).status,200);
 assert.equal((await (await telegramMod.exports.GET()).json()).enabled,false);
 user={userId:'other',email:'other@example.test'};
 assert.equal((await (await telegramMod.exports.GET()).json()).chatId,'');
});
test('Monitored-pair and trade follow-ups are pushed to Telegram once per key',async()=>{
 env.TELEGRAM_BOT_TOKEN='TEST_ONLY';env.TELEGRAM_CHAT_ID='123456';env.TELEGRAM_OWNER_EMAIL='alice@example.test';
 user={userId:'alice',email:'alice@example.test'};
 await telegramMod.exports.POST(request('POST',{action:'connect',chatId:'123456'}));
 const before=telegramSent.length;
 const events=[{key:'monitor:ABCUSDT:LONG:100:95:0:AT TRIGGER',lines:['🔔 ABCUSDT LONG · AT TRIGGER','📍 Price 100.5','<b>not html</b>']},{key:'bad key',lines:['x']}];
 const first=await (await telegramMod.exports.POST(request('POST',{action:'events',events}))).json();
 assert.equal(first.sent,1,JSON.stringify(first));
 assert.equal(telegramSent.length,before+1);
 assert.match(telegramSent.at(-1)[2].text,/^<b>🔔 ABCUSDT LONG · AT TRIGGER<\/b>\n\n📍 Price <code>100.5<\/code>\n&lt;b&gt;not html&lt;\/b&gt;$/);
 const second=await (await telegramMod.exports.POST(request('POST',{action:'events',events}))).json();
 assert.equal(second.sent,0,'same key is not resent');
});
sqlite.exec(readFileSync(new URL('../drizzle/0002_sour_bloodscream.sql',import.meta.url),'utf8'));
const pollFile=new URL('../app/api/telegram/poll/route.ts',import.meta.url).pathname;
const pollMod=new Module(pollFile);const commands=[];
pollMod.require=spec=>{
 if(spec==='@/app/server/env')return {env};
 if(spec==='@/app/server/memory-store')return memoryMod.exports;
 if(spec==='@/app/server/owner-auth')return {getOwnerUser:async()=>user};
 if(spec==='@/app/server/telegram-controls')return {handleCommand:async(...args)=>commands.push(args)};
 if(spec==='@/app/server/telegram-poll'){const f=new URL('../app/server/telegram-poll.ts',import.meta.url).pathname;const pm=new Module(f);pm.require=pollMod.require;pm._compile(ts.transpileModule(readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);return pm.exports;}
 if(spec==='@/app/server/telegram')return {telegramCall:async()=>({})};
 return require(spec);
};
pollMod._compile(ts.transpileModule(readFileSync(pollFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,pollFile);
test('Telegram command processor ignores foreign chats and duplicate updates',async()=>{
 const original=globalThis.fetch;
 user={userId:'alice',email:'alice@example.test'};
 try{
  globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,result:[
   {update_id:1,message:{text:'/timeframe 2h',date:Math.floor(Date.now()/1000),chat:{id:123456},from:{id:123456}}},
   {update_id:2,message:{text:'/equity 5',date:Math.floor(Date.now()/1000),chat:{id:999999},from:{id:999999}}},
  ]})});
  assert.equal((await pollMod.exports.POST(request('POST'))).status,200);
  assert.equal(commands.length,1);
  assert.equal(commands[0][2],'/timeframe 2h');
  await pollMod.exports.POST(request('POST'));
  assert.equal(commands.length,1);
 }finally{globalThis.fetch=original;}
});

test('Telegram buttons on an old menu still process a fresh user click',async()=>{
 const original=globalThis.fetch;
 user={userId:'alice',email:'alice@example.test'};
 const before=commands.length;
 try{
  globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,result:[{update_id:3,callback_query:{id:'new-click',data:'tf:4h',from:{id:123456},message:{date:1,chat:{id:123456}}}}]})});
  assert.equal((await pollMod.exports.POST(request('POST'))).status,200);
  assert.equal(commands.length,before+1);
  assert.equal(commands.at(-1)[2],'/timeframe 4h');
 }finally{globalThis.fetch=original;}
});
