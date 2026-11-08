import { type ScannerRow, formatPrice } from "@/app/lib/market";
import { appLink, compactSignalLines } from "@/app/lib/signal-alerts";
import { entryCall, type ExitEvent, type MonitorEntry } from "@/app/lib/trigger-monitor";
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
/**
 * A setup that passed the trend, regime and quality gates but is still
 * waiting for price to return to its zone and close through the trigger.
 * Sent once per plan so the owner can watch it before it becomes a signal.
 */
export function formatFormingSetup(row: ScannerRow, now = Date.now()): TelegramEvent {
  const plan = row.executionPlan;
  const long = row.bias === "LONG";
  const lines = compactSignalLines({ symbol: row.symbol, side: row.bias, entryLow: plan.entryLow, entryHigh: plan.entryHigh, entry: plan.entry, trigger: plan.trigger, timeframe: plan.timeframe, stop: row.stop, targets: row.takeProfits.map(t => ({ price: t.price, available: t.available })), expiresAt: plan.expiresAt, zoneLow: plan.zoneLow, zoneHigh: plan.zoneHigh, keyLevels: row.keyLevels?.summary, call: entryCall(row, row.price).line });
  const toTrigger = (plan.trigger - row.price) / row.price * 100;
  return { key: "forming:" + row.symbol + ":" + [plan.side, plan.trigger, row.stop].join(":") + ":" + Math.floor(now / (6 * 3_600_000)), symbol: row.symbol, lines: [
    "📋 SETUP FORMING · " + row.symbol + " " + row.bias + " · " + row.setupType,
    "📍 Price " + formatPrice(row.price) + " · " + (toTrigger >= 0 ? "+" : "") + toTrigger.toFixed(2) + "% to trigger · score " + row.score + " · " + row.regime,
    "",
    ...lines,
    "",
    "⏳ Not a signal yet: price must " + (plan.status === "WAIT_RETEST" ? "pull back into the zone " + formatPrice(plan.zoneLow) + " – " + formatPrice(plan.zoneHigh) : "reach the entry area") + " and a " + plan.timeframe + " candle must close " + (long ? "above" : "below") + " " + formatPrice(plan.trigger) + ". Monitoring sends the alert when that happens.",
  ], buttons: [{ text: "👀 Monitor & prioritise", data: "monitor:" + row.symbol }, { text: "📊 Re-analyse", data: "analyse:" + row.symbol }, { text: "🙈 Ignore this pair", data: "unmonitor:" + row.symbol }] };
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
  const call = entry.price !== null ? entryCall({ symbol: entry.symbol, bias: entry.side, stop: entry.stop ?? plan.stop, entryReady: entry.ready, executionPlan: plan }, entry.price).line : undefined;
  return compactSignalLines({ symbol: entry.symbol, side: entry.side, entryLow: plan.entryLow, entryHigh: plan.entryHigh, entry: plan.entry, trigger: plan.trigger, timeframe: plan.timeframe, stop: entry.stop ?? plan.stop, targets: entry.targets, expiresAt: plan.expiresAt, zoneLow: plan.zoneLow, zoneHigh: plan.zoneHigh, call });
}

const FOLLOW_UP_ACTIONS: TradeSnapshot["action"][] = ["TAKE PARTIAL", "CLOSE REMAINDER", "EXIT NOW", "REDUCE / EXIT", "PROTECT PROFIT"];

