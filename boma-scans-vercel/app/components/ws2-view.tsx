"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fmt, type Levels } from "@/app/lib/ws2/engine";
import { spanWords, type Ws2Calibration, type Ws2Rated as Ws2Result } from "@/app/lib/ws2/rating";
import type { Ws2LogEntry, Ws2Performance } from "@/app/lib/ws2/outcomes";
import type { Ws2Source } from "@/app/lib/ws2/registry";

type Settings = { watch: string[]; alerts: boolean; universe: number; equity: number; riskPct: number; leverage: number };
type BoardRow = { coin: string; symbol: string; at: number; status: string; side: string | null; price: number | null; scores: Record<string, number>; headline: string; squeeze: string; top: string; whales: string; rating?: number | null };
type Stat = { n?: number; filled?: number; avgNetR?: number | null; se?: number | null; won?: number | null };
type Comparison = { builtFrom: { ws2Readings: number; ws2Pairs: number; from: string; to: string }; ws2: Record<string, Stat | Record<string, Stat>>; scanner: { pairs: number; hourlyEvaluations: number; from: string; to: string; levels: Record<string, { signals: number; all: Stat; LONG: Stat; SHORT: Stat }>; windows: Record<string, Record<string, Stat | Record<string, Stat>>> }; earlierBacktest: { withFormingCandles: { n: number; avgRTaker: number }; closedCandlesOnly: { n: number; avgRTaker: number }; sameReplay23Pairs: { n: number; avgNetR: number; se: number } } };
type Overview = { version: string; calibration: Omit<Ws2Calibration, "pairStats">; comparison: Comparison; settings: Settings; log: Ws2LogEntry[]; board: BoardRow[]; performance: Ws2Performance[]; sources: Ws2Source[]; weights: Record<string, number>; thresholds: Record<string, number>; schedule: { ok: boolean; error?: string } | null; error?: string };
const melbourne = (t: number) => new Date(t).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " Melbourne";
const statusTone = (s: string) => s === "ENTRY READY" ? "border-emerald-300/60 bg-emerald-300/[0.12] text-emerald-50" : s === "CHASING RISK" || s === "INVALIDATED" ? "border-rose-300/50 bg-rose-300/[0.10] text-rose-50" : s === "NO TRADE" || s === "DATA UNAVAILABLE" || s === "WATCHING" ? "border-white/15 bg-white/[0.04] text-slate-100" : "border-amber-300/50 bg-amber-300/[0.10] text-amber-50";
const usd = (v: number) => "$" + (v >= 1000 ? Math.round(v).toLocaleString("en-AU") : v.toFixed(2));

function Bar({ label, value, tone, hint }: { label: string; value: number; tone: string; hint?: string }) {
  return <div title={hint}><p className="flex justify-between text-xs text-slate-300"><span>{label}</span><b className="font-mono text-white">{value}</b></p><div className="mt-0.5 h-2 overflow-hidden rounded-full bg-white/10"><div className={"h-full " + tone} style={{ width: Math.max(0, Math.min(100, value)) + "%" }}/></div></div>;
}
function Group({ icon, title, verdict, lines }: { icon: string; title: string; verdict: string; lines: string[] }) {
  return <div className="rounded-xl border border-white/[0.08] bg-slate-950/60 p-3"><p className="text-sm font-bold text-white">{icon} {title}</p><p className="mt-1 text-sm font-semibold text-violet-100">{verdict}</p><ul className="mt-2 space-y-1 text-xs leading-5 text-slate-300">{lines.map(l => <li key={l}>• {l}</li>)}</ul></div>;
}
function LevelsCard({ title, lv, side, note }: { title: string; lv: Levels; side: string; note: string }) {
  return <div className="rounded-xl border border-white/[0.08] bg-slate-950/60 p-3 text-xs leading-5">
    <p className="text-sm font-bold text-white">{title}</p><p className="text-slate-400">{note}</p>
    <p className="mt-2 font-mono text-slate-100">👉 Entry {fmt(lv.entryLow)} – {fmt(lv.entryHigh)}</p>
    <p className="font-mono text-rose-200">❌ Stop {fmt(lv.stop)} ({lv.stopAtr} ATR, {(Math.abs(lv.entry - lv.stop) / lv.entry * 100).toFixed(2)}%)</p>
    {lv.targets.map((t, i) => <p key={t.price} className="font-mono text-emerald-200">🎯 TP{i + 1} {fmt(t.price)} · {t.r}R <span className="font-sans text-[10px] text-slate-500">{t.source}</span></p>)}
    <p className="mt-1 text-slate-300">⚖️ Weighted reward {lv.weightedR}R across the five targets (30/25/20/15/10%). This is the expected reward, not the distance to TP5.</p>
    <p className="mt-2 text-slate-300">💰 If it activates ({side}): risk {usd(lv.size.riskUsd)} → quantity {lv.size.qty.toFixed(3)} · notional {usd(lv.size.notional)} · margin {usd(lv.size.margin)} · est. liquidation {fmt(lv.size.estLiquidation)} {lv.size.liquidationSafe ? "(safely beyond the stop)" : "⚠️ too close to the stop: lower the leverage"}</p>
  </div>;
}

