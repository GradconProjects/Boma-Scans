import type { MarketAnalysis, TradingStyle } from "@/app/before-telegram/_src/lib/market";

export const ADAPTIVE_STYLE_MAX_LEVERAGE: Record<TradingStyle, number> = {
  SCALP: 10,
  DAY: 8,
  SWING: 5,
  POSITION: 3,
};

export type AdaptiveLeveragePlan = {
  targetRiskPct: number;
  targetRiskAmount: number;
  actualRiskPct: number;
  actualRiskAmount: number;
  stopDistance: number;
  stopDistancePct: number;
  quantity: number;
  notional: number;
  accountNotionalMultiple: number;
  minimumLeverage: number;
  recommendedLeverage: number;
  maximumLeverage: number;
  recommendedMargin: number;
  marginUtilizationPct: number;
  qualityTier: "ELITE" | "CONFIRMED" | "BALANCED" | "DEFENSIVE";
  bindingConstraint: "STYLE" | "QUALITY" | "VOLATILITY" | "STOP BUFFER" | "BYBIT LIMIT";
  rationale: string;
};

type AdaptiveLeverageInput = {
  accountEquity: number;
  targetRiskPct: number;
  entry: number;
  stop: number;
  score: number;
  regime: MarketAnalysis["regime"];
  setupType?: MarketAnalysis["setupType"];
  trendFrames: number;
  atrPct: number;
  adx: number;
  style: TradingStyle;
  actionable?: boolean;
  exchangeMaxLeverage?: number;
  quantityStep?: number;
  minOrderQty?: number;
  minNotionalValue?: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function positive(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function floorToStep(value: number, step: number) {
  if (!step) return value;
  return Number((Math.floor((value + Number.EPSILON) / step) * step).toFixed(12));
}

/**
 * Builds an isolated-margin leverage setting and a separately risk-sized position.
 * Raising the leverage setting reduces reserved margin; it never raises the hard-stop
 * account risk because notional remains derived from the target risk amount.
 */
export function buildAdaptiveLeveragePlan(
  input: AdaptiveLeverageInput,
): AdaptiveLeveragePlan {
  const accountEquity = positive(input.accountEquity);
  const entry = positive(input.entry);
  const stop = positive(input.stop);
  const score = clamp(Number.isFinite(input.score) ? input.score : 0, 0, 100);
  const trendFrames = clamp(
    Math.round(Number.isFinite(input.trendFrames) ? input.trendFrames : 0),
    0,
    3,
  );
  const atrPct = positive(input.atrPct);
  const adx = positive(input.adx);
  const targetRiskPct = clamp(
    Number.isFinite(input.targetRiskPct) ? input.targetRiskPct : 0.5,
    0.25,
    1,
  );
  const styleCeiling = ADAPTIVE_STYLE_MAX_LEVERAGE[input.style];
  const setupType = input.setupType ?? "TREND CONTINUATION";

  let qualityTier: AdaptiveLeveragePlan["qualityTier"] = "DEFENSIVE";
  let qualityCeiling = Math.min(styleCeiling, 2);
  if (
    input.regime === "TRENDING" &&
    setupType !== "CHoCH REVERSAL" &&
    score >= 88 &&
    trendFrames === 3 &&
    adx >= 25
  ) {
    qualityTier = "ELITE";
    qualityCeiling = styleCeiling;
  } else if (
    input.regime === "TRENDING" &&
    score >= 80 &&
    trendFrames >= 2 &&
    adx >= 20
  ) {
    qualityTier = "CONFIRMED";
    qualityCeiling = Math.min(styleCeiling, 7);
  } else if (
    input.regime === "TRENDING" &&
    trendFrames >= 2 &&
    ((setupType === "PULLBACK" && score >= 66) || score >= 70)
  ) {
    qualityTier = "BALANCED";
    qualityCeiling = Math.min(styleCeiling, 5);
  } else if (
    setupType === "CHoCH REVERSAL" &&
    score >= 72 &&
    trendFrames >= 1
  ) {
    qualityTier = "DEFENSIVE";
    qualityCeiling = Math.min(styleCeiling, 3);
  } else if (input.regime === "WEAK TREND" && score >= 78 && trendFrames >= 2) {
    qualityTier = "DEFENSIVE";
    qualityCeiling = Math.min(styleCeiling, 3);
  }

  const volatilityCeiling =
    atrPct >= 5
      ? 1
      : atrPct >= 3.5
        ? 2
        : atrPct >= 2.5
          ? 3
          : atrPct >= 1.5
            ? 4
            : atrPct >= 0.8
              ? Math.min(styleCeiling, 6)
              : styleCeiling;

  const stopDistance = entry && stop ? Math.abs(entry - stop) : 0;
  const stopDistancePct = entry ? (stopDistance / entry) * 100 : 0;
  const stressBufferPct = Math.max(10, stopDistancePct * 4, atrPct * 3);
  const stopBufferCeiling = clamp(Math.floor(100 / stressBufferPct), 1, styleCeiling);
  const exchangeCeiling = input.exchangeMaxLeverage
    ? Math.max(1, Math.floor(positive(input.exchangeMaxLeverage)))
    : Number.POSITIVE_INFINITY;

  const constraints = [
    { label: "BYBIT LIMIT" as const, ceiling: exchangeCeiling },
    { label: "VOLATILITY" as const, ceiling: volatilityCeiling },
    { label: "STOP BUFFER" as const, ceiling: stopBufferCeiling },
    { label: "QUALITY" as const, ceiling: qualityCeiling },
    { label: "STYLE" as const, ceiling: styleCeiling },
  ];
  const maximumLeverage = Math.max(
    1,
    Math.min(...constraints.map((constraint) => constraint.ceiling)),
  );
  const bindingConstraint = constraints.find(
    (constraint) => constraint.ceiling === maximumLeverage,
  )!.label;

  const targetRiskAmount = accountEquity * (targetRiskPct / 100);
  const stopFraction = stopDistancePct / 100;
  const riskSizedNotional = stopFraction ? targetRiskAmount / stopFraction : 0;
  let notional = Math.min(riskSizedNotional, accountEquity * maximumLeverage);
  let quantity = entry ? notional / entry : 0;
  const quantityStep = positive(input.quantityStep ?? 0);
  const minOrderQty = positive(input.minOrderQty ?? 0);
  const minNotionalValue = positive(input.minNotionalValue ?? 0);
  quantity = floorToStep(quantity, quantityStep);
  notional = quantity * entry;
  if (
    (minOrderQty && quantity < minOrderQty) ||
    (minNotionalValue && notional < minNotionalValue)
  ) {
    quantity = 0;
    notional = 0;
  }
  const actualRiskAmount = quantity * stopDistance;
  const actualRiskPct = accountEquity
    ? (actualRiskAmount / accountEquity) * 100
    : 0;
  const accountNotionalMultiple = accountEquity ? notional / accountEquity : 0;
  const minimumLeverage = notional
    ? clamp(Math.ceil(accountNotionalMultiple - 1e-9), 1, maximumLeverage)
    : 0;

  const tacticalFraction =
    qualityTier === "ELITE"
      ? 0.9
      : qualityTier === "CONFIRMED"
        ? 0.8
        : qualityTier === "BALANCED"
          ? 0.7
          : 0.67;
  const recommendedLeverage = input.actionable !== false && notional
    ? clamp(
        Math.max(minimumLeverage, Math.ceil(maximumLeverage * tacticalFraction)),
        1,
        maximumLeverage,
      )
    : 0;
  const recommendedMargin = recommendedLeverage
    ? notional / recommendedLeverage
    : 0;
  const marginUtilizationPct = accountEquity && recommendedMargin
    ? (recommendedMargin / accountEquity) * 100
    : 0;
  const rationale =
    qualityTier +
    " · " +
    setupType.toLowerCase() +
    " · " +
    trendFrames +
    "/3 frames · ATR " +
    atrPct.toFixed(2) +
    "% · " +
    bindingConstraint.toLowerCase() +
    " ceiling";

  return {
    targetRiskPct,
    targetRiskAmount,
    actualRiskPct,
    actualRiskAmount,
    stopDistance,
    stopDistancePct,
    quantity,
    notional,
    accountNotionalMultiple,
    minimumLeverage,
    recommendedLeverage,
    maximumLeverage,
    recommendedMargin,
    marginUtilizationPct,
    qualityTier,
    bindingConstraint,
    rationale,
  };
}
