import { targetBudget, TARGET_EXIT_WEIGHTS, MAX_ROUND_TRIP_COST_R, R_LADDER, R_LADDER_WEIGHTS, SIGNAL_INTERVAL_MS, DEFAULT_TARGET_STYLE, TA_DESIRED_R, TA_WINDOW, type TargetStyle, PLAN_VALID_CANDLES } from "@/app/lib/target-policy";
import { relativeRiskBand, type FlexibilityMode, type QualityOverride } from "@/app/lib/entry-policy";
import { buildEntryExecutionPlan, type EntryExecutionPlan } from "@/app/lib/entry-execution";

export type AnalysisOptions = { flexibility?: FlexibilityMode; takerFeePct?: number; slippagePct?: number; now?: number; targetStyle?: TargetStyle; /** Weekly candles for historic levels; resampled from the macro frame when absent. */ weekly?: Candle[]; /** Backtest switch: how historic levels are applied. */ keyLevelMode?: "FULL" | "GATE" | "TARGETS" | "INFO" };
import { assessKeyLevels, keyLevelZones, resampleWeekly, type KeyLevelAssessment } from "@/app/lib/key-levels";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketTicker = {
  updatedAt?: number;
  symbol: string;
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  price24hPcnt: number;
  turnover24h: number;
  volume24h: number;
  fundingRate: number;
  bid1Price: number;
  ask1Price: number;
  openInterestValue: number;
};

export type MarketInstrument = {
  symbol: string;
  contractType?: string;
  status?: string;
  minLeverage: number;
  maxLeverage: number;
  leverageStep: number;
  minOrderQty: number;
  quantityStep: number;
  minNotionalValue: number;
};

export type TradingStyle = "SCALP" | "DAY" | "SWING" | "POSITION";
export type Bias = "LONG" | "SHORT";
export type Direction = Bias | "WAIT";
export type Decision = "SETUP" | "WATCH" | "NO TRADE";
export type Zone = { side: Bias; low: number; high: number } | null;
export type SetupType =
  | "PULLBACK"
  | "CHoCH REVERSAL"
  | "BREAKOUT"
  | "TREND CONTINUATION";
export type PullbackSetup = {
  side: Bias;
  state: "APPROACHING" | "CONFIRMED";
  reference: "EMA21" | "ORDER BLOCK" | "FVG";
  low: number;
  high: number;
} | null;

export type EntryCheckStatus = "PASS" | "WAIT" | "FAIL";
export type TradeGrade = "A+" | "A" | "B+" | "B" | "C" | "D";

export type EntryCheck = {
  id: string;
  label: string;
  status: EntryCheckStatus;
  required: boolean;
  weight: number;
  detail: string;
};

export type BtcRelationship = {
  historyBars: number;
  correlation: number | null;
  beta: number | null;
  relationship:
    | "SELF"
    | "TIGHT BTC LINK"
    | "BTC-SENSITIVE"
    | "LOOSE LINK"
    | "INDEPENDENT"
    | "INVERSE"
    | "INSUFFICIENT DATA";
  divergence: "NONE" | "BULLISH" | "BEARISH";
  divergenceVerdict: "NO DIVERGENCE" | "ACCEPT" | "CAUTION" | "REJECT";
  pairReturnPct: number;
  btcReturnPct: number;
  relativeStrengthPct: number;
  residualZScore: number;
  explanation: string;
  /** BTC close vs its 200-day EMA (closed daily candles). */
  btcDailyTrend: "BULL" | "BEAR" | "UNKNOWN";
  /** False when the trade side opposes the BTC daily trend: size is halved. */
  trendAligned: boolean;
};

export type TakeProfitLevel = {
  available: boolean;
  confluenceCount: number;
  level: 1 | 2 | 3 | 4 | 5;
  price: number;
  rewardR: number;
  exitPct: number;
  confidence: "HIGH" | "MEDIUM" | "DEVELOPING";
  source: string;
  sources: string[];
  rationale: string;
};

export type ImmediateEntryStatus = "ALLOW" | "CAUTION" | "AVOID";

export type ImmediateEntryTarget = TakeProfitLevel & {
  distancePct: number;
};

export type ImmediateEntryPlan = {
  status: ImmediateEntryStatus;
  score: number;
  entry: number;
  stop: number;
  targets: ImmediateEntryTarget[];
  weightedRewardR: number;
  netRewardR: number;
  estimatedCostPct: number;
  stopSource: string;
  deviationAtr: number;
  maxRiskPct: number;
  leverageMultiplier: number;
  reasoning: string[];
  warnings: string[];
  invalidationText: string;
};

export type MarketAnalysis = {
  executionPlan: EntryExecutionPlan;
  flexibility: FlexibilityMode;
  confirmationPath: string;
  qualityOverride: QualityOverride;
  direction: Direction;
  bias: Bias;
  decision: Decision;
  setupType: SetupType;
  entryReady: boolean;
  entryQuality: number;
  entryGrade: TradeGrade;
  entryChecks: EntryCheck[];
  score: number;
  regime: "TRENDING" | "WEAK TREND" | "RANGING" | "VOLATILE";
  session: string;
  isKillzone: boolean;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  tp5: number;
  takeProfits: TakeProfitLevel[];
  targetStyle: TargetStyle;
  rr: number;
  support: number;
  resistance: number;
  riskMultiplier: number;
  immediateEntry: ImmediateEntryPlan;
  scalpPlan: {
    status: "ENTER" | "WAIT FOR TRIGGER" | "STAND ASIDE";
    entryLow: number;
    entryHigh: number;
    trigger: number;
    triggerText: string;
    cancelText: string;
    ttlCandles: number;
    exitPlan: string[];
  };
  metrics: {
    rsi: number;
    adx: number;
    atr: number;
    atrPct: number;
    macdHistogram: number;
    stochastic: number;
    volumeRatio: number;
    fundingRate: number;
    trendFrames: number;
    spreadPct: number;
    executionCostR: number;
    weightedRewardR: number;
    netRewardR: number;
    breakEvenWinRatePct: number;
    setupThreshold: number;
    spreadCostLimitR: number;
    participationFloor: number;
    targetReliability: number;
    structuralTargets: number;
    candlestickPattern: string;
    turnover24h: number;
    liquidityFloor: number;
    confirmedCandleTime: number;
    executionCandles: number;
    contextCandles: number;
    macroCandles: number;
  };
  keyLevels: KeyLevelAssessment;
  structure: {
    bos: "BULLISH" | "BEARISH" | "NONE";
    bosLevel: number | null;
    bosTime: number | null;
    choch: "BULLISH" | "BEARISH" | "NONE";
    chochLevel: number | null;
    chochTime: number | null;
    sweep: "BULLISH" | "BEARISH" | "NONE";
    fvg: Zone;
    orderBlock: Zone;
    pullback: PullbackSetup;
  };
  reasons: string[];
  warnings: string[];
};

export type ScannerRow = {
  executionPlan: EntryExecutionPlan;
  flexibility: FlexibilityMode;
  entryChecks: EntryCheck[];
  qualityOverride: QualityOverride;
  analyzedAt: number;
  symbol: string;
  style: TradingStyle;
  price: number;
  change: number;
  turnover: number;
  fundingRate: number;
  openInterestValue: number;
  volume24h: number;
  score: number;
  direction: Direction;
  bias: Bias;
  decision: Decision;
  setupType: SetupType;
  regime: MarketAnalysis["regime"];
  rr: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  tp5: number;
  takeProfits: TakeProfitLevel[];
  targetStyle: TargetStyle;
  riskMultiplier: number;
  trendFrames: number;
  atrPct: number;
  adx: number;
  exchangeMaxLeverage?: number;
  minOrderQty?: number;
  quantityStep?: number;
  minNotionalValue?: number;
  spreadPct: number;
  executionCostR: number;
  spreadCostLimitR: number;
  setupThreshold: number;
  netRewardR: number;
  breakEvenWinRatePct: number;
  targetReliability: number;
  structuralTargets: number;
  entryReady: boolean;
  entryQuality: number;
  entryGrade: TradeGrade;
  ratingScore: number;
  ratingGrade: TradeGrade;
  ratingLabel: string;
  riskBand: "LOW" | "MEDIUM" | "HIGH";
  riskReason: string;
  btcRelationship: BtcRelationship;
  keyLevels?: KeyLevelAssessment;
  reason: string;
  gateReason: string;
  demo?: boolean;
};

type BybitPayload = {
  time?: number;
  error?: string;
  result?: {
    list?: unknown[];
    nextPageCursor?: string;
  };
};

export const STYLE_CONFIG: Record<
  TradingStyle,
  { label: string; interval: string; description: string }
> = {
  SCALP: {
    label: "Scalp",
    interval: "5",
    description: "5m execution · 15m/1h context",
  },
  DAY: { label: "Day", interval: "60", description: "1h signals · 4h/1D context" },
  SWING: { label: "Swing", interval: "60", description: "1h execution · 4h/1D context · wider swing limits" },
  POSITION: {
    label: "Position",
    interval: "240",
    description: "4h execution · 1D/1W context",
  },
};

export const STYLE_LIQUIDITY_FLOOR: Record<TradingStyle, number> = {
  SCALP: 25_000_000,
  DAY: 10_000_000,
  SWING: 5_000_000,
  POSITION: 5_000_000,
};

export const TIMEFRAMES = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1H" },
  { value: "120", label: "2H" },
  { value: "240", label: "4H" },
  { value: "D", label: "1D" },
];

export const INTERVAL_MS: Record<string, number> = {
  "1": 60_000,
  "3": 180_000,
  "5": 300_000,
  "15": 900_000,
  "30": 1_800_000,
  "60": 3_600_000,
  "120": 7_200_000,
  "240": 14_400_000,
  "360": 21_600_000,
  "720": 43_200_000,
  D: 86_400_000,
  W: 604_800_000,
  M: 2_592_000_000,
};

export function contextIntervals(interval: string) {
  const map: Record<string, [string, string]> = {
    "1": ["5", "15"],
    "3": ["15", "60"],
    "5": ["15", "60"],
    "15": ["60", "240"],
    "30": ["240", "D"],
    "60": ["240", "D"],
    "120": ["240", "D"],
    "240": ["D", "W"],
    "360": ["D", "W"],
    "720": ["D", "W"],
    D: ["W", "M"],
  };
  return map[interval] ?? ["60", "240"];
}

export function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeTicker(raw: Record<string, unknown>): MarketTicker {
  return {
    symbol: String(raw.symbol ?? ""),
    lastPrice: asNumber(raw.lastPrice),
    markPrice: asNumber(raw.markPrice),
    indexPrice: asNumber(raw.indexPrice),
    price24hPcnt: asNumber(raw.price24hPcnt),
    turnover24h: asNumber(raw.turnover24h),
    volume24h: asNumber(raw.volume24h),
    fundingRate: asNumber(raw.fundingRate),
    bid1Price: asNumber(raw.bid1Price),
    ask1Price: asNumber(raw.ask1Price),
    openInterestValue: asNumber(raw.openInterestValue),
  };
}

export function normalizeInstrument(raw: Record<string, unknown>): MarketInstrument {
  const leverageFilter =
    raw.leverageFilter && typeof raw.leverageFilter === "object"
      ? (raw.leverageFilter as Record<string, unknown>)
      : {};
  const lotSizeFilter =
    raw.lotSizeFilter && typeof raw.lotSizeFilter === "object"
      ? (raw.lotSizeFilter as Record<string, unknown>)
      : {};
  return {
    symbol: String(raw.symbol ?? ""),
    contractType: String(raw.contractType ?? ""),
    status: String(raw.status ?? ""),
    minLeverage: asNumber(leverageFilter.minLeverage, 1),
    maxLeverage: asNumber(leverageFilter.maxLeverage),
    leverageStep: asNumber(leverageFilter.leverageStep, 0.01),
    minOrderQty: asNumber(lotSizeFilter.minOrderQty),
    quantityStep: asNumber(lotSizeFilter.qtyStep),
    minNotionalValue: asNumber(lotSizeFilter.minNotionalValue),
  };
}

export async function fetchInstrument(symbol: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ kind: "instrument", symbol });
  const response = await fetch("/api/bybit?" + params.toString(), {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json()) as BybitPayload;
  const first = payload?.result?.list?.[0];
  if (!response.ok || !first || typeof first !== "object") {
    throw new Error(payload?.error || "Instrument leverage limits unavailable.");
  }
  return normalizeInstrument(first as Record<string, unknown>);
}

