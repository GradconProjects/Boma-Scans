import { formatPrice } from "@/app/lib/market";
import { appLink, compactSignalLines } from "@/app/lib/signal-alerts";
import type { ExitEvent, MonitorEntry } from "@/app/lib/trigger-monitor";
import type { TrackedTrade, TradeSnapshot } from "@/app/lib/trade-manager";

/** A follow-up message for Telegram. `key` de-duplicates across devices and reloads. */
export type TelegramButton = { text: string; data: string };
export type TelegramEvent = { key: string; lines: string[]; symbol?: string; buttons?: TelegramButton[] };

/** Buttons under every signal: record the entry (plan price or your own fill), prioritise the pair, re-analyse. */
export function signalButtons(symbol: string): TelegramButton[] {
  return [
    { text: "✅ Entered at plan price", data: "entered:" + symbol }, { text: "✏️ Entered at…", data: "enterat:" + symbol },
    { text: "👀 Monitor & prioritise", data: "monitor:" + symbol }, { text: "📊 Re-analyse", data: "analyse:" + symbol },
  ];
}
/** Telegram inline keyboard rows of two. */
export function keyboardRows(buttons: TelegramButton[]) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2).map(button => ({ text: button.text, callback_data: button.data })));
  return { inline_keyboard: rows };
}

function card(entry: MonitorEntry) {
  const plan = entry.plan;
  if (!plan || !entry.side) return [] as string[];
  return compactSignalLines({ symbol: entry.symbol, side: entry.side, entryLow: plan.entryLow, entryHigh: plan.entryHigh, entry: plan.entry, trigger: plan.trigger, timeframe: plan.timeframe, stop: entry.stop ?? plan.stop, targets: entry.targets, expiresAt: plan.expiresAt, zoneLow: plan.zoneLow, zoneHigh: plan.zoneHigh });
}

const FOLLOW_UP_ACTIONS: TradeSnapshot["action"][] = ["TAKE PARTIAL", "CLOSE REMAINDER", "EXIT NOW", "REDUCE / EXIT", "PROTECT PROFIT"];

export function formatMonitorEvent(entry: MonitorEntry): TelegramEvent | null {
  const plan = entry.plan;
  if (!plan || !entry.side || entry.price === null) return null;
  const long = entry.side === "LONG";
  const head = "🔔 " + entry.symbol + " " + entry.side + " · " + entry.state;
  const levels = ["📍 Price " + formatPrice(entry.price), "", ...card(entry), ""];
  const instruction =
    entry.state === "ENTRY RANGE" ? "✅ Plan is READY and price is inside the entry range. Place the limit at the entry price or better; cancel it if the dashboard drops READY or the plan expires."
    : entry.state === "AT TRIGGER" ? "⏳ Price crossed the trigger. Wait for the " + plan.timeframe + " candle to CLOSE " + (long ? "above" : "below") + " it and for the dashboard to show READY. Do not buy the wick."
    : entry.state === "STOP HIT" ? "⛔ Plan invalidated: price reached the stop side before entry. Cancel any resting order and wait for a fresh plan."
    : entry.state === "PAST ENTRY" ? "⏸ Price ran past the entry level. Keep the limit at the level and wait for a pullback; do not chase."
    : "";
  const buttons = entry.state === "ENTRY RANGE" ? [{ text: "✅ Entered at plan price", data: "entered:" + entry.symbol }, { text: "✏️ Entered at…", data: "enterat:" + entry.symbol }, { text: "❌ Skipped", data: "skipped:" + entry.symbol }, { text: "📊 Re-analyse", data: "analyse:" + entry.symbol }] : undefined;
  return { key: "monitor:" + entry.planKey + ":" + entry.state, symbol: entry.symbol, lines: [head, ...levels, instruction, ...(buttons ? ["Tap Entered so exits are tracked from your fill, or Skipped to stop following this plan."] : [])], buttons };
}

export type MonitorUpdateKind = "CONFIRMED" | "PLAN UPDATED" | "EXPIRED";

/** Ongoing updates while a pair is monitored. */
export function formatMonitorUpdate(entry: MonitorEntry, kind: MonitorUpdateKind): TelegramEvent {
  const levels = entry.plan ? ["", ...card(entry), ""] : [];
  const head = kind === "CONFIRMED" ? "✅ " + entry.symbol + " " + (entry.side ?? "") + " · CONFIRMED: candle closed, plan READY"
    : kind === "PLAN UPDATED" ? "🔄 " + entry.symbol + " " + (entry.side ?? "") + " · PLAN UPDATED after rescan"
    : "⌛ " + entry.symbol + " " + (entry.side ?? "") + " · PLAN EXPIRED";
  const note = kind === "CONFIRMED" ? "Enter only while the live price stays inside the entry range; place the limit at the entry price or better."
    : kind === "PLAN UPDATED" ? "New levels replace the earlier ones. Cancel any resting order placed on the old plan."
    : "The entry window closed without a fill. Nothing to do; a fresh plan will be sent if the pair qualifies again.";
  return { key: "monitor:" + entry.planKey + ":" + kind, symbol: entry.symbol, lines: [head, "📍 Price " + (entry.price !== null ? formatPrice(entry.price) : "—"), ...levels, note] };
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
  return { key: "monitor:digest:" + hour, lines: ["🕐 Monitoring update · " + entries.length + " pair" + (entries.length === 1 ? "" : "s"), ...lines, "Sent hourly. Alerts for trigger, entry range, confirmation, targets and stop arrive as they happen."] };
}

