"use client";

import { useAccountSync } from "@/app/components/use-account-sync";
import { acceptQuote, quoteIsFresh } from "@/app/lib/quote-safety";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Plus,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { entryExecutionBlocker } from "@/app/lib/entry-execution";
import { EntryInstructions } from "@/app/components/entry-instructions";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Bias,
  ImmediateEntryStatus,
  MarketAnalysis,
  MarketInstrument,
  TradingStyle,
} from "@/app/lib/market";
import {
  fetchTicker,
  formatPrice,
} from "@/app/lib/market";
import {
  ADAPTIVE_STYLE_MAX_LEVERAGE,
  buildAdaptiveLeveragePlan,
} from "@/app/lib/leverage";
import {
  PRICE_STALE_AFTER_MS,
  TRADE_STORAGE_KEY,
  TrackedTrade,
  TradeMode,
  applyPartialExit,
  closeTrackedTrade,
  createTrackedTrade,
  evaluateTrade,
  getPortfolioGuard,
  parseStoredTrades,
} from "@/app/lib/trade-manager";
import { MEDIUM_RISK_MAX_OPEN_RISK_PCT } from "@/app/lib/recommendations";
import { LiveValue } from "@/app/components/live-value";

type TradePrice = {
  price: number;
  markPrice: number;
  updatedAt: number;
};

type TradeManagerProps = {
  analysis: MarketAnalysis;
  symbol: string;
  style: TradingStyle;
  intervalLabel: string;
  currentPrice: number;
  markPrice: number;
  currentPriceUpdatedAt: number | null;
  dataMode: "LIVE" | "DEMO";
  feedLive: boolean;
  accountEquity: number;
  instrument?: MarketInstrument | null;
  onOpenChart: (symbol: string) => void;
  recommendedSymbol?: string;
  recommendedSide?: Bias;
  onOpenRecommendation?: () => void;
  entryMode?: "PREFERRED" | "MARKET";
  currentEntryStatus?: ImmediateEntryStatus;
  btcVerdict?: "NO DIVERGENCE" | "ACCEPT" | "CAUTION" | "REJECT";
  tradeRequest?: {id: number; mode: "PAPER" | "MANUAL_LIVE"};
};

type ManualForm = {
  mode: TradeMode;
  symbol: string;
  side: Bias;
  style: TradingStyle;
  openedAt: string;
  entry: string;
  quantity: string;
  leverage: string;
  stop: string;
  tp1: string;
  tp2: string;
  tp3: string;
  tp4: string;
  tp5: string;
  liquidation: string;
};

function localDatetimeValue(timestamp = Date.now()) {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

const severityTone = {
  neutral: "border-slate-500/20 bg-slate-500/[0.06] text-slate-300",
  positive: "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-300",
  warning: "border-amber-300/20 bg-amber-300/[0.07] text-amber-300",
  critical: "border-rose-300/25 bg-rose-300/[0.08] text-rose-300",
};

function field(
  label: string,
  value: string,
  onChange: (value: string) => void,
  options?: { step?: string; min?: string; placeholder?: string },
) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <Input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        step={options?.step ?? "any"}
        min={options?.min ?? "0"}
        placeholder={options?.placeholder}
        className="mt-1.5 h-9 border-border bg-[#0b111a] font-mono text-sm text-white"
      />
    </label>
  );
}

function formatAge(minutes: number) {
  if (minutes < 60) return Math.round(minutes) + "m";
  if (minutes < 1_440) return (minutes / 60).toFixed(1) + "h";
  return (minutes / 1_440).toFixed(1) + "d";
}

