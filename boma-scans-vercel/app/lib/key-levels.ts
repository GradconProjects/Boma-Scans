import type { Candle } from "@/app/lib/market";

/**
 * Historic support and resistance from higher-timeframe swings.
 *
 * Confirmed swing highs and lows on the daily and weekly charts (three closed
 * candles either side), the yearly and all-data extremes and the prior month's
 * range are clustered into zones. A zone's strength counts touches, with weekly
 * swings worth double and recent touches worth a little more. Signals are then
 * judged against the zones: a trade must have room to its first target before
 * the next major level in its path, an entry sitting on a major level in its
 * favour is a plus, and a stop parked inside a major level is a minus.
 */
export type KeyLevelZone = {
  low: number; high: number; price: number;
  kind: "SUPPORT" | "RESISTANCE" | "BOTH";
  strength: number; touches: number; weeklyTouches: number; lastTouch: number;
  sources: string[];
};

export type KeyLevelAssessment = {
  zones: KeyLevelZone[];
  /** Nearest major zone in the trade's path (above a long entry, below a short entry). */
  opposing: KeyLevelZone | null;
  /** Nearest major zone behind the entry (below a long entry, above a short entry). */
  supporting: KeyLevelZone | null;
  /** Distance to the opposing zone in R; Infinity when none is in range. */
  roomR: number;
  /** Entry within half a daily ATR of the supporting zone. */
  atLevel: boolean;
  /** Stop sits beyond the supporting zone (or no zone is near it). */
  stopProtected: boolean;
  status: "PASS" | "WAIT" | "FAIL";
  detail: string;
  summary: string;
};

type Swing = { price: number; time: number; side: "HIGH" | "LOW"; weight: number; source: string };

/** Weekly candles from daily ones (weeks start Monday 00:00 UTC, as on Bybit). */
export function resampleWeekly(daily: Candle[]): Candle[] {
  const weeks = new Map<number, Candle>();
  for (const candle of daily) {
    const day = Math.floor(candle.time / 86_400_000);
    const start = (day - ((day + 3) % 7)) * 86_400_000;
    const week = weeks.get(start);
    if (!week) weeks.set(start, { time: start, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume });
    else { week.high = Math.max(week.high, candle.high); week.low = Math.min(week.low, candle.low); week.close = candle.close; week.volume += candle.volume; }
  }
  return Array.from(weeks.values()).sort((a, b) => a.time - b.time);
}

function swings(candles: Candle[], span: number, weight: number, source: string): Swing[] {
  const out: Swing[] = [];
  for (let i = span; i < candles.length - span; i++) {
    const window = candles.slice(i - span, i + span + 1);
    const c = candles[i];
    if (c.high >= Math.max(...window.map(x => x.high))) out.push({ price: c.high, time: c.time, side: "HIGH", weight, source });
    if (c.low <= Math.min(...window.map(x => x.low))) out.push({ price: c.low, time: c.time, side: "LOW", weight, source });
  }
  return out;
}

/** Build the zones. `tolerance` is the clustering width in price (about 0.6 daily ATR). */
export function keyLevelZones(daily: Candle[], weekly: Candle[], tolerance: number, now = Date.now()): KeyLevelZone[] {
  if (daily.length < 20) return [];
  const points: Swing[] = [
    ...swings(daily, 3, 1, "daily swing"),
    ...swings(weekly, 2, 2, "weekly swing"),
  ];
  const year = daily.slice(-365);
  const yearHigh = year.reduce((m, c) => Math.max(m, c.high), 0), yearLow = year.reduce((m, c) => Math.min(m, c.low), Infinity);
  points.push({ price: yearHigh, time: now, side: "HIGH", weight: 2, source: "yearly high" }, { price: yearLow, time: now, side: "LOW", weight: 2, source: "yearly low" });
  if (weekly.length > 52) {
    points.push({ price: weekly.reduce((m, c) => Math.max(m, c.high), 0), time: now, side: "HIGH", weight: 2.5, source: "multi-year high" }, { price: weekly.reduce((m, c) => Math.min(m, c.low), Infinity), time: now, side: "LOW", weight: 2.5, source: "multi-year low" });
  }
  const monthMs = 30 * 86_400_000;
  const prior = daily.filter(c => c.time < now - (now % monthMs) && c.time >= now - (now % monthMs) - monthMs);
  if (prior.length >= 10) points.push({ price: Math.max(...prior.map(c => c.high)), time: now, side: "HIGH", weight: 1.5, source: "prior-month high" }, { price: Math.min(...prior.map(c => c.low)), time: now, side: "LOW", weight: 1.5, source: "prior-month low" });
  points.sort((a, b) => a.price - b.price);
  const zones: KeyLevelZone[] = [];
  let bucket: Swing[] = [];
  const flush = () => {
    if (!bucket.length) return;
    const prices = bucket.map(p => p.price);
    const highs = bucket.filter(p => p.side === "HIGH").length, lows = bucket.length - highs;
    const recency = (time: number) => 0.8 + 0.4 * Math.max(0, 1 - (now - time) / (365 * 86_400_000));
    const strength = bucket.reduce((acc, p) => acc + p.weight * recency(p.time), 0);
    zones.push({ low: Math.min(...prices), high: Math.max(...prices), price: prices.reduce((a, b) => a + b, 0) / prices.length, kind: highs && lows ? "BOTH" : highs ? "RESISTANCE" : "SUPPORT", strength, touches: bucket.length, weeklyTouches: bucket.filter(p => p.weight >= 2 && p.source === "weekly swing").length, lastTouch: Math.max(...bucket.map(p => p.time)), sources: Array.from(new Set(bucket.map(p => p.source))) });
    bucket = [];
  };
  for (const point of points) {
    if (bucket.length && point.price - bucket[0].price > tolerance) flush();
    bucket.push(point);
  }
  flush();
  // Major zones only: at least two touches, or one weekly / yearly reference.
  return zones.filter(z => z.strength >= 2).sort((a, b) => b.strength - a.strength);
}

