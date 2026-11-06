"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTickers, type ScannerRow } from "@/app/lib/market";
import { ALERT_STATES, armPlan, checkExits, evaluateMonitor, parseArmedPlans, type ArmedPlan, type ExitEvent, type MonitorEntry, type TriggerState } from "@/app/lib/trigger-monitor";

const ARMED_KEY = "boma-scans:armed";

const POLL_MS = 10_000;
const REALERT_MS = 15 * 60_000;
const RANK: Record<TriggerState, number> = { "NO PLAN": 0, WAITING: 0, "STOP HIT": 0, "AT TRIGGER": 1, "ENTRY RANGE": 2 };

/**
 * Watches the live price of the pairs you chose against their scanned plans.
 * One tickers request every 10 s while the tab is visible covers every pair.
 * `onAlert` fires when a pair first reaches AT TRIGGER or ENTRY RANGE for a
 * plan (and again at most every 15 minutes if it keeps oscillating there).
 */
export type MonitorUpdate = { kind: "CONFIRMED" | "PLAN UPDATED" | "EXPIRED" | "STOP HIT"; entry: MonitorEntry };

export function useTriggerMonitor({rows, monitored, onAlert, onFollowUp, onUpdate, onExit}: {
  rows: ScannerRow[]; monitored: string[]; onAlert: (entries: MonitorEntry[]) => void; onFollowUp?: (entries: MonitorEntry[]) => void;
  onUpdate?: (updates: MonitorUpdate[]) => void; onExit?: (events: ExitEvent[]) => void;
}) {
  const [armed, setArmed] = useState<ArmedPlan[]>([]);
  const armedRef = useRef<ArmedPlan[]>([]);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  useEffect(() => {
    try { const saved = parseArmedPlans(JSON.parse(window.localStorage.getItem(ARMED_KEY) ?? "[]")); armedRef.current = saved; setArmed(saved); } catch { /* start empty */ }
  }, []);
  const saveArmed = (next: ArmedPlan[]) => { armedRef.current = next; setArmed(next); try { window.localStorage.setItem(ARMED_KEY, JSON.stringify(next)); } catch { /* device storage unavailable */ } };
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [updatedAt, setUpdatedAt] = useState(0);
  const alerted = useRef(new Map<string, { state: TriggerState; at: number }>());
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;
  const onFollowUpRef = useRef(onFollowUp);
  onFollowUpRef.current = onFollowUp;
  const stopReported = useRef(new Set<string>());
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const seen = useRef(new Map<string, { planKey: string; ready: boolean; status: string }>());
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
    // A monitored plan that hits its stop side gets one follow-up.
    const ended = entries.filter(entry => entry.state === "STOP HIT" && entry.plan && !stopReported.current.has(entry.planKey));
    for (const entry of ended) stopReported.current.add(entry.planKey);
    if (ended.length) onFollowUpRef.current?.(ended);
    // Ongoing updates: candle-close confirmation, plan replaced after a rescan, plan expired.
    const updates: MonitorUpdate[] = [];
    for (const entry of entries) {
      const previous = seen.current.get(entry.symbol);
      const status = entry.plan?.status ?? "NONE";
      if (previous && entry.plan) {
        if (previous.planKey !== entry.planKey && previous.planKey !== entry.symbol + ":none") updates.push({ kind: "PLAN UPDATED", entry });
        else if (!previous.ready && entry.ready) updates.push({ kind: "CONFIRMED", entry });
        if (status === "EXPIRED" && previous.status !== "EXPIRED") updates.push({ kind: "EXPIRED", entry });
      }
      seen.current.set(entry.symbol, { planKey: entry.planKey, ready: entry.ready, status });
    }
    for (const symbol of Array.from(seen.current.keys())) if (!entries.some(entry => entry.symbol === symbol)) seen.current.delete(symbol);
    if (updates.length) onUpdateRef.current?.(updates);
    // Entry → exit tracking: lock the levels when a monitored pair reaches its entry range, then watch targets and stop.
    let armedNow = armedRef.current;
    const rowBySymbol = new Map(rows.map(row => [row.symbol, row]));
    for (const entry of entries) {
      if (entry.state !== "ENTRY RANGE" || armedNow.some(plan => plan.symbol === entry.symbol)) continue;
      const row = rowBySymbol.get(entry.symbol);
      if (row) armedNow = [...armedNow, armPlan(row, now)];
    }
    const exits: ExitEvent[] = [];
    armedNow = armedNow.flatMap(plan => {
      const price = prices[plan.symbol];
      if (!Number.isFinite(price)) return [plan];
      const result = checkExits(plan, price);
      exits.push(...result.events);
      return result.next ? [result.next] : [];
    });
    if (armedNow !== armedRef.current && (armedNow.length !== armedRef.current.length || armedNow.some((plan, index) => plan !== armedRef.current[index]))) saveArmed(armedNow);
    if (exits.length) onExitRef.current?.(exits);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);
  const disarm = (symbol: string) => saveArmed(armedRef.current.filter(plan => plan.symbol !== symbol));

  const hits = entries.filter(entry => ALERT_STATES.includes(entry.state));
  return { entries, hits, updatedAt, armed, disarm };
}
