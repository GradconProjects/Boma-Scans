"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Push = { tradingWindows: "BACKTESTED" | "ALL"; window: { ok: boolean; reason: string | null; label: string } };

/** When scanner entry calls may be pushed: the backtested Melbourne windows, or every hour. */
export function TradingWindowsBox() {
  const [push, setPush] = useState<Push | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/telegram", { cache: "no-store" }).then(r => r.json()).then(d => { if (d.push) setPush(d.push as Push); }).catch(() => undefined); }, []);
  const choose = async (mode: "BACKTESTED" | "ALL") => {
    setBusy(true);
    try { const r = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "windows", mode }) }); const d = await r.json() as { push?: { tradingWindows: Push["tradingWindows"] }; window?: Push["window"] }; if (d.push && d.window) setPush({ tradingWindows: d.push.tradingWindows, window: d.window }); }
    finally { setBusy(false); }
  };
  return <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3">
    <p className="text-sm font-semibold text-amber-100">🕰 Restrict entry calls to the good windows?{push ? " · currently " + (push.tradingWindows === "ALL" ? "ALL HOURS (every call is pushed, flagged when outside a good window)" : "BACKTESTED WINDOWS ONLY") : ""}</p>
    <p className="mt-1 text-xs leading-5 text-slate-400">Two years of this engine&apos;s signals: Monday and Tuesday (Melbourne) lost money in both years, and 03:00–10:00 was flat to negative. Skipping both lifted the average from +0.2R to +0.6R, winners from 51% to 69%, and cut the maximum drawdown from 9R to under 4R, on about 40% of the trades. Entered trades are managed in every hour regardless.</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <Button type="button" size="sm" variant={push?.tradingWindows === "BACKTESTED" ? "default" : "outline"} disabled={busy} onClick={() => void choose("BACKTESTED")} className="rounded-lg">Only the good windows (Wed–Sun, not 03:00–10:00)</Button>
      <Button type="button" size="sm" variant={push?.tradingWindows === "ALL" ? "default" : "outline"} disabled={busy} onClick={() => void choose("ALL")} className="rounded-lg">All hours, just tell me</Button>
    </div>
    {push && !push.window.ok && push.tradingWindows === "BACKTESTED" && <p className="mt-2 text-xs text-amber-200">Entry calls are being held right now: {push.window.reason}.</p>}
  </div>;
}
