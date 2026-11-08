import { z } from "zod/v4";
import type { MarketAnalysis, ScannerRow } from "@/app/lib/market";
import type { Positioning, PositioningVerdict } from "@/app/lib/positioning";

/** What the reviewer returns for a signal. Stored per plan and shown in the app and on Telegram. */
export const ReviewSchema = z.object({
  verdict: z.enum(["APPROVE", "CAUTION", "REJECT"]),
  /** The call at the live price: enter now, wait (with the condition), or stand down. */
  timing: z.enum(["ENTER NOW", "WAIT", "STAND DOWN"]),
  timing_reason: z.string(),
  confidence: z.number().min(0).max(100),
  summary: z.string(),
  concerns: z.array(z.string()),
  entry_note: z.string(),
  exit_note: z.string(),
  /** Optional refinement of the levels; nulls / empty keep the engine's. */
  levels: z.object({
    entry: z.number().nullable(),
    stop: z.number().nullable(),
    targets: z.array(z.number()),
    reasoning: z.string(),
  }),
});
export type ReviewLevels = { entry: number; stop: number; targets: number[]; reasoning: string; changed: Array<"entry" | "stop" | "targets"> };
export type SignalReview = z.infer<typeof ReviewSchema> & { provider: string; model: string; at: number; planKey: string; symbol: string; applied?: ReviewLevels | null; rejectedLevels?: string[] };

export const REVIEWER_SYSTEM = `You are the senior risk reviewer for a discretionary crypto perpetual-futures desk (Bybit USDT perps, 1H execution chart, Melbourne-based day/swing trader).
A rule-based engine, calibrated on a two-year backtest, has produced a trade plan. Your job is a careful second read before it is sent to the trader, not a re-derivation of the plan.

Judge only from the data given. Never invent prices, news or indicators. Approve by default when the plan is internally consistent; reject only for a concrete, stated reason. Reasons to reject or caution include: the trigger candle is an exhaustion spike (very long range or wick against the direction after an extended run), the entry sits straight under or over a strong historic level with no reaction room while confirmation is weak, structure on the recent candles contradicts the stated bias (lower highs for a long, higher lows for a short), the stop sits inside an obvious liquidity pocket, extreme crowding on the trader's side with funding paid against them, or whale and top-trader positioning strongly opposed together with weak momentum. Positioning alone does not block a trend trade: the backtest found breaks through levels are the better trades.

Two desk rules. The trader holds positions for hours, not minutes: an entry is only worth pushing when its stop can reasonably hold for four hours or more (about two 1H ATRs or a real structural level), after a major structural event (change of character, break of structure or liquidity sweep) on the trade's side. And the desk mirrors what ranked whales are doing now when it can: positioning data that shows ranked whales freshly against the side is a reason for CAUTION or REJECT, whales with the side support it.

Timing. Make the call for right now, not in general: ENTER NOW only when the plan is READY (confirmation close printed), the live price is inside the entry window and nothing in the last candles says the move is exhausted; WAIT with the exact condition the trader should wait for (a close through the trigger, a pullback into the window, a retest); STAND DOWN when the plan is invalid or the setup has degraded. timing_reason is one sentence quoting the prices.

Levels. Before the levels are final you may refine them, and the engine applies your numbers only inside these guardrails (anything outside is discarded and the engine's level kept): the entry must stay inside the plan's zone (between zone[0] and zone[1]); the stop must sit at a stated structural level on the trade's protective side, no tighter than 0.6 times and no wider than 1.5 times the engine's stop distance; targets, if given, are exactly five prices moving away from the entry in the trade's direction, each between 0.5R and 6R of the final risk, ideally at the historic zones, swing levels or round numbers you can see in the data. Return null for entry or stop and an empty targets list to keep the engine's values. Say in levels.reasoning in one sentence what you changed and why, or "engine levels kept".

Keep the summary under 220 characters and plain English for a phone screen. Concerns: at most three short items, most important first. entry_note: one sentence on how to take the entry (limit at the plan price, wait for the close, do not chase). exit_note: one sentence on where to be careful with targets or the stop. Confidence is how sure you are of the verdict.`;

