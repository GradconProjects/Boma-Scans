import { STYLE_CONFIG, INTERVAL_MS, STYLE_LIQUIDITY_FLOOR, type ScannerRow } from "@/app/lib/market";
import { buildAdaptiveLeveragePlan } from "@/app/lib/leverage";
import { RISK_BAND_POLICY } from "@/app/lib/entry-policy";
import { entryExecutionBlocker } from "@/app/lib/entry-execution";

export const MEDIUM_RISK_MIN_SCORE = 70;
export const MEDIUM_RISK_WEAK_TREND_SCORE = 78;
export const MEDIUM_RISK_MAX_OPEN_RISK_PCT = 2.5;

export type MediumRiskRecommendation = {
  row: ScannerRow;
  rank: number;
  riskPct: number;
  riskAmount: number;
  quantity: number;
  leverage: number;
  minimumLeverage: number;
  maximumLeverage: number;
  recommendedMargin: number;
  marginUtilizationPct: number;
  leverageRationale: string;
};

export function mediumRiskThreshold(row: ScannerRow) {
  return row.setupThreshold;
}

export function isMediumRiskTake(row: ScannerRow, live: boolean, now = Date.now()) {
  return Boolean(
    live &&
      now >= row.analyzedAt && now - row.analyzedAt <= Math.min(15 * 60_000, 2 * INTERVAL_MS[STYLE_CONFIG[row.style].interval]) &&
      (row.exchangeMaxLeverage ?? 0) > 0 && (row.quantityStep ?? 0) > 0 &&
      !row.demo &&
      row.decision === "SETUP" &&
      row.entryReady &&
      row.executionPlan && !entryExecutionBlocker(row.executionPlan, row.price, now) &&
      row.direction !== "WAIT" &&
      row.score >= mediumRiskThreshold(row) &&
      row.entryQuality >= RISK_BAND_POLICY.mediumEntryQuality &&
      row.ratingScore >= RISK_BAND_POLICY.mediumRating &&
      row.entryChecks.every((check) => !check.required || check.status === "PASS") &&
      row.riskBand !== "HIGH" &&
      row.btcRelationship.divergenceVerdict !== "REJECT" &&
      row.executionCostR <= row.spreadCostLimitR &&
      row.turnover >= STYLE_LIQUIDITY_FLOOR[row.style] &&
      row.trendFrames >= (row.setupType === "CHoCH REVERSAL" ? 1 : 3) &&
      // Only ADX 25+ trends qualify; weak-trend entries lost money in the backtest.
      row.regime === "TRENDING",
  );
}

function sizeRecommendation(row: ScannerRow, accountEquity: number) {
  const plan = buildAdaptiveLeveragePlan({
    accountEquity,
    // Half size on BTC caution or when the side opposes the BTC daily trend (backtested).
    targetRiskPct: row.btcRelationship.divergenceVerdict === "CAUTION" || !row.btcRelationship.trendAligned
      ? Math.min(row.riskMultiplier, 0.5) : row.riskMultiplier,
    entry: row.entry,
    stop: row.stop,
    score: row.score,
    regime: row.regime,
    setupType: row.setupType,
    trendFrames: row.trendFrames,
    atrPct: row.atrPct,
    adx: row.adx,
    style: row.style,
    actionable: true,
    exchangeMaxLeverage: row.exchangeMaxLeverage,
    quantityStep: row.quantityStep,
    minOrderQty: row.minOrderQty,
    minNotionalValue: row.minNotionalValue,
  });

  return {
    riskPct: plan.actualRiskPct,
    riskAmount: plan.actualRiskAmount,
    quantity: plan.quantity,
    leverage: plan.recommendedLeverage,
    minimumLeverage: plan.minimumLeverage,
    maximumLeverage: plan.maximumLeverage,
    recommendedMargin: plan.recommendedMargin,
    marginUtilizationPct: plan.marginUtilizationPct,
    leverageRationale: plan.rationale,
  };
}

export function getMediumRiskShortlist(
  rows: ScannerRow[],
  accountEquity: number,
  live: boolean,
  limit = 2,
  now = Date.now(),
): MediumRiskRecommendation[] {
  const eligible = rows
    .filter((row) => isMediumRiskTake(row, live, now))
    .sort(
      (first, second) =>
        second.ratingScore - first.ratingScore ||
        second.entryQuality - first.entryQuality ||
        second.score - first.score ||
        second.targetReliability - first.targetReliability ||
        second.structuralTargets - first.structuralTargets ||
        second.netRewardR - first.netRewardR ||
        second.turnover - first.turnover,
    )
    .map((row) => ({ row, ...sizeRecommendation(row, accountEquity) }))
    .filter((pick) => pick.quantity > 0 && pick.leverage > 0);
  if (!eligible.length || limit <= 0) return [];

  const selected = [eligible[0]];
  const opposite = eligible.find(
    (pick) => pick.row.direction !== eligible[0].row.direction,
  );
  if (opposite && selected.length < limit) selected.push(opposite);
  for (const pick of eligible) {
    if (selected.length >= limit) break;
    if (!selected.includes(pick)) selected.push(pick);
  }

  return selected.map((pick, index) => ({
    ...pick,
    rank: index + 1,
  }));
}