/** Confirmation sent when a pair is added to monitoring (or on "send levels now"). */
export function formatMonitorStart(entry: MonitorEntry, now = Date.now()): TelegramEvent {
  const plan = entry.plan;
  const stamp = Math.floor(now / 60_000);
  if (!plan || !entry.side) return { key: "monitor:" + entry.symbol + ":start:" + stamp, symbol: entry.symbol, lines: ["👀 Monitoring " + entry.symbol, "No scanned plan yet for this pair; levels follow after the next scan. You will be told when price reaches the trigger or entry range."] };
  return { key: "monitor:" + entry.planKey + ":start:" + stamp, symbol: entry.symbol, lines: [
    "👀 Monitoring " + entry.symbol + " " + entry.side + " · " + entry.state,
    "📍 Price " + (entry.price !== null ? formatPrice(entry.price) : "—") + (entry.toTriggerPct !== null ? " · " + (entry.toTriggerPct > 0 ? "+" : "") + entry.toTriggerPct.toFixed(2) + "% to trigger" : ""),
    "", ...card(entry), "",
    "Alerts follow at the trigger, the entry range, each target and the stop.",
  ] };
}

/** Exit pushes for a monitored pair after it entered: target hit (with the % to close) or stop hit. */
export function formatExitEvent(event: ExitEvent): TelegramEvent {
  const plan = event.plan; const sign = plan.side === "LONG" ? 1 : -1;
  const risk = Math.max(Math.abs(plan.entry - plan.stop), plan.entry * 0.0001);
  const r = (price: number) => (sign * (price - plan.entry) / risk).toFixed(1) + "R";
  const pct = (price: number) => (sign * (price - plan.entry) / plan.entry * 100).toFixed(2) + "%";
  if (event.kind === "CLOSE") return { key: "exit:" + plan.planKey + ":CLOSE", symbol: plan.symbol, lines: [
    "🚪 " + plan.symbol + " " + plan.side + " · LEAVE THE TRADE",
    "📍 Price " + formatPrice(event.price) + " · " + r(event.price) + " · " + pct(event.price),
    "Reason: " + event.reason + ".",
    "Close the remaining position now; do not wait for the later targets.",
  ] };
  if (event.kind === "STOP") return { key: "exit:" + plan.planKey + ":STOP", symbol: plan.symbol, lines: [
    "❌ " + plan.symbol + " " + plan.side + " · STOP HIT " + formatPrice(plan.stop),
    "📍 Price " + formatPrice(event.price) + " · " + r(event.price) + " · " + pct(event.price),
    "Close the remaining position now. Do not re-enter on this plan.",
  ] };
  const remaining = Math.max(0, 100 - plan.weights.slice(0, event.level).reduce((a, b) => a + b, 0));
  const nextTarget = plan.targets[event.level];
  return { key: "exit:" + plan.planKey + ":TP" + event.level, symbol: plan.symbol, lines: [
    "🎯 " + plan.symbol + " " + plan.side + " · TARGET " + event.level + " HIT " + formatPrice(plan.targets[event.level - 1]),
    "📍 Price " + formatPrice(event.price) + " · " + r(event.price) + " · " + pct(event.price),
    "✅ Close " + event.exitPct + "% now · " + remaining + "% remaining",
    nextTarget !== undefined ? "➡️ Next: Target " + (event.level + 1) + " " + formatPrice(nextTarget) + " · stop stays " + formatPrice(plan.stop) : "🏁 All targets done; close any remainder.",
  ] };
}

/** Structure-based advice for a monitored trade from the engine's trade manager (leave, close remainder, protect). */
export function formatAdviceEvent(plan: { symbol: string; side: "LONG" | "SHORT"; planKey: string; entry: number; stop: number }, action: string, headline: string, detail: string, price: number, rMultiple: number, suggestedStop?: number): TelegramEvent {
  const leave = action === "REDUCE / EXIT" || action === "EXIT NOW" || action === "CLOSE REMAINDER";
  const key = "advice:" + plan.planKey + ":" + action + (suggestedStop ? ":" + formatPrice(suggestedStop) : "");
  return { key, symbol: plan.symbol, lines: [
    (leave ? "🚪 " : "🛡 ") + plan.symbol + " " + plan.side + " · " + (leave ? "LEAVE THE TRADE" : "PROTECT PROFIT"),
    "📍 Price " + formatPrice(price) + " · " + (rMultiple >= 0 ? "+" : "") + rMultiple.toFixed(1) + "R",
    headline,
    detail,
    ...(suggestedStop ? ["🛑 Move stop to " + formatPrice(suggestedStop) + " (was " + formatPrice(plan.stop) + ")"] : []),
  ] };
}

export function formatTradeEvent(trade: TrackedTrade, snapshot: TradeSnapshot): TelegramEvent | null {
  if (!FOLLOW_UP_ACTIONS.includes(snapshot.action)) return null;
  const key = "trade:" + trade.id + ":" + snapshot.action + ":" + (snapshot.exitLevel ?? 0);
  const icon = snapshot.severity === "critical" ? "🚨" : snapshot.severity === "positive" ? "✅" : "⚠️";
  return { key, symbol: trade.symbol, lines: [
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
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const withLinks = events.slice(0, 10).map(event => origin && event.symbol ? { ...event, lines: [...event.lines, "🔗 Open in app: " + appLink(origin, event.symbol)] } : event);
  try {
    const response = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "events", events: withLinks }) });
    const body = await response.json() as { sent?: number; message?: string; error?: string };
    if (!response.ok) return body.error ?? "Telegram delivery failed.";
    return body.sent ? "Sent " + body.sent + " message" + (body.sent === 1 ? "" : "s") + " to Telegram." : body.message ?? "Telegram is not connected.";
  } catch { return "Telegram delivery failed (network)."; }
}
