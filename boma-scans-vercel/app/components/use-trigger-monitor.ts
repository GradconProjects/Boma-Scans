"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTickers, type ScannerRow } from "@/app/lib/market";
import { ALERT_STATES, evaluateMonitor, type MonitorEntry, type TriggerState } from "@/app/lib/trigger-monitor";

const POLL_MS = 10_000;
const REALERT_MS = 15 * 60_000;
const RANK: Record<TriggerState, number> = { "NO PLAN": 0, WAITING: 0, "STOP HIT": 0, "AT TRIGGER": 1, "ENTRY RANGE": 2 };

/**
 * Watches the live price of the pairs you chose against their scanned plans.
 * One tickers request every 10 s while the tab is visible covers every pair.
 * `onAlert` fires when a pair first reaches AT TRIGGER or ENTRY RANGE for a
 * plan (and again at most every 15 minutes if it keeps oscillating there).
 */
export function useTriggerMonitor({rows, monitored, onAlert}: {
  rows: ScannerRow[]; monitored: string[]; onAlert: (entries: MonitorEntry[]) => void;
}) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [updatedAt, setUpdatedAt] = useState(0);
  const alerted = useRef(new Map<string, { state: TriggerState; at: number }>());
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;
  const key = monitored.join(",");

  useEffect(() => {
    if (!key) return;
    let stopped = false, busy = false;
    const controller = new AbortController();
    async function poll() {
      if (stopped || busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const tickers = await fetchTickers(controller.signal);
        const wanted = new Set(key.split(","));
        const next: Record<string, number> = {};
        for (const ticker of tickers) if (wanted.has(ticker.symbol) && ticker.lastPrice > 0) next[ticker.symbol] = ticker.lastPrice;
        if (!stopped) { setPrices(next); setUpdatedAt(Date.now()); }
      } catch { /* keep last prices */ }
      finally { busy = false; }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const visible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [key]);

  const entries = useMemo(() => {
    const bySymbol = new Map(rows.map(row => [row.symbol, row]));
    return monitored.map(symbol => evaluateMonitor(symbol, bySymbol.get(symbol), prices[symbol]));
  }, [rows, monitored, prices]);

  useEffect(() => {
    const now = Date.now();
    const fresh: MonitorEntry[] = [];
    for (const entry of entries) {
      if (!ALERT_STATES.includes(entry.state)) continue;
      const previous = alerted.current.get(entry.planKey);
      if (!previous || RANK[entry.state] > RANK[previous.state] || now - previous.at >= REALERT_MS) {
        alerted.current.set(entry.planKey, { state: entry.state, at: now });
        fresh.push(entry);
      }
    }
    if (fresh.length) onAlertRef.current(fresh);
  }, [entries]);

  const hits = entries.filter(entry => ALERT_STATES.includes(entry.state));
  return { entries, hits, updatedAt };
}
