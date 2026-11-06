"use client";

import { useState } from "react";
import { Bell, BellRing, CheckCheck, ChevronDown, Copy, Eye, EyeOff, LineChart, Plus, Radio, Target, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { formatPrice, type ScannerRow } from "@/app/lib/market";
import { notificationStatus, snapshotSignal, telegramSignalText, type SignalSnapshot } from "@/app/lib/signal-alerts";
import type { useSignalAlerts } from "@/app/components/use-signal-alerts";
import { EntryInstructions } from "@/app/components/entry-instructions";
import { LevelsPanel } from "@/app/components/levels-panel";
import { useOrderBooks } from "@/app/components/use-order-books";
import type { OrderBookBalance } from "@/app/lib/order-book";
import { InlineChart } from "@/app/components/inline-chart";
import type { useTriggerMonitor } from "@/app/components/use-trigger-monitor";
import type { MonitorEntry } from "@/app/lib/trigger-monitor";
import { formatMonitorDigest, formatMonitorStart, pushTelegramEvents } from "@/app/lib/telegram-events";
import { useEffect } from "react";
import { evaluateMonitor } from "@/app/lib/trigger-monitor";
import { Send } from "lucide-react";

export type SignalTab = "signals" | "notifications";
type Alerts = ReturnType<typeof useSignalAlerts>;

function utc(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-GB", {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC"}) + " UTC";
}

function MonitorButton({active, onToggle}: {active: boolean; onToggle: () => void}) {
  return <Button type="button" variant="outline" onClick={onToggle} aria-pressed={active} className={"rounded-xl " + (active ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "")}>{active ? <Eye className="mr-1.5 h-4 w-4"/> : <EyeOff className="mr-1.5 h-4 w-4"/>}{active ? "Monitoring" : "Monitor"}</Button>;
}