function ResultView({ r }: { r: Ws2Result }) {
  const s = r.scores;
  return <div className="space-y-3">
    <div className={"rounded-2xl border-2 p-4 " + statusTone(r.status)}>
      <p className="text-xs font-bold uppercase tracking-widest opacity-80">{r.coin} · {r.symbol} · {r.price ? fmt(r.price) : "no price"} · {melbourne(r.at)}</p>
      <p className="mt-1 text-2xl font-black">{r.status}{r.side ? " · bias " + r.side : ""}</p>
      <p className="mt-1 text-base font-semibold leading-6">✅ What to do: {r.headline}</p>
      <p className="mt-2 text-sm leading-6">💰 Position size: {r.sizing}</p>
    </div>
    <div className={"rounded-2xl border-2 p-4 " + (r.calibration.flags.length ? "border-amber-300/50 bg-amber-300/[0.06]" : "border-cyan-300/40 bg-cyan-300/[0.06]")}>
      <p className="text-xs font-bold uppercase tracking-widest text-cyan-200">🎓 Calibrated rating and track record</p>
      {r.calibration.lead && r.side ? <>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-3xl font-black text-white">{r.calibration.lead.rating}<span className="text-base font-semibold text-slate-400">/10</span></p>
          <div className="flex gap-0.5" aria-hidden>{Array.from({ length: 10 }, (_, i) => <span key={i} className={"h-5 w-3 rounded-sm " + (i < r.calibration.lead!.rating ? (r.calibration.lead!.rating <= 2 ? "bg-rose-400" : r.calibration.lead!.rating <= 5 ? "bg-amber-400" : "bg-emerald-400") : "bg-white/10")}/>)}</div>
          <p className="text-sm text-slate-200">Finished in profit <b>{Math.round(r.calibration.lead.won * 100)}%</b> of the time · average <b>{(r.calibration.lead.avgNetR >= 0 ? "+" : "−") + Math.abs(r.calibration.lead.avgNetR).toFixed(2)}R</b> after fees · {r.calibration.lead.n.toLocaleString("en-AU")} unseen setups</p>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-100">{r.calibration.leadPlain}</p>
        {r.calibration.flags.length > 0 && <div className="mt-2 rounded-lg border border-amber-300/40 bg-amber-300/[0.08] p-2 text-sm leading-6 text-amber-50"><p className="text-xs font-bold uppercase tracking-widest">🚩 Flags · information only, nothing is blocked</p><ul className="mt-1 space-y-0.5">{r.calibration.flags.map(f => <li key={f}>{f}</li>)}</ul></div>}
        {r.calibration.weekday && !r.calibration.weekday.early && <p className="mt-1 text-sm leading-6 text-slate-200">📅 {r.calibration.weekday.note}</p>}
        <p className="mt-1 text-xs text-slate-400">Both sides, for comparison: {(["LONG", "SHORT"] as const).map(sd => sd + " pullback " + (r.calibration.ratings[sd].pullback ? r.calibration.ratings[sd].pullback!.rating + "/10" : "n/a") + ", market " + (r.calibration.ratings[sd].market ? r.calibration.ratings[sd].market!.rating + "/10" : "n/a")).join(" · ")}</p>
        {r.calibration.pair && r.calibration.pair.ratedSetups >= 20 && r.calibration.pair.avgNetR !== null && <p className="mt-1 text-xs text-slate-300">📒 {r.symbol} itself: {r.calibration.pair.ratedSetups} well-rated setups (8–10) over the whole test averaged {(r.calibration.pair.avgNetR >= 0 ? "+" : "−") + Math.abs(r.calibration.pair.avgNetR).toFixed(2)}R, {Math.round((r.calibration.pair.won ?? 0) * 100)}% in profit. Small sample.</p>}
      </> : <p className="mt-1 text-sm text-slate-300">{r.calibration.leadPlain}</p>}
    </div>
    <div className="rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">📊 Independent scores (0–100 each)</p>
      <p className="mt-1 text-xs leading-5 text-cyan-100">{r.scoreNote}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Bar label="Bullish directional bias" value={s.bullishBias} tone="bg-emerald-400"/><Bar label="Bearish directional bias" value={s.bearishBias} tone="bg-rose-400"/>
        <Bar label="Risk-adjusted opportunity" value={s.opportunity} tone="bg-cyan-400"/>
        <Bar label="LONG entry quality" value={s.longEntry} tone="bg-emerald-400/70"/><Bar label="SHORT entry quality" value={s.shortEntry} tone="bg-rose-400/70"/>
        <Bar label="Market exhaustion risk" value={s.exhaustion} tone="bg-amber-400"/>
        <Bar label="Long-squeeze potential" value={s.longSqueeze} tone="bg-rose-300/70" hint="Longs being forced out: price falls"/><Bar label="Short-squeeze potential" value={s.shortSqueeze} tone="bg-emerald-300/70" hint="Shorts being forced out: price rises"/>
        <Bar label="Data reliability" value={s.reliability} tone="bg-violet-400"/>
      </div>
      <p className="mt-2 text-xs text-slate-400">Bullish and bearish do not add up to 100. Both can be low at once, and then the answer is no trade.</p>
    </div>
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4 text-sm leading-6"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">⏳ Wait for (what activates the trade)</p><ul className="mt-1 space-y-1 text-slate-100">{r.activate.map(a => <li key={a}>• {a}</li>)}</ul></div>
      <div className="rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4 text-sm leading-6"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">⛔ Invalid if</p><ul className="mt-1 space-y-1 text-slate-100">{r.invalidate.map(a => <li key={a}>• {a}</li>)}</ul></div>
    </div>
    <div className="rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">❓ In plain words</p>
      <dl className="mt-2 grid gap-3 text-sm leading-6 lg:grid-cols-2">{r.explain.map(e => <div key={e.q}><dt className="font-semibold text-white">{e.q}</dt><dd className="text-slate-300">{e.a}</dd></div>)}</dl>
    </div>
    <div className="grid gap-3 lg:grid-cols-3">
      <Group icon="🐋" title="Whales (ranked Hyperliquid accounts)" verdict={r.whales.verdict} lines={r.whales.lines}/>
      <Group icon="🏦" title="Exchange top traders" verdict={r.institutions.verdict} lines={r.institutions.lines}/>
      <Group icon="👥" title="Retail crowd" verdict={r.retail.verdict} lines={r.retail.lines}/>
      <Group icon="💸" title="Funding" verdict={r.fundingRead.verdict} lines={r.fundingRead.lines}/>
      <Group icon="📈" title="Open interest (coins vs USD)" verdict={r.oi ? "Coins 24 h " + (r.oi.coinChange24h === null ? "n/a" : (r.oi.coinChange24h * 100).toFixed(1) + "%") + " · USD 24 h " + (r.oi.usdChange24h === null ? "n/a" : (r.oi.usdChange24h * 100).toFixed(1) + "%") : "UNAVAILABLE"} lines={r.oi ? [r.oi.read] : ["No open-interest history."]}/>
      <Group icon="₿" title="Bitcoin context" verdict={r.btc.verdict} lines={r.btc.lines}/>
    </div>
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4 text-sm leading-6">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">🔥 Squeeze lifecycle</p>
        <p className="mt-1"><b className="text-rose-200">Long squeeze (longs forced out):</b> {r.squeeze.long.stage}</p><p className="text-xs text-slate-300">{r.squeeze.long.note}</p>
        <p className="mt-2"><b className="text-emerald-200">Short squeeze (shorts forced out):</b> {r.squeeze.short.stage}</p><p className="text-xs text-slate-300">{r.squeeze.short.note}</p>
      </div>
      <div className="rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4 text-sm leading-6">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">🥵 Has the move already happened? Exhaustion {s.exhaustion}/100</p>
        <ul className="mt-1 space-y-0.5 text-xs text-slate-300">{r.exhaustion.parts.map(p => <li key={p}>• {p}</li>)}</ul>
      </div>
    </div>
    {r.side && (r.levels.pullback || r.levels.market) && <div className="grid gap-3 lg:grid-cols-2">
      {r.levels.pullback && <LevelsCard title={"Pullback entry (" + r.side + ")"} lv={r.levels.pullback} side={r.side} note="Preferred: wait for price to come to you. Cancelled, with no loss recorded, if the stop level trades first."/>}
      {r.levels.market && <LevelsCard title={"Market entry now (" + r.side + ")"} lv={r.levels.market} side={r.side} note="Recalculated from the current price with its own stop and targets. Only for ENTRY READY."/>}
    </div>}
    <details className="rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-white">🔍 Score breakdown: every component, its weight and raw values</summary>
      <table className="mt-3 w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="pr-2 font-medium">Component</th><th className="pr-2 text-right font-medium">Weight</th><th className="pr-2 text-right font-medium">Bull pts</th><th className="pr-2 text-right font-medium">Bear pts</th><th className="font-medium">Read</th></tr></thead>
        <tbody>{r.components.map(c => <tr key={c.key} className="border-t border-white/[0.05] align-top"><td className="pr-2 py-1 text-slate-100">{c.label}</td><td className="pr-2 py-1 text-right font-mono">{c.weight}</td><td className="pr-2 py-1 text-right font-mono text-emerald-300">{c.available ? (c.weight * c.bull).toFixed(1) : "—"}</td><td className="pr-2 py-1 text-right font-mono text-rose-300">{c.available ? (c.weight * c.bear).toFixed(1) : "—"}</td><td className="py-1 text-slate-300">{c.note}{c.raw.length > 0 && <span className="block text-[11px] text-slate-500">{c.raw.join(" · ")}</span>}</td></tr>)}</tbody></table>
      <p className="mt-2 text-xs text-slate-400">An unavailable component adds nothing to either side, and its weight is not handed to the others.</p>
    </details>
    <details className="rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-white">📡 Data feeds used for this reading ({s.reliability}/100 reliable)</summary>
      <ul className="mt-2 space-y-1 text-xs">{r.feeds.map(f => <li key={f.name} className={f.available ? "text-emerald-200" : "text-amber-200"}>{f.available ? "✔" : "✖"} {f.name} <span className="text-slate-400">· {f.detail} · worth {f.weight}</span></li>)}</ul>
    </details>
  </div>;
}

