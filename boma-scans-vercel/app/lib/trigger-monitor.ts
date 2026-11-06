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
  /** When target 2 was hit (runner rule); whether the owner confirmed the entry. */
  tp2At?: number; confirmed?: boolean; style?: ScannerRow["style"];
};
export type ExitEvent =
  | { kind: "TARGET"; symbol: string; level: number; price: number; exitPct: number; plan: ArmedPlan }
  | { kind: "STOP"; symbol: string; price: number; plan: ArmedPlan }
  | { kind: "CLOSE"; symbol: string; price: number; reason: string; plan: ArmedPlan };
/** Runner timeout after target 2 and maximum hold, per style (minutes). */
export const RUNNER_MINUTES: Record<ScannerRow["style"], number> = { SCALP: 15, DAY: 120, SWING: 720, POSITION: 1440 };
export const MAX_HOLD_MINUTES: Record<ScannerRow["style"], number> = { SCALP: 180, DAY: 4320, SWING: 10080, POSITION: 20160 };

export function armPlan(row: ScannerRow, now = Date.now()): ArmedPlan {
  const plan = row.executionPlan;
  return { symbol: row.symbol, side: row.bias, planKey: [row.symbol, plan.side, plan.trigger, plan.stop, plan.confirmationTime ?? 0].join(":"), entry: plan.entry, stop: row.stop,
    targets: row.takeProfits.map(target => target.price), weights: row.takeProfits.map(target => target.exitPct), hit: 0, armedAt: now, style: row.style };
}

/** Exit events for a live price; returns the updated plan (null once the stop is hit or every target is done). */
export function checkExits(plan: ArmedPlan, price: number, now = Date.now()): { events: ExitEvent[]; next: ArmedPlan | null } {
  const sign = plan.side === "LONG" ? 1 : -1;
  const events: ExitEvent[] = [];
  if (sign * (price - plan.stop) <= 0) return { events: [{ kind: "STOP", symbol: plan.symbol, price, plan }], next: null };
  let hit = plan.hit; let tp2At = plan.tp2At;
  while (hit < plan.targets.length && sign * (price - plan.targets[hit]) >= 0) { events.push({ kind: "TARGET", symbol: plan.symbol, level: hit + 1, price, exitPct: plan.weights[hit] ?? 0, plan }); hit++; if (hit === 2) tp2At = now; }
  if (hit >= plan.targets.length) return { events, next: null };
  const style = plan.style ?? "DAY";
  // Runner rule: after target 2, leave if price returns to target 1 or the runner times out.
  if (hit >= 2 && hit < 3 && tp2At !== undefined && (sign * (price - plan.targets[0]) <= 0 || now - tp2At >= RUNNER_MINUTES[style] * 60_000)) {
    events.push({ kind: "CLOSE", symbol: plan.symbol, price, reason: sign * (price - plan.targets[0]) <= 0 ? "price returned to target 1 after target 2" : "runner timed out " + RUNNER_MINUTES[style] + " min after target 2", plan });
    return { events, next: null };
  }
  if (now - plan.armedAt >= MAX_HOLD_MINUTES[style] * 60_000) {
    events.push({ kind: "CLOSE", symbol: plan.symbol, price, reason: "maximum hold time reached (" + Math.round(MAX_HOLD_MINUTES[style] / 60) + "h)", plan });
    return { events, next: null };
  }
  return { events, next: { ...plan, hit, tp2At } };
}

export function parseArmedPlans(raw: unknown): ArmedPlan[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ArmedPlan => !!item && typeof item === "object" && typeof item.symbol === "string" && (item.side === "LONG" || item.side === "SHORT") &&
    Number.isFinite(item.entry) && Number.isFinite(item.stop) && Array.isArray(item.targets) && item.targets.every((n: unknown) => Number.isFinite(n)) && Number.isInteger(item.hit)).slice(0, 40);
}

/** Per-symbol memory of what has already been reported; serialisable so the server can keep it in the database. */
export type MonitorMemory = {
  alerted?: { state: TriggerState; at: number };
  stopReported?: boolean;
  seen?: { planKey: string; ready: boolean; status: string };
  armed?: ArmedPlan | null;
  /** Plan the owner said they skipped: it is not armed automatically. */
  skipped?: string;
};
export type MonitorUpdateKind = "CONFIRMED" | "PLAN UPDATED" | "EXPIRED";
export type MonitorTransition = {
  memory: MonitorMemory;
  alert: boolean;
  followUp: boolean;
  updates: MonitorUpdateKind[];
  exits: ExitEvent[];
};
const RANK: Record<TriggerState, number> = { "NO PLAN": 0, WAITING: 0, "STOP HIT": 0, "PAST ENTRY": 0, "AT TRIGGER": 1, "ENTRY RANGE": 2 };
export const REALERT_MS = 15 * 60_000;

/** One monitoring step: compares the live entry with what was already reported and returns what to announce. */
export function transitionMonitor(previous: MonitorMemory, entry: MonitorEntry, row: ScannerRow | undefined, now = Date.now()): MonitorTransition {
  const memory: MonitorMemory = { ...previous };
  let alert = false, followUp = false;
  const updates: MonitorUpdateKind[] = [];
  if (ALERT_STATES.includes(entry.state)) {
    const last = memory.alerted;
    if (!last || RANK[entry.state] > RANK[last.state] || now - last.at >= REALERT_MS) { memory.alerted = { state: entry.state, at: now }; alert = true; }
  }
  if (entry.state === "STOP HIT" && entry.plan && !memory.stopReported) { memory.stopReported = true; followUp = true; }
  const status = entry.plan?.status ?? "NONE";
  if (memory.seen && entry.plan) {
    if (memory.seen.planKey !== entry.planKey && !memory.seen.planKey.endsWith(":none")) { updates.push("PLAN UPDATED"); memory.alerted = undefined; memory.stopReported = false; }
    else if (!memory.seen.ready && entry.ready) updates.push("CONFIRMED");
    if (status === "EXPIRED" && memory.seen.status !== "EXPIRED") updates.push("EXPIRED");
  }
  memory.seen = { planKey: entry.planKey, ready: entry.ready, status };
  // Entry → exit tracking.
  if (entry.state === "ENTRY RANGE" && !memory.armed && row && memory.skipped !== entry.planKey) memory.armed = armPlan(row, now);
  const exits: ExitEvent[] = [];
  if (memory.armed && entry.price !== null) {
    const result = checkExits(memory.armed, entry.price, now);
    exits.push(...result.events);
    memory.armed = result.next;
  }
  return { memory, alert, followUp, updates, exits };
}

export function parseMonitoredSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((item): item is string => typeof item === "string" && /^[A-Z0-9]{2,24}USDT$/.test(item)))).slice(0, 40);
}
