"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/app/lib/market";
import { formatUsd } from "@/app/lib/positioning";
import { pushTelegramEvents } from "@/app/lib/telegram-events";
import type { WhaleAnalysis } from "@/app/server/whale-analysis";

const melbourne = (t: number) => new Date(t).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** Lines for Telegram: the plan exactly as shown here. */
export function whaleAnalysisLines(a: WhaleAnalysis): string[] {
  const p = a.plan;
  return [
    "🐋 WHALE ENTRY ANALYSIS · " + a.coin + " " + a.side + (a.symbol ? " · " + a.symbol : ""),
    "📍 Price " + formatPrice(a.price) + " · whale book long " + formatUsd(a.whales.longUsd) + " / short " + formatUsd(a.whales.shortUsd) + " · " + a.whales.ranked + " ranked",
    ...(a.whales.signal ? ["", "🐋 Whales: " + a.whales.signal.status + " · " + a.whales.signal.confidence + "% · avg entry " + formatPrice(a.whales.signal.avgEntry) + " (" + (a.whales.signal.distancePct >= 0 ? "+" : "") + a.whales.signal.distancePct.toFixed(2) + "%)", ...a.whales.signal.whales.map(w => "• " + w.label + " (" + w.tier.toLowerCase() + ") " + w.kind.toLowerCase() + " " + formatUsd(Math.max(0, w.deltaUsd)) + " @ " + formatPrice(w.entry))] : []),
    ...(a.chart ? ["", "📈 Chart (1h): " + a.chart.bias + " · " + a.chart.regime + " · " + a.chart.trendFrames + "/3 frames · " + a.chart.status.replaceAll("_", " ").toLowerCase(), a.chart.call, ...(a.chart.keyLevels ? ["🏛 Historic levels: " + a.chart.keyLevels] : [])] : []),
    ...(a.positioning ? ["", "👥 " + a.positioning.verdict, a.positioning.summary] : []),
    ...(p ? ["", (p.decision === "ENTER NOW" ? "✅ " : p.decision === "WAIT" ? "⏳ " : "⛔ ") + p.decision + " · " + p.side + " · " + Math.round(p.confidence) + "% (" + p.provider + ")", p.thesis, "👉 Entry window: " + formatPrice(p.entry_low) + " – " + formatPrice(p.entry_high), "🎯 Trigger: " + p.trigger, "❌ StopLoss: " + formatPrice(p.stop), ...p.targets.map((t, i) => "🎯 Target " + (i + 1) + ": " + formatPrice(t)), "⛔ Invalidation: " + p.invalidation, ...p.risks.map(r => "• " + r), "💰 Manage: " + p.management, ...(p.guardrails.length ? ["📐 Guardrails: " + p.guardrails.join("; ")] : [])] : a.planError ? ["", "🧠 " + a.planError] : []),
    "", "No order is placed.",
  ];
}

