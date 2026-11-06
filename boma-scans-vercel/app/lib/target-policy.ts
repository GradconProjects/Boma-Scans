import type {Candle,TradingStyle,Bias} from "@/app/lib/market";
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

/**
 * Backtest-calibrated policy (2 years of Bybit trade data, Nov 2024 - Nov 2026,
 * 23 USDT perpetuals; newer listings use their full history). Rules were tuned
 * on the most recent year and confirmed on the earlier year. See
 * docs/BACKTEST-AND-SIGNAL-POLICY.md.
 *
 * - One exit method for every setup: scale out at 1R/2R/3R/4R/5R
 *   (30/25/20/15/10%). It beat the structural target map and every other
 *   ladder on the 1H timeframe in both years.
 * - Fee gate: round-trip taker fee + slippage + spread must cost at most
 *   MAX_ROUND_TRIP_COST_R of the stop distance (about a 0.5% stop at the
 *   default 0.055% fee / 0.02% slippage). Tighter stops lost money in every mode.
 * - The 1H execution timeframe leads: 5m and 15m lost money after fees and 4H
 *   showed no edge, so only 1H plans can become READY signals.
 */
export const MAX_ROUND_TRIP_COST_R = 0.3;
export const R_LADDER = [1, 2, 3, 4, 5];
export const R_LADDER_WEIGHTS = [30, 25, 20, 15, 10];
export const SIGNAL_INTERVAL_MS = 3_600_000;

/**
 * Target style.
 *  - "TA": each of the five targets snaps to real chart structure (swing and
 *    liquidity levels, volume nodes, anchored VWAP bands, Fibonacci extensions,
 *    measured moves, candle projections) nearest to a desired distance ladder,
 *    preferring the nearer level so targets are reachable; an R multiple is
 *    used only where no structure exists in the window.
 *  - "LADDER": fixed 1R/2R/3R/4R/5R.
 * Exit weights are the same for both.
 */
export type TargetStyle = "TA" | "LADDER";
export const DEFAULT_TARGET_STYLE: TargetStyle = "TA";
/** Desired distances (in R) that TA targets are matched against, and the window around each. */
export const TA_DESIRED_R = [0.9, 1.6, 2.5, 3.5, 5];
export const TA_WINDOW = { low: 0.55, high: 1.45 };
