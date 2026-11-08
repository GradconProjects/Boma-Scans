import type { Bias, Candle } from "@/app/before-telegram/_src/lib/market";
import { resolveEntryTiming, type FlexibilityMode } from "@/app/before-telegram/_src/lib/entry-policy";

// Location rules are policy limits, not empirically calibrated win probabilities.
export const ENTRY_LOCATION_POLICY = {
  maximumExtensionAtr: 1.8,
  impulseRangeAtr: 1.8,
  threeCandleMoveAtr: 2.4,
  maximumChaseAtr: 0.35,
  maximumChaseR: 0.25,
  stopBufferAtr: 0.3,
  maximumStopAtr: 3,
  validCandles: 2,
} as const;

export type EntryExecutionPlan = {
  status: "READY" | "WAIT_RETEST" | "WAIT_CONFIRMATION" | "WAIT_PRICE" | "INVALIDATED" | "EXPIRED" | "BLOCKED";
  headline: string;
  reason: string;
  side: Bias;
  zoneLow: number;
  zoneHigh: number;
  zoneSource: string;
  trigger: number;
  entryLow: number;
  entryHigh: number;
  entry: number;
  stop: number;
  stopSource: string;
  referenceAtr: number;
  extensionAtr: number;
  impulsePending: boolean;
  timingReady: boolean;
  locationOkay: boolean;
  confirmationPath: string;
  confirmationTime: number | null;
  expiresAt: number;
  timeframe: string;
  steps: string[];
  cancelText: string;
};

const priceText = (price: number) => price.toLocaleString("en-US", {
  maximumFractionDigits: price >= 100 ? 2 : price >= 1 ? 4 : 8,
});