export function assessKeyLevels(zones: KeyLevelZone[], side: "LONG" | "SHORT", entry: number, stop: number, dailyAtr: number): KeyLevelAssessment {
  const risk = Math.max(Math.abs(entry - stop), Number.EPSILON);
  const sign = side === "LONG" ? 1 : -1;
  const ahead = zones.filter(z => sign * (z.price - entry) > 0 && (sign > 0 ? z.low : z.high) * sign > entry * sign).sort((a, b) => sign * (a.price - b.price));
  const behind = zones.filter(z => sign * (entry - z.price) >= 0 || (entry >= z.low && entry <= z.high)).sort((a, b) => sign * (b.price - a.price));
  const opposing = ahead[0] ?? null;
  const supporting = behind[0] ?? null;
  const roomR = opposing ? Math.abs((sign > 0 ? opposing.low : opposing.high) - entry) / risk : Infinity;
  const atLevel = !!supporting && Math.abs(entry - (sign > 0 ? supporting.high : supporting.low)) <= Math.max(dailyAtr * 0.5, entry * 0.002);
  const stopProtected = !supporting || (sign > 0 ? stop < supporting.low : stop > supporting.high) || Math.abs(stop - (sign > 0 ? supporting.low : supporting.high)) > dailyAtr * 0.5;
  const label = (z: KeyLevelZone) => (z.weeklyTouches ? "W" : "D") + "×" + z.touches;
  const status: KeyLevelAssessment["status"] = roomR < 1 ? "FAIL" : roomR < 1.5 && !atLevel ? "WAIT" : "PASS";
  const detail = roomR === Infinity
    ? "No major historic level in the path within range" + (atLevel ? "; entry sits on a major " + (sign > 0 ? "support" : "resistance") + " zone." : ".")
    : "Nearest major " + (sign > 0 ? "resistance" : "support") + " " + opposing!.price.toPrecision(6).replace(/\.?0+$/, "") + " (" + label(opposing!) + ") is " + roomR.toFixed(1) + "R away" + (roomR < 1 ? ": expect a reaction there before the first target; take the partial if price stalls at it. In the 2-year backtest, trend signals that broke through such levels were the stronger ones, so this is information, not a block." : roomR < 1.5 && !atLevel ? ": the first target sits just before it." : ".") + (atLevel ? " Entry sits on a major " + (sign > 0 ? "support" : "resistance") + " zone (" + label(supporting!) + ")." : "") + (!stopProtected ? " Stop sits inside the level; placing it beyond the level avoids the obvious sweep." : "");
  const summary = [supporting ? "S " + supporting.price.toPrecision(6).replace(/\.?0+$/, "") + " (" + label(supporting) + ")" : "", opposing ? "R " + opposing.price.toPrecision(6).replace(/\.?0+$/, "") + " (" + label(opposing) + ")" : "", roomR === Infinity ? "open road" : "room " + roomR.toFixed(1) + "R"]
    .filter(Boolean).map((part, i) => i === 0 && sign < 0 ? part.replace(/^S /, "R ") : i === 1 && sign < 0 ? part.replace(/^R /, "S ") : part).join(" · ");
  return { zones: zones.slice(0, 8), opposing, supporting, roomR, atLevel, stopProtected, status, detail, summary };
}
