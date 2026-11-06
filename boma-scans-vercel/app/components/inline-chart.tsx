"use client";
import { useEffect, useState } from "react";
import { ChevronDown, LineChart, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketChart } from "@/app/components/market-chart";
import { analyzeMarket, contextIntervals, fetchKlines, fetchTicker, STYLE_CONFIG, TIMEFRAMES, type Candle, type MarketAnalysis, type TradingStyle } from "@/app/lib/market";
import type { FlexibilityMode } from "@/app/lib/entry-policy";
import type { TargetStyle } from "@/app/lib/target-policy";

type Loaded = { candles: Candle[]; analysis: MarketAnalysis; at: number };

/**
 * A chart that opens directly under a signal or watch card and folds away
 * again. It loads its own candles for the pair's execution timeframe and runs
 * the same analysis the scanner used, so the levels drawn match the card.
 */
export function InlineChart({symbol, style, flexibility, timeframe, open, onToggle, onOpenMain, targetStyle}: {
  symbol: string; style: TradingStyle; flexibility: FlexibilityMode; timeframe?: string; targetStyle?: TargetStyle;
  open: boolean; onToggle: () => void; onOpenMain?: () => void;
}) {
  const minutes = timeframe?.endsWith("h") ? String(Number(timeframe.slice(0, -1)) * 60) : timeframe?.endsWith("m") ? timeframe.slice(0, -1) : "";
  const interval = TIMEFRAMES.some(frame => frame.value === minutes) ? minutes : STYLE_CONFIG[style].interval;
  const intervalLabel = TIMEFRAMES.find(frame => frame.value === interval)?.label ?? interval;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError("");
    (async () => {
      try {
        const [contextInterval, macroInterval] = contextIntervals(interval);
        const [fast, context, macro, ticker] = await Promise.all([
          fetchKlines(symbol, interval, 480, controller.signal),
          fetchKlines(symbol, contextInterval, 400, controller.signal),
          fetchKlines(symbol, macroInterval, 360, controller.signal),
          fetchTicker(symbol, controller.signal),
        ]);
        if (fast.length < 31) throw new Error("Not enough candle history for " + symbol + ".");
        const analysis = analyzeMarket(fast, context, macro, ticker, style, { flexibility, targetStyle });
        if (active) setLoaded({ candles: fast, analysis, at: Date.now() });
      } catch (caught) {
        if (active && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Chart unavailable.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [open, symbol, interval, style, flexibility, targetStyle, reload]);

  return <div className="rounded-2xl border border-white/[0.08] bg-slate-950/40">
    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5">
      <Button type="button" variant={open ? "outline" : "default"} size="sm" onClick={onToggle} aria-expanded={open} className="rounded-xl"><LineChart className="mr-1.5 h-4 w-4"/>{open ? "Fold chart" : "Chart · " + intervalLabel}<ChevronDown className={"ml-1.5 h-4 w-4 transition-transform " + (open ? "rotate-180" : "")}/></Button>
      {open && <div className="flex items-center gap-2 text-xs text-slate-400">{loaded && <span>Analysed {new Date(loaded.at).toLocaleTimeString("en-AU", {timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit"})}</span>}<Button type="button" variant="ghost" size="sm" onClick={() => setReload(value => value + 1)} disabled={loading} className="rounded-lg"><RefreshCw className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")}/></Button>{onOpenMain && <Button type="button" variant="ghost" size="sm" onClick={onOpenMain} className="rounded-lg">Open in main chart</Button>}</div>}
    </div>
    {open && <div className="border-t border-white/[0.06] p-2">
      {error ? <p className="p-3 text-sm text-amber-200">{error}</p>
        : loaded ? <div className="h-[380px]"><MarketChart candles={loaded.candles} analysis={loaded.analysis} symbol={symbol} intervalLabel={intervalLabel} loading={loading} style={style}/></div>
        : <p className="p-3 text-sm text-slate-400">Loading {symbol} {intervalLabel} candles…</p>}
    </div>}
  </div>;
}
