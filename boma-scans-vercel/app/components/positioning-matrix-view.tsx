"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PositioningMatrix } from "@/app/lib/positioning-matrix";

const leanTone = (lean: string) => lean === "LONG" ? "text-emerald-200" : lean === "SHORT" ? "text-rose-200" : "text-slate-300";
const verdictTone = (v: string) => v === "FAVOURABLE" ? "border-emerald-300/50 bg-emerald-300/[0.10] text-emerald-50" : v === "UNFAVOURABLE" ? "border-rose-300/50 bg-rose-300/[0.10] text-rose-50" : "border-amber-300/50 bg-amber-300/[0.10] text-amber-50";

/** Whales vs smart money vs Bybit crowd: three groups side by side, how they line up, scores and the positioning advice. */
export function PositioningMatrixView({ matrix }: { matrix: PositioningMatrix }) {
  return <section className="space-y-3 rounded-2xl border-2 border-violet-300/40 bg-violet-300/[0.05] p-4">
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-violet-200">🧭 Positioning · {matrix.coin}</p>
      <h3 className="text-lg font-bold text-white">Whales vs smart money vs Bybit crowd</h3>
      <p className="text-xs text-slate-400">Follow the whales and smart money. Read the crowd the opposite way: when ordinary traders are one-sided, price often moves against them.</p>
    </div>
    <div className="grid gap-3 lg:grid-cols-3">
      {matrix.groups.map(g => <div key={g.key} className="rounded-xl border border-white/[0.08] bg-slate-950/60 p-3">
        <p className="text-sm font-bold text-white">{g.title}</p>
        <p className="text-[11px] text-slate-500">{g.who}</p>
        <p className={"mt-2 text-xl font-black " + leanTone(g.lean)}>{g.lean}{g.strength !== "—" && <span className="ml-2 text-xs font-semibold text-slate-300">{g.strength}</span>}</p>
        {g.longPct !== null && <div className="mt-1 h-2 overflow-hidden rounded-full bg-rose-400/60" title={Math.round(g.longPct) + "% long"}><div className="h-full bg-emerald-400" style={{ width: Math.round(g.longPct) + "%" }}/></div>}
        {g.longPct !== null && <p className="mt-0.5 flex justify-between text-[10px] text-slate-400"><span>{Math.round(g.longPct)}% long</span><span>{Math.round(100 - g.longPct)}% short</span></p>}
        <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-300">{g.facts.map(f => <li key={f}>• {f}</li>)}</ul>
        <p className="mt-2 text-sm leading-5 text-slate-100">💬 {g.plain}</p>
      </div>)}
    </div>
    <div className="rounded-xl border border-white/[0.08] bg-slate-950/60 p-3 text-sm leading-6">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">🔗 How they line up</p>
      <p className="font-semibold text-white">{matrix.lineUp}</p>
      <p className="mt-1"><b className="text-violet-200">Pattern: {matrix.pattern}</b></p>
      <p className="text-slate-200">{matrix.meaning}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {(["LONG", "SHORT"] as const).map(s => <div key={s}><p className="flex justify-between text-xs"><span className={leanTone(s)}>{s} score</span><b className="font-mono text-white">{matrix.scores[s]}/100</b></p><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className={"h-full " + (s === "LONG" ? "bg-emerald-400" : "bg-rose-400")} style={{ width: matrix.scores[s] + "%" }}/></div></div>)}
      </div>
      <p className="mt-2 text-slate-100">🎯 {matrix.bestPlain}</p>
      <ul className="mt-2 grid gap-x-4 text-xs text-slate-300 sm:grid-cols-2">{matrix.checklist.map(c => <li key={c} className={c.startsWith("✔") ? "text-emerald-200" : "text-slate-400"}>{c}</li>)}</ul>
    </div>
    <div className={"rounded-xl border-2 p-3 " + (matrix.forSide ? verdictTone(matrix.forSide.verdict) : "border-cyan-300/40 bg-cyan-300/[0.07] text-slate-50")}>
      <p className="text-xs font-bold uppercase tracking-widest">✅ Positioning advice{matrix.forSide ? " for your " + matrix.forSide.side + ": " + matrix.forSide.verdict + " (" + matrix.forSide.score + "/100)" : ""}</p>
      <p className="mt-1 text-base font-semibold leading-6">{matrix.todo}</p>
    </div>
  </section>;
}

/** Check positioning for any coin, optionally against a side you are considering. */
export function PositioningChecker() {
  const [coin, setCoin] = useState(""); const [side, setSide] = useState<"" | "LONG" | "SHORT">("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [matrix, setMatrix] = useState<PositioningMatrix | null>(null);
  const run = async () => {
    const c = coin.trim().toUpperCase().replace(/USDT$/, ""); if (!c) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/whales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "positioning", coin: c, side: side || undefined }) });
      const d = await r.json() as { matrix?: PositioningMatrix; error?: string };
      if (d.matrix) setMatrix(d.matrix); else setError(d.error ?? "Positioning unavailable.");
    } catch { setError("Positioning unavailable."); } finally { setBusy(false); }
  };
  return <div className="space-y-3">
    <form className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-slate-950/40 p-3" onSubmit={e => { e.preventDefault(); void run(); }}>
      <label className="text-xs text-slate-400" htmlFor="pos-coin">Positioning for any coin</label>
      <input id="pos-coin" value={coin} onChange={e => setCoin(e.target.value)} placeholder="BTC, ETH, SOL…" className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 font-mono text-sm text-slate-100"/>
      <select value={side} onChange={e => setSide(e.target.value as "" | "LONG" | "SHORT")} className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-sm text-slate-100" aria-label="Side you are considering">
        <option value="">Any side</option><option value="LONG">I am thinking LONG</option><option value="SHORT">I am thinking SHORT</option>
      </select>
      <Button type="submit" size="sm" disabled={busy} className="rounded-lg">{busy ? "Reading…" : "Check positioning"}</Button>
    </form>
    {error && <p className="text-sm text-amber-200">{error}</p>}
    {matrix && <PositioningMatrixView matrix={matrix}/>}
  </div>;
}
