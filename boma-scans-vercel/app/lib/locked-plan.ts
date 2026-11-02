import type { Candle, MarketAnalysis } from "@/app/lib/market";

export type LockedPlan = { key: string; capturedAt: number; capturedCandleTime?: number; analysis: MarketAnalysis; invalidReason?: string };

export function lockedPlanFailure(lock: LockedPlan, price: number, candles: Candle[], now: number): string | undefined {
  if (lock.invalidReason) return lock.invalidReason;
  const plan = lock.analysis.executionPlan;
  if (now >= plan.expiresAt) return "This fixed plan expired. Cancel unfilled orders; request a new plan.";
  if (!Number.isFinite(price) || price <= 0) return undefined; // Live-data gates block entry separately.
  const long = plan.side === "LONG";
  if (long ? price <= plan.stop : price >= plan.stop) return "The fixed stop was touched. This plan is cancelled; do not re-enter it after a bounce.";
  const laterBars = candles.filter(bar => bar.time >= (lock.capturedCandleTime ?? lock.capturedAt));
  if (laterBars.some(bar => long ? bar.low <= plan.stop : bar.high >= plan.stop)) return "A later candle swept the fixed stop. Cancel this plan and wait for new structure.";
  const closed = candles.slice(0, -1).filter(bar => bar.time >= lock.capturedAt);
  if (closed.some(bar => long ? bar.close < plan.zoneLow : bar.close > plan.zoneHigh)) return "A closed candle invalidated the fixed retest zone. Cancel unfilled orders.";
  return undefined;
}

export function cancelLockedAnalysis(analysis: MarketAnalysis, reason?: string): MarketAnalysis {
  if (!reason) return analysis;
  return {...analysis, entryReady: false, decision: "NO TRADE",
    executionPlan: {...analysis.executionPlan, status: "INVALIDATED", timingReady: false, locationOkay: false, headline: "FIXED PLAN CANCELLED", reason},
    immediateEntry: {...analysis.immediateEntry, status: "AVOID"}};
}
