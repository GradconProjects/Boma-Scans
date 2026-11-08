import {TARGET_EXIT_WEIGHTS} from "@/app/before-telegram/_src/lib/target-policy";
import { quoteIsFresh } from "@/app/before-telegram/_src/lib/quote-safety";
import type { Bias, MarketAnalysis, TakeProfitLevel, TradingStyle } from "@/app/before-telegram/_src/lib/market";
import { ADAPTIVE_STYLE_MAX_LEVERAGE } from "@/app/before-telegram/_src/lib/leverage";

export type TradeMode = "PAPER" | "MANUAL_LIVE";
export type TradeStatus = "OPEN" | "CLOSED";

export type TrackedTrade = {
  targetWeights?: number[];
  entrySnapshot?: {
    entryMode: "PREFERRED" | "MARKET";
    flexibility: string;
    score: number;
    entryQuality: number;
    btcVerdict: string;
    overrideAccepted: boolean;
    targets: TakeProfitLevel[];
    reasons: string[];
  };
  id: string;
  symbol: string;
  side: Bias;
  mode: TradeMode;
  style: TradingStyle;
  status: TradeStatus;
  entryPrice: number;
  quantity: number;
  leverage: number;
  initialStop: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  tp5: number;
  atrAtEntry: number;
  liquidationPrice?: number;
  openedAt: number;
  remainingPct: number;
  realizedPnl: number;
  tp1Taken: boolean;
  tp2Taken: boolean;
  tp2TakenAt?: number;
  tp3Taken: boolean;
  tp4Taken: boolean;
  tp5Taken: boolean;
  closedAt?: number;
  exitPrice?: number;
  closeReason?: string;
};

export type TradeAdviceAction =
  | "DATA STALE"
  | "EXIT NOW"
  | "CLOSE REMAINDER"
  | "TAKE PARTIAL"
  | "REDUCE / EXIT"
  | "PROTECT PROFIT"
  | "HOLD TO PLAN";

export type TradeSnapshot = {
  action: TradeAdviceAction;
  severity: "neutral" | "positive" | "warning" | "critical";
  headline: string;
  detail: string;
  marginAdvice: string;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  marginRoiPct: number;
  rMultiple: number;
  suggestedStop: number;
  nextLevel: number;
  nextLevelLabel: string;
  liquidationBufferPct: number | null;
  ageMinutes: number;
  stale: boolean;
  exitLevel: 1 | 2 | 3 | 4 | 5 | null;
};

export type PortfolioGuard = {
  blocked: boolean;
  reasons: string[];
  openCount: number;
  openRisk: number;
  openRiskPct: number;
  dailyRealizedPnl: number;
  consecutiveLosses: number;
};

export const TRADE_STORAGE_KEY = "boma-scans.tracked-trades.v1";
export const PRICE_STALE_AFTER_MS = 15_000;

const timeLimitsHours: Record<TradingStyle, number> = {
  SCALP: 1.5,
  DAY: 12,
  SWING: 72,
  POSITION: 336,
};

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isBias(value: unknown): value is Bias {
  return value === "LONG" || value === "SHORT";
}

function isStyle(value: unknown): value is TradingStyle {
  return value === "SCALP" || value === "DAY" || value === "SWING" || value === "POSITION";
}