const rs = (s?: Stat) => !s || s.avgNetR === undefined || s.avgNetR === null ? "n/a" : (s.avgNetR >= 0 ? "+" : "−") + Math.abs(s.avgNetR).toFixed(2) + "R";
const rn = (s?: Stat) => ((s?.filled ?? s?.n ?? 0)).toLocaleString("en-AU");
/** Scanner and System 2 on the same footing, and the one timing effect both showed. */
function ComparisonReport({ c }: { c: Comparison }) {
  const w = c.ws2 as Record<string, Stat>; const days = c.ws2["lead side by weekday"] as Record<string, Stat>; const sw = c.scanner.windows["major-event setups"]; const sd = sw.byWeekday as Record<string, Stat>;
  const lv = c.scanner.levels; const rows: Array<[string, Stat, Stat?, Stat?]> = [
    ["Scanner · every setup the engine calls", lv["all setups (engine calls a setup)"].all, lv["all setups (engine calls a setup)"].LONG, lv["all setups (engine calls a setup)"].SHORT],
    ["Scanner · setups with a major event (CHoCH, break or sweep; stop 2+ ATR)", lv["setups with a major event (CHoCH, break, sweep; stop 2+ ATR)"].all, lv["setups with a major event (CHoCH, break, sweep; stop 2+ ATR)"].LONG, lv["setups with a major event (CHoCH, break, sweep; stop 2+ ATR)"].SHORT],
    ["Scanner · READY (every check passed)", lv["READY (every check passed)"].all, lv["READY (every check passed)"].LONG, lv["READY (every check passed)"].SHORT],
    ["System 2 · ENTRY READY", w["ENTRY READY, all days"]], ["System 2 · any reading with a lead side", w["lead side, all days"]],
    ["No system · always LONG", w["always LONG"]], ["No system · always SHORT", w["always SHORT"]]];
  return <div className="space-y-4 rounded-2xl border-2 border-fuchsia-300/30 bg-fuchsia-300/[0.04] p-4">
    <div>
      <h2 className="font-semibold text-white">⚖️ Scanner and System 2 compared on the same footing</h2>
      <p className="mt-1">Both engines were replayed over the same three years ({c.builtFrom.from} to {c.builtFrom.to}) on every Bybit crypto pair, with the same rules: no look-ahead, partial exits at the five targets, the stop never moved, fees and slippage deducted. The Scanner was checked every hour ({c.scanner.hourlyEvaluations.toLocaleString("en-AU")} checks on {c.scanner.pairs} pairs); System 2 every four hours ({c.builtFrom.ws2Readings.toLocaleString("en-AU")} readings).</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-100">
        <li><b>Neither system showed a profit edge.</b> Both lose less than entering at random.</li>
        <li><b>The Scanner&apos;s READY signals did worst</b> ({rs(lv["READY (every check passed)"].all)}); its setups with a major event did best (about break-even).</li>
        <li><b>LONG entries lost in both systems.</b> SHORT entries were about break-even.</li>
        <li><b>Monday and Tuesday (Melbourne) lost money in both systems, in all three years.</b> Other days were about break-even. Opening hours made no difference.</li>
        <li><b>Trading against a stretched move was tested and was worse</b> than following the bias (about −0.08 to −0.10R).</li>
      </ul>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-slate-500">{["Rule", "Trades", "Finished in profit", "Average result", "± error", "LONG only", "SHORT only"].map(h => <th key={h} className="p-1.5 font-medium">{h}</th>)}</tr></thead>
      <tbody>{rows.map(([label, a, l, s]) => <tr key={label} className="border-t border-white/[0.05]"><td className="p-1.5 text-slate-100">{label}</td><td className="p-1.5 font-mono">{rn(a)}</td><td className="p-1.5 font-mono">{a?.won !== undefined && a?.won !== null ? Math.round(a.won * 100) + "%" : "n/a"}</td><td className={"p-1.5 font-mono " + ((a?.avgNetR ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{rs(a)}</td><td className="p-1.5 font-mono text-slate-400">{a?.se !== undefined && a?.se !== null ? a.se.toFixed(2) : ""}</td><td className="p-1.5 font-mono">{l ? rs(l) : ""}</td><td className="p-1.5 font-mono">{s ? rs(s) : ""}</td></tr>)}</tbody></table></div>
    <div className="overflow-x-auto"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Day of the week (Melbourne time): average result after fees</p>
      <table className="mt-1 w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="p-1.5 font-medium">System</th>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => <th key={d} className="p-1.5 font-medium">{d}</th>)}</tr></thead>
        <tbody>{([["System 2 · lead side", days], ["Scanner · major-event setups", sd]] as const).map(([label, d]) => <tr key={label} className="border-t border-white/[0.05]"><td className="p-1.5 text-slate-100">{label}</td>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(k => <td key={k} className={"p-1.5 font-mono " + ((d[k]?.avgNetR ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{rs(d[k])}</td>)}</tr>)}</tbody></table>
      <p className="mt-1 text-xs text-slate-300">Scanner major-event setups outside Monday, Tuesday and 03:00–10:00: {rs(sw["inside the backtested windows"] as Stat)} over {rn(sw["inside the backtested windows"] as Stat)} trades, positive in each year. On Monday or Tuesday: {rs(sw["Monday or Tuesday"] as Stat)}. Between 03:00 and 10:00 on any day: {rs(sw["03:00–10:00 any day"] as Stat)}, no different from other hours.</p></div>
    <p className="text-xs text-slate-400">The earlier Scanner backtest (23 pairs, about 185 trades) reported better figures. Re-run on the current engine it gives {c.earlierBacktest.withFormingCandles.avgRTaker >= 0 ? "+" : "−"}{Math.abs(c.earlierBacktest.withFormingCandles.avgRTaker).toFixed(2)}R after taker fees; that harness also let the engine see unfinished 4-hour and daily candles, and with that closed it gives +{c.earlierBacktest.closedCandlesOnly.avgRTaker.toFixed(2)}R. On those same 23 pairs this replay gives −{Math.abs(c.earlierBacktest.sameReplay23Pairs.avgNetR).toFixed(2)}R ± {c.earlierBacktest.sameReplay23Pairs.se.toFixed(2)}: a sample that small cannot tell a small gain from a small loss. Not replayed for either system: the AI second read, whale positions and exchange top-trader ratios.</p>
  </div>;
}
const rr = (v?: number) => v === undefined ? "n/a" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) + "R";
/** What the calibration test found, with the real numbers. */
function CalibrationReport({ cal }: { cal: Omit<Ws2Calibration, "pairStats"> }) {
  const periods = [["train", "Fitting period"], ["val", "Check 1 (unseen)"], ["test", "Check 2 (unseen)"]] as const;
  return <div className="space-y-4 rounded-2xl border-2 border-cyan-300/30 bg-cyan-300/[0.04] p-4">
    <div>
      <h2 className="font-semibold text-white">🎓 Calibration: what was tested and what it showed</h2>
      <p className="mt-1">The engine was replayed every 4 hours over <b>{cal.pairs} Bybit crypto pairs</b> from {cal.from} to {cal.to} ({spanWords(cal)}): <b>{cal.samples.toLocaleString("en-AU")} readings</b>. At each one it saw only data that existed then. Both the LONG and the SHORT plan were then played forward on 15-minute candles with partial exits at the five targets, the stop never moved, and fees and slippage deducted. A rating model was fitted on the oldest 60% and checked on the newest 40%.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-100">
        <li><b>The rating works for avoiding bad trades.</b> Setups rated 1/10 lost {Math.abs(cal.models.market.deciles[0].check.avgNetR).toFixed(2)}R on average in the unseen data; setups rated 8–10 were close to break-even.</li>
        <li><b>No group of setups made money after fees.</b> Even the best rating averaged {rr(cal.models.market.deciles[9].check.avgNetR)}. System 2 has not shown a profit edge.</li>
        <li><b>The trend inputs did not predict direction.</b> The bias scored {cal.directionAuc.test["bias vs 24h direction"].toFixed(2)} to {cal.directionAuc.train["bias vs 24h direction"].toFixed(2)} against the next 24 hours, where 0.50 is a coin flip.</li>
        <li><b>The typical coin drifted down in every half-year tested</b>, so shorts beat longs throughout. That is the market, not skill: compare the &quot;always SHORT&quot; rows. LONG entries lost money in all three periods.</li>
      </ul>
    </div>
    <div className="overflow-x-auto"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Rating table (market entry, unseen data)</p>
      <table className="mt-1 w-full text-xs"><thead><tr className="text-left text-slate-500">{["Rating", "Setups", "Finished in profit", "Average result", "± error", "Check 1", "Check 2"].map(h => <th key={h} className="p-1.5 font-medium">{h}</th>)}</tr></thead>
        <tbody>{cal.models.market.deciles.map(d => <tr key={d.decile} className="border-t border-white/[0.05] font-mono"><td className={"p-1.5 font-bold " + (d.decile <= 2 ? "text-rose-300" : d.decile <= 5 ? "text-amber-200" : "text-emerald-300")}>{d.decile}/10{d.decile <= 2 ? " flagged" : ""}</td><td className="p-1.5">{d.check.n.toLocaleString("en-AU")}</td><td className="p-1.5">{Math.round(d.check.won * 100)}%</td><td className={"p-1.5 " + (d.check.avgNetR >= 0 ? "text-emerald-300" : "text-rose-300")}>{rr(d.check.avgNetR)}</td><td className="p-1.5 text-slate-400">{d.check.se.toFixed(2)}</td><td className="p-1.5">{rr(d.val.avgNetR)}</td><td className="p-1.5">{rr(d.test.avgNetR)}</td></tr>)}</tbody></table></div>
    <div className="overflow-x-auto"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Rules compared, by period (average result after fees · number of trades)</p>
      <table className="mt-1 w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="p-1.5 font-medium">Rule</th>{periods.map(([k, label]) => <th key={k} className="p-1.5 font-medium">{label}<span className="block font-normal text-[10px]">{cal.regime[k].from} → {cal.regime[k].to} · typical coin {cal.regime[k].typicalCoin24hPct}%/day</span></th>)}</tr></thead>
        <tbody>{Object.keys(cal.rules.train).map(rule => <tr key={rule} className="border-t border-white/[0.05]"><td className="p-1.5 text-slate-100">{rule}</td>{periods.map(([k]) => { const c = cal.rules[k][rule]; return <td key={k} className={"p-1.5 font-mono " + ((c?.avgNetR ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{rr(c?.avgNetR)} <span className="text-slate-500">· {c?.n.toLocaleString("en-AU")}{c?.se !== undefined ? " · ±" + c.se.toFixed(2) : ""}</span></td>; })}</tr>)}</tbody></table></div>
    <div className="overflow-x-auto"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Did each input predict the next 24 hours? (0.50 = coin flip)</p>
      <table className="mt-1 w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="p-1.5 font-medium">Input</th>{periods.map(([k, label]) => <th key={k} className="p-1.5 font-medium">{label}</th>)}</tr></thead>
        <tbody>{Object.entries(cal.componentAuc24h).map(([k, v]) => <tr key={k} className="border-t border-white/[0.05] font-mono"><td className="p-1.5 font-sans text-slate-100">{k}</td>{periods.map(([p]) => <td key={p} className="p-1.5">{v[p].toFixed(3)}</td>)}</tr>)}</tbody></table></div>
    {cal.blocks && cal.blocks.length > 0 && <div className="overflow-x-auto"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Half-year by half-year (average result after fees · trades)</p>
      <table className="mt-1 w-full text-xs"><thead><tr className="text-left text-slate-500">{["Period", "Pairs", "Typical coin / day", "ENTRY READY", "Rating 9–10", "Rating 1–2", "Always LONG", "Always SHORT", "Bias vs direction"].map(h => <th key={h} className="p-1.5 font-medium">{h}</th>)}</tr></thead>
        <tbody>{cal.blocks.map(b => { const cell = (k: string) => { const c = b.rules[k]; return <td key={k} className={"p-1.5 font-mono " + ((c?.avgNetR ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{rr(c?.avgNetR)} <span className="text-slate-500">· {c?.n.toLocaleString("en-AU")}</span></td>; }; return <tr key={b.from} className="border-t border-white/[0.05]"><td className="p-1.5 text-slate-100">{b.from} → {b.to}{b.unseen ? <span className="ml-1 rounded bg-cyan-300/20 px-1 text-[10px] text-cyan-100">unseen</span> : null}</td><td className="p-1.5 font-mono">{b.pairs}</td><td className="p-1.5 font-mono">{b.typicalCoin24hPct}%</td>{["0.1 ENTRY READY (market)", "any lead side, rating 9-10 (market)", "any lead side, rating 1-2 (market)", "reference: always LONG (market)", "reference: always SHORT (market)"].map(cell)}<td className="p-1.5 font-mono">{b.biasVs24h.toFixed(2)}</td></tr>; })}</tbody></table></div>}
    <p className="text-xs text-slate-400">Limits: the typical coin drifted down in every half-year of the test, so a broad rising market is not represented; only pairs still listed today are included; samples every 4 hours overlap, so errors are grouped by time; whale positions, exchange top-trader ratios, taker flow and liquidations have no history and were not tested; the pooled model is one model for all pairs because a single pair has too few samples. Re-run the calibration after the market changes character. Model {cal.version}.</p>
  </div>;
}

/** Whale System 2: a separate system. It reads the other systems' data but changes nothing in them. */
export function Ws2View() {
  const [tab, setTab] = useState<"board" | "analyse" | "log" | "method">("board");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [coin, setCoin] = useState(""); const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [result, setResult] = useState<Ws2Result | null>(null);
  const load = useCallback(async () => { try { const d = await (await fetch("/api/ws2", { cache: "no-store" })).json() as Overview; if (d.error) setError(d.error); else setOverview(d); } catch { setError("Whale System 2 is unavailable."); } }, []);
  const analyse = useCallback(async (c: string) => {
    const clean = c.trim(); if (!clean) return;
    setBusy(clean); setError("");
    try { const d = await (await fetch("/api/ws2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "analyse", coin: clean }) })).json() as { result?: Ws2Result; error?: string }; if (d.result) { setResult(d.result); setTab("analyse"); void load(); } else setError(d.error ?? "Analysis failed."); }
    catch { setError("Analysis failed."); } finally { setBusy(""); }
  }, [load]);
  useEffect(() => { void load(); const c = new URLSearchParams(window.location.search).get("coin"); if (c) { setCoin(c); void analyse(c); } }, [load, analyse]);
  const save = async (patch: Partial<Settings>) => { const d = await (await fetch("/api/ws2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", ...patch }) })).json() as { settings?: Settings }; if (d.settings) setOverview(o => o ? { ...o, settings: d.settings! } : o); };
  const st = overview?.settings;
  return <main className="mx-auto min-h-screen max-w-6xl px-4 pb-24 pt-6 text-slate-100">
    <p className="text-xs font-bold uppercase tracking-widest text-fuchsia-200">Boma Scans · separate system</p>
    <h1 className="mt-1 text-3xl font-bold text-white">🐋² Whale System 2</h1>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">A stricter second opinion. It scores direction, entry timing, exhaustion and data quality separately, and it is allowed to say <b>no trade</b>. It reads the same market and whale data as the other systems but changes nothing in them. It runs in shadow mode: every signal is logged and scored later, so its accuracy is measured before it is trusted.</p>
    <div className="mt-4 flex flex-wrap gap-2">{(["board", "analyse", "log", "method"] as const).map(t => <Button key={t} type="button" size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)} className="rounded-xl">{t === "board" ? "Market board" + (overview ? " · " + overview.board.length : "") : t === "analyse" ? "Analyse one coin" : t === "log" ? "Signal log & performance" + (overview ? " · " + overview.log.length : "") : "Data sources & method"}</Button>)}</div>
    {error && <p className="mt-3 text-sm text-amber-200">{error}</p>}

    {tab === "board" && <section className="mt-4 space-y-3">
      <p className="text-sm leading-6 text-slate-300">Every coin System 2 has read in the last 24 hours, best opportunity first. The automatic scan covers your watchlist every 15 minutes and rotates through the {st?.universe || "watchlist-only"}{st?.universe ? " most-traded Bybit pairs" : ""}, about once an hour. Most rows will say wait or no trade; that is the system working.</p>
      {st && <p className="flex flex-wrap items-center gap-3 text-xs text-slate-300"><label>Scan the top <select value={st.universe} onChange={e => void save({ universe: Number(e.target.value) })} className="rounded border border-white/10 bg-slate-900 px-1 py-0.5"><option value={0}>0 (watchlist only)</option><option value={20}>20</option><option value={40}>40</option><option value={80}>80</option></select> Bybit pairs by turnover</label><label className="flex items-center gap-1"><input type="checkbox" checked={st.alerts} onChange={e => void save({ alerts: e.target.checked })}/> Telegram alert when any scanned coin becomes ENTRY READY</label><Button type="button" size="sm" variant="ghost" onClick={() => void load()} className="rounded-lg">Refresh</Button></p>}
      {overview && overview.board.length === 0 ? <p className="rounded-2xl border border-white/[0.08] bg-slate-950/40 p-4 text-sm text-slate-400">No readings yet. The first automatic scan fills this within 15 minutes, or analyse a coin yourself.</p>
        : overview && <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-slate-950/40"><table className="w-full text-xs"><thead><tr className="text-left text-slate-500">{["Coin", "Status", "Bias", "Rating", "Opp.", "Bull / Bear", "Entry L / S", "Exh.", "Data", "Squeeze stage", "Whales", "Top traders", "Read"].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{overview.board.map(b => <tr key={b.symbol} onClick={() => { setCoin(b.coin); void analyse(b.symbol); }} className="cursor-pointer border-t border-white/[0.05] align-top hover:bg-white/[0.04]">
            <td className="p-2 font-mono font-bold text-white">{b.coin}<span className="block text-[10px] font-normal text-slate-500">{b.price ? fmt(b.price) : ""}</span></td>
            <td className="p-2"><span className={"rounded-full border px-2 py-0.5 font-semibold " + statusTone(b.status)}>{b.status}</span></td>
            <td className={"p-2 font-semibold " + (b.side === "LONG" ? "text-emerald-300" : b.side === "SHORT" ? "text-rose-300" : "text-slate-500")}>{b.side ?? "—"}</td>
            <td className={"p-2 font-mono font-bold " + (!b.rating ? "text-slate-500" : b.rating <= 2 ? "text-rose-300" : b.rating <= 5 ? "text-amber-200" : "text-emerald-300")}>{b.rating ? b.rating + "/10" : "—"}</td><td className="p-2 font-mono text-cyan-200">{b.scores.opportunity}</td><td className="p-2 font-mono">{b.scores.bullishBias} / {b.scores.bearishBias}</td><td className="p-2 font-mono">{b.scores.longEntry} / {b.scores.shortEntry}</td><td className="p-2 font-mono text-amber-200">{b.scores.exhaustion}</td><td className="p-2 font-mono">{b.scores.reliability}</td>
            <td className="p-2 text-slate-300">{b.squeeze}</td><td className="p-2 text-slate-300">{b.whales}</td><td className="p-2 text-slate-300">{b.top.split(":")[0]}</td><td className="p-2 text-slate-400">{melbourne(b.at)}</td>
          </tr>)}</tbody></table></div>}
      <p className="text-xs text-slate-500">Tap a row for the full reading. Rating is the calibrated 1–10 grade from the multi-year test across {overview?.calibration.pairs ?? "all"} pairs; 1–2 is flagged, never blocked.</p>
    </section>}

    {tab === "analyse" && <section className="mt-4 space-y-4">
      <form className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-slate-950/40 p-3" onSubmit={e => { e.preventDefault(); void analyse(coin); }}>
        <label className="text-xs text-slate-400" htmlFor="ws2-coin">Analyse any coin</label>
        <input id="ws2-coin" value={coin} onChange={e => setCoin(e.target.value)} placeholder="NEAR, BTC, SOL…" className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 font-mono text-sm text-slate-100"/>
        <Button type="submit" size="sm" disabled={!!busy} className="rounded-lg">{busy ? "Analysing " + busy + "…" : "Analyse"}</Button>
        {st && st.watch.map(c => <Button key={c} type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => { setCoin(c); void analyse(c); }} className="rounded-lg">{c}</Button>)}
      </form>
      {st && <div className="rounded-2xl border border-white/[0.08] bg-slate-950/40 p-3 text-xs text-slate-300">
        <p className="font-semibold text-white">Priority watchlist (read on every 15-minute scan; the rest of the market rotates hourly)</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {st.watch.map(c => <span key={c} className="rounded-full border border-white/10 px-2 py-0.5 font-mono">{c} <button type="button" aria-label={"Remove " + c} onClick={() => void save({ watch: st.watch.filter(x => x !== c) })} className="ml-1 text-rose-300">×</button></span>)}
          {result && !st.watch.includes(result.coin) && st.watch.length < 8 && <Button type="button" size="sm" variant="outline" onClick={() => void save({ watch: [...st.watch, result.coin] })} className="rounded-lg">+ Watch {result.coin}</Button>}
          <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={st.alerts} onChange={e => void save({ alerts: e.target.checked })}/> Telegram alert on ENTRY READY</label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label>Equity $ <input type="number" defaultValue={st.equity} onBlur={e => void save({ equity: Number(e.target.value) })} className="w-24 rounded border border-white/10 bg-slate-900 px-1 py-0.5 font-mono"/></label>
          <label>Risk per trade <select value={st.riskPct} onChange={e => void save({ riskPct: Number(e.target.value) })} className="rounded border border-white/10 bg-slate-900 px-1 py-0.5"><option value={0.25}>0.25%</option><option value={0.5}>0.5%</option><option value={1}>1%</option></select></label>
          <label>Leverage <input type="number" defaultValue={st.leverage} onBlur={e => void save({ leverage: Number(e.target.value) })} className="w-14 rounded border border-white/10 bg-slate-900 px-1 py-0.5 font-mono"/>x <span className="text-slate-500">(sets margin only, never the size)</span></label>
          <span className="text-slate-500">Scheduler: {overview?.schedule ? (overview.schedule.ok ? "running" : "not registered" + (overview.schedule.error ? " (" + overview.schedule.error + ")" : "")) : "not available here"}</span>
        </div>
      </div>}
      {result ? <ResultView r={result}/> : <p className="rounded-2xl border border-white/[0.08] bg-slate-950/40 p-4 text-sm text-slate-400">Type a coin and press Analyse. Nothing is traded; this system only analyses and records.</p>}
    </section>}

    {tab === "log" && overview && <section className="mt-4 space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">{overview.performance.map(p => <div key={p.window} className="rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4 text-sm leading-6">
        <p className="flex items-center justify-between"><b className="text-white">Last {p.window}</b><span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + (p.sample === "USABLE" ? "bg-emerald-300/20 text-emerald-100" : "bg-amber-300/20 text-amber-100")}>{p.sample}</span></p>
        <p className="text-slate-300">{p.signals} signals logged · {p.scored} scored · {p.filled} filled</p>
        <p className="text-slate-300">TP1 before stop: {p.filled ? p.tp1BeforeStop + " of " + p.filled + " (" + Math.round(p.tp1BeforeStop / p.filled * 100) + "%)" : "none yet"} · stops {p.stops}</p>
        <p className="text-slate-300">Average net result: {p.avgNetR === null ? "n/a" : p.avgNetR + "R after fees"}</p>
        <p className="text-slate-300">Direction right after 4 h: {p.directionJudged ? p.directionRight + " of " + p.directionJudged : "none yet"}</p>
        {p.byStatus.length > 0 && <ul className="mt-1 text-xs text-slate-400">{p.byStatus.map(b => <li key={b.status}>{b.status}: {b.scored} scored, {b.filled} filled, {b.tp1} TP1+, {b.stops} stops{b.avgNetR !== null ? ", " + b.avgNetR + "R avg" : ""}</li>)}</ul>}
      </div>)}</div>
      <p className="text-xs text-slate-400">Shadow mode. Each signal is frozen when issued and scored once against the 15-minute candles that followed: the entry must actually trade within 4 hours; if the stop level trades first the trade is cancelled with no loss; profit is taken in parts at the five targets (30/25/20/15/10%) and the stop is never moved; a stop and target in the same candle counts as a stop; fees and slippage are deducted. Under 30 filled trades the figures prove nothing.</p>
      <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-slate-950/40"><table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="p-2 font-medium">Issued</th><th className="p-2 font-medium">Coin</th><th className="p-2 font-medium">Status</th><th className="p-2 font-medium">Bias</th><th className="p-2 text-right font-medium">Bull / Bear</th><th className="p-2 text-right font-medium">Exh.</th><th className="p-2 font-medium">Plan</th><th className="p-2 font-medium">Outcome</th></tr></thead>
        <tbody>{overview.log.map(e => <tr key={e.id} className="border-t border-white/[0.05] align-top"><td className="p-2 text-slate-400">{melbourne(e.at)}</td><td className="p-2 font-mono text-white">{e.coin}</td><td className="p-2">{e.status}</td><td className="p-2">{e.side ?? "—"}</td><td className="p-2 text-right font-mono">{e.scores.bullishBias} / {e.scores.bearishBias}</td><td className="p-2 text-right font-mono">{e.scores.exhaustion}</td><td className="p-2 font-mono text-slate-300">{e.plan ? fmt(e.plan.entryLow) + "–" + fmt(e.plan.entryHigh) + " · stop " + fmt(e.plan.stop) : "—"}</td><td className="p-2 text-slate-300">{e.outcome ? e.outcome.result + (e.outcome.netR !== null && e.outcome.filled ? " · " + e.outcome.netR + "R" : "") + (e.outcome.forward4hPct !== null ? " · 4 h " + (e.outcome.forward4hPct >= 0 ? "+" : "") + e.outcome.forward4hPct.toFixed(2) + "%" : "") : "pending"}</td></tr>)}</tbody></table></div>
    </section>}

    {tab === "method" && overview && <section className="mt-4 space-y-4 text-sm leading-6 text-slate-300">
      <div className="rounded-2xl border border-white/[0.08] bg-slate-950/50 p-4">
        <h2 className="font-semibold text-white">How Whale System 2 differs from the original whale system</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>LONG and SHORT are scored separately. They do not add up to 100, and both can be poor.</li>
          <li>Direction, entry timing, exhaustion and data quality are four different questions with four different scores.</li>
          <li>Whales: only <b>new</b> exposure counts fully. An old, profitable position is flagged as an old call with profit-taking risk.</li>
          <li>Exchange top traders are shown per exchange and never averaged, because Binance and OKX measure different groups.</li>
          <li>The retail crowd only counts when it is unusual for that coin, and only as squeeze fuel, never as a trigger.</li>
          <li>Open interest is judged in coins. A fall in dollars caused by a falling price is not read as positions closing.</li>
          <li>Funding near zero is called ordinary. It is not read as balanced leverage.</li>
          <li>Position size comes from the stop distance, fees and your risk %, never from how strong the positioning looks.</li>
          <li>Missing data is shown as UNAVAILABLE and scores nothing. Nothing is invented.</li>
        </ul>
        <p className="mt-2 text-cyan-100">Calibrated: see the results below. Whale positions and exchange top-trader ratios have no usable history, so those two inputs remain untested.</p>
        <p className="mt-2 font-mono text-xs">Weights: {Object.entries(overview.weights).map(([k, v]) => k + " " + v).join(" · ")}</p>
        <p className="font-mono text-xs">Thresholds: {Object.entries(overview.thresholds).map(([k, v]) => k + " " + v).join(" · ")}</p>
        <p className="mt-1 text-xs text-slate-500">Model {overview.version}</p>
      </div>
      <ComparisonReport c={overview.comparison}/>
      <CalibrationReport cal={overview.calibration}/>
      <div className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-slate-950/40"><table className="w-full text-xs"><thead><tr className="text-left text-slate-500">{["Metric", "Exchange", "Unit", "Who it covers", "Updates", "History", "If missing", "Limits"].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{overview.sources.map(s => <tr key={s.metric + s.exchange} className="border-t border-white/[0.05] align-top"><td className="p-2 text-white">{s.metric}<span className="block font-mono text-[10px] text-slate-500">{s.endpoint}</span></td><td className="p-2">{s.exchange}</td><td className="p-2">{s.unit}</td><td className="p-2">{s.population}</td><td className="p-2">{s.update}</td><td className="p-2">{s.history}</td><td className="p-2">{s.missing}</td><td className="p-2">{s.limits}</td></tr>)}</tbody></table></div>
    </section>}
  </main>;
}
