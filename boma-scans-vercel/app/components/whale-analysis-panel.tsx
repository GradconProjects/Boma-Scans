"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/app/lib/market";
import { formatUsd } from "@/app/lib/positioning";
import { pushTelegramEvents } from "@/app/lib/telegram-events";
import type { WhaleAnalysis } from "@/app/server/whale-analysis";
import { whaleAnalysisLines } from "@/app/lib/whale-analysis-lines";
import { planPlain, sideWords } from "@/app/lib/plain-words";
import { PositioningMatrixView } from "@/app/components/positioning-matrix-view";

const melbourne = (t: number) => new Date(t).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export { whaleAnalysisLines } from "@/app/lib/whale-analysis-lines";

/** The full entry analysis for a coin, inside the whale section. */
export function WhaleAnalysisPanel({ coin, side, compact = false }: { coin: string; side?: "LONG" | "SHORT"; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<WhaleAnalysis | null>(null);
  const [sent, setSent] = useState("");
  const [tracked, setTracked] = useState("");
  /** Record the trade from this analysis and start whale monitoring + management of the pair. */
  const enterTrade = async () => {
    if (!analysis) return;
    const side = analysis.plan?.side ?? analysis.side;
    const typed = window.prompt("Your fill price for " + coin + " " + side + " (leave as is for the current price):", analysis.price ? String(analysis.price) : "");
    if (typed === null) return;
    const r = await fetch("/api/whales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "entered", coin, side, price: Number(typed) || undefined, symbol: analysis.symbol ?? undefined }) });
    const d = await r.json() as { settings?: { entered?: Array<{ coin: string; side: string; entry: number }> }; error?: string };
    const t = d.settings?.entered?.find(x => x.coin === coin);
    setTracked(t ? "✅ Tracking your " + t.side + " " + coin + " from " + formatPrice(t.entry) + ": whale moves against it, instructions in figures, and a 6-hourly check-in now go to Telegram." : (d.error ?? "Could not record the trade."));
  };
  const watchPair = async () => {
    const r = await fetch("/api/whales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "watch", coin }) });
    const d = await r.json() as { settings?: { watch?: string[] }; error?: string };
    setTracked(d.settings?.watch?.includes(coin) ? "👁 Monitoring " + coin + " alone: every $100K+ directional whale move on it is reported." : (d.error ?? "Could not start monitoring."));
  };
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
    {open && analysis && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/[0.06] p-2">
      <Button type="button" size="sm" onClick={() => void enterTrade()} className="rounded-lg bg-emerald-300 text-slate-950 hover:bg-emerald-200">✅ I entered this {analysis.plan?.side ?? analysis.side} · start whale monitoring &amp; management</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void watchPair()} className="rounded-lg">👁 Monitor {coin} alone</Button>
      {tracked && <span className="text-xs text-emerald-100">{tracked}</span>}
    </div>}
    {open && error && <p className="mt-2 text-sm text-amber-200">{error}</p>}
    {open && analysis && <div className="mt-3 space-y-3 rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4 text-sm">
      <p className="text-xs text-slate-500">Analysed {melbourne(analysis.at)} · price {formatPrice(analysis.price)}{analysis.symbol ? " · " + analysis.symbol : " · not on Bybit"}</p>
      {p && <div className="rounded-xl border-2 border-cyan-300/40 bg-cyan-300/[0.07] p-3">
        <p className="text-xs font-bold uppercase tracking-widest text-cyan-200">✅ What to do</p>
        <p className="mt-1 text-base font-semibold leading-6 text-white">{planPlain(analysis.coin, p)}</p>
        {p.simple && <p className="mt-1 leading-6 text-slate-200">{p.simple}</p>}
        {p.decision !== "NO TRADE" && <p className="mt-1 text-xs text-slate-400">{sideWords(p.side)}</p>}
      </div>}
      {analysis.matrix && <PositioningMatrixView matrix={analysis.matrix}/>}
      <div className="grid gap-2 rounded-xl border border-white/[0.08] bg-slate-950/60 p-3 text-xs sm:grid-cols-3">
        <p><span className="text-slate-500">🐋 Whale signal</span><br/><b className={analysis.whales.signal ? (analysis.whales.signal.side === "LONG" ? "text-emerald-200" : "text-rose-200") : "text-slate-400"}>{analysis.whales.signal ? analysis.whales.signal.side + " · " + analysis.whales.signal.status + " · " + analysis.whales.signal.confidence + "%" : "none confirmed (asked about " + analysis.side + ")"}</b></p>
        <p><span className="text-slate-500">📈 Chart engine (1h)</span><br/><b className={analysis.chart ? (analysis.chart.bias === "LONG" ? "text-emerald-200" : "text-rose-200") : "text-slate-400"}>{analysis.chart ? analysis.chart.bias + " · " + analysis.chart.regime + " · plan " + analysis.chart.status.replaceAll("_", " ").toLowerCase() : "not on Bybit"}</b></p>
        <p><span className="text-slate-500">🧠 Planner</span><br/><b className={p ? (p.decision === "NO TRADE" ? "text-slate-300" : p.side === "LONG" ? "text-emerald-200" : "text-rose-200") : "text-slate-400"}>{p ? p.decision + (p.decision === "NO TRADE" ? "" : " " + p.side) + " · " + p.alignment : "no plan"}</b></p>
      </div>
      {p && p.side !== analysis.side && p.decision !== "NO TRADE" && <p className="rounded-xl border border-amber-300/40 bg-amber-300/[0.08] p-2 text-xs font-semibold text-amber-100">⚠️ Side differs: you asked about {analysis.side}, the planner recommends {p.side}. Read the whale and smart-money notes below before acting.</p>}
      {p && <div className={"rounded-xl border p-3 " + (p.decision === "ENTER NOW" ? "border-emerald-300/40 bg-emerald-300/[0.08]" : p.decision === "WAIT" ? "border-amber-300/30 bg-amber-300/[0.06]" : "border-rose-300/30 bg-rose-300/[0.06]")}>
        <p className="text-base font-bold text-white">{p.decision === "ENTER NOW" ? "✅" : p.decision === "WAIT" ? "⏳" : "⛔"} {p.decision} · {p.side} · {Math.round(p.confidence)}% <span className="text-xs font-normal text-slate-400">by {p.provider}</span></p>
        <p className="mt-1 leading-6 text-slate-200">{p.thesis}</p>
        <p className="mt-1 text-xs leading-5 text-violet-100">🐋 {p.alignment}: {p.whale_read}</p>
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
          <p className="mt-1 text-xs leading-5 text-slate-200">{analysis.whales.read}</p>
          <p className="mt-1 text-xs text-slate-300">All tracked whales: long {formatUsd(analysis.whales.longUsd)} · short {formatUsd(analysis.whales.shortUsd)} · fresh 6 h: +{formatUsd(analysis.whales.flows.h6.longUsd)} long / +{formatUsd(analysis.whales.flows.h6.shortUsd)} short · 24 h: +{formatUsd(analysis.whales.flows.h24.longUsd)} / +{formatUsd(analysis.whales.flows.h24.shortUsd)}</p>
          {analysis.whales.book.length > 0 && <table className="mt-2 w-full text-[11px]"><thead><tr className="text-left text-slate-500"><th className="pr-2 font-medium">Ranked whale</th><th className="pr-2 font-medium">Side</th><th className="pr-2 text-right font-medium">Size</th><th className="pr-2 text-right font-medium">Entry</th><th className="pr-2 text-right font-medium">Lev</th><th className="text-right font-medium">P&amp;L</th></tr></thead><tbody>{analysis.whales.book.map(b => <tr key={b.label} className="border-t border-white/[0.05] font-mono text-slate-200"><td className="pr-2 py-0.5">#{b.rank} {b.label} <span className="font-sans text-[10px] text-slate-500">{b.tier.toLowerCase()}</span></td><td className={"pr-2 " + (b.side === "LONG" ? "text-emerald-300" : "text-rose-300")}>{b.side}</td><td className="pr-2 text-right">{formatUsd(b.sizeUsd)}</td><td className="pr-2 text-right">{formatPrice(b.entry)}</td><td className="pr-2 text-right">{b.leverage}x</td><td className={"text-right " + (b.pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{(b.pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(b.pnl))}</td></tr>)}</tbody></table>}
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
          {analysis.positioning && <div className="mt-2 rounded-lg border border-white/[0.06] p-2"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">💼 Smart money &amp; crowd</p><p className="mt-1 text-xs leading-5 text-slate-200">{analysis.positioning.verdict}. {analysis.positioning.summary}</p><ul className="mt-1 space-y-0.5 text-[11px] leading-4 text-slate-300">{analysis.positioning.notes.map(n => <li key={n}>{n}</li>)}</ul></div>}
        </div>
      </div>
    </div>}
  </div>;
}