export async function fetchInstruments(signal?: AbortSignal) {
  const instruments: MarketInstrument[] = [];
  let cursor = "";
  const seenCursors = new Set<string>();

  for (let page = 0; page < 3; page += 1) {
    const params = new URLSearchParams({ kind: "instruments" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch("/api/bybit?" + params.toString(), {
      cache: "no-store",
      signal,
    });
    const payload = (await response.json()) as BybitPayload;
    if (!response.ok || !Array.isArray(payload?.result?.list)) {
      throw new Error(payload?.error || "Instrument leverage limits unavailable.");
    }
    instruments.push(
      ...payload.result.list
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object"),
        )
        .map(normalizeInstrument)
        .filter((item) => item.symbol),
    );
    const nextCursor = payload.result.nextPageCursor ?? "";
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return instruments;
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit = 260,
  signal?: AbortSignal,
  end?: number,
) {
  const params = new URLSearchParams({
    kind: "kline",
    symbol,
    interval,
    limit: String(limit),
  });
  if (end !== undefined) params.set("end", String(end));
  const response = await fetch("/api/bybit?" + params.toString(), {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json()) as BybitPayload;
  if (!response.ok || !Array.isArray(payload?.result?.list)) {
    throw new Error(payload?.error || "Kline history unavailable.");
  }
  const bars = (payload.result.list as unknown[][])
    .map((row) => ({
      time: asNumber(row[0]),
      open: asNumber(row[1]),
      high: asNumber(row[2]),
      low: asNumber(row[3]),
      close: asNumber(row[4]),
      volume: asNumber(row[5]),
    }))
    .reverse();
  if (bars.some((bar, index) => !Number.isFinite(bar.time) || bar.time <= 0 ||
      [bar.open, bar.high, bar.low, bar.close].some(price => !Number.isFinite(price) || price <= 0) ||
      bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close) ||
      bar.volume < 0 || (index > 0 && bar.time <= bars[index - 1].time))) {
    throw new Error("Invalid or unordered candle history. Refresh before entering.");
  }
  return bars;
}

export async function fetchTickers(signal?: AbortSignal) {
  const response = await fetch("/api/bybit?kind=tickers", {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json()) as BybitPayload;
  if (!response.ok || !Array.isArray(payload?.result?.list)) {
    throw new Error(payload?.error || "Ticker feed unavailable.");
  }
  return (payload.result.list as Record<string, unknown>[]).map(normalizeTicker);
}

export async function fetchTicker(symbol: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ kind: "ticker", symbol });
  const response = await fetch("/api/bybit?" + params.toString(), {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json()) as BybitPayload;
  const raw = payload?.result?.list?.[0] as Record<string, unknown> | undefined;
  if (!response.ok || !raw) {
    throw new Error(payload?.error || "Ticker unavailable.");
  }
  const ticker = normalizeTicker(raw);
  if (ticker.symbol !== symbol || ticker.lastPrice <= 0 || !Number.isFinite(payload.time) || !payload.time) throw new Error("Invalid or undated Bybit quote.");
  return {...ticker, updatedAt: payload.time};
}

export function ema(values: number[], period: number) {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push(values[index] * alpha + result[index - 1] * (1 - alpha));
  }
  return result;
}

function wilder(values: number[], period: number) {
  if (!values.length) return [];
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push((result[index - 1] * (period - 1) + values[index]) / period);
  }
  return result;
}

function average(values: number[]) {
  const usable = values.filter(Number.isFinite);
  return usable.length
    ? usable.reduce((total, value) => total + value, 0) / usable.length
    : 0;
}

function clampValue(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function gradeForScore(score: number): TradeGrade {
  if (score >= 90) return "A+";
  if (score >= 84) return "A";
  if (score >= 78) return "B+";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

export function rsi(candles: Candle[], period = 14) {
  const gains = [0];
  const losses = [0];
  for (let index = 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    gains.push(Math.max(0, change));
    losses.push(Math.max(0, -change));
  }
  const averageGains = wilder(gains, period);
  const averageLosses = wilder(losses, period);
  return averageGains.map((gain, index) => {
    const loss = averageLosses[index];
    if (!loss) return gain ? 100 : 50;
    const strength = gain / loss;
    return 100 - 100 / (1 + strength);
  });
}

export function atr(candles: Candle[], period = 14) {
  const ranges = candles.map((candle, index) => {
    if (!index) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  return wilder(ranges, period);
}

export function adx(candles: Candle[], period = 14) {
  if (!candles.length) return [];
  const trueRanges = [candles[0].high - candles[0].low];
  const plusDm = [0];
  const minusDm = [0];

  for (let index = 1; index < candles.length; index += 1) {
    const up = candles[index].high - candles[index - 1].high;
    const down = candles[index - 1].low - candles[index].low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
    trueRanges.push(
      Math.max(
        candles[index].high - candles[index].low,
        Math.abs(candles[index].high - candles[index - 1].close),
        Math.abs(candles[index].low - candles[index - 1].close),
      ),
    );
  }

  const smoothedTr = wilder(trueRanges, period);
  const smoothedPlus = wilder(plusDm, period);
  const smoothedMinus = wilder(minusDm, period);
  const directionalIndex = smoothedTr.map((range, index) => {
    if (!range) return 0;
    const plus = (100 * smoothedPlus[index]) / range;
    const minus = (100 * smoothedMinus[index]) / range;
    return plus + minus ? (100 * Math.abs(plus - minus)) / (plus + minus) : 0;
  });
  return wilder(directionalIndex, period);
}

export function macdHistogram(candles: Candle[]) {
  const closes = candles.map((candle) => candle.close);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line = closes.map((_, index) => fast[index] - slow[index]);
  const signal = ema(line, 9);
  return line.map((value, index) => value - signal[index]);
}

function stochastic(candles: Candle[], period = 14) {
  return candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - period + 1), index + 1);
    const high = Math.max(...window.map((item) => item.high));
    const low = Math.min(...window.map((item) => item.low));
    return high === low ? 50 : ((candle.close - low) / (high - low)) * 100;
  });
}

function lastValue(values: number[], fallback = 0) {
  const value = values[values.length - 1];
  return Number.isFinite(value) ? value : fallback;
}

function findStructure(candles: Candle[]) {
  const current = candles[candles.length - 1];
  const recent = candles.slice(-12, -1);
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  // Retain a recent break level through its later retest, instead of forgetting
  // it as soon as the next candle stops making new highs/lows.
  let bos: MarketAnalysis["structure"]["bos"] = "NONE";
  let bosLevel: number | null = null;
  let bosTime: number | null = null;
  for (let i = Math.max(21, candles.length - 6); i < candles.length; i++) {
    const sample = candles.slice(i - 21, i);
    const high = Math.max(...sample.map(bar => bar.high));
    const low = Math.min(...sample.map(bar => bar.low));
    const bar = candles[i];
    if (bar.close > high) { bos = "BULLISH"; bosLevel = high; bosTime = bar.time; }
    else if (bar.close < low) { bos = "BEARISH"; bosLevel = low; bosTime = bar.time; }
  }
  if (bosLevel !== null && (bos === "BULLISH" ? current.close < bosLevel : current.close > bosLevel)) {
    bos = "NONE"; bosLevel = null; bosTime = null;
  }
  const sweep =
    current.low < recentLow && current.close > recentLow
      ? "BULLISH"
      : current.high > recentHigh && current.close < recentHigh
        ? "BEARISH"
        : "NONE";

  let choch: MarketAnalysis["structure"]["choch"] = "NONE";
  let chochLevel: number | null = null;
  let chochTime: number | null = null;
  for (
    let index = Math.max(18, candles.length - 5);
    index < candles.length;
    index += 1
  ) {
    const history = candles.slice(0, index);
    const bar = candles[index];
    const internal = history.slice(-9);
    const earlier = history.slice(-18, -9);
    if (internal.length < 9 || earlier.length < 9) continue;
    const internalHigh = Math.max(...internal.map((candle) => candle.high));
    const internalLow = Math.min(...internal.map((candle) => candle.low));
    const internalMean = average(internal.map((candle) => candle.close));
    const earlierMean = average(earlier.map((candle) => candle.close));
    if (bar.close > internalHigh && internalMean < earlierMean) {
      choch = "BULLISH";
      chochLevel = internalHigh;
      chochTime = bar.time;
    } else if (bar.close < internalLow && internalMean > earlierMean) {
      choch = "BEARISH";
      chochLevel = internalLow;
      chochTime = bar.time;
    }
  }

  let fvg: Zone = null;
  for (let index = Math.max(1, candles.length - 45); index < candles.length - 1; index += 1) {
    const before = candles[index - 1];
    const after = candles[index + 1];
    if (before.high < after.low && current.close > before.high) {
      fvg = { side: "LONG", low: before.high, high: after.low };
    } else if (before.low > after.high && current.close < before.low) {
      fvg = { side: "SHORT", low: after.high, high: before.low };
    }
  }

  let orderBlock: Zone = null;
  for (let index = Math.max(0, candles.length - 40); index < candles.length - 3; index += 1) {
    const candle = candles[index];
    const impulseClose = candles[index + 3].close;
    const bullishImpulse = (impulseClose - candle.high) / candle.high > 0.003;
    const bearishImpulse = (candle.low - impulseClose) / candle.low > 0.003;
    if (candle.close < candle.open && bullishImpulse && current.close > candle.low) {
      orderBlock = {
        side: "LONG",
        low: candle.low,
        high: Math.max(candle.open, candle.close),
      };
    } else if (
      candle.close > candle.open &&
      bearishImpulse &&
      current.close < candle.high
    ) {
      orderBlock = {
        side: "SHORT",
        low: Math.min(candle.open, candle.close),
        high: candle.high,
      };
    }
  }

  return {
    bos,
    bosLevel,
    bosTime,
    choch,
    chochLevel,
    chochTime,
    sweep,
    fvg,
    orderBlock,
    pullback: null,
  } as MarketAnalysis["structure"];
}

type TargetCandidate = {
  price: number;
  weight: number;
  source: string;
  detail: string;
  structural: boolean;
};

function targetPriority(source: string) {
  if (/liquidity|swing|extreme/i.test(source)) return 1;
  if (/volume|point of control/i.test(source)) return 2;
  if (/VWAP/i.test(source)) return 3;
  if (/Fibonacci/i.test(source)) return 4;
  if (/Measured|impulse candle/i.test(source)) return 5;
  if (/engulf|wick|inside-bar|three-drive/i.test(source)) return 6;
  return 7;
}

