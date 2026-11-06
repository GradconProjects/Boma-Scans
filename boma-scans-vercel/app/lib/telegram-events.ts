import { formatPrice } from "@/app/lib/market";
import type { MonitorEntry } from "@/app/lib/trigger-monitor";
import type { TrackedTrade, TradeSnapshot } from "@/app/lib/trade-manager";

/** A follow-up message for Telegram. `key` de-duplicates across devices and reloads. */
export type TelegramEvent = { key: string; lines: string[] };

const FOLLOW_UP_ACTIONS: TradeSnapshot["action"][] = ["TAKE PARTIAL", "CLOSE REMAINDER", "EXIT NOW", "REDUCE / EXIT", "PROTECT PROFIT"];

export function formatMonitorEvent(entry: MonitorEntry): TelegramEvent | null {
  const plan = entry.plan;
  if (!plan || !entry.side || entry.price === null) return null;
  const long = entry.side === "LONG";
  const head = "🔔 " + entry.symbol + " " + entry.side + " · " + entry.state;
  const levels = [
    "📍 Price " + formatPrice(entry.price),
    "🎯 Trigger " + formatPrice(plan.trigger) + " (" + (long ? "close above" : "close below") + ", " + plan.timeframe + ")",
    "📥 Entry range " + formatPrice(plan.entryLow) + " – " + formatPrice(plan.entryHigh) + " · " + (long ? "BUY" : "SELL") + " LIMIT " + formatPrice(plan.entry),
    "🛑 Stop " + (entry.stop !== null ? formatPrice(entry.stop) : "—"),
  ];
  const instruction =
    entry.state === "ENTRY RANGE" ? "✅ Plan is READY and price is inside the entry range. Place the limit at the entry price or better; cancel it if the dashboard drops READY or the plan expires."
    : entry.state === "AT TRIGGER" ? "⏳ Price crossed the trigger. Wait for the " + plan.timeframe + " candle to CLOSE " + (long ? "above" : "below") + " it and for the dashboard to show READY. Do not buy the wick."
    : entry.state === "STOP HIT" ? "⛔ Plan invalidated: price reached the stop side before entry. Cancel any resting order and wait for a fresh plan."
    : "";
  return { key: "monitor:" + entry.planKey + ":" + entry.state, lines: [head, ...levels, instruction, "Monitored pair · " + plan.zoneSource + " · " + (long ? "long" : "short") + " plan. Advisory only; no order is placed."] };
}

export type MonitorUpdateKind = "CONFIRMED" | "PLAN UPDATED" | "EXPIRED";

/** Ongoing updates while a pair is monitored. */
export function formatMonitorUpdate(entry: MonitorEntry, kind: MonitorUpdateKind): TelegramEvent {
  const plan = entry.plan; const long = entry.side === "LONG";
  const levels = plan ? [
    "🎯 Trigger " + formatPrice(plan.trigger) + " (" + (long ? "close above" : "close below") + ", " + plan.timeframe + ")",
    "📥 Entry range " + formatPrice(plan.entryLow) + " – " + formatPrice(plan.entryHigh) + " · " + (long ? "BUY" : "SELL") + " LIMIT " + formatPrice(plan.entry),
    "🛑 Stop " + (entry.stop !== null ? formatPrice(entry.stop) : "—"),
  ] : [];
  const head = kind === "CONFIRMED" ? "✅ " + entry.symbol + " " + (entry.side ?? "") + " · CONFIRMED: candle closed, plan READY"
    : kind === "PLAN UPDATED" ? "🔄 " + entry.symbol + " " + (entry.side ?? "") + " · PLAN UPDATED after rescan"
    : "⌛ " + entry.symbol + " " + (entry.side ?? "") + " · PLAN EXPIRED";
  const note = kind === "CONFIRMED" ? "Enter only while the live price stays inside the entry range; place the limit at the entry price or better."
    : kind === "PLAN UPDATED" ? "New levels replace the earlier ones. Cancel any resting order placed on the old plan."
    : "The entry window closed without a fill. Nothing to do; a fresh plan will be sent if the pair qualifies again.";
  return { key: "monitor:" + entry.planKey + ":" + kind, lines: [head, "📍 Price " + (entry.price !== null ? formatPrice(entry.price) : "—"), ...levels, note] };
}

