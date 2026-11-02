import { Crosshair, ShieldCheck } from "lucide-react";
import type { EntryExecutionPlan } from "@/app/lib/entry-execution";
import { formatPrice } from "@/app/lib/market";

export function EntryInstructions({plan, ready, reason, compact = false}: {
  plan: EntryExecutionPlan; ready: boolean; reason?: string; compact?: boolean;
}) {
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
        <li><strong>Read the timeframe.</strong> Default signals use 1-hour candles; choose 2h or 4h for a slower alternative. A scan every 15 minutes checks for updates; it does not create a new 15-minute trading signal. Wait for the selected candle to close.</li>
        <li><strong>Identify the direction and zone.</strong> A long buys a confirmed upward reclaim; a short sells a confirmed downward reclaim. A highlighted zone is a watch area, not permission to enter.</li>
        <li><strong>Let the pullback finish.</strong> Price must first sweep the prior eight-candle swing liquidity and reclaim the zone. A first touch alone is insufficient. Then a later closed candle must close above the rejection candle’s high for a long, or below its low for a short. Do not buy the first touch or trade an unfinished wick.</li>
        <li><strong>Check where the setup fails.</strong> The stop sits beyond the zone, retest wick and recent swing extreme with a volatility buffer. A wider structural stop means less position size, not more margin. If the required stop is too wide, skip the setup.</li>
        <li><strong>Use the fixed entry.</strong> Only after READY, place the displayed buy-limit price for a long or sell-limit price for a short. The live quote is not a new entry recommendation. A limit may remain unfilled; never move it to chase. If price loses the reclaim, cancel the resting order and reassess.</li>
        <li><strong>Recheck before a fill.</strong> Confirm the quote is fresh, the entry remains inside the permitted range, the stop has not been touched, and the plan has not expired. A resting limit does not enforce these checks for you; monitor and cancel it when any check fails.</li>
        <li><strong>Size and protect.</strong> Calculate quantity from account risk divided by entry-to-stop distance, allowing for fees and slippage. Place the protective stop on Bybit after the fill. Verify whether its trigger uses last or mark price. Leverage changes margin, not the loss at the stop.</li>
        <li><strong>Record the actual fill.</strong> This app does not submit orders. Use the manual trade form for your actual entry price and quantity. The paper-entry button records the current quote, so it is not proof that your fixed limit filled.</li>
        <li><strong>Manage the trade.</strong> Follow the five fixed TP levels and their quantities. Do not widen a live stop or average down. If the fixed stop is swept and price recovers, that old plan stays cancelled; request a genuinely new setup.</li>
      </ol>
      <p className="mt-3 text-sm text-amber-200">No stop placement is sweep-proof. These checks reduce premature entries; they do not establish a win rate or guarantee profit.</p>
    </details>}
  </section>;
}
