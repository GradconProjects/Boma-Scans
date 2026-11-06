"use client";
import { useState } from "react";
import { ChevronDown, Copy, Eye, EyeOff, LineChart, Target } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type RailItem = {
  symbol: string;
  side: "LONG" | "SHORT" | null;
  kind: "SIGNAL" | "MONITOR" | "WATCH";
  /** Badge text: READY, AT TRIGGER, ENTRY RANGE, WAITING, STOP HIT, WAIT RETEST … */
  status: string;
  /** The signal in the compact Telegram format. */
  lines: string[];
  monitored: boolean;
  hit: boolean;
};

function tone(item: RailItem) {
  if (item.hit) return "border-emerald-300/40 bg-emerald-300/[0.08]";
  if (item.kind === "SIGNAL") return "border-cyan-300/30 bg-cyan-300/[0.05]";
  return "border-white/[0.07] bg-slate-950/40";
}

function Row({item, onToggleMonitor, onSelect, focused = false}: {item: RailItem; onToggleMonitor: () => void; onSelect: () => void; focused?: boolean}) {
  const [open, setOpen] = useState(focused);
  const long = item.side === "LONG";
  async function copy() {
    try { await navigator.clipboard.writeText(item.lines.join("\n")); toast.success("Signal copied"); } catch { toast.error("Copy blocked by the browser; select the text instead."); }
  }
  return <Collapsible id={"rail-" + item.symbol} open={open} onOpenChange={setOpen} className={"rounded-xl border " + tone(item) + (focused ? " ring-2 ring-cyan-300/60" : "")}>
    <CollapsibleTrigger className="flex w-full items-center gap-2 p-2.5 text-left">
      <span aria-hidden="true">{item.side ? (long ? "🟢" : "🔴") : "⚪"}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5"><span className="truncate font-mono text-sm font-bold text-white">{item.symbol.replace("USDT", "")}</span><span className={"text-[11px] font-semibold " + (long ? "text-emerald-300" : "text-rose-300")}>{item.side ?? ""}</span></span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]"><span className={"rounded-full px-1.5 py-0.5 font-semibold " + (item.hit ? "bg-emerald-300/20 text-emerald-100" : item.kind === "SIGNAL" ? "bg-cyan-300/20 text-cyan-100" : "bg-white/10 text-slate-300")}>{item.hit ? "🔔 " : ""}{item.status}</span><span className="text-slate-500">{item.kind === "SIGNAL" ? "signal" : item.kind === "MONITOR" ? "monitored" : "watching"}</span></span>
      </span>
      <ChevronDown className={"h-4 w-4 shrink-0 text-slate-500 transition-transform " + (open ? "rotate-180" : "")}/>
    </CollapsibleTrigger>
    <CollapsibleContent className="border-t border-white/[0.06] p-2.5">
      <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-5 text-slate-200">{item.lines.join("\n")}</pre>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button type="button" size="sm" variant="outline" onClick={onToggleMonitor} className="h-7 rounded-lg px-2 text-xs">{item.monitored ? <Eye className="mr-1 h-3.5 w-3.5"/> : <EyeOff className="mr-1 h-3.5 w-3.5"/>}{item.monitored ? "Monitoring" : "Monitor"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onSelect} className="h-7 rounded-lg px-2 text-xs"><LineChart className="mr-1 h-3.5 w-3.5"/>Chart</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void copy()} className="h-7 rounded-lg px-2 text-xs"><Copy className="mr-1 h-3.5 w-3.5"/>Copy</Button>
      </div>
    </CollapsibleContent>
  </Collapsible>;
}

/** Right-hand panel: every signal, monitored and watched pair as a collapsed row; expand to see the signal. */
export function MonitorRail({items, updatedAt, now, onOpen, onToggleMonitor, onSelect, focus}: {
  items: RailItem[]; updatedAt: number; now: number; focus?: string;
  onOpen: () => void; onToggleMonitor: (symbol: string) => void; onSelect: (symbol: string) => void;
}) {
  const hits = items.filter(item => item.hit).length;
  return <aside aria-label="Monitored pairs" className={"mb-5 rounded-3xl border p-3 xl:sticky xl:top-24 xl:mb-0 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto " + (hits ? "border-emerald-300/40 bg-emerald-300/[0.04]" : "border-white/[0.08] bg-[#08111b]/88")}>
    <div className="flex items-center justify-between gap-2">
      <button type="button" onClick={onOpen} className="flex items-center gap-2 text-sm font-semibold text-white"><Target className="h-4 w-4 text-cyan-200"/>Signals & pairs <span className="font-mono text-slate-400">{items.length}</span>{hits > 0 && <span className="rounded-full bg-emerald-300/20 px-2 py-0.5 text-xs text-emerald-100">🔔 {hits}</span>}</button>
      <span className="text-[11px] text-slate-500">{updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) + "s" : ""}</span>
    </div>
    {items.length === 0
      ? <p className="mt-2 text-xs leading-5 text-slate-400">Signals, monitored pairs and the closest-to-ready setups appear here. Tap a row to see the signal.</p>
      : <ul className="mt-2 space-y-1.5">{items.map(item => <li key={item.kind + ":" + item.symbol}><Row item={item} focused={focus === item.symbol} onToggleMonitor={() => onToggleMonitor(item.symbol)} onSelect={() => onSelect(item.symbol)}/></li>)}</ul>}
  </aside>;
}