/** The full entry analysis for a coin, inside the whale section. */
export function WhaleAnalysisPanel({ coin, side, compact = false }: { coin: string; side?: "LONG" | "SHORT"; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<WhaleAnalysis | null>(null);
  const [sent, setSent] = useState("");
  const run = async () => {
    setBusy(true); setError(""); setOpen(true);
    try {
      const r = await fetch("/api/whales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "analyse", coin, side }) });
      const d = await r.json() as { analysis?: WhaleAnalysis; error?: string };
      if (!r.ok || !d.analysis) throw new Error(d.error || "Analysis failed.");
      setAnalysis(d.analysis);
    } catch (e) { setError(e instanceof Error ? e.message : "Analysis failed."); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!analysis) return;
    const result = await pushTelegramEvents([{ key: "monitor:whale-analysis:" + coin + ":" + Math.floor(Date.now() / 60_000), symbol: analysis.symbol ?? undefined, lines: whaleAnalysisLines(analysis) }]);
    setSent(result);
  };
  const p = analysis?.plan;
  return <div className={compact ? "" : "mt-3"}>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant={open ? "outline" : "default"} disabled={busy} onClick={() => (analysis && open ? setOpen(false) : void run())} className="rounded-lg">{busy ? "Analysing…" : open && analysis ? "Hide entry analysis" : "🔎 Full entry analysis"}</Button>
      {analysis && open && <Button type="button" size="sm" variant="ghost" onClick={() => void run()} disabled={busy} className="rounded-lg">Refresh</Button>}
      {analysis && open && <Button type="button" size="sm" variant="ghost" onClick={() => void send()} className="rounded-lg">Send to Telegram</Button>}
      {sent && <span className="text-xs text-slate-400">{sent}</span>}
    </div>
    {open && error && <p className="mt-2 text-sm text-amber-200">{error}</p>}
    {open && analysis && <div className="mt-3 space-y-3 rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4 text-sm">
      <p className="text-xs text-slate-500">Analysed {melbourne(analysis.at)} · price {formatPrice(analysis.price)}{analysis.symbol ? " · " + analysis.symbol : " · not on Bybit"}</p>
      {p && <div className={"rounded-xl border p-3 " + (p.decision === "ENTER NOW" ? "border-emerald-300/40 bg-emerald-300/[0.08]" : p.decision === "WAIT" ? "border-amber-300/30 bg-amber-300/[0.06]" : "border-rose-300/30 bg-rose-300/[0.06]")}>
        <p className="text-base font-bold text-white">{p.decision === "ENTER NOW" ? "✅" : p.decision === "WAIT" ? "⏳" : "⛔"} {p.decision} · {p.side} · {Math.round(p.confidence)}% <span className="text-xs font-normal text-slate-400">by {p.provider}</span></p>
        <p className="mt-1 leading-6 text-slate-200">{p.thesis}</p>
        <div className="mt-2 grid gap-2 font-mono text-xs sm:grid-cols-2">
          <p>👉 Entry window <b className="text-white">{formatPrice(p.entry_low)} – {formatPrice(p.entry_high)}</b></p>
          <p>❌ Stop <b className="text-rose-200">{formatPrice(p.stop)}</b></p>
          <p className="sm:col-span-2">🎯 Targets <b className="text-emerald-200">{p.targets.map(t => formatPrice(t)).join(" / ")}</b></p>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-300">🎯 Trigger: {p.trigger}</p>
        <p className="mt-1 text-xs leading-5 text-slate-300">⛔ Invalidation: {p.invalidation}</p>
        {p.risks.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs leading-5 text-slate-300">{p.risks.map(r => <li key={r}>{r}</li>)}</ul>}
        <p className="mt-1 text-xs leading-5 text-slate-300">💰 {p.management}</p>
        {p.guardrails.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Guardrails applied: {p.guardrails.join("; ")}</p>}
      </div>}
      {!p && analysis.planError && <p className="rounded-xl border border-white/[0.08] p-3 text-xs text-slate-400">🧠 {analysis.planError}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-white/[0.08] p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-200">🐋 What the whales did</p>
          <p className="mt-1 text-xs text-slate-300">Open book: long {formatUsd(analysis.whales.longUsd)} · short {formatUsd(analysis.whales.shortUsd)} · {analysis.whales.ranked} ranked traders in it</p>
          {analysis.whales.signal ? <>
            <p className="mt-1 text-xs text-slate-200">{analysis.whales.signal.status} · {analysis.whales.signal.confidence}% · avg entry {formatPrice(analysis.whales.signal.avgEntry)} ({analysis.whales.signal.distancePct >= 0 ? "+" : ""}{analysis.whales.signal.distancePct.toFixed(2)}%) · new money {formatUsd(analysis.whales.signal.flowUsd)}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-300">{analysis.whales.signal.whales.map(w => <li key={w.trader + w.at}>• <span className="font-mono">{w.label}</span> {w.tier.toLowerCase()} {w.kind.toLowerCase()} {formatUsd(Math.max(0, w.deltaUsd))} @ {formatPrice(w.entry)}</li>)}</ul>
            {analysis.whales.signal.opposed.length > 0 && <p className="mt-1 text-xs text-amber-200">Against: {analysis.whales.signal.opposed.map(o => o.label + " " + o.kind.toLowerCase() + " " + formatUsd(Math.abs(o.deltaUsd))).join(", ")}</p>}
          </> : <p className="mt-1 text-xs text-slate-400">No confirmed cluster on this coin right now.</p>}
          {analysis.whales.recent.length > 0 && <ul className="mt-2 space-y-0.5 text-[11px] text-slate-400">{analysis.whales.recent.slice(0, 8).map(e => <li key={e.id}>{melbourne(e.at)} · <span className="font-mono">{e.trader}</span> {e.kind} {e.side} {formatUsd(Math.abs(e.deltaUsd))} @ {formatPrice(e.entry)}</li>)}</ul>}
        </div>
        <div className="rounded-xl border border-white/[0.08] p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-cyan-200">📈 What the chart says (1h, rule engine)</p>
          {analysis.chart ? <>
            <p className="mt-1 text-xs text-slate-200">{analysis.chart.bias} · {analysis.chart.regime} · {analysis.chart.trendFrames}/3 frames · plan {analysis.chart.status.replaceAll("_", " ").toLowerCase()} · ATR {analysis.chart.atrPct.toFixed(2)}%</p>
            <p className="mt-1 font-mono text-xs text-cyan-100">{analysis.chart.call}</p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[11px] leading-5 text-slate-300">{analysis.chart.lines.join("\n")}</pre>
            <p className="mt-1 text-[11px] text-slate-500">Checks: {analysis.chart.checks.map(c => c.label + " " + c.status).join(" · ")}</p>
          </> : <p className="mt-1 text-xs text-slate-400">Not listed on Bybit.</p>}
          {analysis.positioning && <p className="mt-2 text-xs leading-5 text-slate-300">👥 {analysis.positioning.verdict}. {analysis.positioning.summary}</p>}
        </div>
      </div>
    </div>}
  </div>;
}
