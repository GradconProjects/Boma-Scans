export type FlexibilityMode = "STRICT" | "BALANCED" | "FLEXIBLE";

export const RISK_BAND_POLICY = {
  lowRating: 84,
  lowEntryQuality: 84,
  lowTargetReliability: 65,
  mediumRating: 70,
  mediumEntryQuality: 68,
} as const;

export type QualityOverride = {
  eligible: boolean;
  reason: string;
  riskCapPct: number;
};

/** Timing alternatives never bypass structural, momentum, execution or payoff checks. */
export function resolveEntryTiming(input: {
  mode: FlexibilityMode;
  setupType: string;
  score: number;
  threshold: number;
  confluence: number;
  frames: number;
  plannedTriggerPassed: boolean;
  strongClose: boolean;
  structureReady: boolean;
  momentumAligned: boolean;
  notChased: boolean;
  invalidated: boolean;
}) {
  if (input.invalidated) return { passed: false, path: "INVALIDATED" };
  if (!input.notChased) return { passed: false, path: "WAIT FOR RETEST" };
  if (input.plannedTriggerPassed) return { passed: true, path: "PLANNED TRIGGER" };
  if (input.mode === "STRICT") return { passed: false, path: "WAIT FOR RETEST" };
  const strongConfirmation =
    input.strongClose && input.structureReady && input.momentumAligned &&
    input.notChased && input.confluence >= 3 && input.frames >= 2;
  if (strongConfirmation && input.score >= input.threshold + 6) {
    return { passed: true, path: "STRONG CLOSED-CANDLE CONFIRMATION" };
  }
  if (input.mode === "FLEXIBLE" && strongConfirmation &&
      ["BREAKOUT", "TREND CONTINUATION"].includes(input.setupType) &&
      input.score >= input.threshold) {
    return { passed: true, path: "HIGH-CONFLUENCE CONTINUATION" };
  }
  return { passed: false, path: "WAIT FOR CONFIRMATION" };
}

export function relativeRiskBand(input: {
  entryReady: boolean;
  rating: number;
  entryQuality: number;
  regime: string;
  targetReliability: number;
  btcVerdict: string;
  requiredFailure: boolean;
  override: boolean;
}): "LOW" | "MEDIUM" | "HIGH" {
  const policy = RISK_BAND_POLICY;
  if (input.requiredFailure || input.btcVerdict === "REJECT") return "HIGH";
  if (input.entryReady && !input.override && input.btcVerdict !== "CAUTION" &&
      input.rating >= policy.lowRating && input.entryQuality >= policy.lowEntryQuality &&
      input.regime === "TRENDING" && input.targetReliability >= policy.lowTargetReliability) return "LOW";
  if (input.rating >= policy.mediumRating && input.entryQuality >= policy.mediumEntryQuality &&
      input.regime !== "VOLATILE") return "MEDIUM";
  return "HIGH";
}
