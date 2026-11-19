import { formatPrice } from "@/app/lib/market";
import { formatUsd } from "@/app/lib/positioning";
import type { WhaleAnalysis } from "@/app/server/whale-analysis";

/** Lines for Telegram: the plan exactly as shown here. */
export function whaleAnalysisLines(a: WhaleAnalysis): string[] {
  const p = a.plan;
  return [
    "🐋 WHALE ENTRY ANALYSIS · " + a.coin + " " + a.side + (a.symbol ? " · " + a.symbol : ""),
    "📍 Price " + formatPrice(a.price) + " · whale book long " + formatUsd(a.whales.longUsd) + " / short " + formatUsd(a.whales.shortUsd) + " · " + a.whales.ranked + " ranked",
    "", "🐋 " + a.whales.read,
    ...(a.whales.signal ? ["🐋 Whale signal " + a.whales.signal.side + ": " + a.whales.signal.status + " · " + a.whales.signal.confidence + "% · avg entry " + formatPrice(a.whales.signal.avgEntry) + " (" + (a.whales.signal.distancePct >= 0 ? "+" : "") + a.whales.signal.distancePct.toFixed(2) + "%)", ...a.whales.signal.whales.map(w => "• " + w.label + " (" + w.tier.toLowerCase() + ") " + w.kind.toLowerCase() + " " + formatUsd(Math.max(0, w.deltaUsd)) + " @ " + formatPrice(w.entry))] : []),
    ...(a.chart ? ["", "📈 Chart (1h): " + a.chart.bias + " · " + a.chart.regime + " · " + a.chart.trendFrames + "/3 frames · " + a.chart.status.replaceAll("_", " ").toLowerCase(), a.chart.call, ...(a.chart.keyLevels ? ["🏛 Historic levels: " + a.chart.keyLevels] : [])] : []),
    ...(a.positioning ? ["", "👥 " + a.positioning.verdict, a.positioning.summary] : []),
    ...(p ? ["", (p.decision === "ENTER NOW" ? "✅ " : p.decision === "WAIT" ? "⏳ " : "⛔ ") + p.decision + " · " + p.side + " · " + Math.round(p.confidence) + "% (" + p.provider + ")" + (p.side !== a.side && p.decision !== "NO TRADE" ? " · ⚠️ opposite to the " + a.side + " you asked about" : ""), p.thesis, "🐋 " + p.alignment + ": " + p.whale_read, "👉 Entry window: " + formatPrice(p.entry_low) + " – " + formatPrice(p.entry_high), "🎯 Trigger: " + p.trigger, "❌ StopLoss: " + formatPrice(p.stop), ...p.targets.map((t, i) => "🎯 Target " + (i + 1) + ": " + formatPrice(t)), "⛔ Invalidation: " + p.invalidation, ...p.risks.map(r => "• " + r), "💰 Manage: " + p.management, ...(p.guardrails.length ? ["📐 Guardrails: " + p.guardrails.join("; ")] : [])] : a.planError ? ["", "🧠 " + a.planError] : []),
    "", "No order is placed.",
  ];
}

