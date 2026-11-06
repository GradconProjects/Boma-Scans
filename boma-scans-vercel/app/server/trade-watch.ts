import { createTrackedTrade, evaluateTrade } from "@/app/lib/trade-manager";
import type { MarketAnalysis, ScannerRow } from "@/app/lib/market";
import type { ArmedPlan } from "@/app/lib/trigger-monitor";
import { formatAdviceEvent, type TelegramEvent } from "@/app/lib/telegram-events";

/**
 * Structure-based "leave / protect" advice for a plan the owner is in: the
 * engine's trade manager judges the fresh analysis against the position
 * (bias flipped, break of structure against the trade, volatility, runner
 * rule) and the result is pushed once per action and level.
 */
export function structureAdvice(plan: ArmedPlan, analysis: MarketAnalysis, row: ScannerRow, now = Date.now()): TelegramEvent[] {
  const [tp1, tp2, tp3, tp4, tp5] = [0, 1, 2, 3, 4].map(index => plan.targets[index] ?? plan.targets[plan.targets.length - 1]);
  const trade = {
    ...createTrackedTrade({ symbol: plan.symbol, side: plan.side, mode: "PAPER", style: plan.style ?? row.style, entryPrice: plan.entry, quantity: 1, leverage: 1, stop: plan.stop, tp1, tp2, tp3, tp4, tp5, atrAtEntry: row.atrPct / 100 * plan.entry, openedAt: plan.armedAt, targetWeights: plan.weights }),
    tp1Taken: plan.hit >= 1, tp2Taken: plan.hit >= 2, tp3Taken: plan.hit >= 3, tp4Taken: plan.hit >= 4, tp2TakenAt: plan.tp2At,
  };
  const snapshot = evaluateTrade(trade, row.price, now, analysis, now, row.price);
  if (snapshot.stale) return [];
  if (snapshot.action === "REDUCE / EXIT" || snapshot.action === "CLOSE REMAINDER") return [formatAdviceEvent(plan, snapshot.action, snapshot.headline, snapshot.detail, row.price, snapshot.rMultiple)];
  if (snapshot.action === "PROTECT PROFIT") return [formatAdviceEvent(plan, snapshot.action, snapshot.headline, snapshot.detail, row.price, snapshot.rMultiple, snapshot.suggestedStop)];
  return [];
}
