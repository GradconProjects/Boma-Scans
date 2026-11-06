import type { EntryExecutionPlan } from "@/app/lib/entry-execution";
import type { ScannerRow } from "@/app/lib/market";

export type TriggerState = "WAITING" | "AT TRIGGER" | "ENTRY RANGE" | "STOP HIT" | "NO PLAN";

export type MonitorEntry = {
  symbol: string;
  side: ScannerRow["bias"] | null;
  state: TriggerState;
  price: number | null;
  /** Signed distance from price to the trigger as % of price (negative = already through). */
  toTriggerPct: number | null;
  plan: EntryExecutionPlan | null;
  stop: number | null;
  ready: boolean;
  /** Changes whenever the plan's trigger/stop change, so a new plan can alert again. */
  planKey: string;
};

/**
 * Live-price read of a monitored pair against its scanned plan.
 *
 * "AT TRIGGER" means the live price has crossed the trigger level in the trade
 * direction; the engine still requires a CLOSED candle past it, so this is the
 * cue to watch the candle close. "ENTRY RANGE" means the plan is READY and the
 * live price sits inside the permitted limit range.
 */
export function evaluateMonitor(symbol: string, row: ScannerRow | undefined, price: number | undefined): MonitorEntry {
  if (!row) return { symbol, side: null, state: "NO PLAN", price: price ?? null, toTriggerPct: null, plan: null, stop: null, ready: false, planKey: symbol + ":none" };
  const plan = row.executionPlan;
  const planKey = [symbol, plan.side, plan.trigger, plan.stop, plan.confirmationTime ?? 0].join(":");
  if (price === undefined || !Number.isFinite(price) || price <= 0) return { symbol, side: row.bias, state: "WAITING", price: null, toTriggerPct: null, plan, stop: row.stop, ready: row.entryReady, planKey };
  const sign = plan.side === "LONG" ? 1 : -1;
  const invalidated = sign * (price - row.stop) <= 0 || ["INVALIDATED", "EXPIRED"].includes(plan.status);
  const inRange = price >= plan.entryLow && price <= plan.entryHigh;
  const crossed = sign * (price - plan.trigger) >= 0;
  const state: TriggerState = invalidated ? "STOP HIT" : row.entryReady && inRange ? "ENTRY RANGE" : crossed ? "AT TRIGGER" : "WAITING";
  return { symbol, side: row.bias, state, price, toTriggerPct: sign * (plan.trigger - price) / price * 100, plan, stop: row.stop, ready: row.entryReady, planKey };
}

export const ALERT_STATES: TriggerState[] = ["AT TRIGGER", "ENTRY RANGE"];

export function parseMonitoredSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((item): item is string => typeof item === "string" && /^[A-Z0-9]{2,24}USDT$/.test(item)))).slice(0, 40);
}
