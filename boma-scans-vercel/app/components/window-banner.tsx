"use client";
import { useEffect, useState } from "react";
import { windowVerdict } from "@/app/lib/push-policy";

/** Bold Melbourne-time statement of whether now is a good time to trade, on every page. */
export function WindowBanner({ compact = false }: { compact?: boolean }) {
  const [v, setV] = useState(() => windowVerdict());
  useEffect(() => { const t = window.setInterval(() => setV(windowVerdict()), 30_000); return () => window.clearInterval(t); }, []);
  return <div role="status" className={"flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 " + (v.good ? "border-emerald-300/40 bg-emerald-300/[0.10]" : "border-rose-300/40 bg-rose-300/[0.10]") + (compact ? " text-xs" : " text-sm")}>
    <span className="font-mono font-bold text-white">🕰 {v.label}</span>
    <span className={"font-extrabold uppercase tracking-wide " + (v.good ? "text-emerald-200" : "text-rose-200")}>{v.good ? "✅ " : "⛔ "}{v.title}</span>
    {!compact && <span className="text-slate-300">{v.detail}</span>}
  </div>;
}
