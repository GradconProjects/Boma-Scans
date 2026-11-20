import { formatPrice } from "@/app/lib/market";
import type { WhaleSignal } from "@/app/lib/whale-logic";

/** Plain-English building blocks so every card says what to do, in everyday words, before the technical detail. */
export const verb = (side: "LONG" | "SHORT") => side === "LONG" ? "BUY (long)" : "SELL (short)";
export const sideWords = (side: "LONG" | "SHORT") => side === "LONG" ? "LONG = you make money if the price goes UP" : "SHORT = you make money if the price goes DOWN";
const pct = (from: number, to: number) => Math.abs((to - from) / from * 100).toFixed(1) + "%";
const usd = (v: number) => v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + Math.round(v / 1e3) + "K";

export const STATUS_WORDS: Record<string, string> = {
  "NEW ENTRY": "Whales just got in and price is still at their level. Good time to join.",
  "ENTRY AVAILABLE": "Price is still close to where the whales got in. You can still join.",
  "RAN AWAY": "Price already moved a lot in the whales' favour. Too late; wait for a pullback.",
  "UNDERWATER": "Price moved against the whales. Their trade is failing; do not join.",
  "WEAK": "Only one whale or small money so far. A heads-up, not a signal.",
};

type Engine = { bias: string; trendFrames: number; agrees: boolean; opposes?: boolean; stop: number; targets: number[] } | null | undefined;

/** "What to do" and "Why" for a whale entry signal. */
export function whaleSignalPlain(s: WhaleSignal, engine: Engine): { todo: string[]; why: string[] } {
  const go = s.status === "NEW ENTRY" || s.status === "ENTRY AVAILABLE";
  const elite = s.whales.filter(w => w.tier === "ELITE").length;
  const why = [
    s.distinct + " top-ranked whale" + (s.distinct === 1 ? "" : "s") + (elite ? " (" + elite + " elite)" : "") + " put " + usd(s.flowUsd) + " into a " + s.coin + " " + s.side + " in the last 24 h.",
    "They got in around " + formatPrice(s.avgEntry) + ". Price is now " + formatPrice(s.price) + ". " + (STATUS_WORDS[s.status] ?? ""),
    ...(engine ? [engine.agrees ? "The 1-hour chart is also going " + (s.side === "LONG" ? "up" : "down") + ", so chart and whales agree." : engine.opposes ? "The 1-hour chart is going the other way, so wait until it turns." : "The 1-hour chart has no clear direction yet. It is not against the whales."] : []),
    ...(s.opposed.length ? [s.opposed.length + " ranked whale" + (s.opposed.length === 1 ? " took" : "s took") + " the opposite side, so be careful."] : []),
  ];
  if (!engine) return { todo: ["Information only: " + s.coin + " is not on Bybit."], why };
  if (!go || engine.opposes) return { todo: ["Do nothing for now. " + (engine.opposes ? "Wait until the chart agrees with the whales." : STATUS_WORDS[s.status] ?? "")], why };
  const t = engine.targets;
  return { todo: [
    verb(s.side) + " " + s.coin + " now, near " + formatPrice(s.price) + ".",
    "Stop-loss at " + formatPrice(engine.stop) + ". If price gets there you are out with a small loss (" + pct(s.price, engine.stop) + ").",
    "Take profit in 3 steps: " + t.map(x => formatPrice(x) + " (" + pct(s.price, x) + ")").join(", ") + ". Close about a third at each.",
    engine.agrees ? "Size: your normal size." : "Size: half your normal size, because the chart has not confirmed yet.",
  ], why };
}

/** One "What to do" line for a whale exit. */
export const whaleExitPlain = (coin: string, side: "LONG" | "SHORT", leave: boolean) => leave
  ? "If you are in a " + coin + " " + side + ": close it now. The whales who started this trade have taken their profit and left."
  : "If you are in a " + coin + " " + side + ": close about half now and move your stop-loss to your entry price, so the rest cannot lose. One of the whales is cashing out.";

/** One "What to do" line for an AI management decision on your trade. */
export function managementPlain(action: string, reducePct?: number | null, newStop?: number | null): string {
  if (action === "EXIT NOW") return "Close the whole trade now.";
  if (action === "REDUCE") return "Close " + (reducePct ?? 50) + "% of the trade now and keep the rest" + (newStop ? ", with the stop-loss moved to " + formatPrice(newStop) : "") + ".";
  if (action === "TIGHTEN STOP") return "Keep the trade, but move your stop-loss to " + (newStop ? formatPrice(newStop) : "a safer level") + ".";
  return "Do nothing. Keep the trade and leave your stop-loss where it is.";
}

/** One "What to do" line for an AI entry plan. */
export function planPlain(coin: string, p: { decision: string; side: "LONG" | "SHORT"; entry_low: number; entry_high: number; stop: number; targets: number[]; trigger: string }): string {
  if (p.decision === "ENTER NOW") return verb(p.side) + " " + coin + " now, between " + formatPrice(Math.min(p.entry_low, p.entry_high)) + " and " + formatPrice(Math.max(p.entry_low, p.entry_high)) + ". Stop-loss " + formatPrice(p.stop) + ". First profit at " + formatPrice(p.targets[0] ?? p.stop) + ".";
  if (p.decision === "WAIT") return "Do not enter yet. " + verb(p.side) + " " + coin + " only after this happens: " + p.trigger;
  return "Stay out of " + coin + " for now. There is no safe trade here.";
}