function buildTechnicalTargets(input: {
  execution: Candle[];
  context: Candle[];
  macro: Candle[];
  bias: Bias;
  entry: number;
  risk: number;
  atrValue: number;
  ema21: number;
  structure: MarketAnalysis["structure"];
  style: TradingStyle;
  /** "TA": chart-structure targets matched to an R-distance ladder; "BUDGET": the volatility-budget map. */
  mode?: "TA" | "BUDGET";
  keyZones?: KeyLevelAssessment["zones"];
}) {
  const taMode = input.mode === "TA";
  const {
    execution,
    context,
    macro,
    bias,
    entry,
    risk,
    atrValue,
    ema21,
    structure,
  } = input;
  const sign = bias === "LONG" ? 1 : -1;
  const candidates: TargetCandidate[] = [];

  function addCandidate(
    price: number,
    weight: number,
    source: string,
    detail: string,
    structural = true,
  ) {
    if (!Number.isFinite(price) || price <= 0) return;
    candidates.push({ price, weight, source, detail, structural });
  }

  function addPivots(
    candles: Candle[],
    label: string,
    weight: number,
    lookback: number,
  ) {
    const sample = candles.slice(-lookback);
    for (let index = 2; index < sample.length - 2; index += 1) {
      const candle = sample[index];
      const window = sample.slice(index - 2, index + 3);
      const pivotPrice =
        bias === "LONG"
          ? candle.high === Math.max(...window.map((item) => item.high))
            ? candle.high
            : 0
          : candle.low === Math.min(...window.map((item) => item.low))
            ? candle.low
            : 0;
      if (!pivotPrice) continue;
      const recencyBoost = 0.75 + (index / Math.max(1, sample.length - 1)) * 0.45;
      addCandidate(
        pivotPrice,
        weight * recencyBoost,
        label + " swing liquidity",
        label + " confirmed pivot where resting liquidity is likely concentrated.",
      );
    }
  }

  function addWindowExtreme(
    candles: Candle[],
    bars: number,
    label: string,
    weight: number,
  ) {
    const sample = candles.slice(-bars);
    if (!sample.length) return;
    const price =
      bias === "LONG"
        ? Math.max(...sample.map((candle) => candle.high))
        : Math.min(...sample.map((candle) => candle.low));
    addCandidate(
      price,
      weight,
      label,
      label + " marks external range liquidity on closed candles.",
    );
  }

  function addPreviousPeriodExtreme(
    candles: Candle[],
    durationMs: number,
    label: string,
    weight: number,
  ) {
    if (candles.length < 2) return;
    const currentBucket = Math.floor(candles[candles.length - 1].time / durationMs);
    const priorBuckets = candles
      .map((candle) => Math.floor(candle.time / durationMs))
      .filter((bucket) => bucket < currentBucket);
    if (!priorBuckets.length) return;
    const priorBucket = Math.max(...priorBuckets);
    const period = candles.filter(
      (candle) => Math.floor(candle.time / durationMs) === priorBucket,
    );
    if (!period.length) return;
    const price =
      bias === "LONG"
        ? Math.max(...period.map((candle) => candle.high))
        : Math.min(...period.map((candle) => candle.low));
    addCandidate(
      price,
      weight,
      label,
      label + " is a commonly watched stop-liquidity objective.",
    );
  }

  addPivots(execution, "Execution", 2.15, 180);
  addPivots(context, "Context", 3.05, 140);
  addPivots(macro, "Macro", 4.1, 100);
  addWindowExtreme(execution, 20, "20-bar external liquidity", 2.2);
  addWindowExtreme(execution, 55, "55-bar external liquidity", 2.65);
  addWindowExtreme(context, 55, "Context range extreme", 3.2);
  addWindowExtreme(macro, 34, "Macro range extreme", 4.2);
  addPreviousPeriodExtreme(execution, 86_400_000, "Prior-day liquidity", 3.25);
  addPreviousPeriodExtreme(context, 604_800_000, "Prior-week liquidity", 3.7);
  // Historic daily / weekly support and resistance zones: the strongest targets a trade can aim for.
  for (const zone of input.keyZones ?? []) {
    const edge = bias === "LONG" ? zone.low : zone.high;
    if (sign * (edge - entry) <= 0) continue;
    addCandidate(edge, 3.6 + Math.min(2.4, zone.strength * 0.5), "Historic " + (bias === "LONG" ? "resistance" : "support") + " (" + (zone.weeklyTouches ? "weekly" : "daily") + " ×" + zone.touches + ")", "Clustered higher-timeframe swing level: " + zone.sources.join(", ") + ".");
  }

  const profile = execution.slice(-180);
  if (profile.length >= 20) {
    const profileLow = Math.min(...profile.map((candle) => candle.low));
    const profileHigh = Math.max(...profile.map((candle) => candle.high));
    const profileRange = profileHigh - profileLow;
    if (profileRange > 0) {
      const binCount = 28;
      const bins = Array.from({ length: binCount }, () => 0);
      for (const candle of profile) {
        const typical = (candle.high + candle.low + candle.close) / 3;
        const index = Math.min(
          binCount - 1,
          Math.max(0, Math.floor(((typical - profileLow) / profileRange) * binCount)),
        );
        bins[index] += Math.max(0, candle.volume);
      }
      const rankedBins = bins
        .map((volume, index) => ({ volume, index }))
        .sort((first, second) => second.volume - first.volume)
        .slice(0, 7);
      rankedBins.forEach((bin, rank) => {
        const price = profileLow + ((bin.index + 0.5) / binCount) * profileRange;
        addCandidate(
          price,
          2.45 - rank * 0.12,
          rank === 0 ? "Approximate volume POC" : "Approximate volume-profile node",
          "OHLCV-binned volume estimate over 180 closed candles; not exchange tick-level volume-at-price.",
        );
      });
    }
  }

  const anchorTime = structure.chochTime ?? execution[Math.max(0, execution.length - 96)]?.time;
  const anchored = execution.filter((candle) => !anchorTime || candle.time >= anchorTime);
  const anchoredVolume = anchored.reduce(
    (total, candle) => total + Math.max(candle.volume, Number.EPSILON),
    0,
  );
  if (anchored.length >= 8 && anchoredVolume > 0) {
    const anchoredVwap =
      anchored.reduce((total, candle) => {
        const typical = (candle.high + candle.low + candle.close) / 3;
        return total + typical * Math.max(candle.volume, Number.EPSILON);
      }, 0) / anchoredVolume;
    const variance =
      anchored.reduce((total, candle) => {
        const typical = (candle.high + candle.low + candle.close) / 3;
        return (
          total +
          Math.max(candle.volume, Number.EPSILON) * Math.pow(typical - anchoredVwap, 2)
        );
      }, 0) / anchoredVolume;
    const deviation = Math.sqrt(Math.max(0, variance));
    if (deviation > atrValue * 0.1) {
      [1, 1.5, 2, 2.5, 3].forEach((multiple, index) => {
        addCandidate(
          anchoredVwap + sign * deviation * multiple,
          2.55 - index * 0.14,
          "Anchored VWAP " + multiple.toFixed(1) + "σ",
          "A volume-weighted deviation band anchored to the latest structural leg.",
        );
      });
    }
  }

  const impulseSource = context.slice(-90);
  if (impulseSource.length >= 12) {
    let startIndex = 0;
    let endIndex = 0;
    if (bias === "LONG") {
      startIndex = impulseSource.reduce(
        (best, candle, index) => (candle.low < impulseSource[best].low ? index : best),
        0,
      );
      endIndex = impulseSource.reduce(
        (best, candle, index) =>
          index >= startIndex && candle.high > impulseSource[best].high ? index : best,
        startIndex,
      );
    } else {
      startIndex = impulseSource.reduce(
        (best, candle, index) => (candle.high > impulseSource[best].high ? index : best),
        0,
      );
      endIndex = impulseSource.reduce(
        (best, candle, index) =>
          index >= startIndex && candle.low < impulseSource[best].low ? index : best,
        startIndex,
      );
    }
    const impulseStart =
      bias === "LONG" ? impulseSource[startIndex].low : impulseSource[startIndex].high;
    const impulseEnd =
      bias === "LONG" ? impulseSource[endIndex].high : impulseSource[endIndex].low;
    const impulseRange = Math.abs(impulseEnd - impulseStart);
    if (endIndex > startIndex && impulseRange >= atrValue * 0.8) {
      addCandidate(
        impulseEnd,
        3,
        "Impulse extreme",
        "The confirmed end of the latest context-timeframe directional impulse.",
      );
      [0.618, 1, 1.272, 1.618, 2].forEach((extension, index) => {
        addCandidate(
          impulseStart + sign * impulseRange * extension,
          2.35 - index * 0.14,
          "Fibonacci " + extension.toFixed(3) + " extension",
          "A Fibonacci extension of the latest directional context impulse.",
        );
      });
      addCandidate(
        entry + sign * impulseRange,
        2.65,
        "Measured move",
        "The prior context impulse projected from the planned entry.",
      );
    }
  }

  let candlestickPattern = "No fresh directional candle pattern";
  const patternWindow = execution.slice(-14);
  for (let index = patternWindow.length - 1; index >= 1; index -= 1) {
    const candle = patternWindow[index];
    const previous = patternWindow[index - 1];
    const range = Math.max(candle.high - candle.low, Number.EPSILON);
    const body = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const bullishEngulfing =
      previous.close < previous.open &&
      candle.close > candle.open &&
      candle.open <= previous.close &&
      candle.close >= previous.open;
    const bearishEngulfing =
      previous.close > previous.open &&
      candle.close < candle.open &&
      candle.open >= previous.close &&
      candle.close <= previous.open;
    const directionalPin =
      bias === "LONG"
        ? lowerWick >= Math.max(body * 1.8, range * 0.45) && candle.close > candle.low + range * 0.55
        : upperWick >= Math.max(body * 1.8, range * 0.45) && candle.close < candle.high - range * 0.55;
    const directionalEngulfing = bias === "LONG" ? bullishEngulfing : bearishEngulfing;
    const before = patternWindow[index - 2];
    const insideBreakout = Boolean(before && previous.high < before.high && previous.low > before.low &&
      (bias === "LONG" ? candle.close > before.high : candle.close < before.low));
    const threeDrive = Boolean(before &&
      (bias === "LONG"
        ? before.close > before.open && previous.close > before.close && candle.close > previous.high && candle.close > candle.open
        : before.close < before.open && previous.close < before.close && candle.close < previous.low && candle.close < candle.open));
    const impulseCandle =
      body / range >= 0.68 &&
      (bias === "LONG" ? candle.close > candle.open : candle.close < candle.open);
    if (!directionalEngulfing && !directionalPin && !impulseCandle && !insideBreakout && !threeDrive) continue;
    if (patternWindow.slice(index + 1).some((next) => bias === "LONG" ? next.close < candle.low : next.close > candle.high)) continue;

    candlestickPattern = insideBreakout ? "Inside-bar breakout" : threeDrive ? "Three-drive continuation proxy" : directionalEngulfing
      ? bias === "LONG"
        ? "Bullish engulfing"
        : "Bearish engulfing"
      : directionalPin
        ? bias === "LONG"
          ? "Bullish rejection wick"
          : "Bearish rejection wick"
        : bias === "LONG"
          ? "Bullish impulse candle"
          : "Bearish impulse candle";
    const patternLow = directionalEngulfing ? Math.min(previous.low, candle.low) : candle.low;
    const patternHigh = directionalEngulfing ? Math.max(previous.high, candle.high) : candle.high;
    const patternRange = Math.max(patternHigh - patternLow, atrValue * 0.35);
    const patternAnchor = bias === "LONG" ? patternHigh : patternLow;
    [0.618, 1, 1.618].forEach((multiple, projectionIndex) => {
      addCandidate(
        patternAnchor + sign * patternRange * multiple,
        2.8 - projectionIndex * 0.18,
        candlestickPattern + " projection",
        candlestickPattern + " range projected " + multiple.toFixed(3) + "× beyond its break.",
      );
    });
    break;
  }

  const volatilityBase = Math.max(atrValue, Math.abs(entry - ema21) * 0.65);
  [0.85, 1.35, 2.15, 3.4, 5.5, 8].forEach((multiple, index) => {
    addCandidate(
      entry + sign * volatilityBase * multiple,
      1.15 - index * 0.06,
      "Adaptive volatility map",
      "A nonlinear ATR/EMA volatility envelope used only where stronger structure is absent.",
      false,
    );
  });

  const budget = targetBudget(execution,bias,atrValue,input.style);
  const minimumDistance = atrValue * 0.12;
  // TA mode reaches as far as the structure goes (up to 6R); budget mode keeps the volatility ceiling.
  const maximumDistance = taMode ? Math.max(budget.distance, risk * 6) : budget.distance;
  const tolerance = Math.max(atrValue * 0.06, entry * 0.00005);
  const eligible = candidates
    .filter((candidate) => {
      const distance = sign * (candidate.price - entry);
      return distance >= minimumDistance && distance <= maximumDistance;
    })
    .sort(
      (first, second) =>
        sign * (first.price - entry) - sign * (second.price - entry),
    );

  const clusters: Array<{
    price: number;
    candidates: TargetCandidate[];
  }> = [];
  for (const candidate of eligible) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(candidate.price - last.price) <= tolerance) {
      last.candidates.push(candidate);
      const totalWeight = last.candidates.reduce((total, item) => total + item.weight, 0);
      last.price =
        last.candidates.reduce((total, item) => total + item.price * item.weight, 0) /
        Math.max(totalWeight, Number.EPSILON);
    } else {
      clusters.push({ price: candidate.price, candidates: [candidate] });
    }
  }

  const minimumSpacing = atrValue * 0.08;
  const selected: typeof clusters = [];
  const targetHorizons = taMode
    ? TA_DESIRED_R.map((multiple, index) => Math.max(minimumDistance + minimumSpacing * index, risk * multiple))
    : [0.18,0.34,0.55,0.78,1].map((fraction,index)=>Math.max(minimumDistance+minimumSpacing*index,budget.distance*fraction));
  for (const desiredDistance of targetHorizons) {
    const previousDistance = selected.length
      ? sign * (selected[selected.length - 1].price - entry)
      : 0;
    const viable = clusters.filter(
      (cluster) => {
        const distance = sign * (cluster.price - entry);
        if (taMode) {
          // Real structure only, inside a window around the desired distance.
          return cluster.candidates.some((candidate) => candidate.structural) &&
            distance >= Math.max(minimumDistance, previousDistance + (selected.length ? minimumSpacing : 0), desiredDistance * TA_WINDOW.low) &&
            distance <= Math.min(maximumDistance, desiredDistance * TA_WINDOW.high);
        }
        return (selected.length >= 3 || cluster.candidates.some((candidate) => candidate.structural)) &&
          distance <= budget.distance &&
          distance >= Math.max(minimumDistance, previousDistance + (selected.length ? minimumSpacing : 0));
      },
    );
    const selectedCluster = viable
      .map((cluster) => {
        const distance = sign * (cluster.price - entry);
        const confluenceWeight = cluster.candidates.reduce(
          (total, candidate) => total + candidate.weight,
          0,
        );
        const structuralCount = cluster.candidates.filter(
          (candidate) => candidate.structural,
        ).length;
        // TA mode prefers the nearer structure (reachable first); overshoot is penalised.
        const undershootPenalty = taMode && distance > desiredDistance ? 0.3 * (distance - desiredDistance) / desiredDistance : 0;
        return {
          cluster,
          rank:
            Math.abs(distance - desiredDistance) / Math.max(desiredDistance, atrValue) +
            undershootPenalty + Math.min(...cluster.candidates.map((candidate) => targetPriority(candidate.source))) * 0.16 -
            Math.min(0.32, confluenceWeight * 0.018 + structuralCount * 0.035),
        };
      })
      .sort((first, second) => first.rank - second.rank)[0]?.cluster;

    if (selectedCluster) {
      selected.push(selectedCluster);
    } else {
      const fallbackDistance = Math.max(desiredDistance, previousDistance + minimumSpacing);
      selected.push({
        price: entry + sign * fallbackDistance,
        candidates: [
          {
            price: entry + sign * fallbackDistance,
            weight: 0.8,
            source: taMode ? TA_DESIRED_R[selected.length] + "R (no structure in window)" : "No confirmed objective",
            detail: selected.length < 3 ? "Not enough technical evidence for this inner target; this map cannot approve entry." : "A nonlinear ATR/EMA extension beyond the last confirmed objective.",
            structural: false,
          },
        ],
      });
    }
  }

  const exitPcts = TARGET_EXIT_WEIGHTS;
  const levels = selected.slice(0, 5).map<TakeProfitLevel>((cluster, index) => {
    const ranked = [...cluster.candidates].sort(
      (first, second) => targetPriority(first.source) - targetPriority(second.source) || second.weight - first.weight,
    );
    const primary = ranked[0];
    const sources = Array.from(new Set(ranked.map((candidate) => candidate.source)));
    const confluenceWeight = ranked.reduce((total, candidate) => total + candidate.weight, 0);
    const structuralSources = new Set(
      ranked.filter((candidate) => candidate.structural).map((candidate) => candidate.source),
    ).size;
    const confidence: TakeProfitLevel["confidence"] =
      confluenceWeight >= 5.5 || structuralSources >= 3
        ? "HIGH"
        : confluenceWeight >= 2.5 || structuralSources >= 1
          ? "MEDIUM"
          : "DEVELOPING";
    const executionBuffer = Math.min(atrValue * 0.05, Math.abs(cluster.price - entry) * 0.025);
    const price = cluster.price - sign * executionBuffer;
    const confluenceText =
      sources.length > 1
        ? " Confluence: " + sources.slice(0, 3).join(" + ") + "."
        : "";
    return {
      available: primary.source !== "No confirmed objective" && Math.abs(price-entry)<=maximumDistance,
      confluenceCount: sources.filter((source) => source !== "No confirmed objective").length,
      level: (index + 1) as TakeProfitLevel["level"],
      price,
      rewardR: primary.source === "No confirmed objective" ? 0 : Math.abs(price - entry) / Math.max(risk, Number.EPSILON),
      exitPct: exitPcts[index],
      confidence,
      source: primary.source,
      sources,
      rationale:
        primary.detail +
        confluenceText +
        " The limit is buffered slightly before the analyzed level for fill probability.",
    };
  });

  const structuralTargets = levels.filter((level) =>
    level.available && level.sources.some((source) => source !== "Adaptive volatility map"),
  ).length;
  const confidencePoints = levels.reduce(
    (total, level) =>
      total + (level.confidence === "HIGH" ? 100 : level.confidence === "MEDIUM" ? 74 : 48),
    0,
  );
  const targetReliability = Math.round(
    Math.min(
      100,
      confidencePoints / levels.length +
        structuralTargets * 2 +
        (candlestickPattern.startsWith("No fresh") ? 0 : 4),
    ),
  );

  return { levels, targetReliability, structuralTargets, candlestickPattern };
}

