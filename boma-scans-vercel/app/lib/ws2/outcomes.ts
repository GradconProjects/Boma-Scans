import type { Candle, Side, Ws2Status } from "@/app/lib/ws2/engine";

/** One logged signal. The original record is never rewritten; only `outcome` is filled in once, later. */
export type Ws2LogEntry = {
  id: string; at: number; version: string; coin: string; symbol: string; status: Ws2Status; side: Side | null; price: number | null;
  scores: Record<string, number>;
  plan: { entryLow: number; entryHigh: number; entry: number; stop: number; targets: number[] } | null;
  inputs: string[];
  costPct: number;
  outcome?: Ws2Outcome;
};
export type Ws2Outcome = { scoredAt: number; filled: boolean; fillPrice: number | null; result: "UNFILLED" | "INVALIDATED BEFORE ENTRY" | "STOP" | "TP1" | "TP2" | "TP3" | "TP4" | "TP5" | "EXPIRED IN TRADE" | "NO PLAN"; netR: number | null; forward4hPct: number | null; directionRight: boolean | null; mfeR: number | null; maeR: number | null; note: string };

export const SIGNAL_LIFE_MS = 4 * 3_600_000;
export const TRADE_LIFE_MS = 24 * 3_600_000;

/**
 * Scores one logged signal against the 15-minute candles that followed it.
 * Rules: the pullback entry must actually trade before the signal expires (4 h); a stop touched before the fill
 * cancels the trade (no loss is recorded for a trade never opened); when the stop and a target fall in the same
 * 15-minute candle the stop is assumed first (conservative); fees and slippage are deducted in R.
 */
export function scoreOutcome(entry: Ws2LogEntry, after: Candle[], now: number): Ws2Outcome | null {
  const candles = after.filter(c => c.time >= entry.at).sort((a, b) => a.time - b.time);
  if (now - entry.at < SIGNAL_LIFE_MS + 15 * 60_000) return null; // too early to judge
  const at4h = candles.filter(c => c.time <= entry.at + SIGNAL_LIFE_MS).pop();
  const forward = entry.price && at4h ? (at4h.close / entry.price - 1) * 100 : null;
  const directionRight = forward === null || !entry.side ? null : entry.side === "LONG" ? forward > 0 : forward < 0;
  const base = { scoredAt: now, forward4hPct: forward, directionRight };
  if (!entry.plan || !entry.side) return { ...base, filled: false, fillPrice: null, result: "NO PLAN", netR: null, mfeR: null, maeR: null, note: "No directional plan was issued (" + entry.status + ")." };
  const { entryLow, entryHigh, stop, targets } = entry.plan; const long = entry.side === "LONG"; const sign = long ? 1 : -1;
  let fill: { price: number; time: number } | null = null;
  for (const c of candles) {
    if (c.time > entry.at + SIGNAL_LIFE_MS) break;
    const stopHit = long ? c.low <= stop : c.high >= stop; const inZone = c.low <= entryHigh && c.high >= entryLow;
    if (inZone) { fill = { price: long ? Math.min(entryHigh, Math.max(c.open, entryLow)) : Math.max(entryLow, Math.min(c.open, entryHigh)), time: c.time }; break; }
    if (stopHit) return { ...base, filled: false, fillPrice: null, result: "INVALIDATED BEFORE ENTRY", netR: 0, mfeR: null, maeR: null, note: "Price reached the stop level before the entry zone traded. Trade cancelled; no loss recorded." };
  }
  if (!fill) return { ...base, filled: false, fillPrice: null, result: "UNFILLED", netR: 0, mfeR: null, maeR: null, note: "The entry zone did not trade within 4 hours. Signal expired." };
  const risk = Math.abs(fill.price - stop); if (risk <= 0) return { ...base, filled: false, fillPrice: null, result: "NO PLAN", netR: null, mfeR: null, maeR: null, note: "Invalid risk." };
  const costR = fill.price * entry.costPct / 100 / risk; let mfe = 0, mae = 0, reached = 0;
  for (const c of candles) {
    if (c.time < fill.time) continue; if (c.time > fill.time + TRADE_LIFE_MS) break;
    const adverse = sign * ((long ? c.low : c.high) - fill.price) / risk, favour = sign * ((long ? c.high : c.low) - fill.price) / risk;
    mae = Math.min(mae, adverse); const stopHit = long ? c.low <= stop : c.high >= stop;
    if (stopHit && c.time !== fill.time) { if (!reached) return { ...base, filled: true, fillPrice: fill.price, result: "STOP", netR: Number((-1 - costR).toFixed(2)), mfeR: Number(mfe.toFixed(2)), maeR: -1, note: "Stopped out before TP1." }; break; }
    mfe = Math.max(mfe, favour);
    while (reached < targets.length && (long ? c.high >= targets[reached] : c.low <= targets[reached])) reached++;
  }
  if (reached > 0) { const r = sign * (targets[reached - 1] - fill.price) / risk; return { ...base, filled: true, fillPrice: fill.price, result: ("TP" + reached) as Ws2Outcome["result"], netR: Number((r - costR).toFixed(2)), mfeR: Number(mfe.toFixed(2)), maeR: Number(mae.toFixed(2)), note: "Highest target reached before the stop within 24 hours: TP" + reached + ". Net R is quoted at that target, after costs." }; }
  const lastC = candles.filter(c => c.time <= fill!.time + TRADE_LIFE_MS).pop(); const r = lastC ? sign * (lastC.close - fill.price) / risk : 0;
  return { ...base, filled: true, fillPrice: fill.price, result: "EXPIRED IN TRADE", netR: Number((r - costR).toFixed(2)), mfeR: Number(mfe.toFixed(2)), maeR: Number(mae.toFixed(2)), note: "Neither the stop nor TP1 was reached within 24 hours; closed at the last price." };
}

