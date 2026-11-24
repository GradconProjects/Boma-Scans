import type { Candle, MarketAnalysis, ScannerRow } from "@/app/lib/market";

/**
 * What may be pushed to Telegram as an entry call. The app shows every graded
 * setup; the phone gets only entries that (1) follow a major structural
 * event, a confirmed break of structure, a change of character or a
 * liquidity sweep on the trade's side, (2) carry a stop the trade can
 * reasonably hold for four hours or more, and (3) are not fought by the
 * ranked whales. Everything else stays in the app.
 */
export type PushGate = { ok: boolean; reasons: string[]; event: string | null; survivalHours: number };

export const MIN_STOP_ATR = 2;          // ~ one 4-hour range on the 1H chart
export const RECENT_HOURS = 4;          // the last four closed candles must not have traded through the stop

export function majorEventGate(row: Pick<ScannerRow, "bias" | "setupType" | "stop" | "entry" | "executionPlan"> & Partial<Pick<ScannerRow, "keyLevels">>, analysis: Pick<MarketAnalysis, "structure" | "metrics">, candles: Candle[]): PushGate {
  const side = row.bias; const sign = side === "LONG" ? 1 : -1;
  const want = side === "LONG" ? "BULLISH" : "BEARISH";
  const s = analysis.structure;
  const event = s.choch === want ? "change of character (CHoCH) " + side.toLowerCase() : s.bos === want ? "break of structure " + side.toLowerCase() : s.sweep === want ? "liquidity sweep " + side.toLowerCase() : row.setupType === "BREAKOUT" || row.setupType === "CHoCH REVERSAL" ? row.setupType.toLowerCase() + " setup" : null;
  const reasons: string[] = [];
  if (!event) reasons.push("no major structural event (CHoCH, break of structure or sweep) behind this entry");
  const entry = row.executionPlan.entry; const risk = Math.abs(entry - row.stop); const atr = analysis.metrics.atr;
  const survivalHours = atr > 0 ? Math.round((risk / atr) ** 2 * 10) / 10 : 0; // random-walk estimate: range grows with the square root of time
  if (risk < MIN_STOP_ATR * atr) reasons.push("stop is " + (risk / atr).toFixed(1) + " ATR from the entry; a four-hour hold needs about " + MIN_STOP_ATR + " ATR");
  const recent = candles.slice(-RECENT_HOURS - 1, -1);
  const adverse = recent.length ? Math.max(...recent.map(c => sign * (entry - (sign > 0 ? c.low : c.high)))) : 0;
  if (recent.length && adverse >= risk * 0.8) reasons.push("price traded within 20% of the stop in the last four hours");
  // The stop must sit beyond the nearest historic level, not inside it: a stop parked in a level is the first thing a wick takes.
  if (row.keyLevels && row.keyLevels.stopProtected === false) reasons.push("stop sits inside a historic support/resistance zone");
  return { ok: reasons.length === 0, reasons, event, survivalHours };
}

export type WhaleAlignment = { stance: "WITH" | "AGAINST" | "NEUTRAL"; detail: string };

/** Whether ranked directional whales are with, against, or indifferent to a side on a coin. */
export function whaleStance(side: "LONG" | "SHORT", book: { longUsd: number; shortUsd: number }, freshFlow: { longUsd: number; shortUsd: number }): WhaleAlignment {
  const flowTotal = freshFlow.longUsd + freshFlow.shortUsd;
  const bookTotal = book.longUsd + book.shortUsd;
  const mine = (x: { longUsd: number; shortUsd: number }) => side === "LONG" ? x.longUsd : x.shortUsd;
  if (flowTotal >= 500_000) {
    const share = mine(freshFlow) / flowTotal;
    if (share >= 0.65) return { stance: "WITH", detail: Math.round(share * 100) + "% of the whales' fresh money in the last 24 h is " + side };
    if (share <= 0.35) return { stance: "AGAINST", detail: Math.round((1 - share) * 100) + "% of the whales' fresh money in the last 24 h is " + (side === "LONG" ? "SHORT" : "LONG") };
  }
  if (bookTotal >= 1_000_000) {
    const share = mine(book) / bookTotal;
    if (share >= 0.7) return { stance: "WITH", detail: Math.round(share * 100) + "% of the ranked whales' open book is " + side };
    if (share <= 0.3) return { stance: "AGAINST", detail: Math.round((1 - share) * 100) + "% of the ranked whales' open book is " + (side === "LONG" ? "SHORT" : "LONG") };
  }
  return { stance: "NEUTRAL", detail: "ranked whales are split or absent on this coin" };
}