function sessionNow() {
  const hour = new Date().getUTCHours();
  const minute = new Date().getUTCMinutes();
  const decimal = hour + minute / 60;
  if (decimal >= 0 && decimal < 3) return { name: "Asia window", active: true };
  if (decimal >= 7 && decimal < 10) return { name: "London window", active: true };
  if (decimal >= 13.5 && decimal < 16) return { name: "New York window", active: true };
  return { name: "Off-session", active: false };
}

export function analyzeMarket(
  candles: Candle[],
  context: Candle[],
  macro: Candle[],
  ticker?: MarketTicker | null,
  style: TradingStyle = "DAY",
  options: AnalysisOptions = {},
): MarketAnalysis {
  const flexibility = options.flexibility ?? "STRICT";
  const sufficientHistory = candles.length >= 31 && context.length >= 31 && macro.length >= 31;
  const executionSource =
    candles.length >= 31 ? candles : generateDemoCandles("BTCUSDT", "15", 180);
  const usable = executionSource.slice(0, -1);
  const contextUsable = context.length >= 31 ? context.slice(0, -1) : usable;
  const macroUsable = macro.length >= 31 ? macro.slice(0, -1) : contextUsable;
  const current = usable[usable.length - 1];
  const closes = usable.map((candle) => candle.close);
  const contextCloses = contextUsable.map((candle) => candle.close);
  const macroCloses = macroUsable.map((candle) => candle.close);
  const currentEma21 = lastValue(ema(closes, 21), current.close);
  const contextEma50 = lastValue(
    ema(contextCloses, 50),
    contextUsable[contextUsable.length - 1].close,
  );
  const macroEma200 = lastValue(
    ema(macroCloses, 200),
    macroUsable[macroUsable.length - 1].close,
  );
  const contextClose = contextUsable[contextUsable.length - 1].close;
  const macroClose = macroUsable[macroUsable.length - 1].close;
  const rsiValue = lastValue(rsi(usable), 50);
  const macdValue = lastValue(macdHistogram(usable));
  const stochasticValue = lastValue(stochastic(usable), 50);
  const atrSeries = atr(usable);
  const atrValue = Math.max(lastValue(atrSeries, current.close * 0.007), current.close * 0.0001);
  const atrPct = (atrValue / current.close) * 100;
  const regimeAdx = lastValue(adx(contextUsable), 20);
  const atrRatio =
    atrValue / Math.max(average(atrSeries.slice(-30)), Number.EPSILON);
  const volumeAverage = average(usable.slice(-21, -1).map((candle) => candle.volume));
  const volumeRatio = volumeAverage ? current.volume / volumeAverage : 1;
  const rawStructure = findStructure(usable);
  const fundingRate = ticker?.fundingRate ?? 0;
  const turnover24h = ticker?.turnover24h ?? 0;
  const session = sessionNow();
  const marketPrice = ticker?.lastPrice || current.close;
  const spreadAbsolute =
    ticker?.ask1Price && ticker?.bid1Price
      ? Math.max(0, ticker.ask1Price - ticker.bid1Price)
      : 0;
  const spreadPct = marketPrice ? (spreadAbsolute / marketPrice) * 100 : 0;

  const regime: MarketAnalysis["regime"] =
    atrRatio > 2
      ? "VOLATILE"
      : regimeAdx < 15
        ? "RANGING"
        : regimeAdx < 25
          ? "WEAK TREND"
          : "TRENDING";

  const longFrames = [
    current.close > currentEma21,
    contextClose > contextEma50,
    macroClose > macroEma200,
  ];
  const shortFrames = [
    current.close < currentEma21,
    contextClose < contextEma50,
    macroClose < macroEma200,
  ];
  const longFrameCount = longFrames.filter(Boolean).length;
  const shortFrameCount = shortFrames.filter(Boolean).length;
  const previous = usable[usable.length - 2] ?? current;
  const candleRange = Math.max(current.high - current.low, Number.EPSILON);
  const candleBody = Math.max(
    Math.abs(current.close - current.open),
    atrValue * 0.04,
  );
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const upperWick = current.high - Math.max(current.open, current.close);
  const closeLocation = (current.close - current.low) / candleRange;

  function preferredZone(side: Bias) {
    if (rawStructure.orderBlock?.side === side) {
      return { ...rawStructure.orderBlock, reference: "ORDER BLOCK" as const };
    }
    if (rawStructure.fvg?.side === side) {
      return { ...rawStructure.fvg, reference: "FVG" as const };
    }
    return null;
  }

  function buildPullback(side: Bias): Exclude<PullbackSetup, null> | null {
    const frameCount = side === "LONG" ? longFrameCount : shortFrameCount;
    if (frameCount < 2) return null;
    const zone = preferredZone(side);
    const zoneTouched = Boolean(
      zone &&
        current.low <= zone.high + atrValue * 0.2 &&
        current.high >= zone.low - atrValue * 0.2,
    );
    const emaTouched =
      current.low <= currentEma21 + atrValue * 0.24 &&
      current.high >= currentEma21 - atrValue * 0.24;
    if (!zoneTouched && !emaTouched) return null;
    const bullishRejection =
      rawStructure.sweep === "BULLISH" ||
      (current.close >= current.open &&
        lowerWick >= candleBody * 0.45 &&
        closeLocation >= 0.58) ||
      current.close > previous.high;
    const bearishRejection =
      rawStructure.sweep === "BEARISH" ||
      (current.close <= current.open &&
        upperWick >= candleBody * 0.45 &&
        closeLocation <= 0.42) ||
      current.close < previous.low;
    const held = zone
      ? side === "LONG"
        ? current.close >= zone.low - atrValue * 0.1
        : current.close <= zone.high + atrValue * 0.1
      : true;
    const confirmed =
      held && (side === "LONG" ? bullishRejection : bearishRejection);
    return {
      side,
      state: confirmed ? "CONFIRMED" : "APPROACHING",
      reference: zoneTouched ? zone!.reference : "EMA21",
      low: zoneTouched ? zone!.low : currentEma21 - atrValue * 0.24,
      high: zoneTouched ? zone!.high : currentEma21 + atrValue * 0.24,
    };
  }

  const longPullback = buildPullback("LONG");
  const shortPullback = buildPullback("SHORT");
  const pullback =
    longPullback && !shortPullback
      ? longPullback
      : shortPullback && !longPullback
        ? shortPullback
        : longFrameCount >= shortFrameCount
          ? longPullback
          : shortPullback;
  const structure: MarketAnalysis["structure"] = {
    ...rawStructure,
    pullback,
  };

  function scoreSide(side: Bias) {
    const long = side === "LONG";
    const frames = long ? longFrames : shortFrames;
    let score = frames.filter(Boolean).length * 8;
    if (regimeAdx >= 25) score += 12;
    else if (regimeAdx >= 15) score += 6;
    if (long ? macdValue > 0 : macdValue < 0) score += 10;
    if (long ? rsiValue >= 40 && rsiValue <= 62 : rsiValue >= 38 && rsiValue <= 60) {
      score += 8;
    }
    if (long ? stochasticValue < 72 : stochasticValue > 28) score += 6;
    if (structure.bos === (long ? "BULLISH" : "BEARISH")) score += 12;
    if (structure.choch === (long ? "BULLISH" : "BEARISH")) score += 14;
    if (structure.sweep === (long ? "BULLISH" : "BEARISH")) score += 8;
    if (structure.fvg?.side === side) score += 6;
    if (structure.orderBlock?.side === side) score += 6;
    if (structure.pullback?.side === side) {
      score += structure.pullback.state === "CONFIRMED" ? 10 : 5;
    }
    if (volumeRatio >= 1.2) score += 8;
    else if (volumeRatio >= 0.9) score += 4;
    return Math.min(100, score);
  }

  const longScore = scoreSide("LONG");
  const shortScore = scoreSide("SHORT");
  const chochBias: Bias | null =
    structure.choch === "BULLISH"
      ? "LONG"
      : structure.choch === "BEARISH"
        ? "SHORT"
        : null;
  const chochHasSupport = Boolean(
    chochBias &&
      (structure.sweep === (chochBias === "LONG" ? "BULLISH" : "BEARISH") ||
        structure.fvg?.side === chochBias ||
        structure.orderBlock?.side === chochBias),
  );
  let bias: Bias = longScore >= shortScore ? "LONG" : "SHORT";
  const confirmedLongPullback =
    longPullback?.state === "CONFIRMED" && longFrameCount >= 2;
  const confirmedShortPullback =
    shortPullback?.state === "CONFIRMED" && shortFrameCount >= 2;
  if (confirmedLongPullback && !confirmedShortPullback) {
    bias = "LONG";
  } else if (confirmedShortPullback && !confirmedLongPullback) {
    bias = "SHORT";
  } else if (
    chochBias === "LONG" &&
    chochHasSupport &&
    longFrameCount >= 1 &&
    longScore >= shortScore - 6
  ) {
    bias = "LONG";
  } else if (
    chochBias === "SHORT" &&
    chochHasSupport &&
    shortFrameCount >= 1 &&
    shortScore >= longScore - 6
  ) {
    bias = "SHORT";
  }
  const setupType: SetupType =
    structure.choch === (bias === "LONG" ? "BULLISH" : "BEARISH")
      ? "CHoCH REVERSAL"
      : structure.pullback?.side === bias
        ? "PULLBACK"
        : structure.bos === (bias === "LONG" ? "BULLISH" : "BEARISH")
          ? "BREAKOUT"
          : "TREND CONTINUATION";
  const trendFrames = (bias === "LONG" ? longFrames : shortFrames).filter(Boolean).length;
  let score = bias === "LONG" ? longScore : shortScore;
  const warnings: string[] = [];
  const intraday = style === "SCALP" || style === "DAY";
  const crowded =
    (bias === "LONG" && fundingRate > 0.001) ||
    (bias === "SHORT" && fundingRate < -0.001);
  const absoluteVolatilityLimit: Record<TradingStyle, number> = {
    SCALP: 1.5,
    DAY: 3,
    SWING: 6,
    POSITION: 10,
  };
  const absoluteVolatilityHalt = atrPct > absoluteVolatilityLimit[style];
  const liquidityTooLow = Boolean(
    ticker && turnover24h < STYLE_LIQUIDITY_FLOOR[style],
  );
  const participationFloor =
    setupType === "PULLBACK"
      ? 0.55
      : setupType === "CHoCH REVERSAL"
        ? 0.85
        : setupType === "BREAKOUT"
          ? 0.8
          : 0.7;
  const participationTooLow = volumeRatio < participationFloor;
  const requiredTrendFrames = setupType === "CHoCH REVERSAL" ? 1 : 2;
  const alignmentTooWeak = trendFrames < requiredTrendFrames;
  // Entry signals need every timeframe aligned; CHoCH reversals trade against
  // the higher frames by design and keep their single-frame requirement.
  const signalTrendFrames = setupType === "CHoCH REVERSAL" ? 1 : 3;
  const sideStructure = bias === "LONG" ? "BULLISH" : "BEARISH";
  const momentumAligned = bias === "LONG" ? macdValue > 0 : macdValue < 0;
  const structuralConfluence = [
    structure.sweep === sideStructure,
    structure.fvg?.side === bias,
    structure.orderBlock?.side === bias,
    momentumAligned,
    volumeRatio >= 0.85,
  ].filter(Boolean).length;
  const setupStructureReady =
    setupType === "CHoCH REVERSAL"
      ? structure.choch === sideStructure && structuralConfluence >= 2
      : setupType === "PULLBACK"
        ? structure.pullback?.side === bias &&
          structure.pullback.state === "CONFIRMED" &&
          (momentumAligned || structure.sweep === sideStructure)
        : setupType === "BREAKOUT"
          ? structure.bos === sideStructure && momentumAligned && volumeRatio >= 0.75
          : momentumAligned &&
            (trendFrames === 3 ||
              structure.sweep === sideStructure ||
              structure.fvg?.side === bias ||
              structure.orderBlock?.side === bias);
  const setupThresholdBase: Record<SetupType, number> = {
    PULLBACK: 66,
    "TREND CONTINUATION": 70,
    BREAKOUT: 70,
    "CHoCH REVERSAL": 72,
  };
  const setupThreshold =
    setupThresholdBase[setupType] + (regime === "WEAK TREND" ? 8 : 0);

  if (crowded) {
    score = Math.min(score, 59);
    warnings.push("Funding is crowded against this side; derivatives filter rejects entry.");
  }
  if (regime === "VOLATILE" || absoluteVolatilityHalt) {
    score = Math.min(score, 49);
    warnings.push(
      absoluteVolatilityHalt
        ? "Absolute ATR is too large for the selected trading style."
        : "ATR expansion is above the volatility halt threshold.",
    );
  } else if (regime === "RANGING") {
    score = Math.min(score, 69);
    warnings.push("ADX is below 15; keep this as a watch until trend strength expands.");
  }
  if (intraday && !session.active) {
    score = Math.max(0, score - 3);
    warnings.push(
      "Outside the primary UTC liquidity windows; use reduced size and require the planned trigger.",
    );
  }
  if (liquidityTooLow) {
    score = Math.min(score, 59);
    warnings.push("24-hour turnover is below the liquidity floor for this style.");
  }
  if (participationTooLow) {
    score = Math.min(score, 59);
    warnings.push(
      "Participation is below the " +
        Math.round(participationFloor * 100) +
        "% floor for this " +
        setupType.toLowerCase() +
        ".",
    );
  } else if (volumeRatio < 0.9) {
    warnings.push(
      setupType === "PULLBACK"
        ? "Volume is contracting on the pullback; acceptable only while the zone holds."
        : "Participation is adequate but still below its 20-candle average.",
    );
  }
  if (alignmentTooWeak) {
    score = Math.min(score, 59);
    warnings.push(
      setupType === "CHoCH REVERSAL"
        ? "The CHoCH has no aligned execution frame yet."
        : "Fewer than two timeframes agree with the directional bias.",
    );
  }
  if (!setupStructureReady) {
    warnings.push(
      setupType === "PULLBACK"
        ? "Pullback zone found; wait for a rejection close before entry."
        : setupType === "CHoCH REVERSAL"
          ? "CHoCH detected; wait for a retest plus two structural confirmations."
          : "Directional bias is valid, but price-action confirmation is incomplete.",
    );
  }

  const recent = usable.slice(-42);
  const support = Math.min(...recent.map((candle) => candle.low));
  const resistance = Math.max(...recent.map((candle) => candle.high));
  const breakLevel = setupType === "CHoCH REVERSAL" ? structure.chochLevel : structure.bosLevel;
  const breakTime = setupType === "CHoCH REVERSAL" ? structure.chochTime : structure.bosTime;
  const breakZone = breakLevel && ["CHoCH REVERSAL", "BREAKOUT"].includes(setupType)
    ? {low: breakLevel - atrValue * 0.16, high: breakLevel + atrValue * 0.16} : null;
  const matchingZone = breakZone ?? (structure.pullback?.side === bias ? structure.pullback
    : structure.orderBlock?.side === bias ? structure.orderBlock
    : structure.fvg?.side === bias ? structure.fvg : null);
  const zoneSource = breakZone ? (setupType === "CHoCH REVERSAL" ? "CHoCH retest" : "Broken swing retest")
    : structure.pullback?.side === bias ? structure.pullback.reference
    : structure.orderBlock?.side === bias ? "ORDER BLOCK" : structure.fvg?.side === bias ? "FVG" : "EMA21 pullback";
  // Anchored to closed-candle structure. A live quote cannot drag this zone upward/downward.
  const entryLow = matchingZone?.low ?? currentEma21 - atrValue * 0.18;
  const entryHigh = matchingZone?.high ?? currentEma21 + atrValue * 0.18;
  const strongClose = Boolean(
    Math.abs(current.close - current.open) / candleRange >= 0.55 &&
    (bias === "LONG" ? current.close > previous.high && closeLocation >= 0.72
      : current.close < previous.low && closeLocation <= 0.28),
  );
  const executionIntervalMs = Math.max(60_000, current.time - previous.time);
  const executionPrice = bias === "LONG" ? Math.max(marketPrice, ticker?.ask1Price ?? 0)
    : Math.min(marketPrice, ticker?.bid1Price || marketPrice);
  const locationPlan = buildEntryExecutionPlan({
    candles: usable, liveCandle: executionSource[executionSource.length - 1], side: bias,
    marketPrice: executionPrice, zoneLow: entryLow, zoneHigh: entryHigh, zoneSource,
    ema21: currentEma21, atr: atrValue, intervalMs: executionIntervalMs, validCandles: PLAN_VALID_CANDLES[style],
    now: options.now ?? Date.now(), breakTime,
    mode: flexibility, setupType, score, threshold: setupThreshold,
    confluence: structuralConfluence, frames: trendFrames, strongClose,
    structureReady: setupStructureReady, momentumAligned,
  });
  const entry = locationPlan.entry;
  const stop = locationPlan.stop;
  const risk = Math.max(Math.abs(entry - stop), Number.EPSILON);
  const targetStyle: TargetStyle = options.targetStyle ?? DEFAULT_TARGET_STYLE;
  // Historic support / resistance from the daily and weekly charts.
  const dailyFrame = macroUsable;
  const weeklyFrame = options.weekly && options.weekly.length >= 8 ? options.weekly.slice(0, -1) : resampleWeekly(dailyFrame).slice(0, -1);
  const dailyAtr = Math.max(lastValue(atr(dailyFrame, 14), entry * 0.02), entry * 0.002);
  const keyZones = keyLevelZones(dailyFrame, weeklyFrame, dailyAtr * 0.6, options.now ?? Date.now());
  const keyLevels = assessKeyLevels(keyZones, bias, entry, stop, dailyAtr);
  // Backtested: zones as targets help a little; blocking on room to the next level removed the best trades (see docs).
  const keyLevelMode = options.keyLevelMode ?? "TARGETS";
  const targetAnalysis = buildTechnicalTargets({
    keyZones: keyLevelMode === "FULL" || keyLevelMode === "TARGETS" ? keyZones : [],
    mode: targetStyle === "TA" ? "TA" : "BUDGET",
    execution: usable,
    context: contextUsable,
    macro: macroUsable,
    bias,
    entry,
    risk,
    atrValue,
    ema21: currentEma21,
    structure,
    style,
  });
  const structuralMap = targetAnalysis.levels;
  const sideSign = bias === "LONG" ? 1 : -1;
  // TA style: the structure-matched map itself (same exit weights). LADDER: fixed R multiples annotated with nearby structure.
  const takeProfits: TakeProfitLevel[] = targetStyle === "TA" ? structuralMap.map((level, index) => ({ ...level, exitPct: R_LADDER_WEIGHTS[index] })) : R_LADDER.map((multiple, index) => {
        const price = entry + sideSign * risk * multiple;
        const nearby = structuralMap.filter(level => level.available && !/ATR|volatility map/i.test(level.source) && Math.abs(level.price - price) <= risk * 0.35);
        return {
          available: true,
          confluenceCount: nearby.length,
          level: (index + 1) as TakeProfitLevel["level"],
          price,
          rewardR: multiple,
          exitPct: R_LADDER_WEIGHTS[index],
          confidence: nearby.length ? "MEDIUM" : "DEVELOPING",
          source: multiple + "R ladder" + (nearby.length ? " near " + nearby[0].source : ""),
          sources: [multiple + "R ladder", ...nearby.flatMap(level => level.sources.filter(source => !/ATR|volatility map/i.test(source)))],
          rationale: multiple + "R from entry (backtested 1R-5R scale-out). The structural map must confirm TP1 before the plan qualifies.",
        };
      });
  const [tp1, tp2, tp3, tp4, tp5] = takeProfits.map((target) => target.price);
  const weightedRewardR = takeProfits.reduce(
    (total, target) => total + target.rewardR * (target.exitPct / 100),
    0,
  );
  const executionCostR = spreadAbsolute / risk;
  const estimatedRoundTripCostR = entry * 2 * ((options.takerFeePct ?? 0.055) + (options.slippagePct ?? 0.02)) / 100 / risk;
  const netRewardR = Math.max(0, weightedRewardR - executionCostR - estimatedRoundTripCostR);
  const breakEvenWinRatePct =
    Math.min(100, ((1 + executionCostR + estimatedRoundTripCostR) / (weightedRewardR + 1)) * 100);
  const maximumSpreadPct: Record<TradingStyle, number> = {
    SCALP: 0.08,
    DAY: 0.12,
    SWING: 0.2,
    POSITION: 0.3,
  };
  const spreadCostLimitR: Record<TradingStyle, number> = {
    SCALP: 0.14,
    DAY: 0.18,
    SWING: 0.2,
    POSITION: 0.22,
  };
  const spreadTooWide =
    spreadPct > maximumSpreadPct[style] ||
    executionCostR > spreadCostLimitR[style];
  if (spreadTooWide) {
    score = Math.min(score, 59);
    warnings.push(
      "Best bid/ask spread consumes " +
        executionCostR.toFixed(2) +
        "R before fees or funding; the " +
        spreadCostLimitR[style].toFixed(2) +
        "R style limit is exceeded.",
    );
  }
  if (targetAnalysis.structuralTargets < 3) {
    warnings.push(
      "Only " +
        targetAnalysis.structuralTargets +
        "/5 targets currently have direct structure, volume, Fibonacci or candle-pattern support; treat the outer volatility projections as runners, not promises.",
    );
  }
  const criticalBlocked =
    crowded ||
    regime === "VOLATILE" ||
    absoluteVolatilityHalt ||
    spreadTooWide ||
    liquidityTooLow ||
    participationTooLow ||
    alignmentTooWeak;
  const takeBlocked =
    criticalBlocked || regime === "RANGING" || !setupStructureReady;
  const decision: Decision =
    score >= setupThreshold && !takeBlocked
      ? "SETUP"
      : score >= 56 && !criticalBlocked
        ? "WATCH"
        : "NO TRADE";
  const direction: Direction = decision === "NO TRADE" ? "WAIT" : bias;
  const trigger = locationPlan.trigger;
  const planInvalidated = locationPlan.status === "INVALIDATED";
  const timing = {passed: locationPlan.timingReady, path: locationPlan.confirmationPath};
  const roundTripCostR = executionCostR + estimatedRoundTripCostR;
  const feesAffordable = roundTripCostR <= MAX_ROUND_TRIP_COST_R;
  const validatedTimeframe = executionIntervalMs === SIGNAL_INTERVAL_MS;
  const riskRewardReady = Boolean(
    feesAffordable &&
      structuralMap[0].available &&
      takeProfits[0].rewardR > roundTripCostR,
  );
  const entryChecks: EntryCheck[] = [
    { id: "history", label: "Verified history depth", status: sufficientHistory ? "PASS" : "FAIL", required: true, weight: 0, detail: sufficientHistory ? "All three frames have at least 30 closed candles; full available history is used." : "Insufficient real candle history. Fallback data cannot authorize an entry." },
    {
      id: "confluence",
      label: "TA confluence score",
      status:
        score >= setupThreshold
          ? "PASS"
          : score >= setupThreshold - 8
            ? "WAIT"
            : "FAIL",
      required: true,
      weight: 12,
      detail:
        Math.round(score) +
        "/100 versus the " +
        setupThreshold +
        "+ " +
        setupType.toLowerCase() +
        " threshold.",
    },
    {
      id: "structure",
      label: "Market structure",
      status: setupStructureReady
        ? "PASS"
        : structuralConfluence >= 2
          ? "WAIT"
          : "FAIL",
      required: true,
      weight: 18,
      detail: setupStructureReady
        ? setupType + " structure is confirmed on closed candles."
        : structuralConfluence >= 2
          ? "Structure is developing; wait for the setup-specific close."
          : "BOS/CHoCH, pullback or continuation evidence is incomplete.",
    },
    {
      id: "trend",
      label: "Multi-frame trend",
      status: alignmentTooWeak ? "FAIL" : trendFrames < signalTrendFrames ? "WAIT" : "PASS",
      required: true,
      weight: 14,
      detail:
        trendFrames +
        "/3 frames align (execution EMA21, context EMA50, macro EMA200); " +
        signalTrendFrames +
        " required for an entry signal" +
        (trendFrames < signalTrendFrames && !alignmentTooWeak ? ". Waiting for the remaining higher timeframe to agree; 2/3 trend signals underperformed full alignment in the 2-year backtest." : "."),
    },
    {
      id: "trigger",
      label: "Entry location & closed-candle trigger",
      status: planInvalidated || locationPlan.status === "BLOCKED" || locationPlan.status === "EXPIRED"
        ? "FAIL" : timing.passed ? "PASS" : "WAIT",
      required: true,
      weight: 16,
      detail: locationPlan.reason,
    },
    {
      id: "momentum",
      label: "Momentum confirmation",
      status: momentumAligned ? "PASS" : "WAIT",
      required: true,
      weight: 9,
      detail: momentumAligned
        ? "MACD impulse agrees with the trade side."
        : "Momentum has not yet rotated with the proposed side.",
    },
    {
      id: "candle-conviction",
      label: "Candle conviction (secondary)",
      status: (bias === "LONG" ? closeLocation >= 0.65 : closeLocation <= 0.35) ? "PASS" : "WAIT",
      required: false,
      weight: 4,
      detail: "Closed-candle finish " + (closeLocation * 100).toFixed(0) + "% up its range; borderline conviction requires a reduced-risk acknowledgement.",
    },
    {
      id: "regime",
      label: "Tradable regime",
      status:
        regime === "TRENDING" ? "PASS" : regime === "WEAK TREND" ? "WAIT" : "FAIL",
      required: true,
      weight: 11,
      detail:
        regime === "TRENDING"
          ? "ADX supports a directional trade."
          : regime === "WEAK TREND"
            ? "Weak trend (ADX 15-25): wait for ADX 25+. Weak-trend entries lost money in the Bybit backtest."
            : regime + " conditions block a medium-risk entry.",
    },
    {
      id: "participation",
      label: "Volume participation",
      status: participationTooLow ? "FAIL" : "PASS",
      required: true,
      weight: 9,
      detail:
        volumeRatio.toFixed(2) +
        "× volume versus a " +
        participationFloor.toFixed(2) +
        "× setup floor.",
    },
    {
      id: "execution",
      label: "Liquidity & spread",
      status: liquidityTooLow || spreadTooWide ? "FAIL" : "PASS",
      required: true,
      weight: 10,
      detail: liquidityTooLow
        ? "24-hour turnover is below the style floor."
        : spreadTooWide
          ? "Spread consumes too much of the planned stop risk."
          : executionCostR.toFixed(3) +
            "R spread cost is inside the " +
            spreadCostLimitR[style].toFixed(2) +
            "R limit.",
    },
    {
      id: "crowding",
      label: "Funding crowding",
      status: crowded ? "FAIL" : "PASS",
      required: true,
      weight: 6,
      detail: crowded
        ? "Funding is crowded against the proposed side."
        : "Funding filter is clear for this side.",
    },
    {
      id: "timeframe",
      label: "Validated signal timeframe",
      status: validatedTimeframe ? "PASS" : "WAIT",
      required: true,
      weight: 6,
      detail: validatedTimeframe
        ? "1H execution: the timeframe that stayed profitable after fees in the 2-year Bybit backtest."
        : "Analysis only. In the 2-year Bybit backtest 5m and 15m signals lost money after fees and 4H showed no edge; entry signals are issued on the 1H chart.",
    },
    {
      id: "key-levels",
      label: "Historic support & resistance",
      status: keyLevels.status,
      required: keyLevelMode === "FULL" || keyLevelMode === "GATE",
      weight: 0,
      detail: keyLevels.detail,
    },
    {
      id: "targets",
      label: "TA target & payoff map",
      status: riskRewardReady ? "PASS" : "WAIT",
      required: true,
      weight: 7,
      detail: !feesAffordable
        ? "Round-trip fees, slippage and spread cost " + roundTripCostR.toFixed(2) + "R of this stop (limit " + MAX_ROUND_TRIP_COST_R + "R). The stop is too tight for fees; skip it."
        : !structuralMap[0].available
          ? "No confirmed structural TP1 objective yet."
          : "Fees " + roundTripCostR.toFixed(2) + "R of risk; " + targetAnalysis.structuralTargets + "/5 structural objectives in range; " +
            netRewardR.toFixed(2) + "R weighted after costs (1R-5R scale-out). Funding excluded.",
    },
  ];
  const entryWeight = entryChecks.reduce((total, check) => total + check.weight, 0);
  const rawEntryQuality =
    entryChecks.reduce(
      (total, check) =>
        total +
        check.weight *
          (check.status === "PASS" ? 1 : check.status === "WAIT" ? 0.45 : 0),
      0,
    ) / Math.max(entryWeight, 1);
  const hasRequiredFailure = entryChecks.some(
    (check) => check.required && check.status === "FAIL",
  );
  const hasRequiredWait = entryChecks.some(
    (check) => check.required && check.status === "WAIT",
  );
  const entryQuality = Math.round(
    Math.min(
      rawEntryQuality * 100,
      hasRequiredFailure ? 59 : hasRequiredWait ? 79 : 100,
    ),
  );
  const entryGrade = gradeForScore(entryQuality);
  const requiredEntryChecksPassed = entryChecks.every(
    (check) => !check.required || check.status === "PASS",
  );
  const secondaryBorderline = entryChecks.filter((check) => !check.required && check.status === "WAIT");
  const baseEntryReady = decision === "SETUP" && requiredEntryChecksPassed;
  const qualityOverride: QualityOverride = {
    eligible: baseEntryReady && score >= setupThreshold + 6 && secondaryBorderline.length === 1,
    reason: secondaryBorderline.length === 1 ? secondaryBorderline[0].detail : "No borderline secondary check qualifies for an override.",
    riskCapPct: 0.5,
  };
  const entryReady = baseEntryReady && (secondaryBorderline.length === 0 || qualityOverride.eligible);
  const executionPlan: EntryExecutionPlan = locationPlan.status === "READY" && !entryReady
    ? {...locationPlan, status: "BLOCKED", headline: "WAIT · ENTRY CHECKS",
      reason: entryChecks.find(check => check.required && check.status !== "PASS")?.detail ?? "Setup score or candle conviction has not qualified. Do not enter yet."}
    : locationPlan;


  const immediateEntryPrice = executionPrice;
  const immediateMicroCandles = usable.slice(-10);
  const immediateRawStop = bias === "LONG"
    ? Math.min(stop, Math.min(...immediateMicroCandles.map(candle => candle.low)) - locationPlan.referenceAtr * 0.2)
    : Math.max(stop, Math.max(...immediateMicroCandles.map(candle => candle.high)) + locationPlan.referenceAtr * 0.2);
  const immediateRawStopDistance =
    bias === "LONG"
      ? immediateEntryPrice - immediateRawStop
      : immediateRawStop - immediateEntryPrice;
  // Never move a structural stop inward just to manufacture a better reward ratio.
  const immediateStopDistance = Math.max(immediateRawStopDistance, atrValue * 0.45);
  const immediateStop =
    bias === "LONG"
      ? Math.max(Number.EPSILON, immediateEntryPrice - immediateStopDistance)
      : immediateEntryPrice + immediateStopDistance;

  type ImmediateCandidate = {
    price: number;
    source: string;
    rationale: string;
    confidence: TakeProfitLevel["confidence"];
  };
  const immediateCandidates: ImmediateCandidate[] = [];
  const addImmediateCandidate = (candidate: ImmediateCandidate) => {
    const distance =
      bias === "LONG"
        ? candidate.price - immediateEntryPrice
        : immediateEntryPrice - candidate.price;
    if (distance < atrValue * 0.16 || distance > atrValue * 2.2) return;
    if (
      immediateCandidates.some(
        (existing) =>
          Math.abs(existing.price - candidate.price) < atrValue * 0.035,
      )
    ) {
      return;
    }
    immediateCandidates.push(candidate);
  };

  [6, 12, 20, 32, 48].forEach((window) => {
    const sample = usable.slice(-window);
    const price =
      bias === "LONG"
        ? Math.max(...sample.map((candle) => candle.high))
        : Math.min(...sample.map((candle) => candle.low));
    addImmediateCandidate({
      price,
      source: window + "-bar swing liquidity",
      rationale:
        "Nearest closed-candle " +
        (bias === "LONG" ? "high" : "low") +
        " likely to attract an intraday reaction.",
      confidence: window <= 20 ? "HIGH" : "MEDIUM",
    });
  });
  takeProfits.forEach((target) => {
    if (!target.available || target.source === "Adaptive volatility map") return;
    addImmediateCandidate({
      price: target.price,
      source: target.source,
      rationale: "A nearby objective inherited from the full technical target map.",
      confidence: target.confidence,
    });
  });
  addImmediateCandidate({
    price: bias === "LONG" ? resistance : support,
    source: "Range liquidity",
    rationale: "The nearest confirmed range boundary can produce a fast reaction.",
    confidence: "HIGH",
  });

  const immediateMultipliers = [0.28, 0.48, 0.72, 1.04, 1.42];
  const immediateExitWeights = [30, 25, 20, 15, 10];
  const usedImmediateCandidates = new Set<number>();
  let previousImmediateDistance = 0;
  const immediateTargets: ImmediateEntryTarget[] = immediateMultipliers.map(
    (multiplier, index) => {
      const desiredDistance = atrValue * multiplier;
      const minimumDistance = Math.max(
        previousImmediateDistance + atrValue * 0.12,
        desiredDistance * 0.68,
      );
      const maximumDistance = desiredDistance * 1.42;
      const available = immediateCandidates
        .map((candidate, candidateIndex) => ({
          ...candidate,
          candidateIndex,
          distance:
            bias === "LONG"
              ? candidate.price - immediateEntryPrice
              : immediateEntryPrice - candidate.price,
        }))
        .filter(
          (candidate) =>
            !usedImmediateCandidates.has(candidate.candidateIndex) &&
            candidate.distance >= minimumDistance &&
            candidate.distance <= maximumDistance,
        )
        .sort(
          (first, second) =>
            Math.abs(first.distance - desiredDistance) -
            Math.abs(second.distance - desiredDistance),
        );
      const chosen = available[0];
      if (chosen) usedImmediateCandidates.add(chosen.candidateIndex);
      const distance = Math.max(
        minimumDistance,
        chosen?.distance ?? desiredDistance,
      );
      previousImmediateDistance = distance;
      const price =
        bias === "LONG"
          ? immediateEntryPrice + distance
          : immediateEntryPrice - distance;
      return {
        available: Boolean(chosen) || index >= 3,
        confluenceCount: chosen ? 1 : 0,
        level: (index + 1) as 1 | 2 | 3 | 4 | 5,
        price,
        rewardR: chosen || index >= 3 ? distance / immediateStopDistance : 0,
        exitPct: immediateExitWeights[index],
        confidence: chosen?.confidence ?? "DEVELOPING",
        source: chosen?.source ?? (index < 3 ? "No confirmed close target" : "ATR micro projection"),
        sources: chosen ? [chosen.source] : [],
        rationale:
          chosen?.rationale ??
          "A volatility-normalized objective used only because no nearer closed-candle structure is available.",
        distancePct: (distance / immediateEntryPrice) * 100,
      };
    },
  );
  const immediateWeightedRewardR = immediateTargets.reduce(
    (total, target) => total + target.rewardR * (target.exitPct / 100),
    0,
  );
  const unfavorableZoneDistance =
    bias === "LONG"
      ? Math.max(0, immediateEntryPrice - Math.max(entryHigh, trigger))
      : Math.max(0, Math.min(entryLow, trigger) - immediateEntryPrice);
  const immediateDeviationAtr = unfavorableZoneDistance / atrValue;
  const immediateFirstTargetDistance = Math.abs(
    immediateTargets[0].price - immediateEntryPrice,
  );
  const immediateSpreadBurden =
    spreadAbsolute / Math.max(immediateFirstTargetDistance, Number.EPSILON);
  const takerFeePct = clampValue(options.takerFeePct ?? 0.055, 0, 0.3);
  const slippagePct = clampValue(options.slippagePct ?? 0.02, 0, 1);
  const estimatedCostPct = takerFeePct * 2 + slippagePct * 2 + spreadPct;
  const immediateCost = immediateEntryPrice * estimatedCostPct / 100;
  const immediateNetRewardR = immediateWeightedRewardR - immediateCost / immediateStopDistance;
  const immediateHardBlocked =
    !sufficientHistory || crowded ||
    regime === "VOLATILE" ||
    absoluteVolatilityHalt ||
    spreadTooWide ||
    liquidityTooLow ||
    !locationPlan.timingReady || !locationPlan.locationOkay ||
    planInvalidated || regime === "RANGING" || !momentumAligned || alignmentTooWeak ||
    participationTooLow || !setupStructureReady ||
    !immediateTargets.every((target) => target.available) ||
    immediateFirstTargetDistance <= immediateCost * 1.25 || immediateNetRewardR < 0.6;
  const immediateEvidence = [
    momentumAligned,
    trendFrames >= 1,
    setupStructureReady,
    structure.bos === sideStructure,
    structure.choch === sideStructure,
    structure.sweep === sideStructure,
    volumeRatio >= 0.65,
  ].filter(Boolean).length;
  const immediateScore = Math.round(
    clampValue(
      score * 0.42 +
        entryQuality * 0.31 +
        targetAnalysis.targetReliability * 0.17 +
        immediateEvidence * 2.2 -
        immediateDeviationAtr * 20 -
        Math.max(0, immediateSpreadBurden - 0.08) * 90,
      0,
      100,
    ),
  );
  const immediateStatus: ImmediateEntryStatus =
    immediateHardBlocked ||
    immediateDeviationAtr > 1.05 ||
    immediateSpreadBurden > 0.24 ||
    immediateScore < 52
      ? "AVOID"
      : decision === "SETUP" &&
          immediateScore >= 68 &&
          immediateDeviationAtr <= 0.55 &&
          immediateEvidence >= 4 &&
          volumeRatio >= 0.65
        ? "ALLOW"
        : "CAUTION";
  const immediateReasoning = [
    immediateDeviationAtr <= 0.2
      ? "Live price is still close to the preferred execution area; chase risk is limited."
      : immediateDeviationAtr <= 0.55
        ? "Live price is outside the preferred band but remains within 0.55 ATR of confirmation."
        : "Live price has moved " +
          immediateDeviationAtr.toFixed(2) +
          " ATR beyond the preferred confirmation area.",
    momentumAligned
      ? "MACD momentum still agrees with the " + bias.toLowerCase() + " side."
      : "Momentum has not fully rotated with the proposed side, so the plan is downgraded.",
    immediateEvidence +
      "/7 immediate structure, trend, sweep, momentum and participation signals agree.",
    "Confirmed close objectives use nearby swing liquidity or the full TA map; unconfirmed inner slots block entry. TP1 distance is " +
      immediateTargets[0].distancePct.toFixed(2) +
      "% from the live entry.",
    "Current spread consumes " +
      (immediateSpreadBurden * 100).toFixed(1) +
      "% of the distance to TP1 before fees and funding.",
  ];
  const immediateWarnings = [
    "This is a reduced-risk market-entry scenario, not a substitute for the preferred pullback or retest.",
    immediateStatus === "CAUTION"
      ? "Use at most 0.25% account stop-risk and do not add before price proves the direction."
      : immediateStatus === "ALLOW"
        ? "Use at most 0.45% account stop-risk; structural stops can still be hit by normal noise."
        : "Do not open the current-price plan while its execution gate is blocked.",
    !locationPlan.timingReady ? locationPlan.reason
      : !sufficientHistory ? "Insufficient verified history."
      : !immediateTargets.every(target => target.available) ? "Nearby structure does not support all three inner targets."
      : immediateFirstTargetDistance <= immediateCost * 1.25 ? "TP1 does not clear estimated round-trip costs with the required buffer."
      : immediateNetRewardR < 0.6 ? "Weighted payoff after estimated fees, spread and slippage is below 0.60R."
      : crowded ? "Funding crowding rejects this side."
      : regime === "VOLATILE" || absoluteVolatilityHalt ? "Volatility exceeds the permitted range."
      : liquidityTooLow || spreadTooWide ? "Liquidity or spread fails the execution check."
      : planInvalidated ? "Price has invalidated the underlying setup."
      : regime === "RANGING" || !momentumAligned || alignmentTooWeak || !setupStructureReady ? "Trend, momentum or market structure is not confirmed."
      : participationTooLow ? "Volume participation is too low."
      : immediateDeviationAtr > 1.05 ? "Price is too far beyond confirmation; do not chase."
      : immediateSpreadBurden > 0.24 ? "Spread consumes too much of the first target."
      : immediateScore < 52 ? "Current-entry evidence is below the minimum score."
      : "Estimated costs are included; fees, slippage and funding can still change.",
  ];
  const immediateEntry: ImmediateEntryPlan = {
    status: immediateStatus,
    score: immediateScore,
    entry: immediateEntryPrice,
    stop: immediateStop,
    targets: immediateTargets,
    weightedRewardR: immediateWeightedRewardR,
    netRewardR: immediateNetRewardR,
    estimatedCostPct,
    stopSource: "Outside both the retest zone and 10 closed-candle swing + normal-range buffer; never clipped inward",
    deviationAtr: immediateDeviationAtr,
    maxRiskPct:
      immediateStatus === "ALLOW" ? 0.45 : immediateStatus === "CAUTION" ? 0.25 : 0,
    leverageMultiplier:
      immediateStatus === "ALLOW" ? 0.7 : immediateStatus === "CAUTION" ? 0.45 : 0,
    reasoning: immediateReasoning,
    warnings: immediateWarnings,
    invalidationText:
      "Exit if price reaches " +
      formatPrice(immediateStop) +
      " or the directional structure flips before TP1. A stale quote suspends advice; verify directly on Bybit. Never widen this stop.",
  };
  const scalpStatus: MarketAnalysis["scalpPlan"]["status"] =
    decision === "NO TRADE"
      ? "STAND ASIDE"
      : entryReady
        ? "ENTER"
        : "WAIT FOR TRIGGER";
  const triggerText = executionPlan.reason;
  const cancelText = executionPlan.cancelText;
  const riskMultiplier = clampValue(
    (regime === "WEAK TREND" ? 0.65 : 1) *
      (setupType === "CHoCH REVERSAL"
        ? 0.7
        : setupType === "PULLBACK"
          ? 0.9
          : 1) *
      (intraday && !session.active ? 0.75 : 1) *
      (qualityOverride.eligible ? 0.5 : 1),
    0.25,
    1,
  );
  const reasons = [
    setupType +
      " setup: " +
      String(trendFrames) +
      "/3 timeframes currently align with the " +
      bias.toLowerCase() +
      " bias.",
    regimeAdx >= 25
      ? "ADX confirms a directional regime."
      : regimeAdx >= 15
        ? "Trend strength is developing, so size is reduced."
        : "Trend strength is not yet sufficient.",
    (bias === "LONG" ? macdValue > 0 : macdValue < 0)
      ? "MACD momentum agrees with the directional bias."
      : "MACD momentum has not confirmed the bias.",
    structure.choch !== "NONE"
      ? "A " + structure.choch.toLowerCase() + " CHoCH is active near " +
        formatPrice(structure.chochLevel ?? current.close) + "."
      : structure.pullback
        ? "Price is testing the " +
          structure.pullback.reference +
          " pullback zone; confirmation is " +
          structure.pullback.state.toLowerCase() +
          "."
        : structure.bos !== "NONE"
          ? "A " + structure.bos.toLowerCase() + " break of structure is present."
          : structure.sweep !== "NONE"
            ? "A " + structure.sweep.toLowerCase() + " liquidity sweep is present."
            : "Price remains inside the latest confirmed structure range.",
    volumeRatio >= 1.2
      ? "Volume expansion supports follow-through."
      : setupType === "PULLBACK" && volumeRatio >= participationFloor
        ? "Pullback volume is controlled and remains above its setup floor."
        : "Volume confirmation is incomplete.",
    spreadTooWide
      ? "Execution friction is too large for this stop distance."
      : "Spread cost is contained at " +
        executionCostR.toFixed(2) +
        "R versus the " +
        spreadCostLimitR[style].toFixed(2) +
        "R style limit.",
    "The five-level target map is " +
      targetAnalysis.targetReliability +
      "/100 reliability with " +
      targetAnalysis.structuralTargets +
      "/5 objectives supported by market structure, volume, Fibonacci or candle-pattern evidence.",
    targetAnalysis.candlestickPattern.startsWith("No fresh")
      ? "No fresh directional candlestick projection is active; target selection relies on the remaining technical confluences."
      : targetAnalysis.candlestickPattern +
        " supplies an active measured target projection.",
  ];

  return {
    flexibility,
    executionPlan,
    confirmationPath: timing.path,
    qualityOverride,
    direction,
    bias,
    decision,
    setupType,
    entryReady,
    entryQuality,
    entryGrade,
    entryChecks,
    score: Math.round(score),
    regime,
    session: session.name,
    isKillzone: session.active,
    entry,
    stop,
    tp1,
    tp2,
    tp3,
    tp4,
    tp5,
    takeProfits,
    targetStyle,
    rr: weightedRewardR,
    support,
    resistance,
    riskMultiplier,
    immediateEntry,
    scalpPlan: {
      status: scalpStatus,
      entryLow,
      entryHigh,
      trigger,
      triggerText,
      cancelText,
      ttlCandles: 2,
      exitPlan: [
        ...takeProfits.map(
          (target) =>
            "TP" +
            target.level +
            " · " +
            target.exitPct +
            "% at " +
            target.source +
            " (" +
            target.confidence.toLowerCase() +
            " confidence).",
        ),
        "After taking a partial, tighten only when a later confirmed structure supports the new stop; never widen existing risk.",
      ],
    },
    metrics: {
      rsi: rsiValue,
      adx: regimeAdx,
      atr: atrValue,
      atrPct,
      macdHistogram: macdValue,
      stochastic: stochasticValue,
      volumeRatio,
      fundingRate,
      trendFrames,
      spreadPct,
      executionCostR,
      weightedRewardR,
      netRewardR,
      breakEvenWinRatePct,
      setupThreshold,
      spreadCostLimitR: spreadCostLimitR[style],
      participationFloor,
      targetReliability: targetAnalysis.targetReliability,
      structuralTargets: targetAnalysis.structuralTargets,
      candlestickPattern: targetAnalysis.candlestickPattern,
      turnover24h,
      liquidityFloor: STYLE_LIQUIDITY_FLOOR[style],
      confirmedCandleTime: current.time,
      executionCandles: usable.length,
      contextCandles: contextUsable.length,
      macroCandles: macroUsable.length,
    },
    keyLevels,
    structure,
    reasons,
    warnings,
  };
}