export type ReviewInput = {
  row: ScannerRow; analysis: MarketAnalysis; candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
  positioning?: Positioning | null; positioningVerdict?: PositioningVerdict | null;
  /** The engine's own call at the live price, so the reviewer can agree or disagree with it. */
  call?: string;
};

/** Compact, deterministic description of the setup for the reviewer. Numbers rounded so the prompt stays stable. */
export function reviewPrompt(input: ReviewInput): string {
  const { row, analysis } = input;
  const plan = row.executionPlan;
  const risk = Math.abs(plan.entry - row.stop) || 1;
  const r = (price: number) => ((row.bias === "LONG" ? 1 : -1) * (price - plan.entry) / risk).toFixed(2) + "R";
  const candles = input.candles.slice(-24).map(c => [new Date(c.time).toISOString().slice(5, 16), c.open, c.high, c.low, c.close, Math.round(c.volume)]);
  const data = {
    symbol: row.symbol, side: row.bias, style: row.style, setup: row.setupType, regime: row.regime, decision: row.decision,
    scores: { ta: row.score, entryQuality: row.entryQuality, rating: row.ratingScore, riskBand: row.riskBand, trendFrames: row.trendFrames },
    plan: { status: plan.status, timeframe: plan.timeframe, trigger: plan.trigger, entry: plan.entry, zone: [plan.zoneLow, plan.zoneHigh], stop: row.stop, stopR: "1R = " + (risk / plan.entry * 100).toFixed(2) + "% of price", targets: row.takeProfits.map(t => ({ price: t.price, r: r(t.price), exitPct: t.exitPct, source: t.source })), expiresAt: new Date(plan.expiresAt).toISOString() },
    checks: row.entryChecks.map(c => c.label + ": " + c.status + (c.status !== "PASS" ? " (" + c.detail + ")" : "")),
    structure: { bos: analysis.structure.bos, choch: analysis.structure.choch, sweep: analysis.structure.sweep, fvg: analysis.structure.fvg?.side ?? null, orderBlock: analysis.structure.orderBlock?.side ?? null },
    metrics: { rsi: Math.round(analysis.metrics.rsi), adx: Math.round(analysis.metrics.adx), atrPct: Number(analysis.metrics.atrPct.toFixed(2)), volumeRatio: Number(analysis.metrics.volumeRatio.toFixed(2)), fundingPct: Number((analysis.metrics.fundingRate * 100).toFixed(4)), spreadPct: Number(analysis.metrics.spreadPct.toFixed(3)) },
    historicLevels: row.keyLevels ? { summary: row.keyLevels.summary, detail: row.keyLevels.detail, zones: row.keyLevels.zones.slice(0, 6).map(z => ({ price: Number(z.price.toPrecision(6)), kind: z.kind, touches: z.touches, weekly: z.weeklyTouches > 0 })) } : null,
    btc: { relationship: row.btcRelationship.relationship, verdict: row.btcRelationship.divergenceVerdict, dailyTrend: row.btcRelationship.btcDailyTrend, aligned: row.btcRelationship.trendAligned },
    positioning: input.positioningVerdict ? { verdict: input.positioningVerdict.level, notes: input.positioningVerdict.notes } : null,
    live: { price: row.price, engineCall: input.call ?? null },
    last24Candles1h: candles,
  };
  return "Review this plan and answer in the required JSON shape.\n\n" + JSON.stringify(data);
}

/** Lines appended to a Telegram signal for a stored review. */
export function reviewLines(review: SignalReview): string[] {
  const icon = review.verdict === "APPROVE" ? "🧠 ✅" : review.verdict === "CAUTION" ? "🧠 ⚠️" : "🧠 ⛔";
  const timingIcon = review.timing === "ENTER NOW" ? "✅" : review.timing === "WAIT" ? "⏳" : "⛔";
  return [
    icon + " Review (" + review.provider + "): " + review.verdict + " · " + Math.round(review.confidence) + "% · " + review.summary,
    timingIcon + " Timing: " + review.timing + " · " + review.timing_reason,
    ...review.concerns.slice(0, 3).map(item => "• " + item),
    ...(review.entry_note ? ["↪ " + review.entry_note] : []),
    ...(review.exit_note ? ["↩ " + review.exit_note] : []),
    ...(review.applied ? ["📐 Levels refined (" + review.applied.changed.join(", ") + "): " + review.applied.reasoning] : []),
    ...(review.rejectedLevels?.length ? ["📐 Suggested but kept engine levels: " + review.rejectedLevels.join("; ")] : []),
  ];
}

