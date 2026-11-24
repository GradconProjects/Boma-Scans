"use client";
import { useEffect, useState } from "react";
import type { MarketDirection } from "@/app/lib/market-direction";

const tone = (d: string) => d === "BULLISH" || d === "UP" ? { text: "text-emerald-200", bg: "bg-emerald-400", box: "border-emerald-300/40 bg-emerald-300/[0.08]", arrow: "⬆" } : d === "BEARISH" || d === "DOWN" ? { text: "text-rose-200", bg: "bg-rose-400", box: "border-rose-300/40 bg-rose-300/[0.08]", arrow: "⬇" } : { text: "text-slate-200", bg: "bg-slate-400", box: "border-white/15 bg-white/[0.04]", arrow: "➡" };
const pct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
/** Two bars from a centre line: green right for up, red left for down. Scaled to ±`scale` %. */
function Twin({ label, a, b, scale }: { label: string; a: number; b: number; scale: number }) {
  const bar = (v: number) => <span className="relative block h-2 w-full overflow-hidden rounded bg-white/10"><span className="absolute left-1/2 top-0 h-full w-px bg-white/40"/><span className={"absolute top-0 h-full " + (v >= 0 ? "bg-emerald-400" : "bg-rose-400")} style={v >= 0 ? { left: "50%", width: Math.min(50, Math.abs(v) / scale * 50) + "%" } : { right: "50%", width: Math.min(50, Math.abs(v) / scale * 50) + "%" }}/></span>;
  return <div className="grid grid-cols-[2.5rem_1fr_4rem] items-center gap-x-2 gap-y-0.5 text-[11px]"><span className="row-span-2 font-semibold text-slate-300">{label}</span>{bar(a)}<span className="text-right font-mono text-slate-200">₿ {pct(a)}</span>{bar(b)}<span className="text-right font-mono text-slate-200">🪙 {pct(b)}</span></div>;
}

/** Market direction strip shown above every section: the tide, Bitcoin against the coins, and who rules. */
export function MarketDirectionStrip() {
  const [m, setM] = useState<MarketDirection | null>(null); const [open, setOpen] = useState(false);
  useEffect(() => {
    let stopped = false;
    const pull = async () => { try { const r = await fetch("/api/market-direction", { cache: "no-store" }); if (!r.ok) return; const d = await r.json() as { direction?: MarketDirection }; if (!stopped && d.direction) setM(d.direction); } catch { /* offline or signed out */ } };
    void pull(); const timer = window.setInterval(() => void pull(), 180_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  if (!m) return null;
  const o = tone(m.overall), b = tone(m.btc.trend), c = tone(m.market.trend); const w24 = m.windows[2];
  const ruleTone = m.ruler === "BTC RULES" ? "border-amber-300/50 bg-amber-300/[0.12] text-amber-100" : m.ruler === "ALTS RULE" ? "border-fuchsia-300/50 bg-fuchsia-300/[0.12] text-fuchsia-100" : "border-white/20 bg-white/[0.06] text-slate-100";
  return <section aria-label="Market direction" className="border-b border-white/10 bg-[#060f17] px-4 py-2 text-slate-100">
    <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-xs">
      <span className={"rounded-lg border px-2 py-1 text-sm font-black " + o.box + " " + o.text}>🌍 MARKET {o.arrow} {m.overall}</span>
      <span className={"font-semibold " + b.text}>₿ BTC {b.arrow} {m.btc.trend.toLowerCase()} <span className="font-mono text-slate-300">{pct(w24.btcPct)}</span></span>
      <span className="text-slate-500">vs</span>
      <span className={"font-semibold " + c.text}>🪙 Coins {c.arrow} {m.market.trend.toLowerCase()} <span className="font-mono text-slate-300">{pct(w24.marketPct)}</span></span>
      <span className="flex items-center gap-1 text-slate-300" title={Math.round(w24.breadthUp * 100) + "% of coins are up over 24 h"}><span className="relative block h-2 w-20 overflow-hidden rounded bg-rose-400/70"><span className="absolute left-0 top-0 h-full bg-emerald-400" style={{ width: Math.round(w24.breadthUp * 100) + "%" }}/></span>{Math.round(w24.breadthUp * 100)}% up</span>
      <span className={"rounded-full border px-2 py-0.5 font-bold " + ruleTone}>👑 {m.ruler}</span>
      <span className="text-slate-400">{m.strength === "EVEN" ? "even strength" : m.strength.toLowerCase()}</span>
      <span className="ml-auto text-slate-500">{open ? "Hide ▲" : "Details ▼"}</span>
    </button>
    {open && <div className="mt-2 grid gap-3 pb-1 text-sm leading-6 lg:grid-cols-3">
      <div className={"rounded-xl border p-3 " + o.box}>
        <p className="text-xs font-bold uppercase tracking-widest opacity-80">Overall direction</p>
        <p className={"text-xl font-black " + o.text}>{o.arrow} {m.overall}</p>
        <p className="text-slate-200">{m.overallPlain}</p>
        <p className="mt-2 rounded-lg bg-black/20 p-2 text-slate-50"><b>✅ What to do:</b> {m.advice}</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Bitcoin (₿) against the coins (🪙)</p>
        <div className="mt-2 space-y-2">{m.windows.map(w => <Twin key={w.label} label={w.label} a={w.btcPct} b={w.marketPct} scale={w.label === "24 h" ? 8 : w.label === "4 h" ? 4 : 2}/>)}</div>
        <p className="mt-2 text-xs text-slate-300">{m.strengthPlain}</p>
        <p className="mt-1 text-xs text-slate-400">Coins moving the same way as BTC: {m.windows.map(w => w.label + " " + Math.round(w.withBtc * 100) + "%").join(" · ")}</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Who rules</p>
        <p className={"mt-1 inline-block rounded-full border px-3 py-0.5 text-base font-black " + ruleTone}>👑 {m.ruler}</p>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-300" title="How closely coins track Bitcoin, 0 to 1"><span>on their own</span><span className="relative block h-2 flex-1 overflow-hidden rounded bg-fuchsia-400/40"><span className="absolute left-0 top-0 h-full bg-amber-400" style={{ width: Math.max(0, Math.min(100, m.correlation * 100)) + "%" }}/></span><span>follow BTC</span><b className="font-mono text-white">{m.correlation.toFixed(2)}</b></div>
        <p className="mt-2 text-xs text-slate-200">{m.rulerPlain}</p>
        <p className="mt-2 text-xs text-emerald-200">🏆 Strongest vs BTC: {m.leaders.map(l => l.coin + " " + pct(l.pct24)).join(" · ")}</p>
        <p className="text-xs text-rose-200">🐢 Weakest vs BTC: {m.laggards.map(l => l.coin + " " + pct(l.pct24)).join(" · ")}</p>
        <p className="mt-1 text-[10px] text-slate-500">{m.coins} most-traded crypto pairs on Bybit, closed 1h candles · {new Date(m.at).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })} Melbourne</p>
      </div>
    </div>}
  </section>;
}