/** One message per hour summarising every monitored pair. */
export function formatMonitorDigest(entries: MonitorEntry[], now = Date.now()): TelegramEvent | null {
  if (!entries.length) return null;
  const hour = Math.floor(now / 3_600_000);
  const lines = entries.map(entry => {
    const plan = entry.plan;
    if (!plan || entry.price === null) return "• " + entry.symbol + " · " + entry.state.toLowerCase();
    return "• " + entry.symbol + " " + entry.side + " · " + entry.state + " · price " + formatPrice(entry.price) + " · trigger " + formatPrice(plan.trigger) + (entry.toTriggerPct !== null ? " (" + (entry.toTriggerPct > 0 ? "+" : "") + entry.toTriggerPct.toFixed(2) + "%)" : "") + " · stop " + (entry.stop !== null ? formatPrice(entry.stop) : "—");
  });
  return { key: "monitor:digest:" + hour, lines: ["🕐 Monitoring update · " + entries.length + " pair" + (entries.length === 1 ? "" : "s"), ...lines, "Sent hourly while the dashboard is open. Alerts for trigger, entry range, confirmation and stop arrive as they happen."] };
}

/** Confirmation sent when a pair is added to monitoring (or on "send levels now"). */
export function formatMonitorStart(entry: MonitorEntry, now = Date.now()): TelegramEvent {
  const plan = entry.plan;
  const stamp = Math.floor(now / 60_000);
  if (!plan || !entry.side) return { key: "monitor:" + entry.symbol + ":start:" + stamp, lines: ["👀 Monitoring " + entry.symbol, "No scanned plan yet for this pair; levels follow after the next scan. You will be told when price reaches the trigger or entry range."] };
  const long = entry.side === "LONG";
  return { key: "monitor:" + entry.planKey + ":start:" + stamp, lines: [
    "👀 Monitoring " + entry.symbol + " " + entry.side + " · " + entry.state,
    "📍 Price " + (entry.price !== null ? formatPrice(entry.price) : "—") + (entry.toTriggerPct !== null ? " · " + (entry.toTriggerPct > 0 ? "+" : "") + entry.toTriggerPct.toFixed(2) + "% to trigger" : ""),
    "🎯 Trigger " + formatPrice(plan.trigger) + " (" + (long ? "close above" : "close below") + ", " + plan.timeframe + ")",
    "📥 Entry range " + formatPrice(plan.entryLow) + " – " + formatPrice(plan.entryHigh) + " · " + (long ? "BUY" : "SELL") + " LIMIT " + formatPrice(plan.entry),
    "🛑 Stop " + (entry.stop !== null ? formatPrice(entry.stop) : "—"),
    "You will be messaged when price reaches the trigger or the entry range, and if the stop side is hit first. " + plan.zoneSource + " · " + (entry.ready ? "plan READY" : "waiting for confirmation") + ".",
  ] };
}

export function formatTradeEvent(trade: TrackedTrade, snapshot: TradeSnapshot): TelegramEvent | null {
  if (!FOLLOW_UP_ACTIONS.includes(snapshot.action)) return null;
  const key = "trade:" + trade.id + ":" + snapshot.action + ":" + (snapshot.exitLevel ?? 0);
  const icon = snapshot.severity === "critical" ? "🚨" : snapshot.severity === "positive" ? "✅" : "⚠️";
  return { key, lines: [
    icon + " " + trade.symbol + " " + trade.side + " · " + snapshot.action + (snapshot.exitLevel ? " TP" + snapshot.exitLevel : ""),
    snapshot.headline,
    snapshot.detail,
    "📍 Price " + formatPrice(snapshot.currentPrice) + " · " + (snapshot.rMultiple >= 0 ? "+" : "") + snapshot.rMultiple.toFixed(2) + "R · stop " + formatPrice(trade.stop),
    "Tracked " + trade.mode.toLowerCase() + " trade. Confirm fills on Bybit; the app places no orders.",
  ] };
}

/** Fire-and-forget delivery. The server de-duplicates by key and needs a signed-in owner with Telegram enabled. */
export async function pushTelegramEvents(events: TelegramEvent[]): Promise<string> {
  if (!events.length) return "Nothing to send.";
  try {
    const response = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "events", events: events.slice(0, 10) }) });
    const body = await response.json() as { sent?: number; message?: string; error?: string };
    if (!response.ok) return body.error ?? "Telegram delivery failed.";
    return body.sent ? "Sent " + body.sent + " message" + (body.sent === 1 ? "" : "s") + " to Telegram." : body.message ?? "Telegram is not connected.";
  } catch { return "Telegram delivery failed (network)."; }
}
