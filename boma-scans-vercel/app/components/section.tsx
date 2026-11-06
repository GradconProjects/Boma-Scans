"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A collapsible card with a one-line header. Open/closed is remembered per
 * device. Children stay mounted while folded so their live data keeps running.
 */
export function Section({id, storageKey, title, subtitle, icon, badge, defaultOpen = true, children}: {
  id?: string; storageKey: string; title: string; subtitle?: string; icon?: ReactNode; badge?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { const saved = window.localStorage.getItem("boma-scans:section:" + storageKey); if (saved === "open" || saved === "closed") setOpen(saved === "open"); } catch { /* keep default */ }
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem("boma-scans:section:" + storageKey, open ? "open" : "closed"); } catch { /* device storage unavailable */ }
  }, [open, ready, storageKey]);
  return <section id={id} className="mb-5 scroll-mt-52 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#08111b]/88 shadow-[0_28px_90px_-60px_rgba(56,189,248,0.45)]">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/60 sm:px-5">
      {icon && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.07] text-cyan-200">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-white">{title}</span>{badge}</span>
        {subtitle && <span className="mt-0.5 block text-xs text-slate-400">{subtitle}</span>}
      </span>
      <ChevronDown className={"h-5 w-5 shrink-0 text-slate-400 transition-transform " + (open ? "rotate-180" : "")}/>
    </button>
    <div className={open ? "border-t border-white/[0.06] p-3 sm:p-4" : "hidden"}>{children}</div>
  </section>;
}