export function TradeManager({
  analysis,
  symbol,
  style,
  intervalLabel,
  currentPrice,
  markPrice,
  currentPriceUpdatedAt,
  dataMode,
  feedLive,
  accountEquity,
  instrument,
  onOpenChart,
  recommendedSymbol,
  recommendedSide,
  onOpenRecommendation,
  entryMode = "PREFERRED",
  currentEntryStatus,
  btcVerdict = "CAUTION",
  tradeRequest,
}: TradeManagerProps) {
  const marketEntryMode = entryMode === "MARKET";
  const effectiveCurrentStatus =
    currentEntryStatus ?? analysis.immediateEntry.status;
  const planEntry = marketEntryMode
    ? analysis.immediateEntry.entry
    : analysis.entry;
  const planStop = marketEntryMode
    ? analysis.immediateEntry.stop
    : analysis.stop;
  const planTargets = marketEntryMode
    ? analysis.immediateEntry.targets
    : analysis.takeProfits;
  const [trades, setTrades] = useState<TrackedTrade[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [prices, setPrices] = useState<Record<string, TradePrice>>({});
  const [manualOpen, setManualOpen] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [paperOpen, setPaperOpen] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState<string | null>(null);
  const acknowledgedKey = [symbol, style, entryMode, analysis.flexibility, btcVerdict, analysis.qualityOverride.eligible, effectiveCurrentStatus].join(":");
  const needsAcknowledgement = btcVerdict === "CAUTION" || analysis.qualityOverride.eligible || (marketEntryMode && effectiveCurrentStatus === "CAUTION");
  const requestHandled = useRef(0);
  const [manual, setManual] = useState<ManualForm>(() => ({
    mode: "MANUAL_LIVE",
    symbol,
    side: analysis.bias,
    style,
    openedAt: localDatetimeValue(),
    entry: String(currentPrice || planEntry),
    quantity: "",
    leverage: "1",
    stop: String(planStop),
    tp1: String(planTargets[0].price),
    tp2: String(planTargets[1].price),
    tp3: String(planTargets[2].price),
    tp4: String(planTargets[3].price),
    tp5: String(planTargets[4].price),
    liquidation: "",
  }));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setTrades(parseStoredTrades(window.localStorage.getItem(TRADE_STORAGE_KEY))); }
      catch { setManualError("Device storage is unavailable. Trade records may not survive a reload."); }
      finally { setStorageReady(true); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const applyCloudTrades = useCallback((items: {key:string;value:unknown}[]) => {
    const incoming = parseStoredTrades(JSON.stringify(items.map(item=>item.value)));
    setTrades(current => {
      const merged = new Map(current.map(trade=>[trade.id,trade]));
      for (const trade of incoming) merged.set(trade.id,trade);
      return [...merged.values()].sort((a,b)=>b.openedAt-a.openedAt);
    });
  }, []);
  const tradeSync = useAccountSync("trade", trades.map(trade=>({key:"trade/"+trade.id,value:trade})), applyCloudTrades, storageReady);

  useEffect(() => {
    if (!storageReady) return;
    try { window.localStorage.setItem(TRADE_STORAGE_KEY, JSON.stringify(trades)); }
    catch { window.setTimeout(() => setManualError("Trade records could not be saved on this device. Do not rely on persistence."), 0); }
  }, [storageReady, trades]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const openSymbols = useMemo(
    () =>
      Array.from(
        new Set(
          trades
            .filter((trade) => trade.status === "OPEN")
            .map((trade) => trade.symbol),
        ),
      ).sort(),
    [trades],
  );
  const openSymbolsKey = openSymbols.join(",");

  useEffect(() => {
    if (!openSymbolsKey) return;
    const trackedSymbols = openSymbolsKey.split(",");
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeat: number | null = null;
    let stopped = false;
    let attempts = 0;

    let refreshing = false;
    async function refreshPrices() {
      if (refreshing) return;
      refreshing = true;
      const results = await Promise.allSettled(
        trackedSymbols.map((trackedSymbol) => fetchTicker(trackedSymbol)),
      );
      refreshing = false;
      if (stopped) return;
      setPrices((previous) => {
        const next = { ...previous };
        results.forEach((result, index) => {
          if (result.status !== "fulfilled" || !acceptQuote(next[trackedSymbols[index]]?.updatedAt, result.value.updatedAt ?? 0, result.value.lastPrice)) return;
          next[trackedSymbols[index]] = {
            price: result.value.lastPrice,
            markPrice: result.value.markPrice || result.value.lastPrice,
            updatedAt: result.value.updatedAt!,
          };
        });
        return next;
      });
    }

    function connect() {
      if (stopped) return;
      attempts += 1;
      socket = new WebSocket("wss://stream.bybit.com/v5/public/linear");
      socket.onopen = () => {
        attempts = 0;
        socket?.send(
          JSON.stringify({
            op: "subscribe",
            args: trackedSymbols.map((trackedSymbol) => "tickers." + trackedSymbol),
          }),
        );
        heartbeat = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ op: "ping" }));
          }
        }, 20_000);
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            topic?: string;
            ts?: number;
            data?: Record<string, unknown> | Record<string, unknown>[];
          };
          if (!message.topic?.startsWith("tickers.") || !message.data) return;
          const raw = Array.isArray(message.data) ? message.data[0] : message.data;
          if (stopped || !raw || !message.ts) return;
          const trackedSymbol = message.topic.slice("tickers.".length);
          setPrices((current) => {
            const previous = current[trackedSymbol];
            const price = Number(raw?.lastPrice ?? previous?.price ?? 0);
            const nextMarkPrice = Number(raw?.markPrice ?? previous?.markPrice ?? price);
            if (!acceptQuote(previous?.updatedAt, message.ts!, price)) return current;
            return {
              ...current,
              [trackedSymbol]: {
                price,
                markPrice:
                  Number.isFinite(nextMarkPrice) && nextMarkPrice > 0
                    ? nextMarkPrice
                    : price,
                updatedAt: message.ts!,
              },
            };
          });
        } catch {
          // Keep the last verified quote when an exchange frame is malformed.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (heartbeat) window.clearInterval(heartbeat);
        if (stopped) return;
        reconnectTimer = window.setTimeout(
          connect,
          Math.min(12_000, 1_500 * 2 ** attempts),
        );
      };
    }

    const warmupTimer = window.setTimeout(() => void refreshPrices(), 0);
    const pollTimer = window.setInterval(() => void refreshPrices(), 10_000);
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(warmupTimer);
      window.clearInterval(pollTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (heartbeat) window.clearInterval(heartbeat);
      socket?.close();
    };
  }, [openSymbolsKey]);

  const openTrades = trades.filter((trade) => trade.status === "OPEN");
  const closedTrades = trades
    .filter((trade) => trade.status === "CLOSED")
    .sort((first, second) => (second.closedAt ?? 0) - (first.closedAt ?? 0));
  const closedRMultiples = closedTrades.map((trade) => {
    const initialRisk =
      Math.abs(trade.entryPrice - trade.initialStop) * trade.quantity;
    return initialRisk > 0 ? trade.realizedPnl / initialRisk : 0;
  });
  const journalWinRate = closedTrades.length
    ? (closedTrades.filter((trade) => trade.realizedPnl > 0).length /
        closedTrades.length) *
      100
    : 0;
  const journalExpectancy = closedRMultiples.length
    ? closedRMultiples.reduce((total, value) => total + value, 0) /
      closedRMultiples.length
    : 0;
  const guard = getPortfolioGuard(trades, accountEquity, analysis.bias);

  function tradePrice(trade: TrackedTrade) {
    const streamed = prices[trade.symbol];
    if (
      trade.symbol === symbol &&
      feedLive && dataMode === "LIVE" &&
      currentPrice > 0 &&
      (currentPriceUpdatedAt ?? 0) >= (streamed?.updatedAt ?? 0)
    ) {
      return { price: currentPrice, markPrice: markPrice || currentPrice, updatedAt: currentPriceUpdatedAt ?? 0 };
    }
    return {
      price: streamed?.price || trade.entryPrice,
      markPrice: streamed?.markPrice || streamed?.price || trade.entryPrice,
      updatedAt: streamed?.updatedAt ?? 0,
    };
  }

  const currentEntryLeverageCap = marketEntryMode
    ? Math.max(
        1,
        Math.floor(
          Math.min(
            instrument?.maxLeverage ?? ADAPTIVE_STYLE_MAX_LEVERAGE[style],
            ADAPTIVE_STYLE_MAX_LEVERAGE[style] *
              (effectiveCurrentStatus === "ALLOW" ? 0.7 : effectiveCurrentStatus === "CAUTION" ? 0.45 : 0),
          ),
        ),
      )
    : instrument?.maxLeverage;
  const planActionable = marketEntryMode
    ? dataMode === "LIVE" && feedLive && effectiveCurrentStatus !== "AVOID" && btcVerdict !== "REJECT"
    : dataMode === "LIVE" &&
      feedLive &&
      btcVerdict !== "REJECT" &&
      analysis.decision === "SETUP" &&
      analysis.entryReady;
  const setupLeveragePlan = buildAdaptiveLeveragePlan({
    accountEquity,
    targetRiskPct: marketEntryMode
      ? effectiveCurrentStatus === "ALLOW" ? 0.45 : 0.25
      : btcVerdict === "CAUTION" ? Math.min(analysis.riskMultiplier, 0.5) : analysis.riskMultiplier,
    entry: currentPrice,
    stop: planStop,
    score: marketEntryMode ? analysis.immediateEntry.score : analysis.score,
    regime: analysis.regime,
    setupType: analysis.setupType,
    trendFrames: analysis.metrics.trendFrames,
    atrPct: analysis.metrics.atrPct,
    adx: analysis.metrics.adx,
    style,
    actionable: planActionable,
    exchangeMaxLeverage: currentEntryLeverageCap,
    quantityStep: instrument?.quantityStep,
    minOrderQty: instrument?.minOrderQty,
    minNotionalValue: instrument?.minNotionalValue,
  });
  const setupQuantity = setupLeveragePlan.quantity;
  const setupPortfolioRiskPct = setupLeveragePlan.actualRiskPct;
  const setupLeverage = setupLeveragePlan.recommendedLeverage;
  const setupRiskPerUnit = Math.abs(planEntry - planStop);
  const adverseChaseDistance =
    analysis.bias === "LONG"
      ? Math.max(0, currentPrice - planEntry)
      : Math.max(0, planEntry - currentPrice);
  const adverseChaseR = setupRiskPerUnit
    ? adverseChaseDistance / setupRiskPerUnit
    : Number.POSITIVE_INFINITY;
  const liveQuoteFresh = Boolean(
    feedLive &&
      currentPriceUpdatedAt &&
      now - currentPriceUpdatedAt <= PRICE_STALE_AFTER_MS,
  );
  const setupBlockers = [
    entryExecutionBlocker(analysis.executionPlan, currentPrice, now, marketEntryMode),
    !instrument ? "Exchange quantity and leverage limits are unavailable. Refresh before starting a new plan." : null,
    dataMode !== "LIVE" ? "Live candle history is required; demo history cannot open a trade." : null,
    !liveQuoteFresh ? "The current Bybit quote is stale or reconnecting." : null,
    btcVerdict === "REJECT" ? "BTC relationship rejects the current divergence; new entry is blocked." : null,
    !(marketEntryMode ? planTargets.every(target => target.available) : planTargets[0]?.available) ? "The first target is unconfirmed. Do not enter using invented levels." : null,
    marketEntryMode && effectiveCurrentStatus === "AVOID"
      ? "Current-price entry is AVOID: " + analysis.immediateEntry.warnings[2]
      : null,
    !marketEntryMode && analysis.decision === "WATCH"
      ? "WATCH: the " +
        analysis.setupType.toLowerCase() +
        " is valid, but it has not reached the " +
        analysis.metrics.setupThreshold +
        "-point TAKE gate."
      : !marketEntryMode && analysis.decision === "NO TRADE"
        ? "NO TRADE: this market does not pass the live trend, session and quality gates."
        : null,
    !marketEntryMode && analysis.decision === "SETUP" && !analysis.entryReady
      ? analysis.executionPlan.reason
      : null,
    analysis.bias === "LONG" && currentPrice <= planStop
      ? "Price has already invalidated the long stop."
      : null,
    analysis.bias === "SHORT" && currentPrice >= planStop
      ? "Price has already invalidated the short stop."
      : null,
    !marketEntryMode && adverseChaseR > 0.25
      ? "Do not chase: price has moved more than 0.25R beyond the analyzed entry."
      : null,
    !setupQuantity
      ? "Account equity, stop distance, and Bybit minimum order rules must permit a valid quantity."
      : null,
    guard.openRiskPct + setupPortfolioRiskPct > MEDIUM_RISK_MAX_OPEN_RISK_PCT
      ? "This entry would push total open stop-risk above the " +
        MEDIUM_RISK_MAX_OPEN_RISK_PCT.toFixed(1) +
        "% portfolio cap."
      : null,
    openTrades.some(
      (trade) => trade.symbol === symbol && trade.side === analysis.bias,
    )
      ? "This symbol and side is already being managed."
      : null,
    ...guard.reasons,
  ].filter((reason): reason is string => Boolean(reason));

  function startSetupTrade() {
    if (setupBlockers.length || (needsAcknowledgement && riskAcknowledged !== acknowledgedKey) ||
        // eslint-disable-next-line react-hooks/purity
        entryExecutionBlocker(analysis.executionPlan, currentPrice, Date.now(), marketEntryMode) ||
        // This function runs only on the confirmation click; recheck time at submission.
        // eslint-disable-next-line react-hooks/purity
        Date.now() - (currentPriceUpdatedAt ?? 0) > PRICE_STALE_AFTER_MS) return;
    const next = createTrackedTrade({
      symbol,
      side: analysis.bias,
      mode: "PAPER",
      style,
      entryPrice: currentPrice,
      quantity: setupQuantity,
      leverage: setupLeverage,
      stop: planStop,
      tp1: planTargets[0].price,
      tp2: planTargets[1].price,
      tp3: planTargets[2].price,
      tp4: planTargets[3].price,
      tp5: planTargets[4].price,
      atrAtEntry: analysis.metrics.atr,
      targetWeights: planTargets.map(target => target.exitPct),
      entrySnapshot: {
        entryMode, flexibility: analysis.flexibility, score: analysis.score,
        entryQuality: analysis.entryQuality, btcVerdict,
        overrideAccepted: needsAcknowledgement && riskAcknowledged === acknowledgedKey,
        targets: planTargets.map(target => ({...target})),
        reasons: [...analysis.executionPlan.steps, analysis.executionPlan.cancelText,
          ...(marketEntryMode ? analysis.immediateEntry.reasoning : analysis.reasons)],
      },
    });
    setTrades((current) => [next, ...current]);
  }

  function openManualDialog() {
    setManualError(null);
    setManual({
      mode: "MANUAL_LIVE",
      symbol,
      side: analysis.bias,
      style,
      openedAt: localDatetimeValue(),
      entry: String(currentPrice || planEntry),
      quantity: setupQuantity ? String(setupQuantity) : "",
      leverage: setupLeverage ? String(setupLeverage) : "1",
      stop: String(planStop),
      tp1: String(planTargets[0].price),
      tp2: String(planTargets[1].price),
      tp3: String(planTargets[2].price),
      tp4: String(planTargets[3].price),
      tp5: String(planTargets[4].price),
      liquidation: "",
    });
    setManualOpen(true);
  }

  useEffect(() => {
    if (!tradeRequest || requestHandled.current === tradeRequest.id || !feedLive) return;
    const timer = window.setTimeout(() => {
      requestHandled.current = tradeRequest.id;
      if (tradeRequest.mode === "PAPER") setPaperOpen(true);
      else openManualDialog();
    }, 0);
    return () => window.clearTimeout(timer);
  });

  function submitManual(event: FormEvent) {
    event.preventDefault();
    const nextSymbol = manual.symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const entry = Number(manual.entry);
    const quantity = Number(manual.quantity);
    const leverage = Number(manual.leverage);
    const stop = Number(manual.stop);
    const tp1 = Number(manual.tp1);
    const tp2 = Number(manual.tp2);
    const tp3 = Number(manual.tp3);
    const tp4 = Number(manual.tp4);
    const tp5 = Number(manual.tp5);
    const liquidation = Number(manual.liquidation);
    const openedAt = new Date(manual.openedAt).getTime();
    const numeric = [entry, quantity, leverage, stop, tp1, tp2, tp3, tp4, tp5];
    if (!/^[A-Z0-9]{2,24}USDT$/.test(nextSymbol)) {
      setManualError("Use a valid Bybit USDT perpetual symbol, such as BTCUSDT.");
      return;
    }
    if (numeric.some((value) => !Number.isFinite(value) || value <= 0)) {
      setManualError("Entry, quantity, leverage, stop and all targets must be positive numbers.");
      return;
    }
    if (!Number.isFinite(openedAt) || openedAt > Date.now() + 60_000) {
      setManualError("Opened time must be a valid time that is not in the future.");
      return;
    }
    if (leverage > 125) {
      setManualError("Leverage cannot exceed 125×. Boma Scans uses a lower adaptive ceiling for managed risk.");
      return;
    }
    const validOrder =
      manual.side === "LONG"
        ? stop < entry && entry < tp1 && tp1 < tp2 && tp2 < tp3 && tp3 < tp4 && tp4 < tp5
        : stop > entry && entry > tp1 && tp1 > tp2 && tp2 > tp3 && tp3 > tp4 && tp4 > tp5;
    if (!validOrder) {
      setManualError(
        manual.side === "LONG"
          ? "For a long: stop < entry < TP1 < TP2 < TP3 < TP4 < TP5."
          : "For a short: stop > entry > TP1 > TP2 > TP3 > TP4 > TP5.",
      );
      return;
    }
    if (manual.liquidation && (!Number.isFinite(liquidation) || liquidation <= 0)) {
      setManualError("Liquidation price must be positive or left blank.");
      return;
    }
    if (manual.mode === "PAPER") {
      const manualRiskPct = accountEquity > 0 ? Math.abs(entry - stop) * quantity / accountEquity * 100 : Infinity;
      const manualGuard = getPortfolioGuard(trades, accountEquity, manual.side);
      if (manualGuard.blocked || manualRiskPct > 1 || manualGuard.openRiskPct + manualRiskPct > MEDIUM_RISK_MAX_OPEN_RISK_PCT) {
        setManualError("Paper trade exceeds the 1% individual or 2.5% portfolio risk limit, or a portfolio halt is active.");
        return;
      }
    }
    if (
      manual.liquidation &&
      ((manual.side === "LONG" && liquidation >= entry) ||
        (manual.side === "SHORT" && liquidation <= entry))
    ) {
      setManualError(
        manual.side === "LONG"
          ? "A long liquidation price should be below entry."
          : "A short liquidation price should be above entry.",
      );
      return;
    }
    const next = createTrackedTrade({
      symbol: nextSymbol,
      side: manual.side,
      mode: manual.mode,
      style: manual.style,
      entryPrice: entry,
      quantity,
      leverage,
      stop,
      tp1,
      tp2,
      tp3,
      tp4,
      tp5,
      atrAtEntry: Math.abs(entry - stop) / 1.5,
      liquidationPrice: manual.liquidation ? liquidation : undefined,
      openedAt,
    });
    setTrades((current) => [next, ...current]);
    setManualOpen(false);
  }

  function updateTrade(id: string, updater: (trade: TrackedTrade) => TrackedTrade) {
    setTrades((current) =>
      current.map((trade) => (trade.id === id ? updater(trade) : trade)),
    );
  }

  return (
    <section className="border-b border-border p-4" id="trade-manager">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BriefcaseBusiness className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-white">Pro trade manager</h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Live {intervalLabel} stay, exit, partial and protection guidance.
          </p>
        </div>
        <span className="rounded-md border border-border bg-slate-800/50 px-2 py-1 text-xs font-bold text-slate-400">
          {openTrades.length} OPEN
        </span>
      </div>

      <p className="mt-2 text-sm text-slate-400" role="status">{tradeSync.status}</p>
      {tradeSync.conflict && <Button variant="outline" onClick={tradeSync.loadCloud}>Back up device copy and load cloud trades</Button>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <AlertDialog open={paperOpen} onOpenChange={setPaperOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              disabled={setupBlockers.length > 0}
              className="h-9 bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              {marketEntryMode ? "Track enter-now plan" : "Enter & manage"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="border-border bg-[#0b111a] text-white">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {marketEntryMode
                  ? "Track the reduced-risk current entry?"
                  : "Start this as a paper trade?"}
              </AlertDialogTitle>
              <AlertDialogDescription className="leading-6 text-slate-400">
                Boma Scans will record {analysis.bias.toLowerCase()} {symbol} at the live price,
                monitor it, and give management prompts. {marketEntryMode
                ? "This uses a structural current-entry stop and close target map. "
                  : ""}This does not send an order to Bybit.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-[#080d15] p-3 text-sm">
              <span className="text-slate-500">Entry</span>
              <span className="text-right font-mono text-white">{formatPrice(currentPrice)}</span>
              <span className="text-slate-500">Size</span>
              <span className="text-right font-mono text-white">{setupQuantity.toFixed(6)}</span>
              <span className="text-slate-500">Adaptive leverage</span>
              <span className="text-right font-mono text-primary">{setupLeverage}×</span>
              <span className="text-slate-500">Permitted band</span>
              <span className="text-right font-mono text-white">
                {setupLeveragePlan.minimumLeverage === setupLeveragePlan.maximumLeverage
                  ? setupLeveragePlan.maximumLeverage + "×"
                  : setupLeveragePlan.minimumLeverage +
                    "–" +
                    setupLeveragePlan.maximumLeverage +
                    "×"}
              </span>
              <span className="text-slate-500">Hard stop</span>
              <span className="text-right font-mono text-rose-300">{formatPrice(planStop)}</span>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              {setupLeveragePlan.rationale}. The setting changes isolated margin reserved, not the {setupLeveragePlan.actualRiskPct.toFixed(2)}% hard-stop account risk.
            </p>
            {setupBlockers.length > 0 && <p role="alert" className="text-sm text-amber-200">Entry unavailable: {setupBlockers[0]}</p>}
            {needsAcknowledgement && <label className="flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm leading-6 text-amber-100"><Checkbox checked={riskAcknowledged === acknowledgedKey} onCheckedChange={checked => setRiskAcknowledged(checked === true ? acknowledgedKey : null)} className="mt-1"/><span>{analysis.qualityOverride.eligible ? "Quality override: " + analysis.qualityOverride.reason + " " : ""}{btcVerdict === "CAUTION" ? "BTC context is CAUTION. " : ""}I accept the reduced-size risk and understand this acknowledgement will be recorded.</span></label>}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={setupBlockers.length > 0 || (needsAcknowledgement && riskAcknowledged !== acknowledgedKey)} onClick={startSetupTrade}>Start paper tracking</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={openManualDialog}
          className="h-9 border-border bg-[#101722] text-xs text-slate-200 hover:bg-slate-800 hover:text-white"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Log manual trade
        </Button>
      </div>

      <div className="mt-3"><EntryInstructions plan={analysis.executionPlan} ready={!setupBlockers.length}
        reason={setupBlockers[0]} compact/></div>

      {setupBlockers.length ? (
        <div className="mt-2 rounded-lg border border-amber-300/15 bg-amber-300/[0.045] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
            <ShieldAlert className="h-3.5 w-3.5" />{
              marketEntryMode && effectiveCurrentStatus === "AVOID"
                ? "Current entry blocked"
                : marketEntryMode
                  ? "Current entry unavailable"
                  : analysis.decision !== "SETUP"
                ? "Setup pending"
                : !analysis.entryReady
                  ? analysis.setupType === "CHoCH REVERSAL"
                    ? "Retest pending"
                    : "Trigger pending"
                  : "Risk gate active"
            }
          </p>
          <p className="mt-1 text-xs leading-4 text-amber-100/60">
            {setupBlockers[0]}
          </p>
          {onOpenRecommendation && recommendedSymbol && recommendedSymbol !== symbol ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onOpenRecommendation}
              className="mt-2 h-8 border-primary/25 bg-primary/[0.06] text-xs text-primary hover:bg-primary/10"
            >
              Open TAKE {recommendedSide} {recommendedSymbol}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-300/15 bg-emerald-300/[0.04] px-3 py-2 text-xs text-emerald-200/75">
          <ShieldCheck className="h-3.5 w-3.5" /> {marketEntryMode
            ? "Current-entry plan passed freshness, reduced-risk and portfolio gates."
            : "Live setup passed freshness and portfolio gates."}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-[#0b111a] p-2.5">
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Open risk</p>
          <p className="mt-1 font-mono text-xs font-semibold text-white">
            {guard.openRiskPct.toFixed(2)}%
          </p>
        </div>
        <div className="rounded-lg border border-border bg-[#0b111a] p-2.5">
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Today</p>
          <p
            className={
              "mt-1 font-mono text-xs font-semibold " +
              (guard.dailyRealizedPnl >= 0 ? "text-emerald-300" : "text-rose-300")
            }
          >
            {guard.dailyRealizedPnl >= 0 ? "+" : ""}
            {guard.dailyRealizedPnl.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-[#0b111a] p-2.5">
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Win rate</p>
          <p className="mt-1 font-mono text-xs font-semibold text-white">
            {closedTrades.length ? journalWinRate.toFixed(0) + "%" : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-[#0b111a] p-2.5">
          <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Loss streak</p>
          <p className="mt-1 font-mono text-xs font-semibold text-white">
            {guard.consecutiveLosses}
          </p>
        </div>
      </div>
      <p className="mt-2 text-xs leading-4 text-slate-500">
        Journal sample {closedTrades.length} · gross expectancy {closedTrades.length ? (journalExpectancy >= 0 ? "+" : "") + journalExpectancy.toFixed(2) + "R" : "—"}. Small samples, paper fills, fees and funding can distort results; a trade count alone does not validate an edge.
      </p>
      {trades.filter(trade => trade.entrySnapshot?.overrideAccepted && now - trade.openedAt <= 7 * 86_400_000).length >= 3 && <p className="mt-2 rounded-lg border border-amber-300/20 p-3 text-sm text-amber-200">Three or more reduced-risk exceptions recorded this week. Review these separately in your journal before taking more.</p>}

      <div className="mt-4 space-y-3">
        {!storageReady ? (
          <div className="rounded-lg border border-border bg-[#0b111a] p-4 text-center text-xs text-slate-500">
            Loading managed trades…
          </div>
        ) : openTrades.length ? (
          openTrades.map((trade) => {
            const quote = tradePrice(trade);
            const snapshot = evaluateTrade(
              trade,
              quote.price,
              quote.updatedAt,
              trade.symbol === symbol && trade.style === style && feedLive && dataMode === "LIVE" ? analysis : null,
              now,
              quote.markPrice,
            );
            const stopCanTighten =
              trade.side === "LONG"
                ? snapshot.suggestedStop > trade.stop
                : snapshot.suggestedStop < trade.stop;
            return (
              <article key={trade.id} className="overflow-hidden rounded-lg border border-border bg-[#0b111a]">
                <div className="flex items-start justify-between gap-3 border-b border-border/70 p-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-white">{trade.symbol}</span>
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold " +
                          (trade.side === "LONG"
                            ? "bg-emerald-300/10 text-emerald-300"
                            : "bg-rose-300/10 text-rose-300")
                        }
                      >
                        {trade.side === "LONG" ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {trade.side}
                      </span>
                      <span className="rounded border border-border px-1.5 py-0.5 text-xs font-semibold text-slate-500">
                        {trade.mode === "PAPER" ? "PAPER" : "MANUAL LIVE"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatAge(snapshot.ageMinutes)} open · {trade.leverage.toFixed(1)}× · {trade.remainingPct}% left
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={
                        "font-mono text-sm font-bold " +
                        (snapshot.pnl >= 0 ? "text-emerald-300" : "text-rose-300")
                      }
                    >
                      <LiveValue value={snapshot.pnl} label={(snapshot.pnl >= 0 ? "+" : "") + snapshot.pnl.toFixed(2) + " USDT"}/>
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      {snapshot.rMultiple >= 0 ? "+" : ""}
                      {snapshot.rMultiple.toFixed(2)}R · margin ROI {snapshot.marginRoiPct.toFixed(2)}%
                    </p>
                  </div>
                </div>

                <div className="p-3">
                  <div className={"rounded-lg border p-3 " + severityTone[snapshot.severity]}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-extrabold tracking-[0.08em]">
                        {snapshot.action}
                      </span>
                      <span className="font-mono text-xs opacity-75">
                        {snapshot.stale ? "QUOTE STALE" : formatPrice(snapshot.currentPrice)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs font-semibold text-slate-100">
                      {snapshot.headline}
                    </p>
                    <p className="mt-1 text-xs leading-[1.55] text-slate-400">
                      {snapshot.detail}
                    </p>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Entry</span>
                      <span className="font-mono text-slate-300">{formatPrice(trade.entryPrice)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Stop</span>
                      <span className="font-mono text-rose-300">{formatPrice(trade.stop)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Next</span>
                      <span className="font-mono text-emerald-300">
                        {snapshot.nextLevelLabel} {formatPrice(snapshot.nextLevel)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Suggested SL</span>
                      <span className="font-mono text-primary">{formatPrice(snapshot.suggestedStop)}</span>
                    </div>
                  </div>

                  <div
                    className={
                      "mt-3 rounded-lg border px-3 py-2 text-xs leading-4 " +
                      (snapshot.marginAdvice.startsWith("PYRAMID")
                        ? "border-emerald-300/15 bg-emerald-300/[0.04] text-emerald-200/75"
                        : "border-amber-300/15 bg-amber-300/[0.04] text-amber-100/65")
                    }
                  >
                    {snapshot.marginAdvice}
                  </div>

                  <Collapsible className="mt-3 rounded-lg border border-border">
                    <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-xs text-slate-300">Frozen entry plan · {trade.remainingPct}% remaining <ChevronDown className="h-4 w-4"/></CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 px-3 pb-3 text-xs leading-5 text-slate-400">
                      <div role="meter" aria-label="Position remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={trade.remainingPct} className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-primary" style={{width: trade.remainingPct + "%"}}/></div>
                      {trade.entrySnapshot ? <><p>{trade.entrySnapshot.flexibility} · {trade.entrySnapshot.entryMode === "MARKET" ? "Enter now" : "Preferred entry"} · TA {trade.entrySnapshot.score}/100 · entry {trade.entrySnapshot.entryQuality}/100 · BTC {trade.entrySnapshot.btcVerdict}{trade.entrySnapshot.overrideAccepted ? " · reduced-risk acknowledgement recorded" : ""}</p><ul className="list-disc space-y-1 pl-4">{trade.entrySnapshot.reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul></> : <p>Manual or legacy record; no analysis snapshot was saved.</p>}
                      {[trade.tp1,trade.tp2,trade.tp3,trade.tp4,trade.tp5].map((target,index)=><div key={index} className="flex justify-between gap-3 border-t border-border pt-2"><span>TP{index+1} · {(trade.targetWeights ?? [20,20,20,15,25])[index]}%<span className="block text-slate-500">{trade.entrySnapshot?.targets[index]?.source ?? "Recorded target"}</span></span><span className="font-mono text-emerald-300">{formatPrice(target)}</span></div>)}
                      <p>Targets are fixed at recording. A refreshed chart does not move them.</p>
                    </CollapsibleContent>
                  </Collapsible>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {snapshot.exitLevel ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          quoteIsFresh(quote.updatedAt) && updateTrade(trade.id, (current) =>
                            applyPartialExit(
                              current,
                              snapshot.exitLevel!,
                              snapshot.currentPrice,
                            ),
                          )
                        }
                        className="h-8 bg-emerald-500 text-xs text-slate-950 hover:bg-emerald-400"
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />{
                          snapshot.exitLevel === 5
                            ? "Mark TP5 final exit"
                            : "Mark TP" + snapshot.exitLevel + " taken"
                        }
                      </Button>
                    ) : null}
                    {stopCanTighten ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          quoteIsFresh(quote.updatedAt) && updateTrade(trade.id, (current) => ({
                            ...current,
                            stop: snapshot.suggestedStop,
                          }))
                        }
                        className="h-8 border-primary/30 bg-primary/[0.06] text-xs text-primary hover:bg-primary/10"
                      >
                        Record stop moved
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenChart(trade.symbol)}
                      className="h-8 border-border bg-[#101722] text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Chart
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={snapshot.stale}
                          className="h-8 border-rose-300/20 bg-rose-300/[0.04] text-xs text-rose-300 hover:bg-rose-300/10 hover:text-rose-200"
                        >
                          Close record
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="border-border bg-[#0b111a] text-white">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Close this managed trade?</AlertDialogTitle>
                          <AlertDialogDescription className="leading-6 text-slate-400">
                            The remaining {trade.remainingPct}% will be recorded at {formatPrice(snapshot.currentPrice)}.
                            For a manual live trade, close it on Bybit first.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep open</AlertDialogCancel>
                          <AlertDialogAction
                            disabled={snapshot.stale}
                            variant="destructive"
                            onClick={() =>
                              quoteIsFresh(quote.updatedAt) && updateTrade(trade.id, (current) =>
                                closeTrackedTrade(
                                  current,
                                  snapshot.currentPrice,
                                  snapshot.action === "EXIT NOW" ? "STOP" : "MANUAL",
                                ),
                              )
                            }
                          >
                            Close record
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-[#0b111a] p-4 text-center">
            <CircleAlert className="mx-auto h-5 w-5 text-slate-500" />
            <p className="mt-2 text-xs font-medium text-slate-300">No managed trades yet</p>
            <p className="mt-1 text-xs leading-4 text-slate-500">
              Enter a qualified paper setup or log a trade already opened on Bybit.
            </p>
          </div>
        )}
      </div>

      <div id="trade-journal" className="scroll-mt-52">
      {closedTrades.length ? (
        <div className="mt-4 rounded-lg border border-border bg-[#0b111a]">
          <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
              Recent closed
            </p>
            <span className="text-xs text-slate-500">Last {Math.min(3, closedTrades.length)}</span>
          </div>
          {closedTrades.slice(0, 3).map((trade) => (
            <div key={trade.id} className="flex items-center justify-between border-b border-border/60 px-3 py-2.5 last:border-b-0">
              <div>
                <p className="font-mono text-xs font-semibold text-slate-300">
                  {trade.symbol} · {trade.side}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{trade.closeReason ?? "CLOSED"}</p>
              </div>
              <span
                className={
                  "font-mono text-xs font-semibold " +
                  (trade.realizedPnl >= 0 ? "text-emerald-300" : "text-rose-300")
                }
              >
                {trade.realizedPnl >= 0 ? "+" : ""}
                {trade.realizedPnl.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      ) : <p className="mt-4 rounded-lg border border-border p-3 text-sm text-slate-400">Journal · no closed trades yet.</p>}
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-[#080d15] p-3 text-xs leading-4 text-slate-500">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" />
        <span>
          Advisory tracking only: buttons update this dashboard, not Bybit orders. P&amp;L excludes fees and funding. Keep this tab open for live guidance; trade records are backed up on this device and synced to your signed-in account when the account-sync status confirms success.
        </span>
      </div>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-[#0b111a] text-white sm:max-w-2xl">
          <form onSubmit={submitManual}>
            <DialogHeader>
              <DialogTitle>Log a trade for active management</DialogTitle>
              <DialogDescription className="leading-6 text-slate-400">
                Use Manual live for a position you already entered on Bybit, or Paper for a simulation. No exchange order is created.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Tracking mode</span>
                <Select
                  value={manual.mode}
                  onValueChange={(value) =>
                    setManual((current) => ({ ...current, mode: value as TradeMode }))
                  }
                >
                  <SelectTrigger className="mt-1.5 w-full border-border bg-[#0b111a] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-[#101722] text-white">
                    <SelectItem value="MANUAL_LIVE">Manual live · already on Bybit</SelectItem>
                    <SelectItem value="PAPER">Paper simulation</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Symbol</span>
                <Input
                  value={manual.symbol}
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      symbol: event.target.value.toUpperCase(),
                    }))
                  }
                  className="mt-1.5 h-9 border-border bg-[#0b111a] font-mono text-sm uppercase text-white"
                  placeholder="BTCUSDT"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Side</span>
                <Select
                  value={manual.side}
                  onValueChange={(value) =>
                    setManual((current) => ({ ...current, side: value as Bias }))
                  }
                >
                  <SelectTrigger className="mt-1.5 w-full border-border bg-[#0b111a] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-[#101722] text-white">
                    <SelectItem value="LONG">Long</SelectItem>
                    <SelectItem value="SHORT">Short</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Trading style</span>
                <Select
                  value={manual.style}
                  onValueChange={(value) =>
                    setManual((current) => ({
                      ...current,
                      style: value as TradingStyle,
                    }))
                  }
                >
                  <SelectTrigger className="mt-1.5 w-full border-border bg-[#0b111a] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-[#101722] text-white">
                    <SelectItem value="SCALP">Scalp</SelectItem>
                    <SelectItem value="DAY">Day</SelectItem>
                    <SelectItem value="SWING">Swing</SelectItem>
                    <SelectItem value="POSITION">Position</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Opened at · your local time</span>
                <Input
                  type="datetime-local"
                  value={manual.openedAt}
                  max={localDatetimeValue()}
                  onChange={(event) =>
                    setManual((current) => ({ ...current, openedAt: event.target.value }))
                  }
                  className="mt-1.5 h-9 border-border bg-[#0b111a] font-mono text-sm text-white"
                />
              </label>
              {field("Entry price", manual.entry, (value) =>
                setManual((current) => ({ ...current, entry: value })),
              )}
              {field("Quantity · base asset", manual.quantity, (value) =>
                setManual((current) => ({ ...current, quantity: value })),
              )}
              {field("Leverage", manual.leverage, (value) =>
                setManual((current) => ({ ...current, leverage: value })),
              )}
              {field("Hard stop", manual.stop, (value) =>
                setManual((current) => ({ ...current, stop: value })),
              )}
              {field("TP1 · exit 40%", manual.tp1, (value) =>
                setManual((current) => ({ ...current, tp1: value })),
              )}
              {field("TP2 · exit 35%", manual.tp2, (value) =>
                setManual((current) => ({ ...current, tp2: value })),
              )}
              {field("TP3 · exit 15%", manual.tp3, (value) =>
                setManual((current) => ({ ...current, tp3: value })),
              )}
              {field("TP4 · exit 5%", manual.tp4, (value) =>
                setManual((current) => ({ ...current, tp4: value })),
              )}
              {field("TP5 · close remainder", manual.tp5, (value) =>
                setManual((current) => ({ ...current, tp5: value })),
              )}
              {field(
                "Liquidation price · optional",
                manual.liquidation,
                (value) => setManual((current) => ({ ...current, liquidation: value })),
                { placeholder: "Improves liquidation warnings" },
              )}
            </div>

            {manualError ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-300/20 bg-rose-300/[0.06] p-3 text-xs leading-5 text-rose-200">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {manualError}
              </div>
            ) : null}
            {Number(manual.leverage) > ADAPTIVE_STYLE_MAX_LEVERAGE[manual.style] ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs leading-5 text-amber-100/75">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> This exceeds Boma Scans’ {ADAPTIVE_STYLE_MAX_LEVERAGE[manual.style]}× hard ceiling for {manual.style.toLowerCase()} trades. The manager will prioritize deleveraging and protecting the stop.
              </div>
            ) : null}

            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" onClick={() => setManualOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                Add to manager <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