/**
 * Backtested trading windows (Melbourne time, DST-aware). In two years of 1H
 * signals, Monday and Tuesday were net losers. A three-year replay of 489 pairs
 * (docs/SYSTEM-COMPARISON.md) confirmed that for both systems in every year, and
 * did NOT confirm the 03:00–10:00 "dead zone": hours made no difference. So the
 * window is now the weekday only. It is a flag by default; it restricts pushes
 * only when the owner chooses BACKTESTED. Entered trades are always managed.
 */
export type WindowMode = "BACKTESTED" | "ALL";
/** No longer used by the gate: the three-year replay did not confirm an hour-of-day effect. Kept for reference. */
export const DEAD_ZONE = { from: 3, to: 10 } as const;
export const SKIP_WEEKDAYS = new Set([1, 2]);              // Monday, Tuesday (Melbourne)

export function melbourneClock(now = Date.now()): { hour: number; weekday: number; label: string } {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === "hour")?.value ?? 0) % 24;
  const weekdayName = parts.find(p => p.type === "weekday")?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName.slice(0, 3));
  return { hour, weekday, label: weekdayName.slice(0, 3) + " " + String(hour).padStart(2, "0") + ":00 Melbourne" };
}

export function tradingWindowGate(now = Date.now(), mode: WindowMode = "BACKTESTED"): { ok: boolean; reason: string | null; label: string } {
  const clock = melbourneClock(now);
  if (mode === "ALL") return { ok: true, reason: null, label: clock.label };
  if (SKIP_WEEKDAYS.has(clock.weekday)) return { ok: false, reason: "outside the backtested windows: Monday and Tuesday (Melbourne) lost money in every year of the three-year test", label: clock.label };
  return { ok: true, reason: null, label: clock.label };
}

/** Plain statement for the trader: is now a good time, and when is the next good window (Melbourne). */
export function windowVerdict(now = Date.now()): { good: boolean; title: string; detail: string; label: string } {
  const gate = tradingWindowGate(now, "BACKTESTED");
  if (gate.ok) return { good: true, label: gate.label, title: "GOOD TIME TO TRADE", detail: "Wednesday to Sunday (Melbourne). In the three-year test these days were about break-even to slightly positive; Monday and Tuesday lost money. The hour of the day made no difference." };
  // Find the next good hour.
  let t = now; for (let i = 0; i < 24 * 8; i++) { t += 3_600_000; if (tradingWindowGate(t, "BACKTESTED").ok) break; }
  const next = melbourneClock(t);
  const clock = melbourneClock(now);
  const reason = "Flag only, nothing is blocked: entries on Monday and Tuesday (Melbourne) lost money in every year of the three-year test, for both systems.";
  return { good: false, label: gate.label, title: "CAUTION DAY", detail: reason + " Next better day starts " + next.label + ". Trades you are already in are still managed.", };
}


/**
 * Evidence flags from the three-year, all-pairs replay (docs/SYSTEM-COMPARISON.md). Information only: a flag never blocks,
 * hides or changes a signal. Each one says in a sentence what the test found.
 */
export function evidenceFlags(input: { side?: string | null; at?: number; majorEvent?: boolean | null; rating?: number | null }): string[] {
  const flags: string[] = []; const clock = melbourneClock(input.at ?? Date.now());
  if (SKIP_WEEKDAYS.has(clock.weekday)) flags.push("🚩 " + (clock.weekday === 1 ? "Monday" : "Tuesday") + " (Melbourne): entries on Monday and Tuesday lost money in every year of the 3-year test (about −0.06R to −0.15R). Other days were about break-even.");
  if (input.side === "LONG") flags.push("🚩 LONG: long entries lost in the 3-year test (about −0.06R a trade); shorts were about break-even.");
  if (input.majorEvent === false) flags.push("🚩 No major event (change of character, breakout or sweep with a 2+ ATR stop): signals without one averaged about −0.09R.");
  if (input.majorEvent === true) flags.push("✅ Major event present: the best group in the 3-year test (about break-even overall, +0.05R from Wednesday to Sunday).");
  if (input.rating !== null && input.rating !== undefined && input.rating <= 2) flags.push("🚩 Low rating (" + input.rating + "/10): setups rated 1–2 lost 0.14R to 0.60R on average in the test.");
  return flags;
}
/** The flags as a short block for a card, or nothing when there are none. */
export function evidenceFlagLines(input: Parameters<typeof evidenceFlags>[0]): string[] { const f = evidenceFlags(input); return f.length ? ["", "🚩 FLAGS (3-year test · information only, nothing is blocked)", ...f] : []; }