/**
 * BTC's daily trend from closed daily candles: close above the 200-day EMA is
 * BULL. In the 2-year Bybit backtest, 1H signals that traded with this trend
 * averaged +0.31R against +0.22R for signals against it, in both years.
 */
export function btcDailyTrend(btcDaily: Candle[] | undefined): BtcRelationship["btcDailyTrend"] {
  if (!btcDaily || btcDaily.length < 60) return "UNKNOWN";
  const closes = btcDaily.slice(0, -1).map((candle) => candle.close);
  const last = closes[closes.length - 1];
  const trend = lastValue(ema(closes, Math.min(200, closes.length)), last);
  return last > trend ? "BULL" : "BEAR";
}

export function analyzeBtcRelationship(
  symbol: string,
  pairCandles: Candle[],
  btcCandles: Candle[],
  analysis: MarketAnalysis,
  btcDaily?: Candle[],
): BtcRelationship {
  const core = analyzeBtcRelationshipCore(symbol, pairCandles, btcCandles, analysis);
  const trend = btcDailyTrend(btcDaily);
  const trendAligned = trend === "UNKNOWN" ? true : (analysis.bias === "LONG") === (trend === "BULL");
  return { ...core, btcDailyTrend: trend, trendAligned };
}

function analyzeBtcRelationshipCore(
  symbol: string,
  pairCandles: Candle[],
  btcCandles: Candle[],
  analysis: MarketAnalysis,
): Omit<BtcRelationship, "btcDailyTrend" | "trendAligned"> {
  const pairClosed = pairCandles.length > 1 ? pairCandles.slice(0, -1) : pairCandles;
  const btcClosed = btcCandles.length > 1 ? btcCandles.slice(0, -1) : btcCandles;
  const rollingLimit = 120;

  if (symbol === "BTCUSDT") {
    const points = pairClosed.slice(-(rollingLimit + 1));
    const recentBars = Math.min(12, Math.max(0, points.length - 1));
    const first = points[Math.max(0, points.length - 1 - recentBars)]?.close ?? 0;
    const last = points[points.length - 1]?.close ?? first;
    const move = first > 0 ? (last / first - 1) * 100 : 0;
    return {
      historyBars: Math.max(0, points.length - 1),
      correlation: 1,
      beta: 1,
      relationship: "SELF",
      divergence: "NONE",
      divergenceVerdict: "NO DIVERGENCE",
      pairReturnPct: move,
      btcReturnPct: move,
      relativeStrengthPct: 0,
      residualZScore: 0,
      explanation:
        "BTC is the benchmark itself; use its own structure, regime and liquidity rather than a divergence test.",
    };
  }

  const btcByTime = new Map(btcClosed.map((candle) => [candle.time, candle]));
  const aligned = pairClosed
    .map((pair) => {
      const btc = btcByTime.get(pair.time);
      return btc ? { pair, btc } : null;
    })
    .filter(
      (point): point is { pair: Candle; btc: Candle } => Boolean(point),
    ).slice(-(rollingLimit + 1));

  const pairReturns: number[] = [];
  const btcReturns: number[] = [];
  for (let index = 1; index < aligned.length; index += 1) {
    const pairPrevious = aligned[index - 1].pair.close;
    const btcPrevious = aligned[index - 1].btc.close;
    const pairCurrent = aligned[index].pair.close;
    const btcCurrent = aligned[index].btc.close;
    if (
      pairPrevious <= 0 ||
      btcPrevious <= 0 ||
      pairCurrent <= 0 ||
      btcCurrent <= 0
    ) {
      continue;
    }
    pairReturns.push(Math.log(pairCurrent / pairPrevious));
    btcReturns.push(Math.log(btcCurrent / btcPrevious));
  }

  if (pairReturns.length < 24 || pairReturns.length !== btcReturns.length) {
    return {
      historyBars: pairReturns.length,
      correlation: null,
      beta: null,
      relationship: "INSUFFICIENT DATA",
      divergence: "NONE",
      divergenceVerdict: "CAUTION",
      pairReturnPct: 0,
      btcReturnPct: 0,
      relativeStrengthPct: 0,
      residualZScore: 0,
      explanation:
        "Fewer than 24 aligned closed bars are available. Treat any apparent BTC divergence as unverified.",
    };
  }

  const pairMean = average(pairReturns);
  const btcMean = average(btcReturns);
  let covariance = 0;
  let pairVariance = 0;
  let btcVariance = 0;
  for (let index = 0; index < pairReturns.length; index += 1) {
    const pairDelta = pairReturns[index] - pairMean;
    const btcDelta = btcReturns[index] - btcMean;
    covariance += pairDelta * btcDelta;
    pairVariance += pairDelta * pairDelta;
    btcVariance += btcDelta * btcDelta;
  }
  const correlation = clampValue(
    covariance /
      Math.max(Math.sqrt(pairVariance * btcVariance), Number.EPSILON),
    -1,
    1,
  );
  const beta = clampValue(
    covariance / Math.max(btcVariance, Number.EPSILON),
    -5,
    5,
  );
  const recentBars = Math.min(12, pairReturns.length);
  const startPoint = aligned[Math.max(0, aligned.length - 1 - recentBars)];
  const endPoint = aligned[aligned.length - 1];
  const pairReturnPct =
    startPoint.pair.close > 0
      ? (endPoint.pair.close / startPoint.pair.close - 1) * 100
      : 0;
  const btcReturnPct =
    startPoint.btc.close > 0
      ? (endPoint.btc.close / startPoint.btc.close - 1) * 100
      : 0;
  const relativeStrengthPct = pairReturnPct - beta * btcReturnPct;
  const residuals = pairReturns.map(
    (value, index) => value - (pairMean + beta * (btcReturns[index] - btcMean)),
  );
  const residualMean = average(residuals);
  const residualDeviation = Math.sqrt(
    average(residuals.map((value) => (value - residualMean) ** 2)),
  );
  const recentResidual = residuals
    .slice(-recentBars)
    .reduce((total, value) => total + value - residualMean, 0);
  const residualZScore =
    residualDeviation > 0
      ? recentResidual / (residualDeviation * Math.sqrt(recentBars))
      : 0;
  const materialThreshold = Math.max(0.5, analysis.metrics.atrPct * 0.65);
  const divergence: BtcRelationship["divergence"] =
    Math.abs(relativeStrengthPct) >= materialThreshold &&
    Math.abs(residualZScore) >= 1.15
      ? relativeStrengthPct > 0
        ? "BULLISH"
        : "BEARISH"
      : "NONE";
  const relationship: BtcRelationship["relationship"] =
    correlation >= 0.75
      ? "TIGHT BTC LINK"
      : correlation >= 0.45
        ? "BTC-SENSITIVE"
        : correlation >= 0.2
          ? "LOOSE LINK"
          : correlation <= -0.3
            ? "INVERSE"
            : "INDEPENDENT";

  if (divergence === "NONE") {
    return {
      historyBars: pairReturns.length,
      correlation,
      beta,
      relationship,
      divergence,
      divergenceVerdict: "NO DIVERGENCE",
      pairReturnPct,
      btcReturnPct,
      relativeStrengthPct,
      residualZScore,
      explanation:
        "No material beta-adjusted divergence is present. BTC context supports the read only when the pair's own closed-candle setup also passes.",
    };
  }

  const divergenceBias: Bias = divergence === "BULLISH" ? "LONG" : "SHORT";
  const sideStructure = divergenceBias === "LONG" ? "BULLISH" : "BEARISH";
  const structureMatches = Boolean(
    analysis.structure.bos === sideStructure ||
      analysis.structure.choch === sideStructure ||
      analysis.structure.sweep === sideStructure ||
      (analysis.structure.pullback?.side === divergenceBias &&
        analysis.structure.pullback.state === "CONFIRMED") ||
      analysis.structure.fvg?.side === divergenceBias ||
      analysis.structure.orderBlock?.side === divergenceBias,
  );
  const sideMatchesPlan = divergenceBias === analysis.bias;
  const participationConfirms =
    analysis.metrics.volumeRatio >= Math.max(0.9, analysis.metrics.participationFloor);
  const highlyCoupled = correlation >= 0.65;
  const independentlyMoving = Math.abs(correlation) < 0.35 || correlation < 0;
  let divergenceVerdict: BtcRelationship["divergenceVerdict"] = "CAUTION";

  if (!sideMatchesPlan) {
    divergenceVerdict = "REJECT";
  } else if (
    structureMatches &&
    participationConfirms &&
    (independentlyMoving || analysis.entryReady || !highlyCoupled)
  ) {
    divergenceVerdict = "ACCEPT";
  } else if (highlyCoupled && (!structureMatches || !participationConfirms)) {
    divergenceVerdict = "REJECT";
  }

  const evidenceText =
    divergenceVerdict === "ACCEPT"
      ? "Acceptable because pair-side structure and participation confirm the move."
      : divergenceVerdict === "REJECT"
        ? "Do not accept it: the move conflicts with the planned side or lacks structure/participation confirmation."
        : "Treat it cautiously until pair-side structure and participation confirm.";

  return {
    historyBars: pairReturns.length,
    correlation,
    beta,
    relationship,
    divergence,
    divergenceVerdict,
    pairReturnPct,
    btcReturnPct,
    relativeStrengthPct,
    residualZScore,
    explanation: evidenceText,
  };
}

