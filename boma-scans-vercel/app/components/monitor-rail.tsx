"use client";
import { Target, X } from "lucide-react";
import { formatPrice } from "@/app/lib/market";
import type { MonitorEntry } from "@/app/lib/trigger-monitor";

function pill(state: MonitorEntry["state"]) {
  return state === "ENTRY RANGE" ? "bg-emerald-300/20 text-emerald-100" : state === "AT TRIGGER" ? "bg-cyan-300/20 text-cyan-100" : state === "STOP HIT" ? "bg-rose-300/20 text-rose-200" : "bg-white/10 text-slate-300";
}

/** Always-visible list of monitored pairs: a sticky side panel on wide screens, a strip on small ones. */
export function MonitorRail({entries, hits, updatedAt, now, onOpen, onRemove, onSelect}: {
  entries: MonitorEntry[]; hits: MonitorEntry[]; updatedAt: number; now: number;
  onOpen: () => void; onRemove: (symbol: string) => void; onSelect: (symbol: string) => void;
}) {
  const ordered = [...hits, ...entries.filter(entry => !hits.includes(entry))];
  return <aside aria-label="Monitored pairs" className={"mb-5 rounded-3xl border p-3 xl:sticky xl:top-24 xl:mb-0 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto " + (hits.length ? "border-emerald-300/40 bg-emerald-300/[0.05]" : "border-white/[0.08] bg-[#08111b]/88")}>
    <div className="flex items-center justify-between gap-2">
      <button type="button" onClick={onOpen} className="flex items-center gap-2 text-sm font-semibold text-white"><Target className="h-4 w-4 text-cyan-200"/>Monitoring <span className="font-mono text-slate-400">{entries.length}</span>{hits.length > 0 && <span className="rounded-full bg-emerald-300/20 px-2 py-0.5 text-xs text-emerald-100">🔔 {hits.length}</span>}</button>
      <span className="text-[11px] text-slate-500">{updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) + "s" : "—"}</span>
    </div>
    {ordered.length === 0 ? <p className="mt-2 text-xs leading-5 text-slate-400">No pairs yet. Tap <strong>Monitor</strong> on a signal, or add one in the Signals panel.</p>
      : <ul className="mt-2 flex gap-2 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible">{ordered.map(entry => <li key={entry.symbol} className="min-w-[200px] shrink-0 rounded-xl border border-white/[0.07] bg-slate-950/40 p-2.5 xl:min-w-0">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => onSelect(entry.symbol)} className="truncate text-left font-mono text-sm font-bold text-white hover:text-cyan-100">{entry.symbol.replace("USDT", "")}<span className="ml-1 text-xs font-semibold text-slate-400">{entry.side ?? ""}</span></button>
          <button type="button" onClick={() => onRemove(entry.symbol)} aria-label={"Stop monitoring " + entry.symbol} className="text-slate-500 hover:text-rose-200"><X className="h-3.5 w-3.5"/></button>
        </div>
        <span className={"mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold " + pill(entry.state)}>{entry.state}</span>
        <p className="mt-1 font-mono text-[11px] text-slate-300">{entry.price !== null ? formatPrice(entry.price) : "—"}{entry.plan && <span className="text-slate-500"> → {formatPrice(entry.plan.trigger)}{entry.toTriggerPct !== null ? " (" + (entry.toTriggerPct > 0 ? "+" : "") + entry.toTriggerPct.toFixed(2) + "%)" : ""}</span>}</p>
      </li>)}</ul>}
  </aside>;
}