export function parseStoredTrades(raw: string | null): TrackedTrade[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map<TrackedTrade | null>((item) => {
        if (!item || typeof item !== "object") return null;
        const value = item as Partial<TrackedTrade>;
        const entryPrice = finitePositive(value.entryPrice);
        const quantity = finitePositive(value.quantity);
        const initialStop = finitePositive(value.initialStop);
        const stop = finitePositive(value.stop);
        const tp1 = finitePositive(value.tp1);
        const tp2 = finitePositive(value.tp2);
        const tp3 = finitePositive(value.tp3);
        if (
          typeof value.id !== "string" ||
          !/^[A-Z0-9]{1,24}USDT$/.test(String(value.symbol ?? "")) ||
          !isBias(value.side) ||
          !isStyle(value.style) ||
          !entryPrice ||
          !quantity ||
          !initialStop ||
          !stop
        ) {
          return null;
        }
        return {
          targetWeights: Array.isArray(value.targetWeights) && value.targetWeights.length === 5 && value.targetWeights.every(v => Number.isFinite(v) && v >= 0) && Math.abs(value.targetWeights.reduce((a,b)=>a+b,0)-100) < 0.01 ? value.targetWeights : undefined,
          entrySnapshot: value.entrySnapshot && typeof value.entrySnapshot === "object" &&
            Array.isArray(value.entrySnapshot.targets) && value.entrySnapshot.targets.length === 5 &&
            value.entrySnapshot.targets.every(target => target && Number.isFinite(target.price) && typeof target.source === "string") &&
            Array.isArray(value.entrySnapshot.reasons) && value.entrySnapshot.reasons.every(reason => typeof reason === "string") &&
            Number.isFinite(value.entrySnapshot.score) && Number.isFinite(value.entrySnapshot.entryQuality) &&
            typeof value.entrySnapshot.flexibility === "string" && typeof value.entrySnapshot.btcVerdict === "string"
              ? value.entrySnapshot : undefined,
          id: value.id,
          symbol: String(value.symbol),
          side: value.side,
          mode: value.mode === "MANUAL_LIVE" ? "MANUAL_LIVE" : "PAPER",
          style: value.style,
          status: value.status === "CLOSED" ? "CLOSED" : "OPEN",
          entryPrice,
          quantity,
          leverage: Math.max(1, finitePositive(value.leverage) || 1),
          initialStop,
          stop,
          tp1,
          tp2,
          tp3,
          tp4:
            finitePositive(value.tp4) ||
            tp3 +
              (value.side === "LONG" ? 1 : -1) *
                Math.max(Math.abs(tp3 - tp2) * 1.25, Math.abs(entryPrice - initialStop)),
          tp5:
            finitePositive(value.tp5) ||
            tp3 +
              (value.side === "LONG" ? 1 : -1) *
                Math.max(Math.abs(tp3 - tp2) * 2.85, Math.abs(entryPrice - initialStop) * 2),
          atrAtEntry: finitePositive(value.atrAtEntry) || Math.abs(entryPrice - initialStop),
          liquidationPrice: finitePositive(value.liquidationPrice) || undefined,
          openedAt: finitePositive(value.openedAt) || Date.now(),
          remainingPct: Math.min(
            100,
            Math.max(
              0,
              Number.isFinite(Number(value.remainingPct))
                ? Number(value.remainingPct)
                : value.status === "CLOSED"
                  ? 0
                  : 100,
            ),
          ),
          realizedPnl: Number.isFinite(Number(value.realizedPnl)) ? Number(value.realizedPnl) : 0,
          tp1Taken: Boolean(value.tp1Taken),
          tp2Taken: Boolean(value.tp2Taken),
          tp2TakenAt: finitePositive(value.tp2TakenAt) || undefined,
          tp3Taken: Boolean(value.tp3Taken),
          tp4Taken: Boolean(value.tp4Taken),
          tp5Taken: Boolean(value.tp5Taken),
          closedAt: finitePositive(value.closedAt) || undefined,
          exitPrice: finitePositive(value.exitPrice) || undefined,
          closeReason: typeof value.closeReason === "string" ? value.closeReason : undefined,
        } satisfies TrackedTrade;
      })
      .filter((trade): trade is TrackedTrade => Boolean(trade));
  } catch {
    return [];
  }
}