export function buildEntryExecutionPlan(input: {
  candles: Candle[]; liveCandle?: Candle; side: Bias; marketPrice: number;
  zoneLow: number; zoneHigh: number; zoneSource: string; ema21: number;
  atr: number; intervalMs: number; now: number; breakTime?: number | null;
  mode: FlexibilityMode; setupType: string; score: number; threshold: number;
  confluence: number; frames: number; strongClose: boolean;
  structureReady: boolean; momentumAligned: boolean;
}): EntryExecutionPlan {
  const { candles, side, marketPrice, intervalMs } = input;
  const long = side === "LONG";
  const sign = long ? 1 : -1;
  const current = candles[candles.length - 1];
  // Median true range from BEFORE the last three candles prevents the impulse
  // from increasing its own allowed chase distance.
  const ranges = candles.slice(-24, -3).map((bar, index, sample) => {
    const previousClose = sample[index - 1]?.close ?? bar.open;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  }).filter(value => value > 0).sort((a, b) => a - b);
  const referenceAtr = Math.max(Math.min(input.atr, ranges[Math.floor(ranges.length / 2)] ?? input.atr), current.close * 0.0001);
  const zoneLow = Math.max(Number.EPSILON, input.zoneLow);
  const zoneHigh = Math.max(zoneLow, input.zoneHigh);
  const trigger = (long ? zoneHigh : zoneLow) + sign * referenceAtr * 0.04;
  const touches = (bar: Candle) => bar.low <= zoneHigh && bar.high >= zoneLow;
  let impulseTime: number | null = null;
  for (let i = Math.max(0, candles.length - 6); i < candles.length; i++) {
    const bar = candles[i];
    const range = bar.high - bar.low;
    const directionalBody = sign * (bar.close - bar.open);
    const threeMove = i >= 2 ? sign * (bar.close - candles[i - 2].open) : 0;
    if ((range >= referenceAtr * ENTRY_LOCATION_POLICY.impulseRangeAtr && directionalBody >= referenceAtr * 0.8) ||
        (threeMove >= referenceAtr * ENTRY_LOCATION_POLICY.threeCandleMoveAtr &&
          candles.slice(Math.max(0, i - 2), i + 1).every(item => sign * (item.close - item.open) > 0))) impulseTime = bar.time;
  }
  const eventTime = Math.max(input.breakTime ?? 0, impulseTime ?? 0);
  const recent = candles.slice(-5);
  // A breakout/impulse candle cannot also count as its own subsequent retest.
  const retests = recent.filter(bar => {
    if (bar.time <= eventTime || !touches(bar)) return false;
    if (input.setupType !== "PULLBACK") return true;
    const prior = candles.filter(item => item.time < bar.time).slice(-8);
    if (prior.length < 3) return false;
    const liquidity = long ? Math.min(...prior.map(item=>item.low)) : Math.max(...prior.map(item=>item.high));
    const swept = long ? bar.low < liquidity : bar.high > liquidity;
    const reclaimedZone = long ? bar.close >= zoneLow : bar.close <= zoneHigh;
    return swept && reclaimedZone;
  });
  let confirmationTime: number | null = null;
  for (const bar of recent) {
    const touchedBefore = retests.some(touch =>
      (input.setupType === "PULLBACK"
        ? touch.time < bar.time && sign * (bar.close - (long ? touch.high : touch.low)) > referenceAtr * 0.02
        : touch.time <= bar.time) && bar.time - touch.time <= intervalMs * 2);
    const range = Math.max(bar.high - bar.low, Number.EPSILON);
    const finish = long ? (bar.close - bar.low) / range : (bar.high - bar.close) / range;
    if (touchedBefore && sign * (bar.close - trigger) >= 0 && sign * (bar.close - bar.open) > 0 && finish >= 0.6 &&
        range < referenceAtr * ENTRY_LOCATION_POLICY.impulseRangeAtr) confirmationTime = bar.time;
  }
  const impulsePending = impulseTime !== null && !retests.some(bar => bar.time > impulseTime);
  const stopBars = input.setupType === "PULLBACK" ? candles.slice(-12) : retests;
  const boundary = long
    ? Math.min(zoneLow, ...stopBars.map(bar => bar.low))
    : Math.max(zoneHigh, ...stopBars.map(bar => bar.high));
  // Protect the entire zone/retest wick. Never clip this inward to improve R:R.
  const structuralStop = boundary - sign * referenceAtr * ENTRY_LOCATION_POLICY.stopBufferAtr;
  const stop = Math.max(Number.EPSILON, long
    ? Math.min(structuralStop, trigger - referenceAtr * 0.65)
    : Math.max(structuralStop, trigger + referenceAtr * 0.65));
  const stopDistance = Math.abs(trigger - stop);
  const chaseAllowance = Math.min(referenceAtr * ENTRY_LOCATION_POLICY.maximumChaseAtr, stopDistance * ENTRY_LOCATION_POLICY.maximumChaseR);
  const entryLow = long ? trigger : trigger - chaseAllowance;
  const entryHigh = long ? trigger + chaseAllowance : trigger;
  const extensionAtr = Math.max(0, sign * (marketPrice - input.ema21) / referenceAtr);
  const tooExtended = extensionAtr > ENTRY_LOCATION_POLICY.maximumExtensionAtr;
  const tooLate = long ? marketPrice > entryHigh : marketPrice < entryLow;
  const reclaimed = sign * (marketPrice - trigger) >= 0;
  const currentBarBreachedStop = input.liveCandle && input.liveCandle.time > current.time &&
    (long ? input.liveCandle.low <= stop : input.liveCandle.high >= stop);
  const invalidated = sign * (marketPrice - stop) <= 0 || currentBarBreachedStop ||
    sign * (current.close - (long ? zoneLow : zoneHigh)) < 0;
  const staleHistory = input.now < current.time + intervalMs || input.now >= current.time + intervalMs * 3;
  const expiredConfirmation = confirmationTime !== null && input.now >= confirmationTime + intervalMs * 3;
  const freshConfirmation = confirmationTime !== null && !expiredConfirmation && sign * (current.close - trigger) >= 0;
  const locationOkay = !invalidated && !staleHistory && !tooExtended && !tooLate && reclaimed && !impulsePending;
  const alternativeAllowed = !impulsePending && input.setupType !== "CHoCH REVERSAL" && input.setupType !== "PULLBACK";
  const timing = resolveEntryTiming({
    ...input, plannedTriggerPassed: freshConfirmation,
    strongClose: input.strongClose && alternativeAllowed,
    notChased: locationOkay, invalidated: Boolean(invalidated),
  });
  if (timing.passed && !freshConfirmation) confirmationTime = current.time;
  const stopTooWide = stopDistance > referenceAtr * ENTRY_LOCATION_POLICY.maximumStopAtr;
  let status: EntryExecutionPlan["status"] = "READY";
  let reason = "A closed candle confirmed the fixed trigger. The live quote is within the no-chase range; use the fixed limit price, not a moving market entry.";
  if (invalidated) { status = "INVALIDATED"; reason = "The zone failed or price crossed the stop before entry. Cancel this plan and wait for fresh structure."; }
  else if (staleHistory) { status = "EXPIRED"; reason = "Candle history is stale or incomplete. Refresh the chart before using an entry price."; }
  else if (impulsePending || tooExtended || tooLate) {
    status = "WAIT_RETEST";
    reason = impulsePending ? "A sharp directional move has not completed a later retest. Do not enter on the pump or dump candle."
      : tooExtended ? "Price is " + extensionAtr.toFixed(2) + " normal candle ranges from EMA21. Let price return to the retest zone."
      : "The entry price has run beyond " + priceText(long ? entryHigh : entryLow) + ". Skip this chase; require a fresh retest and close.";
  }
  else if (stopTooWide) { status = "BLOCKED"; reason = "The structural stop is too distant for this entry. Wait for a tighter structure; do not move the stop inside the zone."; }
  else if (expiredConfirmation) { status = "EXPIRED"; reason = "The confirmation is over two candles old. Require a new retest and confirmation."; }
  else if (!timing.passed || !reclaimed) {
    status = freshConfirmation ? "WAIT_PRICE" : retests.length ? "WAIT_CONFIRMATION" : "WAIT_RETEST";
    reason = freshConfirmation ? "Price lost the confirmation level. Wait for a fresh close that reclaims it."
      : retests.length ? "The zone was touched. For a pullback, wait for a later candle to close beyond the rejection candle’s high (long) or low (short); touching the zone is not entry."
      : "For a pullback, first wait for a sweep of the previous 8-candle swing liquidity and a reclaim of the zone. Then require a later confirmation close. Do not enter on the first touch.";
  }
  const timeframe = intervalMs < 3_600_000 ? intervalMs / 60_000 + "m" : intervalMs / 3_600_000 + "h";
  // Fixed structural limit: quote changes never move the entry price.
  const entry = trigger;
  const expiresAt = (confirmationTime ?? current.time) + intervalMs * (ENTRY_LOCATION_POLICY.validCandles + 1);
  const cancelText = "Cancel if a " + timeframe + " candle closes " + (long ? "below " : "above ") + priceText(long ? zoneLow : zoneHigh) +
    ", price touches stop " + priceText(stop) + ", or this confirmation expires. Never chase " + (long ? "above " : "below ") + priceText(long ? entryHigh : entryLow) + ".";
  return {
    status, headline: status === "READY" ? "Entry location confirmed" : status.replaceAll("_", " "), reason,
    side, zoneLow, zoneHigh, zoneSource: input.zoneSource, trigger, entryLow, entryHigh,
    entry, stop,
    stopSource: "Beyond the full " + input.zoneSource.toLowerCase() + " zone / retest wick and, for pullbacks, the recent 12-candle extreme + 0.30 normal-range buffer; no inward stop cap",
    referenceAtr, extensionAtr, impulsePending, timingReady: timing.passed && status === "READY", locationOkay,
    confirmationPath: timing.path, confirmationTime, expiresAt, timeframe,
    steps: [
      (status === "READY" && freshConfirmation ? "Retest confirmed at " : "Watch ") + priceText(zoneLow) + "–" + priceText(zoneHigh) + " (" + input.zoneSource + "). After a sharp move, the retest must come on a later candle.",
      status === "READY" ? "The " + timeframe + " candle closed " + (long ? "above " : "below ") + priceText(trigger) + ". Confirmed via " + timing.path.toLowerCase() + "."
        : "Wait for a " + timeframe + " rejection candle to CLOSE " + (long ? "above " : "below ") + priceText(trigger) + ". A wick or an unfinished candle is not confirmation.",
      "Only when READY and the live quote is " + priceText(entryLow) + "–" + priceText(entryHigh) + ": place a " + (long ? "BUY LIMIT at " : "SELL LIMIT at ") + priceText(entry) + " or better. A different entry needs fresh sizing. Cancel unfilled orders at expiry.",
      "Set stop at " + priceText(stop) + " and use the listed TP quantities. If the stop needs more room, reduce size before entry; never widen an open trade's stop.",
    ],
    cancelText,
  };
}

