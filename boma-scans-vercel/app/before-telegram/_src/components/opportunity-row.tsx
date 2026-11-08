"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ArrowUpRight, Check, ChartNoAxesCombined } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { buildAdaptiveLeveragePlan } from "@/app/before-telegram/_src/lib/leverage";
import { formatPrice, type ScannerRow } from "@/app/before-telegram/_src/lib/market";
import { isMediumRiskTake } from "@/app/before-telegram/_src/lib/recommendations";
import { EntryInstructions } from "@/app/before-telegram/_src/components/entry-instructions";

export function OpportunityRow({row, active, live, equity, onSelect, onTrade}: {
  row: ScannerRow; active: boolean; live: boolean; equity: number;
  onSelect: () => void; onTrade: (mode: "PAPER" | "MANUAL_LIVE") => void;
}) {
  const [open, setOpen] = useState(false);
  const take = isMediumRiskTake(row, live);
  const previousTake = useRef(take);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const upgraded = take && !previousTake.current;
    previousTake.current = take;
    if (!upgraded) return;
    const start = window.setTimeout(() => {setOpen(true); setPulse(true);}, 0);
    const stop = window.setTimeout(() => setPulse(false), 2400);
    return () => {window.clearTimeout(start); window.clearTimeout(stop);};
  }, [take]);
  const plan = buildAdaptiveLeveragePlan({
    accountEquity: equity, targetRiskPct: row.btcRelationship.divergenceVerdict === "CAUTION" ? Math.min(0.5, row.riskMultiplier) : row.riskMultiplier,
    entry: row.entry, stop: row.stop, score: row.score, regime: row.regime,
    setupType: row.setupType, trendFrames: row.trendFrames, atrPct: row.atrPct,
    adx: row.adx, style: row.style, actionable: take,
    exchangeMaxLeverage: row.exchangeMaxLeverage, minOrderQty: row.minOrderQty,
    quantityStep: row.quantityStep, minNotionalValue: row.minNotionalValue,
  });
  const btc = row.btcRelationship;
  const highRating = row.ratingGrade === "A" || row.ratingGrade === "A+";
  const riskColor = row.riskBand === "LOW" ? "text-emerald-300 bg-emerald-300/10" : row.riskBand === "MEDIUM" ? "text-amber-200 bg-amber-300/10" : "text-rose-300 bg-rose-300/10";
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={"opportunity-row overflow-hidden rounded-2xl border bg-[#0d141d]/80 " + (pulse ? "setup-pulse " : "") + (active ? "border-cyan-200/40" : highRating ? "border-cyan-300/20 border-l-[3px] border-l-cyan-300" : "border-white/[0.07]")}>
      <CollapsibleTrigger asChild>
        <button type="button" className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 p-4 text-left transition-colors hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary lg:grid-cols-[1.2fr_0.7fr_0.6fr_0.65fr_0.8fr_1.1fr_0.6fr_0.7fr_1.1fr_24px]">
          <span><span className="block font-mono text-sm font-bold text-white">{row.symbol.replace("USDT", "")}<span className="text-slate-500">/USDT</span></span><span className="mt-1 block font-mono text-xs text-slate-500">{formatPrice(row.price)}</span></span>
          <span className={"text-xs font-bold " + (row.bias === "LONG" ? "text-emerald-300" : "text-rose-300")}>{row.bias}<span className="mt-1 block text-xs text-slate-500">{take ? "READY" : row.executionPlan.status.replaceAll("_", " ")}</span></span>
          <span className="hidden font-mono text-sm text-slate-300 lg:block">{row.score}<span className="block font-sans text-xs text-slate-600">TA</span></span>
          <span className="font-mono text-base font-bold text-cyan-100">{row.ratingGrade}<span className="ml-1 text-xs text-slate-500">{row.ratingScore}</span></span>
          <span className={"col-start-1 w-fit rounded-full px-2 py-1 text-xs font-semibold lg:col-auto " + riskColor}>{row.riskBand}</span>
          <span className="hidden text-xs text-slate-400 lg:block">{row.setupType}</span>
          <span className="hidden font-mono text-sm text-emerald-200 lg:block">{row.netRewardR.toFixed(2)}R</span>
          <span className="hidden font-mono text-sm text-slate-300 lg:block">{row.entryGrade} · {row.entryQuality}</span>
          <span className="hidden text-xs text-slate-500 lg:block">BTC r {btc.correlation?.toFixed(2) ?? "—"}<span className="mt-1 block">{btc.divergenceVerdict}</span></span>
          <ChevronDown className={"h-4 w-4 justify-self-end text-slate-500 transition-transform " + (open ? "rotate-180" : "")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-white/[0.07] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-sm leading-6 text-slate-400">{row.riskReason} <span className="text-slate-500">{row.gateReason}</span></p>
          <span className="rounded-xl border border-cyan-300/15 bg-cyan-300/5 px-3 py-2 font-mono text-sm text-cyan-200">LEV {take && plan.recommendedLeverage ? plan.recommendedLeverage + "×" : "GATED"}</span>
        </div>
        <div className="mb-4"><EntryInstructions plan={row.executionPlan} ready={false} reason={take ? "Qualified at scan time. Open the live chart to recheck the entry range before placing an order." : row.gateReason} compact/></div>
        <div className="grid gap-4 xl:grid-cols-3">
          <div><h3 className="mb-2 text-sm font-semibold text-white">Entry proof · {row.flexibility}</h3><div className="space-y-2">{row.entryChecks.map(check => <p key={check.id} title={check.detail} className="flex items-center justify-between gap-2 text-xs text-slate-400"><span>{check.label}</span><span className={check.status === "PASS" ? "text-emerald-300" : check.status === "FAIL" ? "text-rose-300" : "text-amber-200"}>{check.status === "PASS" ? <Check className="h-3.5 w-3.5" aria-label="Pass"/> : check.status}</span></p>)}</div></div>
          <div><h3 className="mb-2 text-sm font-semibold text-white">Five technical targets</h3><div className="space-y-2">{row.takeProfits.map(tp => <div key={tp.level} className="rounded-xl bg-white/[0.03] p-2.5"><p className="flex justify-between font-mono text-xs text-emerald-200"><span>TP{tp.level} · {tp.rewardR.toFixed(2)}R</span><span>{tp.available ? formatPrice(tp.price) : "UNCONFIRMED"}</span></p><p className="mt-1 text-xs text-slate-500">{tp.sources.join(" + ")} · {tp.confidence} · {tp.confluenceCount} sources</p></div>)}</div></div>
          <div><h3 className="mb-2 text-sm font-semibold text-white">BTC · {btc.relationship}</h3><div className="grid grid-cols-2 gap-2 font-mono text-xs text-slate-300">{[["Correlation",btc.correlation?.toFixed(2) ?? "—"],["Beta",btc.beta?.toFixed(2) ?? "—"],["Relative move",btc.relativeStrengthPct.toFixed(2)+"%"],["Residual Z",btc.residualZScore.toFixed(2)]].map(([label,value])=><p key={label} className="rounded-xl bg-white/[0.03] p-2.5"><span className="block font-sans text-slate-500">{label}</span>{value}</p>)}</div><p className="mt-3 text-xs font-bold text-violet-200">{btc.divergenceVerdict} · {btc.divergence}</p><p className="mt-2 text-xs leading-5 text-slate-400">{btc.explanation}</p><p className="mt-3 text-xs leading-5 text-slate-500">{plan.rationale}</p>{row.qualityOverride.eligible && <p className="mt-3 rounded-xl bg-amber-300/10 p-3 text-xs text-amber-200">Quality override · {row.qualityOverride.reason} Maximum 0.5% stop-risk; acknowledgement required.</p>}</div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
          <Button type="button" onClick={onSelect} variant="outline" className="rounded-xl"><ChartNoAxesCombined className="mr-2 h-4 w-4"/>Open chart</Button>
          <Button type="button" disabled={!take} onClick={() => onTrade("PAPER")} className="rounded-xl">Paper this trade <ArrowUpRight className="ml-2 h-4 w-4"/></Button>
          <Button type="button" onClick={() => onTrade("MANUAL_LIVE")} variant="outline" className="rounded-xl">Track existing live trade</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">New paper entries refresh the selected analysis and require confirmation. Live tracking only records a position you already opened on Bybit.</p>
      </CollapsibleContent>
    </Collapsible>
  );
}
