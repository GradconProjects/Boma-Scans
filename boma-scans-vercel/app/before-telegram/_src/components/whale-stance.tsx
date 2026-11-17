"use client";
import { useEffect, useState } from "react";

type Stance = { coin: string | null; stance: "WITH" | "AGAINST" | "NEUTRAL"; detail: string; moves: Array<{ at: number; label: string; tier: string; kind: string; side: string; deltaUsd: number; entry: number }>; book: { longUsd: number; shortUsd: number } | null; error?: string };
const usd = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : v.toFixed(0);

/** Cross-check of a Before Telegram signal against what the ranked whales are doing on the same pair. */
export function WhaleStance({ symbol, side }: { symbol: string; side: "LONG" | "SHORT" }) {
  const [data, setData] = useState<Stance | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/whale-stance?symbol=" + symbol + "&side=" + side, { cache: "no-store", signal: controller.signal }).then(r => r.json()).then(d => setData(d as Stance)).catch(() => undefined);
    return () => controller.abort();
  }, [symbol, side]);
  if (!data) return <p className="rounded-xl border border-white/[0.06] bg-slate-950/30 p-2 text-xs text-slate-500">🐋 Checking what the whales are doing on {symbol}…</p>;
  if (data.error) return <p className="rounded-xl border border-white/[0.06] bg-slate-950/30 p-2 text-xs text-slate-500">🐋 Whale check unavailable: {data.error}</p>;
  if (!data.coin) return <p className="rounded-xl border border-white/[0.06] bg-slate-950/30 p-2 text-xs text-slate-500">🐋 Not listed on Hyperliquid; no whale cross-check for this pair.</p>;
  const tone = data.stance === "WITH" ? "border-emerald-300/30 bg-emerald-300/[0.06] text-emerald-100" : data.stance === "AGAINST" ? "border-rose-300/30 bg-rose-300/[0.06] text-rose-100" : "border-white/[0.08] bg-slate-950/30 text-slate-200";
  return <div className={"rounded-xl border p-3 text-xs " + tone}>
    <p className="text-sm font-semibold">🐋 Whales {data.stance === "WITH" ? "agree with this " + side : data.stance === "AGAINST" ? "are AGAINST this " + side : "are neutral on this " + side}</p>
    <p className="mt-1 leading-5 opacity-90">{data.detail}{data.book ? " · ranked book long $" + usd(data.book.longUsd) + " / short $" + usd(data.book.shortUsd) : ""}</p>
    {data.moves.length > 0 && <ul className="mt-1 space-y-0.5 text-[11px] text-slate-300">{data.moves.slice(0, 5).map(m => <li key={m.at + m.label}>• {new Date(m.at).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })} <span className="font-mono">{m.label}</span> {m.tier.toLowerCase()} {m.kind.toLowerCase()} {m.side} ${usd(Math.abs(m.deltaUsd))} @ {m.entry}</li>)}</ul>}
    {data.stance === "AGAINST" && <p className="mt-1 font-semibold">Treat this signal with half size or skip it: the system and the whales disagree.</p>}
  </div>;
}
