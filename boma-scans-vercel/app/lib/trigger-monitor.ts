import type { EntryExecutionPlan } from "@/app/lib/entry-execution";
import type { ScannerRow } from "@/app/lib/market";

export type TriggerState = "WAITING" | "AT TRIGGER" | "ENTRY RANGE" | "PAST ENTRY" | "STOP HIT" | "NO PLAN";

export type MonitorEntry = {
  symbol: string;
  side: ScannerRow["bias"] | null;
  state: TriggerState;
  price: number | null;
  /** Signed distance from price to the trigger as % of price (negative = already through). */
  toTriggerPct: number | null;
  plan: EntryExecutionPlan | null;
  stop: number | null;
  targets: Array<{ price: number; available: boolean }>;
  ready: boolean;
  /** Changes whenever the plan's trigger/stop change, so a new plan can alert again. */
  planKey: string;
};

/**
 * Live-price read of a monitored pair against its scanned plan.
 *
 * "AT TRIGGER" means the live price has crossed the trigger level in the trade
 * direction; the engine still requires a CLOSED candle past it, so this is the
 * cue to watch the candle close. "ENTRY RANGE" means the plan is READY and a
 * limit order at the entry level would fill now: price at or below the level
 * for a long (at or above for a short) while the zone still holds. "PAST
 * ENTRY" means price already ran beyond the level in the trade direction, so
 * wait for it to come back rather than chase.
 */
export function evaluateMonitor(symbol: string, row: ScannerRow | undefined, price: number | undefined): MonitorEntry {
  if (!row) return { symbol, side: null, state: "NO PLAN", price: price ?? null, toTriggerPct: null, plan: null, stop: null, targets: [], ready: false, planKey: symbol + ":none" };
  const targets = (row.takeProfits ?? []).map(target => ({ price: target.price, available: target.available }));
  const plan = row.executionPlan;
  const planKey = [symbol, plan.side, plan.trigger, plan.stop, plan.confirmationTime ?? 0].join(":");
  if (price === undefined || !Number.isFinite(price) || price <= 0) return { symbol, side: row.bias, state: "WAITING", price: null, toTriggerPct: null, plan, stop: row.stop, targets, ready: row.entryReady, planKey };
  const sign = plan.side === "LONG" ? 1 : -1;
  const invalidated = sign * (price - row.stop) <= 0 || ["INVALIDATED", "EXPIRED"].includes(plan.status);
  const tolerance = plan.entry * 0.0005;
  const fillable = sign > 0 ? price <= plan.entry + tolerance && price >= plan.zoneLow : price >= plan.entry - tolerance && price <= plan.zoneHigh;
  const pastLevel = sign * (price - plan.entry) > tolerance;
  const crossed = sign * (price - plan.trigger) >= 0;
  const state: TriggerState = invalidated ? "STOP HIT" : row.entryReady && fillable ? "ENTRY RANGE" : row.entryReady && pastLevel ? "PAST ENTRY" : crossed ? "AT TRIGGER" : "WAITING";
  return { symbol, side: row.bias, state, price, toTriggerPct: sign * (plan.trigger - price) / price * 100, plan, stop: row.stop, targets, ready: row.entryReady, planKey };
}

export const ALERT_STATES: TriggerState[] = ["AT TRIGGER", "ENTRY RANGE"];

/** Levels locked when a monitored pair reaches its entry range; exits are then tracked against them. */
export type ArmedPlan = {
  symbol: string; side: ScannerRow["bias"]; planKey: string; entry: number; stop: number;
  targets: number[]; weights: number[]; hit: number; armedAt: number;
};
export type ExitEvent = { kind: "TARGET"; symbol: string; level: number; price: number; exitPct: number; plan: ArmedPlan } | { kind: "STOP"; symbol: string; price: number; plan: ArmedPlan };

export function armPlan(row: ScannerRow, now = Date.now()): ArmedPlan {
  const plan = row.executionPlan;
  return { symbol: row.symbol, side: row.bias, planKey: [row.symbol, plan.side, plan.trigger, plan.stop, plan.confirmationTime ?? 0].join(":"), entry: plan.entry, stop: row.stop,
    targets: row.takeProfits.map(target => target.price), weights: row.takeProfits.map(target => target.exitPct), hit: 0, armedAt: now };
}

/** Exit events for a live price; returns the updated plan (null once the stop is hit or every target is done). */
export function checkExits(plan: ArmedPlan, price: number): { events: ExitEvent[]; next: ArmedPlan | null } {
  const sign = plan.side === "LONG" ? 1 : -1;
  const events: ExitEvent[] = [];
  if (sign * (price - plan.stop) <= 0) return { events: [{ kind: "STOP", symbol: plan.symbol, price, plan }], next: null };
  let hit = plan.hit;
  while (hit < plan.targets.length && sign * (price - plan.targets[hit]) >= 0) { events.push({ kind: "TARGET", symbol: plan.symbol, level: hit + 1, price, exitPct: plan.weights[hit] ?? 0, plan }); hit++; }
  const next = hit >= plan.targets.length ? null : { ...plan, hit };
  return { events, next };
}

export function parseArmedPlans(raw: unknown): ArmedPlan[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ArmedPlan => !!item && typeof item === "object" && typeof item.symbol === "string" && (item.side === "LONG" || item.side === "SHORT") &&
    Number.isFinite(item.entry) && Number.isFinite(item.stop) && Array.isArray(item.targets) && item.targets.every((n: unknown) => Number.isFinite(n)) && Number.isInteger(item.hit)).slice(0, 40);
}

export function parseMonitoredSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((item): item is string => typeof item === "string" && /^[A-Z0-9]{2,24}USDT$/.test(item)))).slice(0, 40);
}