export function formatMonitorEvent(entry: MonitorEntry): TelegramEvent | null {
  const plan = entry.plan;
  if (!plan || !entry.side || entry.price === null) return null;
  const long = entry.side === "LONG";
  const head = "🔔 " + entry.symbol + " " + entry.side + " · " + entry.state;
  // A stop-side hit before entry is a one-line notice, not another copy of the signal.
  if (entry.state === "STOP HIT") return { key: "monitor:" + entry.planKey + ":STOP HIT", symbol: entry.symbol, lines: [
    "⛔ " + entry.symbol + " " + entry.side + " · STOP LOSS LEVEL HIT " + formatPrice(entry.stop ?? plan.stop),
    "📍 Price " + formatPrice(entry.price) + " · plan cancelled before entry. Remove any resting order; a fresh plan will be sent if one forms.",
  ], buttons: [{ text: "📊 Re-analyse", data: "analyse:" + entry.symbol }, { text: "🙈 Stop monitoring", data: "unmonitor:" + entry.symbol }] };
  const levels = ["📍 Price " + formatPrice(entry.price), "", ...card(entry), ""];
  const instruction =
    entry.state === "ENTRY RANGE" ? "✅ Plan is READY and price is inside the entry range. Place the limit at the entry price or better; cancel it if the dashboard drops READY or the plan expires."
    : entry.state === "AT TRIGGER" ? "⏳ Price crossed the trigger. Wait for the " + plan.timeframe + " candle to CLOSE " + (long ? "above" : "below") + " it and for the dashboard to show READY. Do not buy the wick."
    : entry.state === "PAST ENTRY" ? "⏸ Price ran past the entry level. Keep the limit at the level and wait for a pullback; do not chase."
    : "";
  const buttons = entry.state === "ENTRY RANGE" ? [{ text: "✅ Entered at plan price", data: "entered:" + entry.symbol }, { text: "✏️ Entered at…", data: "enterat:" + entry.symbol }, { text: "❌ Skipped", data: "skipped:" + entry.symbol }, { text: "📊 Re-analyse", data: "analyse:" + entry.symbol }] : signalButtons(entry.symbol);
  return { key: "monitor:" + entry.planKey + ":" + entry.state, symbol: entry.symbol, lines: [head, ...levels, instruction, entry.state === "ENTRY RANGE" ? "Tap Entered so exits are tracked from your fill, or Skipped to stop following this plan." : "Already in? Tap Entered (or Entered at… with your fill) so exits are tracked from your price."], buttons };
}

export type MonitorUpdateKind = "CONFIRMED" | "PLAN UPDATED" | "EXPIRED";

/** Ongoing updates while a pair is monitored. */
export function formatMonitorUpdate(entry: MonitorEntry, kind: MonitorUpdateKind): TelegramEvent {
  if (kind === "EXPIRED") return { key: "monitor:" + entry.planKey + ":EXPIRED", symbol: entry.symbol, lines: [
    "⌛ " + entry.symbol + " " + (entry.side ?? "") + " · PLAN EXPIRED" + (entry.plan ? " (" + entry.plan.timeframe + " confirmation ran out)" : ""),
    "📍 Price " + (entry.price !== null ? formatPrice(entry.price) : "—") + ". No fill was recorded; cancel a resting order unless you entered. A fresh plan follows when the pair qualifies again.",
  ], buttons: [{ text: "✅ I entered at plan price", data: "entered:" + entry.symbol }, { text: "✏️ I entered at…", data: "enterat:" + entry.symbol }, { text: "👀 Keep monitoring", data: "monitor:" + entry.symbol }, { text: "📊 Re-analyse", data: "analyse:" + entry.symbol }] };
  const levels = entry.plan ? ["", ...card(entry), ""] : [];
  const head = kind === "CONFIRMED" ? "✅ " + entry.symbol + " " + (entry.side ?? "") + " · CONFIRMED: candle closed, plan READY"
    : kind === "PLAN UPDATED" ? "🔄 " + entry.symbol + " " + (entry.side ?? "") + " · PLAN UPDATED after rescan"
    : "⌛ " + entry.symbol + " " + (entry.side ?? "") + " · PLAN EXPIRED";
  const note = kind === "CONFIRMED" ? "Enter only while the live price stays inside the entry range; place the limit at the entry price or better."
    : kind === "PLAN UPDATED" ? "New levels replace the earlier ones. Cancel any resting order placed on the old plan."
    : "The entry window closed without a fill. Nothing to do; a fresh plan will be sent if the pair qualifies again.";
  return { key: "monitor:" + entry.planKey + ":" + kind, symbol: entry.symbol, lines: [head, "📍 Price " + (entry.price !== null ? formatPrice(entry.price) : "—"), ...levels, note], buttons: signalButtons(entry.symbol) };
}

/**
 * The hourly monitor list. Pairs that are ready to enter or already in a trade
 * are the "current" ones and come first with their levels; everything else is
 * one line each, so the chat is not flooded with intermediate alerts.
 */