/**
 * Apply the reviewer's level suggestions inside the guardrails. Returns the
 * final levels and which of them changed; out-of-bounds suggestions are
 * dropped with a reason so the trader can see what was refused.
 */
export function refineLevels(row: Pick<ScannerRow, "bias" | "stop" | "executionPlan" | "takeProfits">, levels: z.infer<typeof ReviewSchema>["levels"]): { applied: ReviewLevels | null; rejected: string[] } {
  const plan = row.executionPlan;
  const sign = row.bias === "LONG" ? 1 : -1;
  const rejected: string[] = [];
  const changed: ReviewLevels["changed"] = [];
  let entry = plan.entry;
  if (levels.entry !== null && Number.isFinite(levels.entry)) {
    if (levels.entry >= plan.zoneLow && levels.entry <= plan.zoneHigh) { if (Math.abs(levels.entry - entry) > entry * 1e-6) { entry = levels.entry; changed.push("entry"); } }
    else rejected.push("entry " + levels.entry + " is outside the zone " + plan.zoneLow + " – " + plan.zoneHigh);
  }
  const engineRisk = Math.abs(plan.entry - row.stop);
  let stop = row.stop;
  if (levels.stop !== null && Number.isFinite(levels.stop)) {
    const distance = sign * (entry - levels.stop);
    if (distance >= engineRisk * 0.6 && distance <= engineRisk * 1.5) { if (Math.abs(levels.stop - stop) > stop * 1e-6) { stop = levels.stop; changed.push("stop"); } }
    else rejected.push("stop " + levels.stop + " is " + (distance <= 0 ? "on the wrong side of the entry" : distance < engineRisk * 0.6 ? "tighter than 0.6× the engine stop" : "wider than 1.5× the engine stop"));
  }
  const risk = Math.max(Math.abs(entry - stop), Number.EPSILON);
  let targets = row.takeProfits.map(t => t.price);
  if (levels.targets.length) {
    const ok = levels.targets.length === 5 && levels.targets.every((price, index) => Number.isFinite(price) && sign * (price - entry) / risk >= 0.5 && sign * (price - entry) / risk <= 6 && (index === 0 || sign * (price - levels.targets[index - 1]) > 0));
    if (ok) { if (levels.targets.some((price, index) => Math.abs(price - targets[index]) > price * 1e-6)) { targets = levels.targets; changed.push("targets"); } }
    else rejected.push("targets must be five prices in trade direction between 0.5R and 6R");
  }
  return { applied: changed.length ? { entry, stop, targets, reasoning: levels.reasoning, changed } : null, rejected };
}

/** A copy of the row with the refined levels in place (plan key unchanged: the trigger and the plan's own stop field stay). */
export function applyRefinedLevels<T extends Pick<ScannerRow, "bias" | "stop" | "entry" | "executionPlan" | "takeProfits">>(row: T, applied: ReviewLevels): T {
  const sign = row.bias === "LONG" ? 1 : -1;
  const risk = Math.max(Math.abs(applied.entry - applied.stop), Number.EPSILON);
  return {
    ...row,
    entry: applied.entry,
    stop: applied.stop,
    executionPlan: { ...row.executionPlan, entry: applied.entry },
    takeProfits: row.takeProfits.map((target, index) => ({ ...target, price: applied.targets[index] ?? target.price, rewardR: sign * ((applied.targets[index] ?? target.price) - applied.entry) / risk, available: true, source: applied.changed.includes("targets") ? "AI-refined level" : target.source, rationale: applied.changed.includes("targets") ? applied.reasoning : target.rationale })),
  };
}
