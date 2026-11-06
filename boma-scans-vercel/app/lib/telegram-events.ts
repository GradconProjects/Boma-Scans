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
export async function pushTelegramEvents(events: TelegramEvent[]) {
  if (!events.length) return;
  try {
    await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "events", events: events.slice(0, 10) }) });
  } catch { /* Telegram is optional; the dashboard already shows the event. */ }
}
