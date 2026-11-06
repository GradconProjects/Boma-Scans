"use client";
import { useEffect, useRef, useState } from "react";
import { summarizeOrderBook, type OrderBookBalance } from "@/app/lib/order-book";

const REFRESH_MS = 30_000;
const MAX_SYMBOLS = 8;

/**
 * Polls the order book for a handful of visible symbols every 30 s while the tab
 * is visible. Each request is one serverless invocation, so the list is capped.
 */
export function useOrderBooks(symbols: string[]) {
  const [books, setBooks] = useState<Record<string, OrderBookBalance>>({});
  const key = Array.from(new Set(symbols)).slice(0, MAX_SYMBOLS).sort().join(",");
  const latest = useRef(key);
  latest.current = key;
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const controller = new AbortController();
    async function refresh() {
      if (stopped || document.visibilityState !== "visible") return;
      const list = latest.current.split(",").filter(Boolean);
      await Promise.all(list.map(async symbol => {
        try {
          const response = await fetch("/api/bybit?kind=orderbook&symbol=" + symbol, { cache: "no-store", signal: controller.signal });
          const payload = await response.json() as { result?: { s?: string; b?: [string, string][]; a?: [string, string][] } };
          if (!response.ok || !payload.result) return;
          const summary = summarizeOrderBook(symbol, payload.result);
          if (summary && !stopped) setBooks(current => ({ ...current, [symbol]: summary }));
        } catch { /* keep the previous reading */ }
      }));
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [key]);
  return books;
}