/** Reused on the confirmation click. A lower long price is not automatically a valid entry. */
export function entryExecutionBlocker(plan: EntryExecutionPlan, price: number, now: number, immediate = false): string | null {
  if ((!immediate && plan.status !== "READY") || !plan.timingReady) return plan.reason;
  if (now >= plan.expiresAt) return "This entry confirmation expired. Refresh and wait for a new trigger.";
  if (!Number.isFinite(price) || price < plan.entryLow || price > plan.entryHigh) return "Price is outside the confirmed entry range " + priceText(plan.entryLow) + "–" + priceText(plan.entryHigh) + ". Wait; do not chase or buy a failed reclaim.";
  return null;
}

/** Legacy alerts stay readable; malformed optional instructions are discarded. */
export function restoreEntryExecutionPlan(value: unknown): EntryExecutionPlan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const plan = value as EntryExecutionPlan;
  if (!["READY", "WAIT_RETEST", "WAIT_CONFIRMATION", "WAIT_PRICE", "INVALIDATED", "EXPIRED", "BLOCKED"].includes(plan.status) ||
      !["LONG", "SHORT"].includes(plan.side) ||
      ![plan.zoneLow, plan.zoneHigh, plan.trigger, plan.entryLow, plan.entryHigh, plan.entry, plan.stop, plan.referenceAtr, plan.expiresAt].every(n => Number.isFinite(n) && n > 0) ||
      !Number.isFinite(plan.extensionAtr) ||
      ![plan.headline, plan.reason, plan.zoneSource, plan.stopSource, plan.confirmationPath, plan.timeframe, plan.cancelText].every(text => typeof text === "string" && text.length < 3000) ||
      ![plan.timingReady, plan.locationOkay, plan.impulsePending].every(flag => typeof flag === "boolean") ||
      !(plan.confirmationTime === null || Number.isFinite(plan.confirmationTime)) ||
      !Array.isArray(plan.steps) || plan.steps.length !== 4 || !plan.steps.every(step => typeof step === "string" && step.length < 3000)) return undefined;
  return {...plan, steps: [...plan.steps]};
}