export function formatMonitorDigest(entries: MonitorEntry[], now = Date.now(), extra: { inTrade?: Array<{ symbol: string; side: "LONG" | "SHORT"; entry: number; hit: number; price?: number | null }>; forming?: Array<{ symbol: string; side: string; trigger: number; status: string }>; reviews?: Record<string, { verdict: string; summary: string }>; held?: Array<{ symbol: string; reason: string }> } = {}): TelegramEvent | null {
  const inTrade = extra.inTrade ?? [];
  if (!entries.length && !inTrade.length) return null;
  const hour = Math.floor(now / 3_600_000);
  const tradeSymbols = new Set(inTrade.map(t => t.symbol));
  const ready = entries.filter(e => !tradeSymbols.has(e.symbol) && e.plan && e.side && (e.state === "ENTRY RANGE" || (e.ready && e.state !== "STOP HIT")));
  const rest = entries.filter(e => !tradeSymbols.has(e.symbol) && !ready.includes(e));
  const pct = (a: number, b: number) => ((a - b) / b * 100).toFixed(2) + "%";
  const lines: string[] = ["📡 MONITOR LIST · " + new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" }).format(now) + " Melbourne"];
  if (inTrade.length) {
    lines.push("", "🟢 IN TRADE");
    for (const t of inTrade) { const sign = t.side === "LONG" ? 1 : -1; lines.push("• " + t.symbol + " " + t.side + " · from " + formatPrice(t.entry) + " · next T" + (t.hit + 1) + (t.price ? " · " + (sign * (t.price - t.entry) >= 0 ? "+" : "") + (sign * (t.price - t.entry) / t.entry * 100).toFixed(2) + "%" : "")); }
  }
  if (ready.length) {
    lines.push("", "✅ READY TO ENTER");
    for (const e of ready) {
      const plan = e.plan!; const review = extra.reviews?.[e.planKey];
      lines.push("• " + e.symbol + " " + e.side + " · " + e.state + " · price " + formatPrice(e.price ?? plan.entry) + " · limit " + formatPrice(plan.entry) + " · stop " + formatPrice(e.stop ?? plan.stop) + (review ? " · review " + review.verdict : ""));
    }
  }
  if (rest.length) {
    lines.push("", "👀 MONITORED");
    for (const e of rest) { const plan = e.plan; lines.push("• " + e.symbol + (e.side ? " " + e.side : "") + " · " + e.state.toLowerCase() + (plan && e.price !== null ? " · " + formatPrice(e.price) + " vs trigger " + formatPrice(plan.trigger) + (e.toTriggerPct !== null ? " (" + (e.toTriggerPct > 0 ? "+" : "") + e.toTriggerPct.toFixed(2) + "%)" : "") : "")); }
  }
  if (extra.forming?.length) {
    lines.push("", "📋 FORMING (not yet signals)");
    for (const f of extra.forming.slice(0, 8)) lines.push("• " + f.symbol + " " + f.side + " · " + f.status.replaceAll("_", " ").toLowerCase() + " · trigger " + formatPrice(f.trigger));
  }
  if (extra.held?.length) {
    lines.push("", "🧠 HELD BY REVIEW");
    for (const h of extra.held.slice(0, 5)) lines.push("• " + h.symbol + " · " + h.reason);
  }
  lines.push("", "Full alerts arrive only for entry range, confirmation, your entered trades and exits. /status any time.");
  const buttons = [...ready.map(e => ({ text: "✅ Entered " + e.symbol.replace(/USDT$/, ""), data: "entered:" + e.symbol })), ...inTrade.map(t => ({ text: "❌ Closed " + t.symbol.replace(/USDT$/, ""), data: "skipped:" + t.symbol }))].slice(0, 8);
  return { key: "monitor:digest:" + hour, lines, buttons: buttons.length ? buttons : undefined };
}

/** Confirmation sent when a pair is added to monitoring (or on "send levels now"). */
export function formatMonitorStart(entry: MonitorEntry, now = Date.now()): TelegramEvent {
  const plan = entry.plan;
  const stamp = Math.floor(now / 60_000);
  if (!plan || !entry.side) return { key: "monitor:" + entry.symbol + ":start:" + stamp, symbol: entry.symbol, lines: ["👀 Monitoring " + entry.symbol, "No scanned plan yet for this pair; levels follow after the next scan. You will be told when price reaches the trigger or entry range."] };
  return { key: "monitor:" + entry.planKey + ":start:" + stamp, symbol: entry.symbol, buttons: signalButtons(entry.symbol), lines: [
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
