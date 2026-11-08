import { z } from "zod/v4";
import type { MarketAnalysis, ScannerRow } from "@/app/lib/market";
import type { Positioning, PositioningVerdict } from "@/app/lib/positioning";

/** What the reviewer returns for a signal. Stored per plan and shown in the app and on Telegram. */
export const ReviewSchema = z.object({
  verdict: z.enum(["APPROVE", "CAUTION", "REJECT"]),
  confidence: z.number().min(0).max(100),
  summary: z.string(),
  concerns: z.array(z.string()),
  entry_note: z.string(),
  exit_note: z.string(),
});
export type SignalReview = z.infer<typeof ReviewSchema> & { provider: string; model: string; at: number; planKey: string; symbol: string };

export const REVIEWER_SYSTEM = `You are the senior risk reviewer for a discretionary crypto perpetual-futures desk (Bybit USDT perps, 1H execution chart, Melbourne-based day/swing trader).
A rule-based engine, calibrated on a two-year backtest, has produced a trade plan. Your job is a careful second read before it is sent to the trader, not a re-derivation of the plan.

Judge only from the data given. Never invent prices, news or indicators. Approve by default when the plan is internally consistent; reject only for a concrete, stated reason. Reasons to reject or caution include: the trigger candle is an exhaustion spike (very long range or wick against the direction after an extended run), the entry sits straight under or over a strong historic level with no reaction room while confirmation is weak, structure on the recent candles contradicts the stated bias (lower highs for a long, higher lows for a short), the stop sits inside an obvious liquidity pocket, extreme crowding on the trader's side with funding paid against them, or whale and top-trader positioning strongly opposed together with weak momentum. Positioning alone does not block a trend trade: the backtest found breaks through levels are the better trades.

Keep the summary under 220 characters and plain English for a phone screen. Concerns: at most three short items, most important first. entry_note: one sentence on how to take the entry (limit at the plan price, wait for the close, do not chase). exit_note: one sentence on where to be careful with targets or the stop. Confidence is how sure you are of the verdict.`;

export type ReviewInput = {
  row: ScannerRow; analysis: MarketAnalysis; candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
  positioning?: Positioning | null; positioningVerdict?: PositioningVerdict | null;
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
    last24Candles1h: candles,
  };
  return "Review this plan and answer in the required JSON shape.\n\n" + JSON.stringify(data);
}

/** Lines appended to a Telegram signal for a stored review. */
export function reviewLines(review: SignalReview): string[] {
  const icon = review.verdict === "APPROVE" ? "🧠 ✅" : review.verdict === "CAUTION" ? "🧠 ⚠️" : "🧠 ⛔";
  return [
    icon + " Review (" + review.provider + "): " + review.verdict + " · " + Math.round(review.confidence) + "% · " + review.summary,
    ...review.concerns.slice(0, 3).map(item => "• " + item),
    ...(review.entry_note ? ["↪ " + review.entry_note] : []),
    ...(review.exit_note ? ["↩ " + review.exit_note] : []),
  ];
}
