import type { EntryExecutionPlan } from "@/app/lib/entry-execution";
import { compactNumber, formatPrice, type ScannerRow, type TakeProfitLevel } from "@/app/lib/market";
import { orderBookAdvice, type OrderBookBalance } from "@/app/lib/order-book";

function sessionLabel(now: number) {
  const hour = new Date(now).getUTCHours();
  if (hour < 7) return "Asia session";
  if (hour < 13) return "London session";
  if (hour < 21) return "New York session";
  return "Late US session";
}

/**
 * Exact order levels for one plan, laid out by entry type so nothing is missed:
 * zone, trigger close, limit entry, no-chase bound, stop and the five targets,
 * plus the market context (24h volume, funding, open interest, order book).
 */
export function LevelsPanel({plan, stop, targets, row, book, now, compact = false}: {
  plan: EntryExecutionPlan; stop: number; targets: TakeProfitLevel[];
  row?: Pick<ScannerRow, "turnover" | "fundingRate" | "spreadPct" | "atrPct" | "btcRelationship" | "openInterestValue" | "volume24h">;
  book?: OrderBookBalance; now: number; compact?: boolean;
}) {
  const long = plan.side === "LONG";
  const entryType = plan.zoneSource + " · " + (plan.confirmationPath === "PLANNED TRIGGER" ? "closed-candle retest" : plan.confirmationPath.toLowerCase()) + " · " + plan.timeframe;
  const rows: Array<[string, string, string?]> = [
    ["Watch zone", formatPrice(plan.zoneLow) + " – " + formatPrice(plan.zoneHigh), "Price must touch this zone on a closed " + plan.timeframe + " candle"],
    [long ? "Trigger: close above" : "Trigger: close below", formatPrice(plan.trigger), "A " + plan.timeframe + " candle must CLOSE past this level"],
    [long ? "BUY LIMIT" : "SELL LIMIT", formatPrice(plan.entry), "Place only when READY; cancel at expiry"],
    [long ? "Never buy above" : "Never short below", formatPrice(long ? plan.entryHigh : plan.entryLow), "No-chase boundary"],
    ["Stop loss", formatPrice(stop), plan.stopSource],
  ];
  const aligned = row?.btcRelationship.btcDailyTrend;
  return <section aria-label="Exact levels" className="rounded-2xl border border-white/[0.08] bg-slate-950/40 p-3">
    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Exact levels · {entryType}</p>
    <dl className="mt-2 divide-y divide-white/[0.05]">
      {rows.map(([label, value, hint]) => <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5"><dt className="text-xs text-slate-400">{label}</dt><dd className={"font-mono text-sm font-semibold " + (label.startsWith("Stop") ? "text-rose-200" : label.includes("LIMIT") ? "text-white" : "text-cyan-100")}>{value}</dd>{!compact && hint && <p className="basis-full text-[11px] leading-4 text-slate-500">{hint}</p>}</div>)}
      {targets.map(target => <div key={target.level} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5"><dt className="text-xs text-slate-400">TP{target.level} · close {target.exitPct}%</dt><dd className="font-mono text-sm font-semibold text-emerald-200">{target.available ? formatPrice(target.price) : "unconfirmed"} <span className="text-xs text-slate-500">{target.rewardR.toFixed(1)}R</span></dd></div>)}
    </dl>
    {row && <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3 text-xs sm:grid-cols-3">
      <div><p className="text-slate-500">24h volume</p><p className="font-mono text-slate-200">${compactNumber(row.turnover)}</p></div>
      <div><p className="text-slate-500">Open interest</p><p className="font-mono text-slate-200">{row.openInterestValue ? "$" + compactNumber(row.openInterestValue) : "—"}</p></div>
      <div><p className="text-slate-500">Funding / 8h</p><p className={"font-mono " + (Math.abs(row.fundingRate) > 0.0005 ? "text-amber-200" : "text-slate-200")}>{(row.fundingRate * 100).toFixed(4)}%</p></div>
      <div><p className="text-slate-500">Spread</p><p className="font-mono text-slate-200">{row.spreadPct.toFixed(3)}%</p></div>
      <div><p className="text-slate-500">Volatility (ATR)</p><p className="font-mono text-slate-200">{row.atrPct.toFixed(2)}% / candle</p></div>
      <div><p className="text-slate-500">BTC daily trend</p><p className={"font-mono " + (aligned === "UNKNOWN" ? "text-slate-400" : row.btcRelationship.trendAligned ? "text-emerald-200" : "text-amber-200")}>{aligned ?? "—"}{aligned && aligned !== "UNKNOWN" && (row.btcRelationship.trendAligned ? " · aligned" : " · against, half size")}</p></div>
    </div>}
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <div className="flex items-center justify-between text-xs"><p className="text-slate-500">Order book · within 1% of price</p><p className="text-slate-500">{sessionLabel(now)}</p></div>
      {book ? <>
        <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={"Bids " + book.bidPct.toFixed(0) + "%, asks " + (100 - book.bidPct).toFixed(0) + "%"}><div className="bg-emerald-400" style={{width: book.bidPct + "%"}}/><div className="bg-rose-400" style={{width: (100 - book.bidPct) + "%"}}/></div>
        <p className="mt-1 flex justify-between font-mono text-xs"><span className="text-emerald-200">Bids {book.bidPct.toFixed(0)}% · ${compactNumber(book.bidUsd)}</span><span className="text-rose-200">${compactNumber(book.askUsd)} · {(100 - book.bidPct).toFixed(0)}% asks</span></p>
        <p className="mt-1 text-[11px] leading-4 text-slate-400">{book.verdict} · {orderBookAdvice(book, plan.side)} Largest wall: bid {book.largestBidWallPct.toFixed(0)}% / ask {book.largestAskWallPct.toFixed(0)}% of its side. Updated {Math.max(0, Math.round((now - book.updatedAt) / 1000))}s ago.</p>
      </> : <p className="mt-1 text-[11px] text-slate-500">Loading order book…</p>}
    </div>
  </section>;
}