export function scannerRowFromAnalysis(
  ticker: MarketTicker,
  analysis: MarketAnalysis,
  demo = false,
  instrument?: MarketInstrument,
  style: TradingStyle = "DAY",
  btcRelationship?: BtcRelationship,
): ScannerRow {
  const btc =
    btcRelationship ??
    ({
      historyBars: 0,
      correlation: null,
      beta: null,
      relationship: "INSUFFICIENT DATA",
      divergence: "NONE",
      divergenceVerdict: "CAUTION",
      pairReturnPct: 0,
      btcReturnPct: 0,
      relativeStrengthPct: 0,
      residualZScore: 0,
      btcDailyTrend: "UNKNOWN",
      trendAligned: true,
      explanation:
        "BTC relationship is unavailable; do not use BTC divergence as confirmation.",
    } satisfies BtcRelationship);
  const rewardScore = clampValue((analysis.metrics.netRewardR / 3.5) * 100, 0, 100);
  const executionScore = clampValue(
    100 -
      (analysis.metrics.executionCostR /
        Math.max(analysis.metrics.spreadCostLimitR, 0.01)) *
        55,
    0,
    100,
  );
  const decisionScore =
    analysis.decision === "SETUP"
      ? analysis.entryReady
        ? 100
        : 78
      : analysis.decision === "WATCH"
        ? 60
        : 32;
  const btcScore =
    btc.divergenceVerdict === "ACCEPT"
      ? 100
      : btc.divergenceVerdict === "NO DIVERGENCE"
        ? 86
        : btc.divergenceVerdict === "CAUTION"
          ? 62
          : 24;
  const ratingScore = Math.round(
    clampValue(
      analysis.score * 0.28 +
        analysis.entryQuality * 0.24 +
        analysis.metrics.targetReliability * 0.15 +
        rewardScore * 0.12 +
        executionScore * 0.08 +
        decisionScore * 0.08 +
        btcScore * 0.05,
      0,
      100,
    ),
  );
  const ratingGrade = gradeForScore(ratingScore);
  const ratingLabel =
    ratingGrade === "A+"
      ? "ELITE"
      : ratingGrade === "A"
        ? "HIGH QUALITY"
        : ratingGrade === "B+"
          ? "STRONG WATCH"
          : ratingGrade === "B"
            ? "WATCH"
            : ratingGrade === "C"
              ? "DEVELOPING"
              : "PASS";
  const failedCheck = analysis.entryChecks.find(
    (check) => check.required && check.status === "FAIL",
  );
  const waitingCheck = analysis.entryChecks.find(
    (check) => check.required && check.status === "WAIT",
  );
  const riskBand = relativeRiskBand({
    entryReady: analysis.entryReady, rating: ratingScore,
    entryQuality: analysis.entryQuality, regime: analysis.regime,
    targetReliability: analysis.metrics.targetReliability,
    btcVerdict: btc.divergenceVerdict, requiredFailure: Boolean(failedCheck),
    override: analysis.qualityOverride.eligible,
  });
  const riskReason =
    riskBand === "LOW"
      ? "All required entry checks pass with A-grade evidence and controlled execution."
      : riskBand === "MEDIUM"
        ? waitingCheck
          ? waitingCheck.label + " is still pending; use reduced size or wait."
          : "Evidence is tradeable but not strong enough for the relative low-risk tier."
        : failedCheck
          ? failedCheck.label + " failed: " + failedCheck.detail
          : btc.divergenceVerdict === "REJECT"
            ? "BTC divergence conflicts with the pair's confirmed technical structure."
            : "Low rating or unstable conditions make this a speculative/high-risk market.";
  const blockingCheck = analysis.entryChecks.find(
    (check) => check.required && check.status !== "PASS",
  );
  return {
    flexibility: analysis.flexibility,
    executionPlan: analysis.executionPlan,
    entryChecks: analysis.entryChecks,
    qualityOverride: analysis.qualityOverride,
    analyzedAt: Date.now(),
    symbol: ticker.symbol,
    style,
    price: ticker.lastPrice,
    change: ticker.price24hPcnt * 100,
    turnover: ticker.turnover24h,
    fundingRate: ticker.fundingRate,
    openInterestValue: ticker.openInterestValue,
    volume24h: ticker.volume24h,
    score: analysis.score,
    direction: analysis.direction,
    bias: analysis.bias,
    decision: analysis.decision,
    setupType: analysis.setupType,
    regime: analysis.regime,
    rr: analysis.rr,
    entry: analysis.entry,
    stop: analysis.stop,
    tp1: analysis.tp1,
    tp2: analysis.tp2,
    tp3: analysis.tp3,
    tp4: analysis.tp4,
    tp5: analysis.tp5,
    takeProfits: analysis.takeProfits,
    targetStyle: analysis.targetStyle,
    riskMultiplier: analysis.riskMultiplier,
    trendFrames: analysis.metrics.trendFrames,
    atrPct: analysis.metrics.atrPct,
    adx: analysis.metrics.adx,
    exchangeMaxLeverage: instrument?.maxLeverage,
    minOrderQty: instrument?.minOrderQty,
    quantityStep: instrument?.quantityStep,
    minNotionalValue: instrument?.minNotionalValue,
    spreadPct: analysis.metrics.spreadPct,
    executionCostR: analysis.metrics.executionCostR,
    spreadCostLimitR: analysis.metrics.spreadCostLimitR,
    setupThreshold: analysis.metrics.setupThreshold,
    netRewardR: analysis.metrics.netRewardR,
    breakEvenWinRatePct: analysis.metrics.breakEvenWinRatePct,
    targetReliability: analysis.metrics.targetReliability,
    structuralTargets: analysis.metrics.structuralTargets,
    entryReady: analysis.entryReady,
    entryQuality: analysis.entryQuality,
    entryGrade: analysis.entryGrade,
    ratingScore,
    ratingGrade,
    ratingLabel,
    riskBand,
    riskReason,
    btcRelationship: btc,
    keyLevels: analysis.keyLevels,
    reason: analysis.reasons[0],
    gateReason: analysis.executionPlan.status !== "READY" ? analysis.executionPlan.reason :
      analysis.decision === "SETUP" && analysis.entryReady
        ? analysis.setupType +
          " passed all required TA, execution and target-map checks."
        : blockingCheck
          ? blockingCheck.label + ": " + blockingCheck.detail
        : analysis.warnings[0] ??
          "The " +
            analysis.setupType.toLowerCase() +
            " score has not reached its " +
            analysis.metrics.setupThreshold +
            "-point entry threshold.",
    demo,
  };
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function symbolSeed(symbol: string) {
  return symbol.split("").reduce((total, char) => total + char.charCodeAt(0) * 17, 91);
}

export function generateDemoCandles(symbol: string, interval: string, count = 260) {
  const reference: Record<string, number> = {
    BTCUSDT: 100_000,
    ETHUSDT: 3_800,
    SOLUSDT: 210,
    XRPUSDT: 2.4,
    DOGEUSDT: 0.25,
    BNBUSDT: 780,
    ADAUSDT: 0.85,
    LINKUSDT: 24,
  };
  const random = seededRandom(symbolSeed(symbol) + (INTERVAL_MS[interval] ?? 900_000));
  const stepMs = INTERVAL_MS[interval] ?? 900_000;
  let close = reference[symbol] ?? Math.max(0.08, 20 + (symbolSeed(symbol) % 800));
  const start = Date.now() - stepMs * count;
  const candles: Candle[] = [];

  for (let index = 0; index < count; index += 1) {
    const cycle = Math.sin(index / 14) * 0.0022;
    const drift = ((symbolSeed(symbol) % 9) - 4) * 0.000045;
    const move = (random() - 0.48) * 0.006 + cycle + drift;
    const open = close;
    close = Math.max(open * 0.2, open * (1 + move));
    const wick = (0.001 + random() * 0.0035) * open;
    candles.push({
      time: start + index * stepMs,
      open,
      close,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick * (0.7 + random() * 0.6),
      volume: 800 + random() * 1700 + (index % 19 === 0 ? 1200 : 0),
    });
  }
  return candles;
}

export function makeDemoScannerRows() {
  const symbols = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "BNBUSDT",
    "DOGEUSDT",
    "ADAUSDT",
    "LINKUSDT",
  ];
  const btcHistory = generateDemoCandles("BTCUSDT", "15", 200);
  return symbols
    .map((symbol, index) => {
      const current = symbol === "BTCUSDT"
        ? btcHistory
        : generateDemoCandles(symbol, "15", 200);
      const higher = generateDemoCandles(symbol, "240", 240);
      const price = current[current.length - 1].close;
      const ticker: MarketTicker = {
        symbol,
        lastPrice: price,
        markPrice: price,
        indexPrice: price,
        price24hPcnt: (index % 2 ? -1 : 1) * (0.004 + index * 0.0018),
        turnover24h: 2_000_000_000 / (index + 1),
        volume24h: 0,
        fundingRate: (index % 3 - 1) * 0.00007,
        bid1Price: price * 0.9999,
        ask1Price: price * 1.0001,
        openInterestValue: 0,
      };
      const analysis = analyzeMarket(current, higher, higher, ticker, "DAY");
      return scannerRowFromAnalysis(
        ticker,
        analysis,
        true,
        undefined,
        "DAY",
        analyzeBtcRelationship(symbol, current, btcHistory, analysis),
      );
    })
    .sort((first, second) => second.ratingScore - first.ratingScore);
}

export function formatPrice(value: number) {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const digits = absolute >= 1_000 ? 2 : absolute >= 1 ? 4 : absolute >= 0.01 ? 5 : 7;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function compactNumber(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function utcTime(time: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(new Date(time));
}