export function createTrackedTrade(input: {
  targetWeights?: TrackedTrade["targetWeights"];
  entrySnapshot?: TrackedTrade["entrySnapshot"];
  symbol: string;
  side: Bias;
  mode: TradeMode;
  style: TradingStyle;
  entryPrice: number;
  quantity: number;
  leverage: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  tp5: number;
  atrAtEntry: number;
  liquidationPrice?: number;
  openedAt?: number;
}) {
  const openedAt = input.openedAt ?? Date.now();
  return {
    targetWeights: [...(input.targetWeights ?? TARGET_EXIT_WEIGHTS)],
    entrySnapshot: input.entrySnapshot ? { ...input.entrySnapshot, reasons: [...input.entrySnapshot.reasons], targets: input.entrySnapshot.targets.map(target => ({...target, sources: [...target.sources]})) } : undefined,
    id:
      "trade-" +
      openedAt.toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 8),
    symbol: input.symbol,
    side: input.side,
    mode: input.mode,
    style: input.style,
    status: "OPEN",
    entryPrice: input.entryPrice,
    quantity: input.quantity,
    leverage: input.leverage,
    initialStop: input.stop,
    stop: input.stop,
    tp1: input.tp1,
    tp2: input.tp2,
    tp3: input.tp3,
    tp4: input.tp4,
    tp5: input.tp5,
    atrAtEntry: input.atrAtEntry,
    liquidationPrice: input.liquidationPrice,
    openedAt,
    remainingPct: 100,
    realizedPnl: 0,
    tp1Taken: false,
    tp2Taken: false,
    tp3Taken: false,
    tp4Taken: false,
    tp5Taken: false,
  } satisfies TrackedTrade;
}

function signedMove(side: Bias, from: number, to: number) {
  return side === "LONG" ? to - from : from - to;
}

function levelReached(side: Bias, price: number, level: number) {
  if (!level) return false;
  return side === "LONG" ? price >= level : price <= level;
}

function stopBreached(side: Bias, price: number, stop: number) {
  return side === "LONG" ? price <= stop : price >= stop;
}

function tradeOpenRisk(trade: TrackedTrade) {
  const riskPerUnit =
    trade.side === "LONG"
      ? Math.max(0, trade.entryPrice - trade.stop)
      : Math.max(0, trade.stop - trade.entryPrice);
  return riskPerUnit * trade.quantity * (trade.remainingPct / 100);
}

export function getPortfolioGuard(
  trades: TrackedTrade[],
  accountEquity: number,
  proposedSide?: Bias,
  now = Date.now(),
): PortfolioGuard {
  const open = trades.filter((trade) => trade.status === "OPEN");
  const closed = trades
    .filter((trade) => trade.status === "CLOSED" && trade.closedAt)
    .sort((first, second) => (second.closedAt ?? 0) - (first.closedAt ?? 0));
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dailyRealizedPnl = closed
    .filter((trade) => (trade.closedAt ?? 0) >= dayStart.getTime())
    .reduce((total, trade) => total + trade.realizedPnl, 0);
  let consecutiveLosses = 0;
  for (const trade of closed) {
    if ((trade.closedAt ?? 0) < now - 24 * 60 * 60 * 1_000) break;
    if (trade.realizedPnl < 0) consecutiveLosses += 1;
    else break;
  }
  const openRisk = open.reduce((total, trade) => total + tradeOpenRisk(trade), 0);
  const openRiskPct = accountEquity > 0 ? (openRisk / accountEquity) * 100 : 0;
  const reasons: string[] = [];
  if (!Number.isFinite(accountEquity) || accountEquity <= 0) reasons.push("Set a valid account equity before opening a tracked setup.");
  if (open.length >= 3) reasons.push("Three open positions is the medium-risk portfolio limit.");
  if (proposedSide && open.filter((trade) => trade.side === proposedSide).length >= 2) {
    reasons.push("Two same-direction crypto positions already use the correlation allowance.");
  }
  if (consecutiveLosses >= 3) reasons.push("Three consecutive losses triggered a 24-hour review halt.");
  if (accountEquity > 0 && dailyRealizedPnl <= accountEquity * -0.03) {
    reasons.push("Today’s realized loss reached the 3% daily circuit breaker.");
  }
  if (openRiskPct >= 2.5) reasons.push("Open stop-risk is already at or above 2.5% of equity.");

  return {
    blocked: reasons.length > 0,
    reasons,
    openCount: open.length,
    openRisk,
    openRiskPct,
    dailyRealizedPnl,
    consecutiveLosses,
  };
}