export type Ws2Performance = { window: string; signals: number; scored: number; withPlan: number; filled: number; tp1BeforeStop: number; stops: number; avgNetR: number | null; directionRight: number; directionJudged: number; sample: "INSUFFICIENT SAMPLE" | "PRELIMINARY" | "USABLE"; byStatus: Array<{ status: string; scored: number; filled: number; tp1: number; stops: number; avgNetR: number | null }> };
/** Honest performance summary. Fewer than 30 filled trades is labelled INSUFFICIENT SAMPLE. */
export function summarise(log: Ws2LogEntry[], days: number, now: number): Ws2Performance {
  const inWindow = log.filter(e => now - e.at <= days * 86_400_000); const scored = inWindow.filter(e => e.outcome);
  const stat = (list: Ws2LogEntry[]) => { const filled = list.filter(e => e.outcome!.filled); const r = filled.map(e => e.outcome!.netR ?? 0); return { scored: list.length, filled: filled.length, tp1: filled.filter(e => e.outcome!.result.startsWith("TP")).length, stops: filled.filter(e => e.outcome!.result === "STOP").length, avgNetR: r.length ? Number((r.reduce((a, b) => a + b, 0) / r.length).toFixed(2)) : null }; };
  const all = stat(scored); const judged = scored.filter(e => e.outcome!.directionRight !== null);
  return { window: days + " days", signals: inWindow.length, scored: scored.length, withPlan: scored.filter(e => e.plan).length, filled: all.filled, tp1BeforeStop: all.tp1, stops: all.stops, avgNetR: all.avgNetR, directionRight: judged.filter(e => e.outcome!.directionRight).length, directionJudged: judged.length, sample: all.filled < 30 ? "INSUFFICIENT SAMPLE" : all.filled < 100 ? "PRELIMINARY" : "USABLE", byStatus: Array.from(new Set(scored.map(e => e.status))).map(status => ({ status, ...stat(scored.filter(e => e.status === status)) })) };
}
