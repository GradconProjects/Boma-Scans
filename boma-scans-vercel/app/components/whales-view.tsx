"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/app/lib/market";
import { formatUsd } from "@/app/lib/positioning";
import type { WhaleEvent, WhaleExit, WhaleRank, WhaleSignal } from "@/app/lib/whale-logic";
import { WhaleAnalysisPanel } from "@/app/components/whale-analysis-panel";

type Signal = WhaleSignal & { symbol: string | null; engine?: { bias: string; regime: string; trendFrames: number; agrees: boolean; stop: number; targets: number[]; atrPct: number } | null };
type Settings = { alerts: boolean; minTier: "ELITE" | "STRONG"; coins: string[]; watch?: string[] };
type Payload = { at: number; signals: Signal[]; exits: WhaleExit[]; ranks: WhaleRank[]; events: WhaleEvent[]; settings: Settings; error?: string };

const melbourne = (t: number) => new Date(t).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const tierTone: Record<WhaleRank["tier"], string> = { ELITE: "bg-violet-300/20 text-violet-100", STRONG: "bg-cyan-300/20 text-cyan-100", WATCH: "bg-white/10 text-slate-300" };
const kindTone: Record<WhaleEvent["kind"], string> = { OPEN: "text-emerald-300", ADD: "text-emerald-200", REDUCE: "text-amber-200", CLOSE: "text-rose-300", FLIP: "text-fuchsia-300" };

/**
 * Whale system: independent of the scanner. Follows what consistently
 * successful Hyperliquid whales are doing now: live events, rankings and
 * confirmed signals. Information only; no order is ever placed.
 */