export function evaluateTrade(
  trade: TrackedTrade,
  currentPrice: number,
  priceUpdatedAt: number,
  analysis: MarketAnalysis | null,
  now = Date.now(),
  markPrice = currentPrice,
): TradeSnapshot {
  if (analysis && now >= analysis.executionPlan.expiresAt) analysis = null;
  const price = finitePositive(currentPrice) || trade.entryPrice;
  const initialRisk = Math.max(
    Math.abs(trade.entryPrice - trade.initialStop),
    trade.entryPrice * 0.0001,
  );
  const move = signedMove(trade.side, trade.entryPrice, price);
  const remainingQuantity = trade.quantity * (trade.remainingPct / 100);
  const pnl = move * remainingQuantity + trade.realizedPnl;
  const notional = trade.entryPrice * trade.quantity;
  const margin = notional / Math.max(1, trade.leverage);
  const pnlPct = notional ? (pnl / notional) * 100 : 0;
  const marginRoiPct = margin ? (pnl / margin) * 100 : 0;
  const rMultiple = move / initialRisk;
  const stale = !finitePositive(currentPrice) || !quoteIsFresh(priceUpdatedAt, now);
  const ageMinutes = Math.max(0, (now - trade.openedAt) / 60_000);
  const hitTp1 = levelReached(trade.side, price, trade.tp1);
  const hitTp2 = levelReached(trade.side, price, trade.tp2);
  const hitTp3 = levelReached(trade.side, price, trade.tp3);
  const hitTp4 = levelReached(trade.side, price, trade.tp4);
  const hitTp5 = levelReached(trade.side, price, trade.tp5);
  const invalidated = stopBreached(trade.side, price, trade.stop);
  const trendSupports = Boolean(
    analysis &&
      analysis.bias === trade.side &&
      analysis.metrics.trendFrames >= 2 &&
      analysis.regime !== "RANGING" &&
      analysis.regime !== "VOLATILE",
  );
  const oppositeStructure = Boolean(
    analysis &&
      analysis.structure.bos === (trade.side === "LONG" ? "BEARISH" : "BULLISH"),
  );
  const trendAgainst = Boolean(
    analysis &&
      (analysis.bias !== trade.side || oppositeStructure || analysis.regime === "VOLATILE"),
  );
  const liquidationReference = finitePositive(markPrice) || price;
  const liquidationBufferPct = trade.liquidationPrice
    ? (Math.abs(liquidationReference - trade.liquidationPrice) / liquidationReference) * 100
    : null;
  const liquidationBreached = Boolean(
    trade.liquidationPrice &&
      (trade.side === "LONG"
        ? liquidationReference <= trade.liquidationPrice
        : liquidationReference >= trade.liquidationPrice),
  );
  const atr = Math.max(analysis?.metrics.atr ?? trade.atrAtEntry, initialRisk * 0.5);
  let suggestedStop = trade.stop;
  const freshProtectiveStructure = Boolean(analysis && trendSupports &&
    analysis.executionPlan.confirmationTime && analysis.executionPlan.confirmationTime > trade.openedAt &&
    now < analysis.executionPlan.expiresAt && analysis.metrics.confirmedCandleTime > trade.openedAt);
  const structuralCandidate = analysis?.stop ?? trade.stop;
  // A price reaching +0.75R (or a close TP1) does not create a protective swing.
  // Tightening needs a realized partial and later confirmed structure, with room
  // between the stop and current price. Existing stops can only tighten.
  const protectsGain = trade.side === "LONG" ? structuralCandidate >= trade.entryPrice : structuralCandidate <= trade.entryPrice;
  const leavesRetestRoom = trade.side === "LONG" ? price - structuralCandidate >= atr * 0.6 : structuralCandidate - price >= atr * 0.6;
  if (!stale && trade.tp1Taken && freshProtectiveStructure && protectsGain && leavesRetestRoom) {
    suggestedStop = trade.side === "LONG" ? Math.max(trade.stop, structuralCandidate) : Math.min(trade.stop, structuralCandidate);
  }
  const canTighten = trade.side === "LONG" ? suggestedStop > trade.stop : suggestedStop < trade.stop;
  const weights = trade.targetWeights ?? [20, 20, 20, 15, 25];

  let action: TradeAdviceAction = "HOLD TO PLAN";
  let severity: TradeSnapshot["severity"] = "neutral";
  let headline = "Plan intact — stay with the defined risk";
  let detail = "Price has not reached an exit or protection trigger. Do not widen the stop.";
  let exitLevel: TradeSnapshot["exitLevel"] = null;

  if (stale) {
    action = "DATA STALE";
    severity = "warning";
    headline = "Pause decisions until the live quote refreshes";
    detail = "The latest tracked price is over 15 seconds old. Verify Bybit directly before acting.";
  } else if (invalidated) {
    action = "EXIT NOW";
    severity = "critical";
    headline = "The hard stop is breached";
    detail = "Close the remaining position. Never add margin or move the stop farther away.";
  } else if (
    liquidationBreached ||
    (liquidationBufferPct !== null && liquidationBufferPct <= 2)
  ) {
    action = "EXIT NOW";
    severity = "critical";
    headline = liquidationBreached
      ? "Price is at or beyond the recorded liquidation level"
      : "Liquidation buffer is critically small";
    detail = "Verify the position on Bybit and reduce or close immediately; liquidation can occur before a stop fills.";
  } else if (hitTp5) {
    action = "CLOSE REMAINDER";
    severity = "positive";
    headline = "TP5 reached — the full technical map is complete";
    detail = "Close the remaining position and record the result. Do not turn a completed trade into a new bet.";
    exitLevel = 5;
  } else if (hitTp1 && !trade.tp1Taken) {
    action = "TAKE PARTIAL";
    severity = "positive";
    headline = "TP1 reached — bank the first tranche";
    detail = "Take " + weights[0] + "% of the original size. Keep the protective stop until a later confirmed structure supports tightening; a TP1 touch alone is not a breakeven trigger.";
    exitLevel = 1;
  } else if (hitTp2 && !trade.tp2Taken) {
    action = "TAKE PARTIAL";
    severity = "positive";
    headline = "TP2 reached — lock the second tranche";
    detail = "Take " + weights[1] + "% of the original size. Tighten the remainder only behind a confirmed protective structure.";
    exitLevel = 2;
  } else if (hitTp3 && !trade.tp3Taken) {
    action = "TAKE PARTIAL";
    severity = "positive";
    headline = "TP3 reached — the central objective traded";
    detail = "Take " + weights[2] + "% of the original size. Review the suggested structural stop for the remainder.";
    exitLevel = 3;
  } else if (hitTp4 && !trade.tp4Taken) {
    action = "TAKE PARTIAL";
    severity = "positive";
    headline = "TP4 reached — protect the runner";
    detail = "Take " + weights[3] + "% of the original size and protect the runner behind confirmed structure.";
    exitLevel = 4;
  } else if (trade.tp2Taken && !trade.tp3Taken &&
    ((trade.side === "LONG" ? price <= trade.tp1 : price >= trade.tp1) ||
      (trade.tp2TakenAt && now-trade.tp2TakenAt >= (trade.style === "SCALP" ? 15 : trade.style === "DAY" ? 120 : 720)*60000))) {
    action = "CLOSE REMAINDER"; severity = "warning";
    headline = "Primary profit banked — protect the remainder";
    detail = "After TP2, price returned to TP1 or the runner timed out. Close the remainder instead of waiting for TP3–TP5.";
  } else if (trendAgainst && (rMultiple < 0.5 || oppositeStructure)) {
    action = "REDUCE / EXIT";
    severity = "critical";
    headline = "Structure no longer supports the trade";
    detail = "Exit or materially reduce; the original directional thesis is no longer confirmed.";
  } else if (ageMinutes >= timeLimitsHours[trade.style] * 60 && rMultiple < 0.5) {
    action = "REDUCE / EXIT";
    severity = "warning";
    headline = "The trade has exceeded its time allowance";
    detail = "Momentum has not delivered at least +0.5R within the style’s holding window.";
  } else if (canTighten) {
    action = "PROTECT PROFIT";
    severity = "positive";
    headline = trendSupports ? "Trend still supports holding" : "Protect the open gain";
    detail = "A later confirmed structure supports the displayed tighter stop. Check it on Bybit; do not automatically move to breakeven or loosen an existing stop.";
  }

  let marginAdvice = "NO ADD — wait for at least +1.5R and fresh trend confirmation.";
  if (stale || invalidated || liquidationBreached || action === "EXIT NOW" || action === "CLOSE REMAINDER" || action === "REDUCE / EXIT") {
    marginAdvice = "NO ADD — resolve the stale data or exit condition before considering any new risk.";
  } else if (rMultiple < 0) {
    marginAdvice = "NO ADD — never add margin or size to rescue a losing trade.";
  } else if (trade.leverage > ADAPTIVE_STYLE_MAX_LEVERAGE[trade.style]) {
    marginAdvice =
      "REDUCE LEVERAGE — this position exceeds the " +
      ADAPTIVE_STYLE_MAX_LEVERAGE[trade.style] +
      "× adaptive ceiling for " +
      trade.style.toLowerCase() +
      " trades.";
  } else if (
    rMultiple >= 1.5 &&
    trendSupports &&
    trade.tp1Taken &&
    (trade.side === "LONG" ? trade.stop >= trade.entryPrice : trade.stop <= trade.entryPrice)
  ) {
    marginAdvice =
      "PYRAMID ELIGIBLE — add size only after TP1 is realized, the existing stop already protects entry, and added account risk stays at or below 0.25%.";
  }

  const next = !trade.tp1Taken
    ? { label: "TP1", value: trade.tp1 }
    : !trade.tp2Taken
      ? { label: "TP2", value: trade.tp2 }
      : !trade.tp3Taken
        ? { label: "TP3", value: trade.tp3 }
        : !trade.tp4Taken
          ? { label: "TP4", value: trade.tp4 }
          : { label: "TP5", value: trade.tp5 };

  return {
    action,
    severity,
    headline,
    detail,
    marginAdvice,
    currentPrice: price,
    pnl,
    pnlPct,
    marginRoiPct,
    rMultiple,
    suggestedStop,
    nextLevel: next.value,
    nextLevelLabel: next.label,
    liquidationBufferPct,
    ageMinutes,
    stale,
    exitLevel,
  };
}

