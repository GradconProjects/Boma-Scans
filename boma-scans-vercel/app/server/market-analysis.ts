import {NextRequest} from "next/server";
import {GET as bybit} from "@/app/api/bybit/route";
import {analyzeMarket,analyzeBtcRelationship,scannerRowFromAnalysis,normalizeTicker,normalizeInstrument,contextIntervals,type Candle,type TradingStyle} from "@/app/lib/market";
import type {FlexibilityMode} from "@/app/lib/entry-policy";
import {DEFAULT_TARGET_STYLE,type TargetStyle} from "@/app/lib/target-policy";
export async function marketRead(params:Record<string,string>) {
 const response=await bybit(new NextRequest("https://internal/api/bybit?"+new URLSearchParams(params)));
 const payload=await response.json() as {error?:string;time?:number;result?:{list:unknown[]}};
 if(!response.ok || !payload.result?.list)throw new Error("Fresh Bybit analysis unavailable. No entry approved.");
 return payload;
}
// Same history depths as the browser scanner (execution 480 / context 400 /
// macro 360) so a server re-check reproduces the scanner's levels.
export async function bars(symbol:string,interval:string,limit=480) {
 const data=await marketRead({kind:"kline",symbol,interval,limit:String(limit)});
 return (data.result!.list as string[][]).map(row=>({time:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5])})).reverse() as Candle[];
}
export async function analyzePair(symbol:string,interval:string,style:TradingStyle,flexibility:FlexibilityMode,fee=0.055,slippage=0.02,targetStyle:TargetStyle=DEFAULT_TARGET_STYLE) {
 const [context,macro]=contextIntervals(interval);
 const [fast,mid,slow,btc,btcDaily,quote,instrument]=await Promise.all([bars(symbol,interval),bars(symbol,context,400),bars(symbol,macro,360),bars("BTCUSDT",interval),bars("BTCUSDT","D",360).catch(()=>[] as Candle[]),marketRead({kind:"ticker",symbol}),marketRead({kind:"instrument",symbol})]);
 if(fast.length<31 || mid.length<31 || slow.length<31 || !quote.time || Date.now()-quote.time>15000)throw new Error("Insufficient fresh history. Wait; no entry approved.");
 const ticker=normalizeTicker(quote.result!.list[0] as Record<string,unknown>);
 const analysis=analyzeMarket(fast,mid,slow,ticker,style,{flexibility,takerFeePct:fee,slippagePct:slippage,targetStyle});
 const relationship=analyzeBtcRelationship(symbol,fast,btc,analysis,btcDaily);
 const row=scannerRowFromAnalysis(ticker,analysis,false,normalizeInstrument(instrument.result!.list[0] as Record<string,unknown>),style,relationship);
 return {analysis,row,relationship,ticker};
}