export function WhalesView() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"signals" | "feed" | "ranks" | "rules">("signals");
  const [analyseCoin, setAnalyseCoin] = useState<{ coin: string; side: "LONG" | "SHORT" } | null>(null);
  const load = async () => {
    setLoading(true);
    try { const r = await fetch("/api/whales", { cache: "no-store" }); const d = await r.json() as Payload; if (!r.ok) throw new Error(d.error || "Whale data unavailable."); setData(d); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Whale data unavailable."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000); return () => window.clearInterval(t); }, []);
  const saveSettings = async (patch: Partial<Settings>) => {
    const r = await fetch("/api/whales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const d = await r.json() as { settings?: Settings };
    if (d.settings) setData(current => current ? { ...current, settings: d.settings! } : current);
  };
  const rankBy = new Map((data?.ranks ?? []).map(r => [r.trader, r]));
  const watched = new Set(data?.settings.watch ?? []);
  const toggleWatch = async (coin: string) => {
    const r = await fetch("/api/whales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: watched.has(coin) ? "unwatch" : "watch", coin }) });
    const d = await r.json() as { settings?: Settings };
    if (d.settings) setData(current => current ? { ...current, settings: d.settings! } : current);
  };
  const WatchButton = ({ coin }: { coin: string }) => <Button type="button" size="sm" variant={watched.has(coin) ? "default" : "outline"} onClick={() => void toggleWatch(coin)} className="rounded-lg">{watched.has(coin) ? "👁 Monitoring " + coin : "👁 Monitor " + coin + " alone"}</Button>;
  return <main className="mx-auto max-w-6xl px-4 py-6 text-slate-100">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-violet-200">🐋 Whale system</p>
        <h1 className="mt-1 text-2xl font-bold text-white">Follow what consistently successful whales are doing now</h1>
        <p className="mt-1 text-sm text-slate-400">Top Hyperliquid traders by consistency, their live opens, adds and closes, and a confirmation engine that separates new entries from positions that are already in profit. No orders are placed.</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400">{data && <span>Updated {melbourne(data.at)}</span>}<Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading} className="rounded-lg">{loading ? "Refreshing…" : "Refresh"}</Button></div>
    </div>
    {error && <p className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">{error}{error.includes("Sign in") && <> · <Link href="/login" className="underline">Sign in</Link></>}</p>}
    <div className="mt-5 flex flex-wrap gap-2">{(["signals", "feed", "ranks", "rules"] as const).map(t => <Button key={t} type="button" size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)} className="rounded-xl">{t === "signals" ? "Entry & exit signals" + (data ? " · " + (data.signals.filter(s => s.status !== "WEAK").length + data.exits.length) : "") : t === "feed" ? "Live activity" : t === "ranks" ? "Whale rankings" : "Rules & alerts"}</Button>)}</div>

    {tab === "signals" && data && <section className="mt-4 rounded-2xl border border-violet-300/30 bg-violet-300/[0.05] p-3">
      <p className="text-sm font-semibold text-white">👁 Pairs you monitor in the whale system {watched.size ? "· " + watched.size : ""}</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">Every directional whale move of $100K+ on these coins is sent to Telegram as it happens, and their entry and exit signals are sent without the confidence floor. Pick a coin from any signal, any activity row, or type one below.</p>
      {watched.size > 0 && <div className="mt-2 flex flex-wrap gap-2">{Array.from(watched).map(c => <button key={c} type="button" onClick={() => void toggleWatch(c)} className="rounded-lg border border-violet-300/40 bg-violet-300/10 px-2 py-1 font-mono text-xs text-violet-100 hover:bg-violet-300/20" title="Stop monitoring">{c} ✕</button>)}</div>}
      <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); const input = (e.currentTarget.elements.namedItem("watch-coin") as HTMLInputElement); const c = input.value.trim().toUpperCase().replace(/USDT$/, ""); if (c) { void toggleWatch(c); input.value = ""; } }}>
        <input name="watch-coin" placeholder="Coin to monitor, e.g. SOL" className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 font-mono text-sm text-slate-100"/>
        <Button type="submit" size="sm" variant="outline" className="rounded-lg">Monitor this pair</Button>
      </form>
    </section>}
    {tab === "signals" && <AnalyseAnyCoin/>}
    {tab === "signals" && data && data.exits.length > 0 && <section className="mt-4">
      <h2 className="text-sm font-bold uppercase tracking-widest text-rose-200">🚪 Whale exit signals</h2>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">{data.exits.map(x => <article key={x.coin + x.side + x.at} className={"rounded-2xl border p-4 " + (x.urgency === "LEAVE" ? "border-rose-300/40 bg-rose-300/[0.07]" : "border-amber-300/30 bg-amber-300/[0.05]")}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-bold text-white">{x.coin} {x.side} · {x.urgency === "LEAVE" ? "LEAVE" : "REDUCE"}</h3><span className="font-mono text-xs text-slate-300">{melbourne(x.at)}</span></div>
        <p className="mt-1 text-xs text-slate-300">Whales realised {(x.realizedPnl >= 0 ? "+" : "−") + formatUsd(Math.abs(x.realizedPnl))} on the way out</p>
        <ul className="mt-2 space-y-1 text-xs text-slate-300">{x.whales.map(w => <li key={w.label + w.kind}>• <span className="font-mono">{w.label}</span> <span className={"rounded px-1 " + tierTone[w.tier]}>{w.tier}</span>{w.wasLeader && <span className="ml-1 rounded bg-rose-300/20 px-1 text-rose-100">led the entry</span>} {w.kind.toLowerCase()} {formatUsd(Math.abs(w.deltaUsd))} · {(w.pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(w.pnl))} · held {w.heldHours}h</li>)}</ul>
        <p className="mt-2 text-xs leading-5 text-slate-400">{x.note}</p>
        <div className="mt-3 flex flex-wrap gap-2"><WatchButton coin={x.coin}/></div>
        <WhaleAnalysisPanel coin={x.coin} side={x.side}/>
      </article>)}</div>
    </section>}
    {tab === "signals" && <section className="mt-4 grid gap-4 lg:grid-cols-2">
      {!data ? <p className="text-sm text-slate-400">Loading…</p> : data.signals.filter(s => s.status !== "WEAK").length === 0 ? <p className="rounded-2xl border border-white/[0.08] bg-slate-950/40 p-4 text-sm leading-6 text-slate-400 lg:col-span-2">No confirmed whale entry right now. An entry needs a cluster of directional whales (two or more, score 1.8+), one ranked whale with $1M+ of new money, or any directional whale with $3M+ within 24 hours, with price still near their average entry. What is building is listed below; the live activity tab shows every move.</p>
        : data.signals.filter(s => s.status !== "WEAK").map(s => <article key={s.coin + s.side} className={"rounded-2xl border p-4 " + (s.status === "RAN AWAY" ? "border-white/[0.08] bg-slate-950/40" : s.side === "LONG" ? "border-emerald-300/30 bg-emerald-300/[0.05]" : "border-rose-300/30 bg-rose-300/[0.05]")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white">{s.side === "LONG" ? "🟢" : "🔴"} {s.coin} {s.side}</h2>
            <span className="flex items-center gap-2 text-xs"><span className={"rounded-full px-2 py-0.5 font-semibold " + (s.status === "NEW ENTRY" ? "bg-emerald-300/20 text-emerald-100" : s.status === "ENTRY AVAILABLE" ? "bg-cyan-300/20 text-cyan-100" : "bg-white/10 text-slate-300")}>{s.status}</span><span className="font-mono text-slate-300">{s.confidence}%</span></span>
          </div>
          <p className="mt-1 font-mono text-sm text-slate-200">Price {formatPrice(s.price)} · whales&apos; avg entry {formatPrice(s.avgEntry)} ({s.distancePct >= 0 ? "+" : ""}{s.distancePct.toFixed(2)}%) · new money {formatUsd(s.flowUsd)}</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-300">{s.whales.map(w => <li key={w.trader + w.at}>• <span className="font-mono">{w.label}</span> <span className={"rounded px-1 " + tierTone[w.tier]}>{w.tier}</span> {w.kind.toLowerCase()} {formatUsd(Math.max(0, w.deltaUsd))} @ {formatPrice(w.entry)} · {melbourne(w.at)}</li>)}</ul>
          {s.opposed.length > 0 && <p className="mt-2 text-xs text-amber-200">⚠️ Against: {s.opposed.map(o => o.label + " " + o.kind.toLowerCase() + " " + formatUsd(Math.abs(o.deltaUsd))).join(", ")}</p>}
          {s.engine ? <div className="mt-3 rounded-xl border border-white/[0.08] bg-slate-950/40 p-3 text-xs leading-5">
            <p className={s.engine.agrees ? "text-emerald-200" : "text-slate-300"}>📈 Chart (1h, {s.symbol}): bias {s.engine.bias} · {s.engine.regime} · {s.engine.trendFrames}/3 frames · {s.engine.agrees ? "agrees with the whales" : "does not confirm yet"}</p>
            <p className="mt-1 font-mono text-slate-200">🛑 Stop idea {formatPrice(s.engine.stop)} (1.5 ATR beyond their entry) · 🎯 {s.engine.targets.map(t => formatPrice(t)).join(" / ")} (1R / 2R / 3R)</p>
          </div> : <p className="mt-3 text-xs text-slate-500">Not listed on Bybit; information only.</p>}
          <p className="mt-2 text-xs leading-5 text-slate-400">{s.note}</p>
          <div className="mt-3 flex flex-wrap gap-2"><WatchButton coin={s.coin}/></div>
          <WhaleAnalysisPanel coin={s.coin} side={s.side}/>
        </article>)}
    </section>}
    {tab === "signals" && data && data.signals.some(s => s.status === "WEAK") && <section className="mt-4">
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">📋 Building (not yet confirmed)</h2>
      <ul className="mt-2 grid gap-2 text-xs text-slate-300 lg:grid-cols-2">{data.signals.filter(s => s.status === "WEAK").map(s => <li key={s.coin + s.side} className="rounded-xl border border-white/[0.07] bg-slate-950/40 p-3"><span className="font-semibold text-white">{s.side === "LONG" ? "🟢" : "🔴"} {s.coin} {s.side}</span> · {s.whales.map(w => w.label + " " + w.kind.toLowerCase() + " " + formatUsd(Math.max(0, w.deltaUsd))).join(", ")}<br/><span className="text-slate-400">{s.note}</span></li>)}</ul>
    </section>}

    {tab === "feed" && analyseCoin && <div className="mt-4 rounded-2xl border border-violet-300/30 bg-violet-300/[0.05] p-4"><p className="text-sm font-semibold text-white">{analyseCoin.coin} {analyseCoin.side}</p><WhaleAnalysisPanel key={analyseCoin.coin + analyseCoin.side} coin={analyseCoin.coin} side={analyseCoin.side}/></div>}
    {tab === "feed" && <section className="mt-4 overflow-x-auto rounded-2xl border border-white/[0.08] bg-slate-950/40">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-slate-500"><th className="p-2 font-medium">Time</th><th className="p-2 font-medium">Whale</th><th className="p-2 font-medium">Event</th><th className="p-2 font-medium">Coin</th><th className="p-2 text-right font-medium">Size change</th><th className="p-2 text-right font-medium">Entry</th><th className="p-2 text-right font-medium">P&amp;L</th><th className="p-2 text-right font-medium">Held</th><th className="p-2 font-medium"></th></tr></thead>
        <tbody>{(data?.events ?? []).map(e => { const r = rankBy.get(e.trader); return <tr key={e.id} className="border-t border-white/[0.05] font-mono text-slate-200">
          <td className="p-2 whitespace-nowrap text-slate-400">{melbourne(e.at)}</td>
          <td className="p-2 whitespace-nowrap">{e.trader} {r && <span className={"ml-1 rounded px-1 font-sans text-[10px] " + tierTone[r.tier]}>#{r.rank}</span>}</td>
          <td className={"p-2 font-semibold " + kindTone[e.kind]}>{e.kind} {e.side}</td>
          <td className="p-2">{e.coin}</td>
          <td className="p-2 text-right">{(e.deltaUsd >= 0 ? "+" : "−") + formatUsd(Math.abs(e.deltaUsd))}</td>
          <td className="p-2 text-right">{formatPrice(e.entry)}</td>
          <td className={"p-2 text-right " + (e.pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{(e.pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(e.pnl))}</td>
          <td className="p-2 text-right text-slate-400">{e.heldMs ? Math.round(e.heldMs / 3_600_000) + "h" : "new"}</td>
          <td className="p-2 whitespace-nowrap"><button type="button" onClick={() => setAnalyseCoin(current => current?.coin === e.coin && current.side === e.side ? null : { coin: e.coin, side: e.side })} className="rounded-lg border border-white/10 px-2 py-1 font-sans text-[11px] text-cyan-100 hover:bg-white/5">Analyse</button> <button type="button" onClick={() => void toggleWatch(e.coin)} className={"rounded-lg border px-2 py-1 font-sans text-[11px] hover:bg-white/5 " + (watched.has(e.coin) ? "border-violet-300/40 text-violet-100" : "border-white/10 text-slate-300")}>{watched.has(e.coin) ? "👁 on" : "👁"}</button></td>
        </tr>; })}</tbody>
      </table>
      {data && data.events.length === 0 && <p className="p-4 text-sm text-slate-400">No events yet. The first snapshot records existing positions as the baseline; opens, adds, reductions, closes and flips appear from the next change on (snapshots every 3 minutes).</p>}
    </section>}

    {tab === "ranks" && <section className="mt-4 overflow-x-auto rounded-2xl border border-white/[0.08] bg-slate-950/40">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-slate-500"><th className="p-2 font-medium">#</th><th className="p-2 font-medium">Whale</th><th className="p-2 font-medium">Tier</th><th className="p-2 text-right font-medium">Account</th><th className="p-2 text-right font-medium">Day</th><th className="p-2 text-right font-medium">Week</th><th className="p-2 text-right font-medium">Month</th><th className="p-2 text-right font-medium">Month ROI</th><th className="p-2 text-right font-medium">All time</th><th className="p-2 text-right font-medium">Tracked closes</th><th className="p-2 text-right font-medium">Score</th></tr></thead>
        <tbody>{(data?.ranks ?? []).map(r => <tr key={r.trader} className="border-t border-white/[0.05] font-mono text-slate-200">
          <td className="p-2">{r.rank}</td><td className="p-2">{r.label}</td><td className="p-2"><span className={"rounded px-1 font-sans " + tierTone[r.tier]}>{r.tier}</span>{r.marketMaker && <span className="ml-1 rounded bg-white/10 px-1 font-sans text-[10px] text-slate-300" title="Many simultaneous positions: hedging flow, not a directional call">MM</span>}</td>
          <td className="p-2 text-right">{formatUsd(r.accountValue)}</td>
          {(["day", "week", "month"] as const).map(w => <td key={w} className={"p-2 text-right " + (r.windows[w].pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{(r.windows[w].pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(r.windows[w].pnl))}</td>)}
          <td className="p-2 text-right">{(r.windows.month.roi * 100).toFixed(1)}%</td>
          <td className={"p-2 text-right " + (r.windows.allTime.pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{(r.windows.allTime.pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(r.windows.allTime.pnl))}</td>
          <td className="p-2 text-right">{r.trackedCloses}{r.trackedWinRate !== null ? " · " + Math.round(r.trackedWinRate * 100) + "% win" : ""}</td>
          <td className="p-2 text-right">{r.score.toFixed(1)}</td>
        </tr>)}</tbody>
      </table>
    </section>}

    {tab === "rules" && data && <section className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-white/[0.08] bg-slate-950/40 p-4 text-sm leading-6 text-slate-300">
        <h2 className="font-semibold text-white">How the engine decides</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Universe:</b> the 60 most profitable Hyperliquid accounts over 30 days with at least $1M, refreshed daily from the public leaderboard.</li>
          <li><b>History:</b> every position snapshot (3 min) is diffed into OPEN, ADD (+15% size), REDUCE, CLOSE and FLIP events and stored permanently, with the P&amp;L at the time.</li>
          <li><b>Market makers:</b> accounts holding more than 15 positions at once are hedging books; they are listed (MM) but never confirm a direction. Changes under $50K are not recorded.</li>
          <li><b>Ranking:</b> consistency first: a point per profitable window (day, week, month, all time), 30-day ROI capped, and our own tracked closes once a whale has five or more. Elite = top 10, Strong = next 15.</li>
          <li><b>Confirmation:</b> a signal needs ranked whales opening or adding the same side of a coin within 12 hours (two whales, or one elite with $1M+ of new money). Adds to positions already over 5% in profit and older than a day count at 40%: that is yesterday&apos;s call. Ranked whales on the other side subtract. Price more than 2% past their average entry is &quot;ran away&quot;: wait for a pullback.</li>
          <li><b>Own logic:</b> the whales give direction and entry area; the Bybit 1H chart gives the risk. Stop 1.5 ATR beyond their average entry, targets at 1R, 2R and 3R, and the scanner&apos;s trend read says whether the chart agrees.</li>
          <li><b>No execution.</b> Copy trading is not introduced until API accuracy, historical profitability and live signal performance are verified from this history.</li>
        </ul>
      </div>
      <div className="rounded-2xl border border-white/[0.08] bg-slate-950/40 p-4 text-sm leading-6 text-slate-300">
        <h2 className="font-semibold text-white">Telegram alerts</h2>
        <p className="mt-1 text-xs text-slate-400">Confirmed whale signals (confidence 55%+) and opens, closes and flips by ranked whales of $250K+.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={data.settings.alerts ? "default" : "outline"} onClick={() => void saveSettings({ alerts: !data.settings.alerts })} className="rounded-lg">{data.settings.alerts ? "Alerts on" : "Alerts off"}</Button>
          <Button type="button" size="sm" variant={data.settings.minTier === "ELITE" ? "default" : "outline"} onClick={() => void saveSettings({ minTier: "ELITE" })} className="rounded-lg">Elite only</Button>
          <Button type="button" size="sm" variant={data.settings.minTier === "STRONG" ? "default" : "outline"} onClick={() => void saveSettings({ minTier: "STRONG" })} className="rounded-lg">Elite + strong</Button>
        </div>
        <label className="mt-3 block text-xs text-slate-400">Coins for event alerts (blank = all): <input defaultValue={data.settings.coins.join(", ")} onBlur={e => void saveSettings({ coins: e.target.value.split(/[,\s]+/).filter(Boolean) })} placeholder="BTC, ETH, SOL" className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 font-mono text-slate-100"/></label>
      </div>
    </section>}
  </main>;
}

/** Type any coin to get the full whale + chart + planner read without leaving the section. */
function AnalyseAnyCoin() {
  const [coin, setCoin] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  return <div className="mt-4 rounded-2xl border border-white/[0.08] bg-slate-950/40 p-3">
    <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); const c = coin.trim().toUpperCase().replace(/USDT$/, ""); if (c) setTarget(c); }}>
      <label className="text-xs text-slate-400" htmlFor="whale-coin">Full entry analysis for any coin</label>
      <input id="whale-coin" value={coin} onChange={e => setCoin(e.target.value)} placeholder="BTC, ETH, SOL, kPEPE…" className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 font-mono text-sm text-slate-100"/>
      <Button type="submit" size="sm" className="rounded-lg">Analyse</Button>
    </form>
    {target && <div className="mt-3"><p className="text-sm font-semibold text-white">{target}</p><WhaleAnalysisPanel key={target} coin={target}/></div>}
  </div>;
}