export function applyPartialExit(
  trade: TrackedTrade,
  level: 1 | 2 | 3 | 4 | 5,
  exitPrice: number,
) {
  if (trade.status === "CLOSED" || trade[["tp1Taken", "tp2Taken", "tp3Taken", "tp4Taken", "tp5Taken"][level - 1] as "tp1Taken"] || !Number.isFinite(exitPrice) || exitPrice <= 0) return trade;
  const plannedPct = level === 5 ? trade.remainingPct : (trade.targetWeights ?? [20, 20, 20, 15, 25])[level - 1];
  const closePct = Math.min(plannedPct, trade.remainingPct);
  const closedQuantity = trade.quantity * (closePct / 100);
  const realized = signedMove(trade.side, trade.entryPrice, exitPrice) * closedQuantity;
  const remainingPct = Math.max(0, trade.remainingPct - closePct);
  return {
    ...trade,
    remainingPct,
    realizedPnl: trade.realizedPnl + realized,
    tp1Taken: trade.tp1Taken || level === 1,
    tp2Taken: trade.tp2Taken || level === 2,
    tp2TakenAt: level === 2 ? Date.now() : trade.tp2TakenAt,
    tp3Taken: trade.tp3Taken || level === 3,
    tp4Taken: trade.tp4Taken || level === 4,
    tp5Taken: trade.tp5Taken || level === 5,
    status: remainingPct === 0 ? "CLOSED" : "OPEN",
    closedAt: remainingPct === 0 ? Date.now() : trade.closedAt,
    exitPrice: remainingPct === 0 ? exitPrice : trade.exitPrice,
    closeReason: remainingPct === 0 ? "TP5" : trade.closeReason,
  } satisfies TrackedTrade;
}

export function closeTrackedTrade(
  trade: TrackedTrade,
  exitPrice: number,
  reason = "MANUAL",
) {
  if (trade.status === "CLOSED" || !Number.isFinite(exitPrice) || exitPrice <= 0) return trade;
  const closedQuantity = trade.quantity * (trade.remainingPct / 100);
  const realized = signedMove(trade.side, trade.entryPrice, exitPrice) * closedQuantity;
  return {
    ...trade,
    status: "CLOSED",
    remainingPct: 0,
    realizedPnl: trade.realizedPnl + realized,
    closedAt: Date.now(),
    exitPrice,
    closeReason: reason,
  } satisfies TrackedTrade;
}
