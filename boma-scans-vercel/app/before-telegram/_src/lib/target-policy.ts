import type {Candle,TradingStyle,Bias} from "@/app/before-telegram/_src/lib/market";
export const TARGET_EXIT_WEIGHTS=[40,35,15,5,5];
export const MIN_WEIGHTED_REWARD_R=1.2;
export function targetBudget(candles:Candle[],side:Bias,atr:number,style:TradingStyle) {
 const horizon={SCALP:6,DAY:8,SWING:12,POSITION:20}[style];
 const cap={SCALP:2,DAY:3.5,SWING:5,POSITION:8}[style]*atr;
 const moves:number[]=[];
 const sample=candles.slice(-240);
 for(let i=0;i+horizon<sample.length;i++) {
  const later=sample.slice(i+1,i+horizon+1);
  const move=side==="LONG"?Math.max(...later.map(bar=>bar.high))-sample[i].close:sample[i].close-Math.min(...later.map(bar=>bar.low));
  if(move>0)moves.push(move);
 }
 moves.sort((a,b)=>a-b);
 // Historical excursion is a distance bound, never a probability of a future fill.
 const observed=moves[Math.floor(moves.length*.65)]??cap;
 return {distance:Math.max(atr*.65,Math.min(cap,observed)),horizon};
}