function SignalCard({signal, historical = false, now, onReview, onPaper, row, book, monitored, onToggleMonitor}: {
  signal: SignalSnapshot; historical?: boolean; now: number;
  onReview: () => void; onPaper?: () => void; row?: ScannerRow; book?: OrderBookBalance;
  monitored?: boolean; onToggleMonitor?: () => void;
}) {
  const [copyFallback, setCopyFallback] = useState("");
  const [chartOpen, setChartOpen] = useState(false);
  const bullish = signal.side === "LONG";
  const warning = historical && (signal.withdrawnAt || now >= signal.expiresAt);
  async function copy() {
    const text = telegramSignalText(signal, historical, now);
    try { await navigator.clipboard.writeText(text); toast.success("Telegram-style signal copied"); setCopyFallback(""); }
    catch { setCopyFallback(text); }
  }
  return <article className={"min-w-0 overflow-hidden rounded-2xl border border-l-[3px] bg-[#101923] " + (warning ? "border-slate-600/40 border-l-slate-500" : bullish ? "border-emerald-300/20 border-l-emerald-300" : "border-rose-300/20 border-l-rose-300")}>
    <div className={"border-b border-white/[0.06] p-4 sm:p-5 " + (bullish ? "bg-emerald-300/[0.035]" : "bg-rose-300/[0.035]")}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-widest text-cyan-200">📡 Boma Scans · signal</p><span className="rounded-full border border-white/10 bg-slate-950/40 px-2.5 py-1 text-xs font-semibold text-slate-300">{historical ? notificationStatus(signal, now) : "QUALIFIED SCAN"}</span></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><h3 className="flex flex-wrap items-center gap-2 text-xl font-bold text-white"><span aria-hidden="true">{bullish ? "🟢" : "🔴"}</span><span className={bullish ? "text-emerald-300" : "text-rose-300"}>{signal.side}</span><span className="font-mono">{signal.symbol}</span></h3><p className="font-mono text-xl font-semibold text-cyan-100">{signal.grade} <span className="text-sm text-slate-400">{signal.rating}/100</span></p></div>
      <p className="mt-2 text-sm text-slate-300">🛡️ {signal.riskBand} relative risk · {signal.style} · {signal.setupType}</p>
      <p className="mt-1 text-xs text-slate-500">{signal.flexibility} · TA {signal.score} · entry {signal.entryGrade} {signal.entryQuality} · {utc(signal.createdAt)}</p>
    </div>
    <div className="space-y-4 p-4 sm:p-5">
      {signal.executionPlan && <EntryInstructions plan={signal.executionPlan} ready={false} compact
        reason={historical ? "Saved instructions from this alert. Open the live chart for a current entry decision." : "Confirmed at scan time. Open the chart; enter only if READY and the current quote remains inside this range."}/>}
      {signal.executionPlan && <LevelsPanel plan={signal.executionPlan} stop={signal.stop} targets={signal.targets} row={row} book={book} now={now}/>}
      {!historical && <InlineChart symbol={signal.symbol} style={signal.style} flexibility={signal.flexibility} targetStyle={row?.targetStyle} timeframe={signal.executionPlan?.timeframe} open={chartOpen} onToggle={() => setChartOpen(value => !value)} onOpenMain={onReview}/>}
      <div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-white/[0.035] p-3"><p className="text-sm text-slate-400">📍 Entry</p><p className="mt-1 break-all font-mono text-lg font-semibold text-white">{formatPrice(signal.entry)}</p></div><div className="rounded-xl bg-rose-300/[0.045] p-3"><p className="text-sm text-rose-200/80">🛑 Stop loss</p><p className="mt-1 break-all font-mono text-lg font-semibold text-rose-200">{formatPrice(signal.stop)}</p></div></div>
      <ol className="divide-y divide-white/[0.05]">{signal.targets.map(target => <li key={target.level} className="py-2 first:pt-0 last:pb-0"><div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"><span className="text-slate-300">🎯 TP{target.level} <strong className="ml-2 font-mono text-emerald-200">{formatPrice(target.price)}</strong></span><span className="font-mono text-xs text-slate-400">{target.rewardR.toFixed(2)}R · close {target.exitPct}%</span></div><p className="mt-0.5 text-xs leading-5 text-slate-500">{target.source}</p></li>)}</ol>
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.06] bg-slate-950/30 p-3"><div><p className="text-xs text-slate-400">⚖️ Leverage</p><p className="mt-1 font-mono text-lg font-semibold text-cyan-200">{signal.leverage}×</p></div><div><p className="text-xs text-slate-400">💼 Stop-risk</p><p className="mt-1 font-mono text-lg font-semibold text-white">{signal.riskPct.toFixed(2)}%</p></div><div><p className="text-xs text-slate-400">📐 After spread</p><p className="mt-1 font-mono text-lg font-semibold text-white">{signal.netRewardR.toFixed(2)}R</p></div></div>
      <p className="text-xs leading-5 text-slate-400">Risk {signal.riskAmount.toFixed(2)} USDT · estimated margin {signal.margin.toFixed(2)} USDT. Reward excludes fees and funding.</p>
      <p className="text-sm leading-6 text-violet-200">₿ {signal.btcRelationship} · {signal.btcVerdict}</p>
      {signal.needsAcknowledgement && <p className="rounded-xl bg-amber-300/10 p-3 text-sm leading-6 text-amber-200">⚠️ Reduced-size acknowledgement required: {signal.trendAligned === false ? "this trade goes against the BTC daily trend (half size)" : "BTC caution or a quality override"}.</p>}
      <p className="text-xs leading-5 text-slate-400">{historical ? "🗂️ Original alert levels. Open the chart for a fresh plan." : "✅ Required entry checks passed at the scan. Recheck the live chart and portfolio before entry."}</p>
      <div className="flex flex-wrap gap-2">{onToggleMonitor && <MonitorButton active={!!monitored} onToggle={onToggleMonitor}/>}{historical ? <Button type="button" onClick={onReview} className="rounded-xl"><LineChart className="mr-1.5 h-4 w-4"/>Review chart</Button> : <Button type="button" variant="outline" onClick={() => setChartOpen(value => !value)} className="rounded-xl"><LineChart className="mr-1.5 h-4 w-4"/>{chartOpen ? "Fold chart" : "Chart"}</Button>}<Button type="button" variant="outline" onClick={() => void copy()} className="rounded-xl"><Copy className="mr-1.5 h-4 w-4"/>Copy signal</Button>{onPaper && <Button type="button" variant="outline" className="rounded-xl" onClick={onPaper}>📄 Paper plan</Button>}</div>
      {copyFallback && <label className="block text-sm text-amber-200">Copy is blocked by your browser. Select this text:<textarea readOnly value={copyFallback} onFocus={event => event.currentTarget.select()} rows={10} className="mt-2 w-full rounded-xl border border-border bg-slate-950 p-3 font-mono text-xs text-slate-200"/></label>}
    </div>
  </article>;
}

function WatchRow({row, book, now, onReview, monitored, onToggleMonitor}: {row: ScannerRow; book?: OrderBookBalance; now: number; onReview: () => void; monitored: boolean; onToggleMonitor: () => void}) {
  const bullish = row.bias === "LONG";
  const [chartOpen, setChartOpen] = useState(false);
  const pending = row.entryChecks.find(check => check.required && check.status !== "PASS");
  const status = row.btcRelationship.divergenceVerdict === "REJECT" ? "BLOCKED · BTC divergence rejects" : row.executionPlan.status.replaceAll("_", " ");
  return <article className={"rounded-2xl border border-l-[3px] bg-[#0d141d]/80 p-4 " + (bullish ? "border-white/[0.07] border-l-emerald-300/60" : "border-white/[0.07] border-l-rose-300/60")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="flex flex-wrap items-center gap-2 text-base font-bold text-white"><span className={bullish ? "text-emerald-300" : "text-rose-300"}>{row.bias}</span><span className="font-mono">{row.symbol}</span><span className="font-mono text-sm text-cyan-100">{row.ratingGrade} {row.ratingScore}</span></h4>
      <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-xs font-semibold text-amber-200">{status}</span>
    </div>
    <p className="mt-1 text-xs text-slate-400">{row.setupType} · {row.regime} · TA {row.score} · {row.style}</p>
    <p className="mt-2 text-sm leading-6 text-slate-300">Waiting for: <strong className="text-amber-200">{pending ? pending.label + " (" + pending.status + ")" : "live confirmation"}</strong>{pending ? " — " + pending.detail : ""}</p>
    <div className="mt-3"><LevelsPanel plan={row.executionPlan} stop={row.stop} targets={row.takeProfits} row={row} book={book} now={now} compact/></div>
    <div className="mt-3"><InlineChart symbol={row.symbol} style={row.style} flexibility={row.flexibility} targetStyle={row.targetStyle} timeframe={row.executionPlan.timeframe} open={chartOpen} onToggle={() => setChartOpen(value => !value)} onOpenMain={onReview}/></div>
    <div className="mt-3"><MonitorButton active={monitored} onToggle={onToggleMonitor}/></div>
  </article>;
}

function stateClass(state: MonitorEntry["state"]) {
  return state === "ENTRY RANGE" ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-100" : state === "AT TRIGGER" ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100" : state === "STOP HIT" ? "border-rose-300/40 bg-rose-300/15 text-rose-200" : "border-white/15 bg-white/5 text-slate-300";
}

function MonitorPanel({entries, hits, updatedAt, now, rows, onToggleMonitor, onAdd, onReview}: {
  entries: MonitorEntry[]; hits: MonitorEntry[]; updatedAt: number; now: number; rows: ScannerRow[];
  onToggleMonitor: (symbol: string) => void; onAdd: (symbol: string) => void; onReview: (row: ScannerRow) => void;
}) {
  const [draft, setDraft] = useState("");
  const [telegramNote, setTelegramNote] = useState("");
  async function sendLevels() {
    const result = await pushTelegramEvents(entries.map(entry => formatMonitorStart(entry, now)));
    setTelegramNote(result);
  }
  const bySymbol = new Map(rows.map(row => [row.symbol, row]));
  const ordered = [...hits, ...entries.filter(entry => !hits.includes(entry))];
  function add() {
    const symbol = draft.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const pair = symbol.endsWith("USDT") ? symbol : symbol + "USDT";
    if (/^[A-Z0-9]{2,24}USDT$/.test(pair)) { onAdd(pair); setDraft(""); }
  }
  return <section aria-label="Monitored pairs" className={"mb-5 rounded-2xl border p-4 " + (hits.length ? "border-emerald-300/40 bg-emerald-300/[0.05]" : "border-white/[0.08] bg-white/[0.02]")}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="flex items-center gap-2 text-base font-semibold text-white"><Target className="h-5 w-5 text-cyan-200"/>Monitored pairs{hits.length > 0 && <span className="rounded-full bg-emerald-300/20 px-2.5 py-0.5 text-sm font-semibold text-emerald-100">🔔 {hits.length} at entry level</span>}</h3><p className="mt-1 text-xs text-slate-400">Live price checked every 10 s against each pair's plan. A distinct chime plays when price reaches the trigger or the entry range.{updatedAt ? " Updated " + Math.max(0, Math.round((now - updatedAt) / 1000)) + "s ago." : ""}</p></div>
      <form onSubmit={event => {event.preventDefault(); add();}} className="flex items-center gap-2"><Input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Add pair, e.g. SOL" aria-label="Add a pair to monitor" className="h-9 w-40 font-mono uppercase"/><Button type="submit" size="sm" variant="outline" className="rounded-lg"><Plus className="h-4 w-4"/></Button>{entries.length > 0 && <Button type="button" size="sm" variant="outline" onClick={() => void sendLevels()} className="rounded-lg"><Send className="mr-1.5 h-3.5 w-3.5"/>Send levels to Telegram</Button>}</form>
    </div>
    {telegramNote && <p role="status" className="mt-2 text-xs text-cyan-200">{telegramNote}</p>}
    {ordered.length === 0 ? <p className="mt-3 text-sm text-slate-400">Nothing monitored yet. Use <strong>Monitor</strong> on any signal or watch card, or add a pair above.</p>
      : <ul className="mt-3 grid gap-2 lg:grid-cols-2">{ordered.map(entry => {
        const row = bySymbol.get(entry.symbol); const plan = entry.plan; const long = entry.side === "LONG";
        return <li key={entry.symbol} className={"rounded-xl border p-3 " + (hits.includes(entry) ? "border-emerald-300/40 bg-emerald-300/[0.07]" : "border-white/[0.07] bg-slate-950/30")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-white"><span className="font-mono">{entry.symbol}</span>{entry.side && <span className={long ? "text-emerald-300" : "text-rose-300"}>{entry.side}</span>}{entry.price !== null && <span className="font-mono text-xs text-slate-400">{formatPrice(entry.price)}</span>}</p>
            <span className={"rounded-full border px-2.5 py-0.5 text-xs font-semibold " + stateClass(entry.state)}>{entry.state === "ENTRY RANGE" ? "🔔 ENTRY RANGE" : entry.state === "AT TRIGGER" ? "🔔 AT TRIGGER · wait for close" : entry.state}</span>
          </div>
          {plan ? <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs text-slate-300 sm:grid-cols-4">
            <div><dt className="font-sans text-slate-500">Trigger</dt><dd>{formatPrice(plan.trigger)}{entry.toTriggerPct !== null && <span className="ml-1 text-slate-500">({entry.toTriggerPct > 0 ? "+" : ""}{entry.toTriggerPct.toFixed(2)}%)</span>}</dd></div>
            <div><dt className="font-sans text-slate-500">Entry range</dt><dd>{formatPrice(plan.entryLow)}–{formatPrice(plan.entryHigh)}</dd></div>
            <div><dt className="font-sans text-slate-500">Stop</dt><dd className="text-rose-200">{entry.stop !== null ? formatPrice(entry.stop) : "—"}</dd></div>
            <div><dt className="font-sans text-slate-500">Plan</dt><dd className="truncate">{plan.zoneSource} · {plan.timeframe}{entry.ready ? " · READY" : ""}</dd></div>
          </dl> : <p className="mt-2 text-xs text-slate-400">No scanned plan for this pair in the current scan. It is checked again on the next scan.</p>}
          <div className="mt-2 flex flex-wrap gap-2">{row && <Button type="button" variant="outline" size="sm" onClick={() => onReview(row)} className="rounded-lg"><LineChart className="mr-1.5 h-3.5 w-3.5"/>Open chart</Button>}<Button type="button" variant="ghost" size="sm" onClick={() => onToggleMonitor(entry.symbol)} className="rounded-lg text-slate-400"><X className="mr-1 h-3.5 w-3.5"/>Remove</Button></div>
        </li>;})}</ul>}
  </section>;
}

export function SignalCenter({alerts, monitor, rows = [], monitored = [], onToggleMonitor = () => {}, tab, onTabChange, now, scanning, live, onReview, onPaper}: {
  alerts: Alerts; monitor: ReturnType<typeof useTriggerMonitor>; rows?: ScannerRow[]; monitored?: string[]; onToggleMonitor?: (symbol: string) => void; tab: SignalTab; onTabChange: (tab: SignalTab) => void;
  now: number; scanning: boolean; live: boolean;
  onReview: (signal: Pick<SignalSnapshot, "symbol" | "style" | "flexibility">) => void;
  onPaper: (row: ScannerRow) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [historyCount, setHistoryCount] = useState(10);
  const soundActive = alerts.soundEnabled && alerts.soundReady;
  const visiblePicks = showAll ? alerts.picks : alerts.picks.slice(0, 2);
  const pickSymbols = new Set(alerts.picks.map(pick => pick.row.symbol));
  // Closest-to-ready setups: every required check except the live trigger/payoff may still be pending.
  const watch = rows
    .filter(row => !pickSymbols.has(row.symbol) && row.decision !== "NO TRADE" && !["INVALIDATED", "EXPIRED"].includes(row.executionPlan.status))
    .sort((a, b) => b.ratingScore - a.ratingScore || b.entryQuality - a.entryQuality)
    .slice(0, 6);
  const books = useOrderBooks([...visiblePicks.map(pick => pick.row.symbol), ...watch.map(row => row.symbol)]);
  const monitoredSet = new Set(monitored);
  // Toggling on sends a "now monitoring" message with the levels; toggling off is silent.
  function startMonitoring(symbol: string) {
    onToggleMonitor(symbol);
    if (!monitoredSet.has(symbol)) void pushTelegramEvents([formatMonitorStart(evaluateMonitor(symbol, rows.find(row => row.symbol === symbol), undefined), now)]);
  }
  // Hourly digest of every monitored pair while the dashboard is open.
  const digestHour = Math.floor(now / 3_600_000);
  const digestEntries = monitor.entries;
  useEffect(() => {
    if (!digestEntries.length || !digestEntries.some(entry => entry.price !== null)) return;
    const digest = formatMonitorDigest(digestEntries, digestHour * 3_600_000);
    if (digest) void pushTelegramEvents([digest]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digestHour, digestEntries.length > 0]);
  return <section id="signals-center" className="mb-5 scroll-mt-52 rounded-3xl border border-cyan-300/20 bg-[#09131e]/95 shadow-[0_18px_80px_-45px_rgba(103,232,249,0.35)]">
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:px-6 sm:pt-5"><div><div className="flex items-center gap-2"><Radio className="h-5 w-5 text-cyan-200"/><h2 className="text-lg font-semibold text-white">Trade signals</h2>{alerts.picks.length > 0 && <span className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-sm font-semibold text-emerald-200">{alerts.picks.length} ready to review</span>}</div><p className="mt-1 text-sm text-slate-400">Telegram-style plans · long and short · live checks before entry</p></div>
      <Button type="button" variant="outline" onClick={alerts.toggleSound} aria-pressed={soundActive} className={"rounded-xl " + (soundActive ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-200" : "text-slate-300")}>{soundActive ? <Volume2 className="mr-2 h-4 w-4"/> : <VolumeX className="mr-2 h-4 w-4"/>}{soundActive ? alerts.volume === 0 ? "Sound muted · 0%" : "Sound on · tap to mute" : "Enable sound"}</Button>
    </div>
    {alerts.soundError && <p role="alert" className="px-5 pb-3 text-sm text-amber-200">{alerts.soundError}</p>}
    <Tabs value={tab} onValueChange={value => onTabChange(value as SignalTab)} className="gap-0">
      <div className="border-b border-white/[0.07] px-4 pb-3 sm:px-6"><TabsList className="h-11 w-full rounded-xl bg-slate-950/60 sm:w-auto" aria-label="Signals and notifications"><TabsTrigger value="signals" className="rounded-lg px-4 text-sm data-[state=active]:bg-cyan-200 data-[state=active]:text-slate-950"><Radio className="h-4 w-4"/>Signals <span className="font-mono">{alerts.picks.length}</span></TabsTrigger><TabsTrigger value="notifications" className="rounded-lg px-4 text-sm data-[state=active]:bg-cyan-200 data-[state=active]:text-slate-950"><Bell className="h-4 w-4"/>Notifications {alerts.unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-xs font-bold text-white">{alerts.unread}</span>}</TabsTrigger></TabsList></div>
      <TabsContent value="signals" className="p-4 sm:p-6">
        <MonitorPanel entries={monitor.entries} hits={monitor.hits} updatedAt={monitor.updatedAt} now={now} rows={rows} onToggleMonitor={onToggleMonitor} onAdd={symbol => { if (!monitoredSet.has(symbol)) { onToggleMonitor(symbol); void pushTelegramEvents([formatMonitorStart(evaluateMonitor(symbol, rows.find(row => row.symbol === symbol), undefined), now)]); } }} onReview={row => onReview(row)}/>
        {alerts.picks.length ? <><div className="grid items-start gap-4 xl:grid-cols-2">{visiblePicks.map(pick => <SignalCard key={pick.row.symbol} signal={snapshotSignal(pick)} row={pick.row} book={books[pick.row.symbol]} now={now} onReview={() => onReview(pick.row)} onPaper={() => onPaper(pick.row)} monitored={monitoredSet.has(pick.row.symbol)} onToggleMonitor={() => startMonitoring(pick.row.symbol)}/>)}</div>{alerts.picks.length > 2 && <Button type="button" variant="outline" onClick={() => setShowAll(value => !value)} className="mt-4 w-full rounded-xl">{showAll ? "Show top two signals" : "Show all " + alerts.picks.length + " qualified signals"}<ChevronDown className={"ml-2 h-4 w-4 " + (showAll ? "rotate-180" : "")}/></Button>}</> : <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-7"><p className="flex items-center gap-2 text-base font-semibold text-slate-200"><Radio className={"h-5 w-5 text-cyan-200 " + (scanning ? "animate-pulse" : "")}/>{scanning ? "Checking the market for a complete setup…" : live ? "No entry-ready signal on this scan" : "Waiting for a verified live scan"}</p><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{scanning ? "Signals appear here when the scan completes and every required entry check passes." : "A qualifying long or short plan will appear here automatically. Developing and higher-risk ideas are still in Market opportunities below."}</p></div>}
        {watch.length > 0 && <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold text-white">👀 Watching · closest to ready</h3><p className="text-xs text-slate-400">Exact levels are set now; each card says what must still happen before it becomes a signal.</p></div>
          <div className="mt-3 grid items-start gap-4 xl:grid-cols-2">{watch.map(row => <WatchRow key={row.symbol} row={row} book={books[row.symbol]} now={now} onReview={() => onReview(row)} monitored={monitoredSet.has(row.symbol)} onToggleMonitor={() => startMonitoring(row.symbol)}/>)}</div>
        </div>}
      </TabsContent>
      <TabsContent value="notifications" className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm text-slate-300">{alerts.unread} unread · {alerts.notifications.length} saved alerts</p><Button type="button" variant="outline" size="sm" onClick={() => alerts.markRead()} disabled={!alerts.unread} className="rounded-xl"><CheckCheck className="mr-2 h-4 w-4"/>Mark all read</Button></div>
        <div className="grid gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 md:grid-cols-[1fr_240px]"><div><p className="text-sm font-semibold text-slate-200">🔊 Setup alert sound</p><p className="mt-1 text-xs leading-5 text-slate-400">{soundActive ? "One chime for a batch of newly qualified setups. Continuing setups stay quiet across scans." : "Tap Enable sound once in this tab to activate audio. Your sound preference and volume are saved."} Keep Boma Scans open; sleeping or closed tabs cannot reliably alert.</p><Button type="button" variant="outline" size="sm" className="mt-3 rounded-lg" onClick={() => void alerts.testSound()}>Test sound</Button></div><div className="self-center"><label htmlFor="signal-alert-volume" className="mb-3 block text-sm text-slate-300">Volume · {Math.round(alerts.volume * 100)}%{alerts.volume === 0 ? " (muted)" : ""}</label><Slider id="signal-alert-volume" aria-label="Signal alert volume" min={0} max={100} step={5} value={[alerts.volume * 100]} onValueChange={values => alerts.setVolume(values[0] / 100)}/></div></div>
        {alerts.storageError && <p role="alert" className="text-sm text-amber-200">Device storage is unavailable. Alerts still appear here, but may not survive a reload.</p>}
        {!alerts.storageReady ? <p className="py-5 text-sm text-slate-400">Loading notification history…</p> : !alerts.notifications.length ? <div className="rounded-2xl border border-dashed border-white/10 px-5 py-8 text-center"><BellRing className="mx-auto h-7 w-7 text-cyan-200"/><p className="mt-3 text-base font-semibold text-white">Your next qualified setup lands here</p><p className="mt-2 text-sm text-slate-400">New setup alerts include the original entry, stop, targets, risk and leverage.</p></div> : <div className="space-y-3">{alerts.notifications.slice(0,historyCount).map(item => <Collapsible key={item.id} onOpenChange={open => {if (open) alerts.markRead(item.id);}} className={"rounded-2xl border " + (item.readAt ? "border-white/[0.07]" : "border-cyan-300/25 bg-cyan-300/[0.035]")}><CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left"><span className="min-w-0"><span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100">{!item.readAt && <span aria-label="Unread" className="h-2 w-2 rounded-full bg-cyan-200"/>}{item.side === "LONG" ? "🟢" : "🔴"} {item.side} · {item.symbol}<span className="font-mono text-cyan-200">{item.grade} {item.rating}</span></span><span className="mt-1 block text-xs leading-5 text-slate-400">{utc(item.createdAt)} · {item.style} · {item.flexibility} · {notificationStatus(item,now)}</span></span><ChevronDown className="h-4 w-4 shrink-0 text-slate-500"/></CollapsibleTrigger><CollapsibleContent className="px-3 pb-3"><SignalCard signal={item} historical now={now} onReview={() => {alerts.markRead(item.id); onReview(item);}}/></CollapsibleContent></Collapsible>)}</div>}
        {alerts.notifications.length > historyCount && <Button type="button" variant="outline" onClick={() => setHistoryCount(value => value+10)} className="w-full rounded-xl">Show more notifications</Button>}
        <p className="text-xs leading-5 text-slate-500">Last 100 alerts saved on this device. Read status does not mean a trade was taken. Copy signal prepares Telegram-style text; messages are not sent to Telegram automatically.</p>
      </TabsContent>
    </Tabs>
  </section>;
}
