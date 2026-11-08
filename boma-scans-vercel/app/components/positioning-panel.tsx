"use client";
import { useState } from "react";
import type { usePositioning } from "@/app/components/use-positioning";
import { ChevronDown, Fish, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatPrice } from "@/app/lib/market";
import { formatUsd, judgePositioning, type Positioning, type PositioningVerdict } from "@/app/lib/positioning";

export type PositioningTarget = { symbol: string; side: "LONG" | "SHORT"; price: number; stop?: number; kind: "SIGNAL" | "MONITOR" };

function levelTone(level: PositioningVerdict["level"]) {
  return level === "SUPPORTS" ? "bg-emerald-300/20 text-emerald-100" : level === "AGAINST" ? "bg-rose-300/20 text-rose-100" : "bg-white/10 text-slate-200";
}

function Row({ target, data }: { target: PositioningTarget; data: Positioning }) {
  const [open, setOpen] = useState(false);
  const verdict = judgePositioning(data, target.side, target.price, target.stop);
  const total = data.whales.longUsd + data.whales.shortUsd;
  const longShare = total > 0 ? Math.round(data.whales.longUsd / total * 100) : null;
  return <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-white/[0.07] bg-slate-950/40">
    <CollapsibleTrigger className="flex w-full items-center gap-2 p-2.5 text-left">
      <span aria-hidden="true">{target.side === "LONG" ? "🟢" : "🔴"}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-sm font-bold text-white">{target.symbol.replace("USDT", "")}</span><span className="text-[11px] font-semibold text-slate-400">{target.side} · {target.kind === "SIGNAL" ? "signal" : "monitored"}</span><span className={"rounded-full px-1.5 py-0.5 text-[11px] font-semibold " + levelTone(verdict.level)}>{verdict.level}</span></span>
        <span className="mt-0.5 block text-xs text-slate-400">{longShare === null ? "No whale positions" : "Whales " + longShare + "% long · " + formatUsd(total) + " · " + data.whales.traders + " traders"}{(data.venues ?? []).filter(v => v.kind === "top traders").map(v => " · " + v.name.replace(" top traders", " top") + " " + Math.round(v.longShare * 100) + "%").join("")}{data.crowd ? " · Bybit crowd " + Math.round(data.crowd.longRatio * 100) + "% long" : ""}</span>
      </span>
      <ChevronDown className={"h-4 w-4 shrink-0 text-slate-500 transition-transform " + (open ? "rotate-180" : "")}/>
    </CollapsibleTrigger>
    <CollapsibleContent className="border-t border-white/[0.06] p-2.5">
      <p className="text-sm font-semibold text-white">{verdict.headline}</p>
      <ul className="mt-1.5 space-y-1 text-xs leading-5 text-slate-300">{verdict.notes.map(note => <li key={note}>{note}</li>)}</ul>
      {data.whales.positions.length > 0 && <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead><tr className="text-left text-slate-500"><th className="pr-2 font-medium">Trader</th><th className="pr-2 font-medium">Side</th><th className="pr-2 text-right font-medium">Size</th><th className="pr-2 text-right font-medium">Entry</th><th className="pr-2 text-right font-medium">Lev</th><th className="pr-2 text-right font-medium">Liq.</th><th className="text-right font-medium">PnL</th></tr></thead>
          <tbody>{data.whales.positions.map(p => <tr key={p.trader + p.coin} className="border-t border-white/[0.05] font-mono text-slate-200">
            <td className="pr-2 py-0.5">{p.trader}</td><td className={"pr-2 " + (p.side === "LONG" ? "text-emerald-300" : "text-rose-300")}>{p.side}</td><td className="pr-2 text-right">{formatUsd(p.sizeUsd)}</td><td className="pr-2 text-right">{formatPrice(p.entry)}</td><td className="pr-2 text-right">{p.leverage}x</td><td className="pr-2 text-right">{p.liquidation ? formatPrice(p.liquidation) : "—"}</td><td className={"text-right " + (p.pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>{(p.pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(p.pnl))}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {data.hyperliquid && <p className="mt-2 text-[11px] text-slate-500">Hyperliquid {data.coin}: open interest {formatUsd(data.hyperliquid.openInterestUsd)} · funding {(data.hyperliquid.funding * 100).toFixed(4)}%/h · mark {formatPrice(data.hyperliquid.markPx)}</p>}
    </CollapsibleContent>
  </Collapsible>;
}

/**
 * Whale and crowd positioning for every signal and monitored pair: top
 * Hyperliquid traders' open positions (entry, size, leverage, liquidation)
 * against Bybit's long/short account ratio, open interest and funding, judged
 * in relation to each plan's side.
 */
export function PositioningPanel({ targets, positioning }: { targets: PositioningTarget[]; positioning: ReturnType<typeof usePositioning> }) {
  const { data, meta, error, loading, refresh } = positioning;
  const seen = new Set<string>();
  const rows = targets.filter(t => { if (seen.has(t.symbol)) return false; seen.add(t.symbol); return true; });
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
      <span><Fish className="mr-1 inline h-3.5 w-3.5 text-cyan-200"/>{meta ? meta.traders + " top Hyperliquid traders with open positions · refreshed " + new Date(meta.at).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" }) : "Loading top-trader positions…"}</span>
      <Button type="button" variant="ghost" size="sm" onClick={refresh} disabled={loading} className="h-7 rounded-lg px-2"><RefreshCw className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")}/></Button>
    </div>
    {error && <p className="mt-2 text-sm text-amber-200">{error}</p>}
    {rows.length === 0 ? <p className="mt-2 text-xs leading-5 text-slate-400">Positioning appears here for each signal and monitored pair: whether the biggest profitable traders and the Bybit crowd sit with or against the plan.</p>
      : <ul className="mt-2 space-y-1.5">{rows.map(target => data[target.symbol] ? <li key={target.symbol}><Row target={target} data={data[target.symbol]}/></li> : <li key={target.symbol} className="rounded-xl border border-white/[0.07] p-2.5 text-xs text-slate-500">{target.symbol} · loading…</li>)}</ul>}
    <p className="mt-2 text-[11px] leading-4 text-slate-500">Whale positions come from Hyperliquid&apos;s public on-chain data (top 60 traders by 30-day profit with ≥ $1M accounts). Binance and OKX publish their top traders&apos; long/short position ratio and the all-accounts ratio; Bybit publishes its account ratio, open interest and funding. No public source shows individual positions on those exchanges.</p>
  </div>;
}
