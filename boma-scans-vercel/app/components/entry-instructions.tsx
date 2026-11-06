import { Crosshair, ShieldCheck } from "lucide-react";
import type { EntryExecutionPlan } from "@/app/lib/entry-execution";
import { formatPrice, type TakeProfitLevel } from "@/app/lib/market";

export function EntryInstructions({plan, ready, reason, compact = false, targets, quantity, riskAmount, leverage}: {
  plan: EntryExecutionPlan; ready: boolean; reason?: string; compact?: boolean;
  targets?: TakeProfitLevel[]; quantity?: number; riskAmount?: number; leverage?: number;
}) {
  const long = plan.side === "LONG";
  const p = formatPrice;
  const stopPct = (Math.abs(plan.entry - plan.stop) / plan.entry * 100).toFixed(2);
  const expiry = new Intl.DateTimeFormat("en-AU", {timeZone: "Australia/Melbourne", dateStyle: "medium", timeStyle: "short"}).format(plan.expiresAt);
  const figures = <span className="font-mono text-cyan-100">{plan.side} {plan.timeframe} · zone {p(plan.zoneLow)}–{p(plan.zoneHigh)} · trigger {p(plan.trigger)} · limit {p(plan.entry)} · stop {p(plan.stop)}</span>;
  const title = ready ? "READY · " + (plan.side === "LONG" ? "BUY" : "SELL") + " IN RANGE"
    : plan.status === "READY" ? "WAIT · VERIFY LIVE CHECKS" : plan.headline;
  return <section aria-label="Step-by-step entry instructions" className={"rounded-2xl border p-4 " + (ready ? "border-emerald-300/30 bg-emerald-300/[0.055]" : "border-amber-300/25 bg-amber-300/[0.045]")}>
    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400"><Crosshair className="h-4 w-4"/>Your entry instructions</p>
    <p className={"mt-2 text-base font-bold " + (ready ? "text-emerald-200" : "text-amber-200")}>{title}</p>
    <p className="mt-1.5 text-sm leading-6 text-slate-300">{reason || plan.reason}</p>
    <p className="mt-2 text-sm text-cyan-200">For new plans: bank 40% at TP1 and 35% at TP2. TP3–TP5 are smaller runners; do not wait for all targets to take profit.</p>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <div className="rounded-xl bg-slate-950/40 p-2.5"><p className="text-xs text-slate-400">Watch retest zone</p><p className="mt-1 break-words font-mono text-sm text-white">{formatPrice(plan.zoneLow)}–{formatPrice(plan.zoneHigh)}</p></div>
      <div className="rounded-xl bg-slate-950/40 p-2.5"><p className="text-xs text-slate-400">{plan.side === "LONG" ? "Do not buy above" : "Do not short below"}</p><p className="mt-1 font-mono text-sm font-bold text-amber-200">{formatPrice(plan.side === "LONG" ? plan.entryHigh : plan.entryLow)}</p></div>
    </div>
    <ol className="mt-4 space-y-3">{plan.steps.slice(compact ? 1 : 0, compact ? 3 : 4).map((step, index) => <li key={index} className="flex gap-2.5 text-sm leading-6 text-slate-300"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-xs text-cyan-200">{index + 1}</span><span>{step}</span></li>)}</ol>
    <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-rose-200/85"><ShieldCheck className="mr-1 inline h-3.5 w-3.5"/>{plan.cancelText}</p>
    <p className="mt-2 text-xs text-slate-400">Unfilled-plan expiry: {new Intl.DateTimeFormat("en-AU", {timeZone: "Australia/Melbourne", dateStyle: "medium", timeStyle: "short"}).format(plan.expiresAt)} Melbourne time. This is an entry deadline, not a promised trade duration.</p>
    {!compact && <details className="mt-4 rounded-xl border border-white/10 bg-slate-950/30 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-cyan-200">Entry tutor — follow this sequence</summary>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-300">
        <li className="rounded-lg bg-white/[0.04] p-2 text-xs leading-5">This plan: {figures}</li>
        <li><strong>Read the timeframe.</strong> This plan runs on <span className="font-mono text-cyan-100">{plan.timeframe}</span> candles; scans every 15 minutes only refresh it. Wait for each {plan.timeframe} candle to close before acting.</li>
        <li><strong>Identify the direction and zone.</strong> {long ? "Long: buy a confirmed upward reclaim" : "Short: sell a confirmed downward reclaim"} of the <span className="font-mono text-cyan-100">{plan.zoneSource}</span> zone <span className="font-mono text-cyan-100">{p(plan.zoneLow)} – {p(plan.zoneHigh)}</span>. The zone is a watch area, not permission to enter.</li>
        <li><strong>Let the pullback finish.</strong> Price must touch the zone and a later {plan.timeframe} candle must <strong>close {long ? "above" : "below"} <span className="font-mono text-cyan-100">{p(plan.trigger)}</span></strong>. A first touch or an unfinished wick is not confirmation. Confirmation path: {plan.confirmationPath.toLowerCase()}.</li>
        <li><strong>Check where the setup fails.</strong> Stop <span className="font-mono text-rose-200">{p(plan.stop)}</span> ({stopPct}% from the limit; {plan.stopSource.toLowerCase()}). A wider stop means a smaller position, never more margin. Cancel if a {plan.timeframe} candle closes {long ? "below " + p(plan.zoneLow) : "above " + p(plan.zoneHigh)}.</li>
        <li><strong>Use the fixed entry.</strong> Only when READY: <span className="font-mono text-cyan-100">{long ? "BUY" : "SELL"} LIMIT {p(plan.entry)}</span> or better. Never {long ? "buy above" : "short below"} <span className="font-mono text-amber-200">{p(long ? plan.entryHigh : plan.entryLow)}</span>. The live quote is not a new entry; if price loses the reclaim, cancel the resting order.</li>
        <li><strong>Recheck before a fill.</strong> Quote fresh, price inside <span className="font-mono text-cyan-100">{p(plan.entryLow)} – {p(plan.entryHigh)}</span>, stop {p(plan.stop)} untouched, and the plan not expired (expires {expiry} Melbourne). A resting limit does not enforce these for you.</li>
        <li><strong>Size and protect.</strong> {quantity && riskAmount ? <>Suggested size <span className="font-mono text-cyan-100">{quantity}</span> contracts risks about <span className="font-mono text-cyan-100">{riskAmount.toFixed(2)} USDT</span> at the stop{leverage ? " at " + leverage + "× leverage" : ""}. </> : "Quantity = account risk ÷ (entry − stop distance), allowing for fees and slippage. "}Place the protective stop at {p(plan.stop)} on Bybit right after the fill and check whether it triggers on last or mark price. Leverage changes margin, not the loss at the stop.</li>
        <li><strong>Record the actual fill.</strong> This app does not submit orders. Enter your real fill price and quantity in the manual trade form; the paper button records the current quote, not proof that {p(plan.entry)} filled.</li>
        <li><strong>Manage the trade.</strong> {targets?.length ? <>Take profit at {targets.map(target => <span key={target.level} className="font-mono text-emerald-200">{target.level > 1 ? ", " : ""}TP{target.level} {target.available ? p(target.price) : "unconfirmed"} ({target.exitPct}%)</span>)}.</> : "Follow the five fixed TP levels and their quantities."} Do not widen the stop or average down. If the stop is swept and price recovers, this plan stays cancelled; wait for a genuinely new setup.</li>
      </ol>
      <p className="mt-3 text-sm text-amber-200">No stop placement is sweep-proof. These checks reduce premature entries; they do not establish a win rate or guarantee profit.</p>
    </details>}
  </section>;
}
