"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  Menu,
  Maximize2,
  BookOpen,
  BriefcaseBusiness,
  CircleDollarSign,
  Crosshair,
  Download,
  Gauge,
  Info,
  LineChart,
  Loader2,
  Lock,
  Radar,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { MarketChart } from "@/app/components/market-chart";
import { TradeManager } from "@/app/components/trade-manager";
import { OpportunityRow } from "@/app/components/opportunity-row";
import { useAccountSync } from "@/app/components/use-account-sync";
import { mergeHistory, candleFeedFresh } from "@/app/lib/candle-history";
import { lockedPlanFailure, cancelLockedAnalysis, type LockedPlan } from "@/app/lib/locked-plan";
import { EntryInstructions } from "@/app/components/entry-instructions";
import { entryExecutionBlocker } from "@/app/lib/entry-execution";
import { LiveValue } from "@/app/components/live-value";
import { SignalCenter, type SignalTab } from "@/app/components/signal-center";
import { TelegramPanel } from "@/app/components/telegram-panel";
import { snapshotSignal } from "@/app/lib/signal-alerts";
import { useSignalAlerts } from "@/app/components/use-signal-alerts";
import type { SignalSnapshot } from "@/app/lib/signal-alerts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import type { FlexibilityMode } from "@/app/lib/entry-policy";
import {
  Candle,
  MarketInstrument,
  MarketTicker,
  ScannerRow,
  STYLE_CONFIG,
  STYLE_LIQUIDITY_FLOOR,
  TIMEFRAMES,
  INTERVAL_MS,
  TradingStyle,
  analyzeBtcRelationship,
  analyzeMarket,
  asNumber,
  compactNumber,
  contextIntervals,
  fetchInstrument,
  fetchInstruments,
  fetchKlines,
  fetchTicker,
  fetchTickers,
  formatPrice,
  generateDemoCandles,
  normalizeTicker,
  scannerRowFromAnalysis,
} from "@/app/lib/market";
import {
  ADAPTIVE_STYLE_MAX_LEVERAGE,
  buildAdaptiveLeveragePlan,
} from "@/app/lib/leverage";
import {
  MEDIUM_RISK_MAX_OPEN_RISK_PCT,
  getMediumRiskShortlist,
  isMediumRiskTake,
} from "@/app/lib/recommendations";

type FeedStatus = "CONNECTING" | "LIVE" | "POLLING" | "OFFLINE";
type ScannerMode = "LIVE" | "OFFLINE";
type RiskFilter = "ALL" | "LOW" | "MEDIUM" | "HIGH";
type DirectionFilter = "BOTH" | "LONG" | "SHORT";
type WebTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: unknown) => unknown | Promise<unknown>;
};
type WebModelContext = {
  registerTool: (
    tool: WebTool,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const BLACKLIST = new Set(["LUNAUSDT", "LUNA2USDT", "BUSDUSDT"]);
const AUTO_SCAN_INTERVALS = [
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
] as const;
type AutoScanMinutes = (typeof AUTO_SCAN_INTERVALS)[number]["minutes"];
const AUTO_SCAN_INTERVAL_STORAGE_KEY = "boma-scans:auto-scan-minutes";
const SCANNER_MANUAL_STALE_AFTER_MS = 90_000;
const SCANNER_REFRESH_GRACE_MS = 120_000;
function isAutoScanInterval(value: number): value is AutoScanMinutes {
  return AUTO_SCAN_INTERVALS.some((option) => option.minutes === value);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return results;
}

import { acceptQuote, quoteIsFresh } from "@/app/lib/quote-safety";

function mergeTickerDelta(
  previous: MarketTicker | null,
  raw: Record<string, unknown>,
  symbol: string,
) {
  const base =
    previous ??
    ({
      symbol,
      lastPrice: 0,
      markPrice: 0,
      indexPrice: 0,
      price24hPcnt: 0,
      turnover24h: 0,
      volume24h: 0,
      fundingRate: 0,
      bid1Price: 0,
      ask1Price: 0,
      openInterestValue: 0,
    } satisfies MarketTicker);
  const next = { ...base };
  const fields: Array<keyof Omit<MarketTicker, "symbol">> = [
    "lastPrice",
    "markPrice",
    "indexPrice",
    "price24hPcnt",
    "turnover24h",
    "volume24h",
    "fundingRate",
    "bid1Price",
    "ask1Price",
    "openInterestValue",
  ];
  for (const field of fields) {
    if (raw[field] !== undefined && raw[field] !== "") {
      next[field] = asNumber(raw[field], next[field]);
    }
  }
  next.symbol = String(raw.symbol ?? symbol);
  return next;
}

function decisionRank(row: ScannerRow) {
  if (row.decision === "SETUP") return 3;
  if (row.decision === "WATCH") return 2;
  return 1;
}

function scoreTone(score: number) {
  if (score >= 72) return "#32d5a4";
  if (score >= 60) return "#f5c451";
  return "#64748b";
}

function riskTone(risk: ScannerRow["riskBand"]) {
  if (risk === "LOW") {
    return "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-300";
  }
  if (risk === "MEDIUM") {
    return "border-amber-300/20 bg-amber-300/[0.07] text-amber-300";
  }
  return "border-rose-300/20 bg-rose-300/[0.07] text-rose-300";
}

function signed(value: number, digits = 2) {
  return (value >= 0 ? "+" : "") + value.toFixed(digits);
}

function ScoreGauge({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, score) / 100) * circumference;
  const color = scoreTone(score);
  return (
    <div className="relative h-[92px] w-[92px] shrink-0">
      <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90">
        <circle cx="46" cy="46" r={radius} fill="none" stroke="#1c2634" strokeWidth="7" />
        <circle
          cx="46"
          cy="46"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="font-mono text-2xl font-semibold text-white">{score}</span>
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
          {label}
        </span>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  state,
  accent,
}: {
  label: string;
  value: string;
  state: string;
  accent?: "green" | "red" | "amber" | "blue";
}) {
  const tones = {
    green: "text-emerald-300",
    red: "text-rose-300",
    amber: "text-amber-300",
    blue: "text-blue-300",
  };
  return (
    <div className="min-w-0 border-r border-border/80 px-3 py-3 last:border-r-0">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className={"mt-1 truncate font-mono text-[15px] font-semibold " + (accent ? tones[accent] : "text-slate-100")}>
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs text-slate-500">{state}</p>
    </div>
  );
}


export default function Home() {
  const [loadedMarket, setLoadedMarket] = useState("");
  const [historyReload, setHistoryReload] = useState(0);
  const quoteTime = useRef(0);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [symbolInput, setSymbolInput] = useState("BTCUSDT");
  const [style, setStyle] = useState<TradingStyle>("DAY");
  const [interval, setIntervalValue] = useState("60");
  const historyKey = useRef("");
  const [olderLoading, setOlderLoading] = useState(false);
  const [historyEnd, setHistoryEnd] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [candleCheckedAt, setCandleCheckedAt] = useState(0);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [contextCandles, setContextCandles] = useState<Candle[]>([]);
  const [macroCandles, setMacroCandles] = useState<Candle[]>([]);
  const [btcCandles, setBtcCandles] = useState<Candle[]>([]);
  const [ticker, setTicker] = useState<MarketTicker | null>(null);
  const [instrument, setInstrument] = useState<MarketInstrument | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<"LIVE" | "DEMO">("LIVE");
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("CONNECTING");
  const [latency, setLatency] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [scannerRows, setScannerRows] = useState<ScannerRow[]>([]);
  const [scannerMode, setScannerMode] = useState<ScannerMode>("LIVE");
  const [scannerRunning, setScannerRunning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const [scannerNow, setScannerNow] = useState(() => Date.now());
  const [autoScan, setAutoScan] = useState(true);
  const [autoScanMinutes, setAutoScanMinutes] =
    useState<AutoScanMinutes>(15);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("ALL");
  const [directionFilter, setDirectionFilter] =
    useState<DirectionFilter>("BOTH");
  const [symbolCatalog, setSymbolCatalog] = useState<string[]>([]);
  const [inputError, setInputError] = useState<string | null>(null);
  const [accountEquity, setAccountEquity] = useState("10000");
  const [flexibility, setFlexibility] = useState<FlexibilityMode>("STRICT");
  const [takerFeePct, setTakerFeePct] = useState("0.055");
  const [slippagePct, setSlippagePct] = useState("0.02");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [tradeIntent, setTradeIntent] = useState<{id: number; symbol: string; mode: "PAPER" | "MANUAL_LIVE"} | null>(null);
  const [scanUniverse, setScanUniverse] = useState<MarketTicker[]>([]);
  const [scanFailures, setScanFailures] = useState<Record<string, string>>({});
  const [signalTab, setSignalTab] = useState<SignalTab>("signals");
  const openNotifications = useCallback(() => {
    setSignalTab("notifications");
    setNavOpen(false);
    window.setTimeout(() => document.getElementById("signals-center")?.scrollIntoView({behavior: "smooth", block: "start"}), 50);
  }, []);
  const [copied, setCopied] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installHint, setInstallHint] = useState(false);
  const [appInstalled, setAppInstalled] = useState(false);
  const [opportunitiesOpen, setOpportunitiesOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<"PREFERRED" | "MARKET">(
    "PREFERRED",
  );
  const [cloudScanRequest,setCloudScanRequest] = useState(0);
  const [btcDaily, setBtcDaily] = useState<Candle[]>([]);
  const handledCloudScan = useRef(0);
  const scanController = useRef<AbortController | null>(null);
  const scanRunId = useRef(0);
  const scannerRowsRef = useRef<ScannerRow[]>([]);
  const autoScanIntervalMs = autoScanMinutes * 60_000;
  const autoScanIntervalLabel =
    AUTO_SCAN_INTERVALS.find((option) => option.minutes === autoScanMinutes)
      ?.label ?? "15 min";
  const scanLiquidityFloor = STYLE_LIQUIDITY_FLOOR[style];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = Number(window.localStorage.getItem(AUTO_SCAN_INTERVAL_STORAGE_KEY));
        if (isAutoScanInterval(stored)) setAutoScanMinutes(stored);
        const saved = JSON.parse(window.localStorage.getItem("boma-scans:preferences:v1.4") || "{}");
        if (typeof saved.symbol === "string" && /^[A-Z0-9]{2,24}USDT$/.test(saved.symbol)) {setSymbol(saved.symbol);setSymbolInput(saved.symbol);}
        if (TIMEFRAMES.some(frame=>frame.value===saved.interval)) setIntervalValue(saved.interval);
        if (["SCALP","DAY","SWING","POSITION"].includes(saved.style)) setStyle(saved.style);
        if (["STRICT", "BALANCED", "FLEXIBLE"].includes(saved.flexibility)) setFlexibility(saved.flexibility);
        if (Number.isFinite(saved.equity) && saved.equity >= 0) setAccountEquity(String(saved.equity));
        if (typeof saved.autoScan === "boolean") setAutoScan(saved.autoScan);
        if (Number.isFinite(saved.fee) && saved.fee >= 0 && saved.fee <= 0.3) setTakerFeePct(String(saved.fee));
        if (Number.isFinite(saved.slippage) && saved.slippage >= 0 && saved.slippage <= 1) setSlippagePct(String(saved.slippage));
      } catch { /* Corrupt preferences fall back to strict, risk-first defaults. */ }
      setPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      window.localStorage.setItem("boma-scans:preferences:v1.4", JSON.stringify({symbol, interval, style, flexibility, equity: Number(accountEquity), autoScan, fee: Number(takerFeePct), slippage: Number(slippagePct)}));
    } catch { /* Trading gates do not depend on storage availability. */ }
  }, [preferencesReady, symbol, interval, style, flexibility, accountEquity, autoScan, takerFeePct, slippagePct]);

  useEffect(() => {
    const detectInstalled = () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      setAppInstalled(standalone);
    };
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setAppInstalled(true);
      setInstallPrompt(null);
      setInstallHint(false);
    };
    const timer = window.setTimeout(detectInstalled, 0);
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // The live website remains fully usable if installation is unsupported.
      });
    }
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    scannerRowsRef.current = scannerRows;
  }, [scannerRows]);

  useEffect(
    () => () => {
      scanController.current?.abort();
    },
    [],
  );

  const runScan = useCallback(async () => {
    scanController.current?.abort();
    const controller = new AbortController();
    scanController.current = controller;
    const requestId = ++scanRunId.current;
    setScannerRunning(true);
    setScanProgress(5);
    setScanError(null);

    try {
      const executionInterval = interval;
      const [allTickers, instruments, btcHistory, btcDailyCandles] = await Promise.all([
        fetchTickers(controller.signal),
        fetchInstruments(controller.signal).catch(() => []),
        fetchKlines("BTCUSDT", executionInterval, 480, controller.signal).catch(
          () => [],
        ),
        fetchKlines("BTCUSDT", "D", 360, controller.signal).catch(() => [] as Candle[]),
      ]);
      if (btcDailyCandles.length) setBtcDaily(btcDailyCandles);
      const instrumentsBySymbol = new Map(
        instruments.map((item) => [item.symbol, item]),
      );
      const eligible = allTickers
        .filter(
          (item) =>
            item.symbol.endsWith("USDT") &&
            item.turnover24h >= scanLiquidityFloor &&
            !BLACKLIST.has(item.symbol) &&
            (!instrumentsBySymbol.has(item.symbol) || (instrumentsBySymbol.get(item.symbol)?.contractType === "LinearPerpetual" && instrumentsBySymbol.get(item.symbol)?.status === "Trading")),
        )
        .sort((first, second) => second.turnover24h - first.turnover24h);
      setSymbolCatalog(eligible.slice(0, 180).map((item) => item.symbol));
      const candidates = eligible;
      if (controller.signal.aborted || requestId !== scanRunId.current) return [];
      setScanUniverse(candidates);
      setScanFailures({});
      setScannerRows([]);
      const partialRows: ScannerRow[] = [];
      const [contextFrameInterval, macroFrameInterval] =
        contextIntervals(executionInterval);
      let completed = 0;
      setScanProgress(14);
      const rows = await mapWithConcurrency(candidates, 4, async (item) => {
        if (controller.signal.aborted) return null;
        try {
          const [fast, contextFrame, macroFrame] = await Promise.all([
            fetchKlines(item.symbol, executionInterval, 480, controller.signal),
            fetchKlines(item.symbol, contextFrameInterval, 400, controller.signal),
            fetchKlines(item.symbol, macroFrameInterval, 360, controller.signal),
          ]);
          if (fast.length < 31 || contextFrame.length < 31 || macroFrame.length < 31) throw new Error("Insufficient real history on one or more analysis frames");
          // Universe quotes can be several minutes old by the end of a scan.
          // Refresh this pair after downloading its candles, before approving it.
          // If the bulk instrument download failed, fetch this pair's contract
          // limits directly; without them sizing is zero and no signal can qualify.
          const [freshTicker, pairInstrument] = await Promise.all([
            fetchTicker(item.symbol, controller.signal),
            instrumentsBySymbol.has(item.symbol)
              ? Promise.resolve(instrumentsBySymbol.get(item.symbol))
              : fetchInstrument(item.symbol, controller.signal).catch(() => undefined),
          ]);
          const analysis = analyzeMarket(
            fast,
            contextFrame,
            macroFrame,
            freshTicker,
            style,
            { flexibility, takerFeePct: Number(takerFeePct), slippagePct: Number(slippagePct) },
          );
          const btcRelationship = analyzeBtcRelationship(
            item.symbol,
            fast,
            item.symbol === "BTCUSDT" ? fast : btcHistory,
            analysis,
            btcDailyCandles,
          );
          const row = scannerRowFromAnalysis(
            freshTicker,
            analysis,
            false,
            pairInstrument,
            style,
            btcRelationship,
          );
          if (!controller.signal.aborted && requestId === scanRunId.current) {
            partialRows.push(row);
            // Each pair is analysed on fresh data, so it can alert as soon as it
            // qualifies instead of waiting minutes for the full universe.
            setScannerMode("LIVE");
            setLastScan(Date.now());
            setScannerRows([...partialRows].sort((a,b) => b.ratingScore - a.ratingScore));
          }
          return row;
        } catch (error) {
          if (!controller.signal.aborted && requestId === scanRunId.current) {
            setScanFailures(current => ({...current, [item.symbol]: error instanceof Error ? error.message : "Analysis unavailable"}));
          }
          return null;
        } finally {
          completed += 1;
          if (requestId === scanRunId.current) {
            setScanProgress(14 + Math.round((completed / candidates.length) * 82));
          }
        }
      });
      const usable = rows
        .filter((row): row is ScannerRow => Boolean(row))
        .sort(
          (first, second) =>
            second.ratingScore - first.ratingScore ||
            decisionRank(second) - decisionRank(first) ||
            second.entryQuality - first.entryQuality ||
            second.score - first.score,
        );
      if (!usable.length) throw new Error("Technical scans did not return.");
      if (requestId !== scanRunId.current || controller.signal.aborted) {
        return scannerRowsRef.current;
      }
      setScannerRows(usable);
      scannerRowsRef.current = usable;
      setScannerMode("LIVE");
      setLastScan(Date.now());
      setScanProgress(100);
      return usable;
    } catch (error) {
      if (controller.signal.aborted || requestId !== scanRunId.current) {
        return scannerRowsRef.current;
      }
      setScannerMode("OFFLINE");
      setScanError(
        error instanceof Error
          ? error.message
          : "Live scanner unavailable. No recommendation was issued.",
      );
      setScanProgress(100);
      return [];
    } finally {
      if (requestId === scanRunId.current) {
        scanController.current = null;
        setScannerRunning(false);
      }
    }
  }, [scanLiquidityFloor, style, interval, flexibility, takerFeePct, slippagePct]);

  useEffect(() => {
    if (!cloudScanRequest || cloudScanRequest<=handledCloudScan.current) return;
    handledCloudScan.current=cloudScanRequest;void runScan();
  },[cloudScanRequest,runScan]);

  useEffect(() => {
    if (!preferencesReady) return;
    const timer = window.setTimeout(() => void runScan(), 0);
    return () => window.clearTimeout(timer);
  }, [runScan, preferencesReady]);

  useEffect(() => {
    if (!autoScan || !preferencesReady) return;
    // Never abort a scan that is still running; a long scan would otherwise be
    // restarted forever and never produce signals.
    const timer = window.setInterval(() => { if (!scanController.current) void runScan(); }, autoScanIntervalMs);
    return () => window.clearInterval(timer);
  }, [autoScan, autoScanIntervalMs, runScan, preferencesReady]);

  useEffect(() => {
    const clock = window.setInterval(() => setScannerNow(Date.now()), 1_000);
    const refreshVisibleScan = () => {
      if (autoScan && document.visibilityState === "visible" && !scanController.current &&
          (!lastScan || Date.now() - lastScan >= autoScanIntervalMs)) void runScan();
    };
    window.addEventListener("focus", refreshVisibleScan);
    document.addEventListener("visibilitychange", refreshVisibleScan);
    return () => {
      window.clearInterval(clock);
      window.removeEventListener("focus", refreshVisibleScan);
      document.removeEventListener("visibilitychange", refreshVisibleScan);
    };
  }, [autoScan, runScan, lastScan, autoScanIntervalMs]);

  useEffect(() => {
    const context = (
      document as Document & { modelContext?: WebModelContext }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const styles = Object.keys(STYLE_CONFIG);
    const timeframes = TIMEFRAMES.map((item) => item.value);

    try {
      const registrations = [
        context.registerTool(
        {
          name: "start_market_analysis",
          title: "Start market analysis",
          description:
            "Open a Bybit USDT perpetual and begin its visible multi-timeframe technical analysis.",
          inputSchema: {
            type: "object",
            properties: {
              symbol: {
                type: "string",
                description: "Bybit USDT perpetual symbol, such as ETHUSDT.",
              },
              style: { type: "string", enum: styles },
              timeframe: { type: "string", enum: timeframes },
            },
            required: ["symbol"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            untrustedContentHint: false,
          },
          execute(input) {
            const values = input as Record<string, unknown>;
            let next = String(values.symbol ?? "")
              .trim()
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "");
            if (next && !next.endsWith("USDT")) next += "USDT";
            if (!/^[A-Z0-9]{2,24}USDT$/.test(next)) {
              throw new Error("A valid USDT perpetual symbol is required.");
            }
            const nextStyle = String(values.style ?? "");
            const nextTimeframe = String(values.timeframe ?? "");
            const resolvedStyle = styles.includes(nextStyle)
              ? (nextStyle as TradingStyle)
              : style;
            const resolvedTimeframe = timeframes.includes(nextTimeframe)
              ? nextTimeframe
              : styles.includes(nextStyle)
                ? STYLE_CONFIG[resolvedStyle].interval
                : interval;
            if (
              next !== symbol ||
              resolvedStyle !== style ||
              resolvedTimeframe !== interval
            ) {
              setLoading(true);
      quoteTime.current = 0;
      setLoadedMarket("");
              setLastUpdate(null);
              setFeedStatus("CONNECTING");
            }
            setSymbolInput(next);
            setSymbol(next);
            setStyle(resolvedStyle);
            setIntervalValue(resolvedTimeframe);
            return {
              status: "analysis_started",
              symbol: next,
              style: resolvedStyle,
              timeframe: resolvedTimeframe,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
        context.registerTool(
        {
          name: "refresh_market_scanner",
          title: "Refresh market scanner",
          description:
            "Run the visible Bybit market scan and return the strongest liquid USDT perpetual candidates.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            untrustedContentHint: true,
          },
          async execute() {
            const rows = await runScan();
            const recommendations = getMediumRiskShortlist(
              rows,
              Math.max(0, Number(accountEquity) || 0),
              rows.length > 0,
            );
            return {
              status: recommendations.length ? "take_available" : "no_trade",
              recommendations: recommendations.map((pick) => ({
                rank: pick.rank,
                symbol: pick.row.symbol,
                side: pick.row.direction,
                score: pick.row.score,
                trade_rating: pick.row.ratingScore,
                trade_grade: pick.row.ratingGrade,
                relative_risk_band: pick.row.riskBand,
                entry_quality: pick.row.entryQuality,
                entry_grade: pick.row.entryGrade,
                entry: pick.row.entry,
                stop: pick.row.stop,
                tp1: pick.row.tp1,
                tp2: pick.row.tp2,
                tp3: pick.row.tp3,
                tp4: pick.row.tp4,
                tp5: pick.row.tp5,
                target_reliability: pick.row.takeProfits.map((target) => ({
                  level: target.level,
                  price: target.price,
                  reward_r: target.rewardR,
                  confidence: target.confidence,
                  source: target.source,
                  confluence: target.sources,
                })),
                risk_pct: pick.riskPct,
                quantity: pick.quantity,
                leverage: pick.leverage,
                leverage_min: pick.minimumLeverage,
                leverage_max: pick.maximumLeverage,
                isolated_margin: pick.recommendedMargin,
                margin_utilization_pct: pick.marginUtilizationPct,
                weighted_reward_r: pick.row.rr,
                reward_after_spread_r: pick.row.netRewardR,
                spread_cost_r: pick.row.executionCostR,
                spread_limit_r: pick.row.spreadCostLimitR,
                break_even_win_rate_pct: pick.row.breakEvenWinRatePct,
                setup_type: pick.row.setupType,
                setup_threshold: pick.row.setupThreshold,
                signal_basis: "last_closed_candle",
                btc_relationship: pick.row.btcRelationship.relationship,
                btc_rolling_bars: pick.row.btcRelationship.historyBars,
                btc_correlation: pick.row.btcRelationship.correlation,
                btc_beta: pick.row.btcRelationship.beta,
                btc_divergence: pick.row.btcRelationship.divergence,
                btc_divergence_verdict:
                  pick.row.btcRelationship.divergenceVerdict,
                leverage_reason: pick.leverageRationale,
              })),
              candidates: rows.map((row) => ({
                symbol: row.symbol,
                direction: row.direction,
                decision: row.decision,
                score: row.score,
                trade_rating: row.ratingScore,
                trade_grade: row.ratingGrade,
                relative_risk_band: row.riskBand,
                risk_reason: row.riskReason,
                setup_type: row.setupType,
                entry_ready: row.entryReady,
                entry_quality: row.entryQuality,
                btc_correlation: row.btcRelationship.correlation,
                btc_beta: row.btcRelationship.beta,
                btc_divergence: row.btcRelationship.divergence,
                btc_divergence_verdict:
                  row.btcRelationship.divergenceVerdict,
              })),
            };
          },
        },
        { signal: lifecycle.signal },
      ),
      ];

      void Promise.all(registrations.map((item) => Promise.resolve(item))).catch(
        () => undefined,
      );
    } catch {
      lifecycle.abort();
    }
    return () => lifecycle.abort();
  }, [accountEquity, interval, runScan, style, symbol]);

  useEffect(() => {
    const controller = new AbortController();
    const [contextInterval, macroInterval] = contextIntervals(interval);
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadedMarket("");
      setCandleCheckedAt(0);
      setLoadError(null);
      setFeedStatus("CONNECTING");
      setLastUpdate(null);
      setInstrument(null);
      setBtcCandles([]);

      Promise.all([
        fetchKlines(symbol, interval, 1000, controller.signal),
        fetchKlines(symbol, contextInterval, 1000, controller.signal),
        fetchKlines(symbol, macroInterval, 1000, controller.signal),
        fetchTicker(symbol, controller.signal),
        fetchInstrument(symbol, controller.signal).catch(() => null),
        symbol === "BTCUSDT"
          ? Promise.resolve<Candle[]>([])
          : fetchKlines("BTCUSDT", interval, 720, controller.signal).catch(
              () => [],
            ),
      ])
        .then(
          ([primary, context, macro, nextTicker, nextInstrument, nextBtc]) => {
          if (controller.signal.aborted) return;
          if (primary.length < 31 || context.length < 31 || macro.length < 31) throw new Error("Insufficient real history; demo is shown with trading disabled.");
          const sameHistory = historyKey.current === symbol + ":" + interval;
          setCandles(previous => sameHistory ? mergeHistory(previous, primary) : primary);
          if (!sameHistory) {setHistoryEnd(false); setHistoryError("");}
          historyKey.current = symbol + ":" + interval;
          setCandleCheckedAt(Date.now());
          setContextCandles(context);
          setMacroCandles(macro);
          setBtcCandles(symbol === "BTCUSDT" ? primary : nextBtc);
          setTicker(nextTicker);
          setInstrument(nextInstrument);
          setDataMode("LIVE");
          quoteTime.current = nextTicker.updatedAt ?? 0;
          setLastUpdate(quoteTime.current);
          setLoadedMarket(symbol + ":" + interval);
          },
        )
        .catch((error) => {
          if (controller.signal.aborted) return;
          const primary = generateDemoCandles(symbol, interval, 720);
          const context = generateDemoCandles(symbol, contextInterval, 600);
          const macro = generateDemoCandles(symbol, macroInterval, 500);
          const last = primary[primary.length - 1].close;
          setCandles(primary);
          setContextCandles(context);
          setMacroCandles(macro);
          setBtcCandles(
            symbol === "BTCUSDT"
              ? primary
              : generateDemoCandles("BTCUSDT", interval, 720),
          );
          setTicker(
            normalizeTicker({
              symbol,
              lastPrice: last,
              markPrice: last,
              indexPrice: last,
              price24hPcnt: 0,
              turnover24h: 0,
              fundingRate: 0,
              bid1Price: last,
              ask1Price: last,
            }),
          );
          setInstrument(null);
          setDataMode("DEMO");
          setFeedStatus("OFFLINE");
          setLoadError(
            error instanceof Error
              ? error.message
              : "Live history unavailable; showing labeled demo data.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [interval, symbol, historyReload]);

  useEffect(() => {
    if (dataMode !== "LIVE" || loading || loadedMarket !== symbol + ":" + interval) return;
    const [contextInterval, macroInterval] = contextIntervals(interval);
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeat: number | null = null;
    let stopped = false;
    let attempts = 0;

    function connect() {
      if (stopped) return;
      attempts += 1;
      setFeedStatus(attempts > 3 ? "POLLING" : "CONNECTING");
      socket = new WebSocket("wss://stream.bybit.com/v5/public/linear");

      socket.onopen = () => {
        attempts = 0;
        setFeedStatus("LIVE");
        const topics = [
          "tickers." + symbol,
          "kline." + interval + "." + symbol,
          "kline." + contextInterval + "." + symbol,
          "kline." + macroInterval + "." + symbol,
        ];
        if (symbol !== "BTCUSDT") {
          topics.push("kline." + interval + ".BTCUSDT");
        }
        socket?.send(
          JSON.stringify({
            op: "subscribe",
            args: topics,
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
          if (stopped) return;
          if (message.topic === "tickers." + symbol && message.data) {
            const raw = Array.isArray(message.data) ? message.data[0] : message.data;
            if (!raw || (raw.symbol && raw.symbol !== symbol) || !message.ts ||
                message.ts < quoteTime.current || !quoteIsFresh(message.ts)) return;
            const price = asNumber(raw.lastPrice);
            if (raw.lastPrice !== undefined && !acceptQuote(quoteTime.current, message.ts, price)) return;
            quoteTime.current = message.ts;
            setLatency(Math.max(0, Date.now() - message.ts));
            setLastUpdate(message.ts);
            setFeedStatus("LIVE");
            setTicker((previous) => mergeTickerDelta(previous, raw, symbol));
            if (price > 0 && dataMode === "LIVE") {
              setCandles((previous) => {
                if (!previous.length) return previous;
                const current = previous[previous.length - 1];
                const duration = INTERVAL_MS[interval];
                if (duration && Date.now() >= current.time + duration) return previous;
                const updated = {
                  ...current,
                  close: price,
                  high: Math.max(current.high, price),
                  low: Math.min(current.low, price),
                };
                return previous.slice(0, -1).concat(updated);
              });
            }
          } else if (dataMode === "LIVE" && message.topic?.startsWith("kline.")) {
            const raw = Array.isArray(message.data) ? message.data[0] : message.data;
            if (!raw) return;
            const next: Candle = {
              time: asNumber(raw.start),
              open: asNumber(raw.open),
              high: asNumber(raw.high),
              low: asNumber(raw.low),
              close: asNumber(raw.close),
              volume: asNumber(raw.volume),
            };
            if (!next.time || !next.close) return;
            const mergeCandle = (previous: Candle[], maximum: number) => {
              const current = previous[previous.length - 1];
              if (!current) return [next];
              if (current.time === next.time) return previous.slice(0, -1).concat(next);
              if (next.time > current.time) return previous.concat(next);
              return previous;
            };
            if (message.topic === "kline." + interval + "." + symbol) {
              setCandles((previous) => mergeCandle(previous, 720));
            } else if (
              message.topic === "kline." + contextInterval + "." + symbol
            ) {
              setContextCandles((previous) => mergeCandle(previous, 600));
            } else if (
              message.topic === "kline." + macroInterval + "." + symbol
            ) {
              setMacroCandles((previous) => mergeCandle(previous, 500));
            } else if (
              symbol !== "BTCUSDT" &&
              message.topic === "kline." + interval + ".BTCUSDT"
            ) {
              setBtcCandles((previous) => mergeCandle(previous, 720));
            }
          }
        } catch {
          // Ignore malformed exchange frames and keep the last valid market state.
        }
      };

      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (heartbeat) window.clearInterval(heartbeat);
        if (stopped) return;
        setFeedStatus(attempts >= 3 ? "POLLING" : "CONNECTING");
        reconnectTimer = window.setTimeout(connect, Math.min(12_000, 1_500 * 2 ** attempts));
      };
    }

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (heartbeat) window.clearInterval(heartbeat);
      socket?.close();
    };
  }, [dataMode, interval, symbol, loading, loadedMarket]);

  // REST remains available even after a socket or polling failure; never stop retries.
  useEffect(() => {
    if (dataMode !== "LIVE" || loading || loadedMarket !== symbol + ":" + interval) return;
    const controller = new AbortController();
    let busy = false;
    async function poll() {
      if (busy) return;
      busy = true;
      try {
        const [contextFrame, macroFrame] = contextIntervals(interval);
        const [next, recentBars, recentContext, recentMacro] = await Promise.all([
          fetchTicker(symbol, controller.signal), fetchKlines(symbol, interval, 3, controller.signal),
          fetchKlines(symbol, contextFrame, 3, controller.signal), fetchKlines(symbol, macroFrame, 3, controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setCandles(previous => mergeHistory(previous, recentBars));
          setContextCandles(previous => mergeHistory(previous, recentContext));
          setMacroCandles(previous => mergeHistory(previous, recentMacro));
          setCandleCheckedAt(Date.now());
        }
        if (!controller.signal.aborted && acceptQuote(quoteTime.current, next.updatedAt ?? 0, next.lastPrice)) {
          quoteTime.current = next.updatedAt!;
          setTicker(next);
          setLastUpdate(next.updatedAt!);
          setFeedStatus(status => status === "LIVE" ? status : "POLLING");
        }
      } catch {
        if (!controller.signal.aborted && !quoteIsFresh(quoteTime.current)) setFeedStatus("OFFLINE");
      } finally { busy = false; }
    }
    const onVisible = () => {if (document.visibilityState === "visible") {void poll(); setHistoryReload(value => value + 1);}};
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void poll(), 5_000);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [dataMode, symbol, interval, loading, loadedMarket]);

  // Recover failed history loads and refill candles missed during a disconnection.
  useEffect(() => {
    if (loading) return;
    const latest = candles.at(-1);
    const missingCandle = !latest || Date.now() > latest.time + (INTERVAL_MS[interval] ?? 900_000) + 10_000;
    if (dataMode === "LIVE" && !missingCandle) return;
    const timer = window.setTimeout(() => setHistoryReload(value => value + 1), 15_000);
    return () => window.clearTimeout(timer);
  }, [loading, dataMode, candles, interval, Math.floor(scannerNow / 30_000)]);

  const candlesCurrent = dataMode === "LIVE" && candleFeedFresh(candles, INTERVAL_MS[interval] ?? 3_600_000, scannerNow) && scannerNow - candleCheckedAt < 20_000;
  async function loadOlderCandles() {
    if (olderLoading || !candles.length || dataMode !== "LIVE") return;
    const key = symbol + ":" + interval;
    setOlderLoading(true); setHistoryError("");
    try {
      const older = await fetchKlines(symbol, interval, 1000, undefined, candles[0].time - 1);
      if (historyKey.current !== key) return;
      setCandles(previous => mergeHistory(older, previous));
      if (older.length < 1000) setHistoryEnd(true);
    } catch (error) {if (historyKey.current === key) setHistoryError(error instanceof Error ? error.message : "Older candles unavailable; retry.");}
    finally {setOlderLoading(false);}
  }

  const rawAnalysis = useMemo(
    () =>
      analyzeMarket(
        candles,
        contextCandles,
        macroCandles,
        dataMode === "LIVE" ? ticker : null,
        style,
        {flexibility, takerFeePct: Number(takerFeePct), slippagePct: Number(slippagePct)},
      ),
    [candles, contextCandles, dataMode, macroCandles, ticker, style, flexibility, takerFeePct, slippagePct],
  );
  const applyCloudWorkspace = useCallback((items: {key:string;value:unknown}[]) => {
    const value = items.find(item=>item.key==="workspace")?.value as Record<string,unknown> | undefined;
    if (!value || typeof value.symbol !== "string" || !/^[A-Z0-9]{2,24}USDT$/.test(value.symbol) || !TIMEFRAMES.some(frame=>frame.value===value.interval)) return;
    setSymbol(value.symbol); setSymbolInput(value.symbol); setIntervalValue(String(value.interval));
    if(typeof value.scanRequestedAt === "number" && Date.now()-value.scanRequestedAt<60000) setCloudScanRequest(value.scanRequestedAt);
    if(["ALL","LOW","MEDIUM","HIGH"].includes(String(value.riskFilter))) setRiskFilter(value.riskFilter as RiskFilter);
    if(["BOTH","LONG","SHORT"].includes(String(value.directionFilter))) setDirectionFilter(value.directionFilter as DirectionFilter);
    if (["SCALP","DAY","SWING","POSITION"].includes(String(value.style))) setStyle(value.style as TradingStyle);
    if (["STRICT","BALANCED","FLEXIBLE"].includes(String(value.flexibility))) setFlexibility(value.flexibility as FlexibilityMode);
    if (typeof value.equity === "number" && Number.isFinite(value.equity) && value.equity>=0) setAccountEquity(String(value.equity));
    if (typeof value.autoScan === "boolean") setAutoScan(value.autoScan);
    if (isAutoScanInterval(Number(value.autoScanMinutes))) setAutoScanMinutes(Number(value.autoScanMinutes) as AutoScanMinutes);
    if (typeof value.fee === "number" && value.fee>=0 && value.fee<=0.3) setTakerFeePct(String(value.fee));
    if (typeof value.slippage === "number" && value.slippage>=0 && value.slippage<=1) setSlippagePct(String(value.slippage));
  }, []);
  const workspaceSync = useAccountSync("workspace", [{key:"workspace",value:{symbol,interval,style,flexibility,equity:Number(accountEquity),autoScan,autoScanMinutes,riskFilter,directionFilter,scanRequestedAt:cloudScanRequest,fee:Number(takerFeePct),slippage:Number(slippagePct)}}], applyCloudWorkspace, preferencesReady);
  const planKey = [symbol, interval, style, flexibility].join(":");
  const [lockedPlan, setLockedPlan] = useState<LockedPlan | null>(null);
  const activeLock = lockedPlan?.key === planKey ? lockedPlan : null;
  const lockFailure = activeLock ? lockedPlanFailure(activeLock, ticker?.lastPrice ?? 0, candles, scannerNow) : undefined;
  useEffect(() => {
    if (activeLock) {
      if (lockFailure && !activeLock.invalidReason) setLockedPlan({...activeLock, invalidReason: lockFailure});
      return;
    }
    if (!loading && loadedMarket === symbol + ":" + interval && dataMode === "LIVE" &&
        quoteIsFresh(lastUpdate) && rawAnalysis.entryReady && rawAnalysis.executionPlan.status === "READY") {
      setLockedPlan({key: planKey, capturedAt: Date.now(), capturedCandleTime: candles.at(-1)?.time, analysis: structuredClone(rawAnalysis)});
    }
  }, [activeLock, lockFailure, loading, loadedMarket, symbol, interval, dataMode, lastUpdate, rawAnalysis, planKey, candles]);
  const lockedQualityFailure = activeLock && (rawAnalysis.bias !== activeLock.analysis.bias ||
    rawAnalysis.entryChecks.some(check => check.required && check.id !== "trigger" && check.status === "FAIL"))
    ? "Live technical checks no longer support this frozen plan. Do not enter; review a new plan." : undefined;
  const analysis = activeLock
    ? cancelLockedAnalysis(activeLock.analysis, lockFailure || lockedQualityFailure)
    : rawAnalysis;
  const btcRelationship = useMemo(
    () =>
      analyzeBtcRelationship(
        symbol,
        candles,
        symbol === "BTCUSDT" ? candles : btcCandles,
        analysis,
        btcDaily,
      ),
    [analysis, btcCandles, candles, symbol, btcDaily],
  );
  const currentPrice =
    (dataMode === "LIVE" ? ticker?.lastPrice : 0) ||
    candles[candles.length - 1]?.close ||
    analysis.entry;
  const change24h = (ticker?.price24hPcnt ?? 0) * 100;
  const spread =
    ticker?.ask1Price && ticker?.bid1Price && currentPrice
      ? ((ticker.ask1Price - ticker.bid1Price) / currentPrice) * 100
      : 0;
  const intervalLabel =
    TIMEFRAMES.find((item) => item.value === interval)?.label ?? interval;
  const equity = Math.max(0, Number(accountEquity) || 0);
  const liveDataReady = candlesCurrent && dataMode === "LIVE" && !loading && loadedMarket === symbol + ":" + interval &&
    (feedStatus === "LIVE" || feedStatus === "POLLING") && quoteIsFresh(lastUpdate, scannerNow);
  const setupReady =
    liveDataReady && Boolean(instrument?.maxLeverage && instrument.quantityStep) && btcRelationship.divergenceVerdict !== "REJECT" &&
    analysis.decision === "SETUP" &&
    analysis.entryReady && !entryExecutionBlocker(analysis.executionPlan, currentPrice, scannerNow);
  const adaptiveLeveragePlan = buildAdaptiveLeveragePlan({
    accountEquity: equity,
    targetRiskPct: btcRelationship.divergenceVerdict === "CAUTION" ? Math.min(analysis.riskMultiplier, 0.5) : analysis.riskMultiplier,
    entry: analysis.entry,
    stop: analysis.stop,
    score: analysis.score,
    regime: analysis.regime,
    setupType: analysis.setupType,
    trendFrames: analysis.metrics.trendFrames,
    atrPct: analysis.metrics.atrPct,
    adx: analysis.metrics.adx,
    style,
    actionable: setupReady,
    exchangeMaxLeverage: instrument?.maxLeverage,
    quantityStep: instrument?.quantityStep,
    minOrderQty: instrument?.minOrderQty,
    minNotionalValue: instrument?.minNotionalValue,
  });
  const plannedRiskAtStop = adaptiveLeveragePlan.actualRiskAmount;
  const plannedQuantity = adaptiveLeveragePlan.quantity;
  const plannedLeverage = adaptiveLeveragePlan.recommendedLeverage;
  const sizingReady = setupReady && plannedLeverage > 0 && plannedQuantity > 0;
  const riskDollars = sizingReady ? plannedRiskAtStop : 0;
  const activeRiskPct = equity ? (riskDollars / equity) * 100 : 0;
  const leverageLabel = sizingReady ? plannedLeverage + "×" : "GATED";
  const leverageBandLabel = adaptiveLeveragePlan.minimumLeverage
    ? adaptiveLeveragePlan.minimumLeverage === adaptiveLeveragePlan.maximumLeverage
      ? adaptiveLeveragePlan.maximumLeverage + "×"
      : adaptiveLeveragePlan.minimumLeverage +
        "–" +
        adaptiveLeveragePlan.maximumLeverage +
        "×"
    : "—";
  const currentEntryStatus =
    !liveDataReady || !instrument?.maxLeverage || !instrument.quantityStep || entryExecutionBlocker(analysis.executionPlan, currentPrice, scannerNow, true)
      ? ("AVOID" as const)
      : btcRelationship.divergenceVerdict === "REJECT"
        ? ("AVOID" as const)
        : btcRelationship.divergenceVerdict === "CAUTION" &&
            analysis.immediateEntry.status === "ALLOW"
          ? ("CAUTION" as const)
          : analysis.immediateEntry.status;
  const currentEntryStatusReason =
    !liveDataReady
      ? "A verified live quote is required before a current-price entry can be considered."
      : !instrument?.maxLeverage || !instrument.quantityStep
        ? "Verified exchange quantity and leverage limits are required."
      : entryExecutionBlocker(analysis.executionPlan, currentPrice, scannerNow, true)
        ? entryExecutionBlocker(analysis.executionPlan, currentPrice, scannerNow, true)!
      : btcRelationship.divergenceVerdict === "REJECT"
        ? "The pair's rolling BTC relationship rejects this divergence at the current price."
        : btcRelationship.divergenceVerdict === "CAUTION" &&
            analysis.immediateEntry.status === "ALLOW"
          ? "The technical entry is valid, but BTC divergence downgrades it to reduced-size caution."
          : analysis.immediateEntry.status === "ALLOW"
            ? "Price, structure, execution cost and nearby objectives support a reduced-risk entry now."
            : analysis.immediateEntry.status === "CAUTION"
              ? "Entry timing is confirmed; mixed supporting evidence requires reduced size."
              : analysis.immediateEntry.warnings[2];
  const immediateLeverageCap = Math.max(
    1,
    Math.floor(
      Math.min(
        instrument?.maxLeverage ?? ADAPTIVE_STYLE_MAX_LEVERAGE[style],
        ADAPTIVE_STYLE_MAX_LEVERAGE[style] *
          (currentEntryStatus === "ALLOW" ? 0.7 : currentEntryStatus === "CAUTION" ? 0.45 : 0),
      ),
    ),
  );
  const immediateLeveragePlan = buildAdaptiveLeveragePlan({
    accountEquity: equity,
    targetRiskPct: currentEntryStatus === "ALLOW" ? 0.45 : 0.25,
    entry: analysis.immediateEntry.entry,
    stop: analysis.immediateEntry.stop,
    score: analysis.immediateEntry.score,
    regime: analysis.regime,
    setupType: analysis.setupType,
    trendFrames: analysis.metrics.trendFrames,
    atrPct: analysis.metrics.atrPct,
    adx: analysis.metrics.adx,
    style,
    actionable:
      dataMode === "LIVE" &&
      feedStatus === "LIVE" &&
      currentEntryStatus !== "AVOID",
    exchangeMaxLeverage: immediateLeverageCap,
    quantityStep: instrument?.quantityStep,
    minOrderQty: instrument?.minOrderQty,
    minNotionalValue: instrument?.minNotionalValue,
  });
  const immediateSizingReady = Boolean(
    instrument?.maxLeverage && instrument.quantityStep && currentEntryStatus !== "AVOID" &&
      immediateLeveragePlan.recommendedLeverage > 0 &&
      immediateLeveragePlan.quantity > 0,
  );
  const activeLeveragePlan =
    entryMode === "MARKET" ? immediateLeveragePlan : adaptiveLeveragePlan;
  const activeSizingReady =
    entryMode === "MARKET" ? immediateSizingReady : sizingReady;

  const scannerStaleAfterMs = autoScan
    ? autoScanIntervalMs + SCANNER_REFRESH_GRACE_MS
    : SCANNER_MANUAL_STALE_AFTER_MS;
  const scannerLive = Boolean(
    scannerMode === "LIVE" &&
      !scanError &&
      lastScan &&
      scannerNow - lastScan <= scannerStaleAfterMs,
  );
  const mediumRiskPicks = getMediumRiskShortlist(scannerRows, equity, scannerLive);
  const signalAlerts = useSignalAlerts({rows: scannerRows, equity, live: scannerLive,
    scanAt: lastScan, scope: style + ":" + flexibility, now: scannerNow, partial: scannerRunning, onOpen: openNotifications});
  const analyzedSymbols = new Set(scannerRows.map(row => row.symbol));
  const pendingMarkets = scanUniverse.filter(item => !analyzedSymbols.has(item.symbol));
  const selectedRatedRow = ticker ? scannerRowFromAnalysis(ticker, analysis, dataMode !== "LIVE", instrument ?? undefined, style, btcRelationship) : null;

  const closestCandidate =
    scannerRows.find((row) => !isMediumRiskTake(row, scannerLive)) ?? null;
  const filteredRows = scannerRows.filter((row) => {
    const riskMatches = riskFilter === "ALL" || row.riskBand === riskFilter;
    const directionMatches =
      directionFilter === "BOTH" || row.bias === directionFilter;
    return riskMatches && directionMatches;
  });
  const riskCounts = scannerRows.reduce(
    (counts, row) => {
      counts[row.riskBand] += 1;
      return counts;
    },
    { LOW: 0, MEDIUM: 0, HIGH: 0 },
  );

  function chooseStyle(next: TradingStyle) {
    if (next === style && STYLE_CONFIG[next].interval === interval) return;
    setLoading(true);
    setLastUpdate(null);
    setFeedStatus("CONNECTING");
    setStyle(next);
    setIntervalValue(STYLE_CONFIG[next].interval);
  }

  function toggleAutoScan(enabled: boolean) {
    setAutoScan(enabled);
    if (enabled) void runScan();
  }

  function chooseAutoScanInterval(value: string) {
    const minutes = Number(value);
    if (!isAutoScanInterval(minutes)) return;
    setAutoScanMinutes(minutes);
    window.localStorage.setItem(
      AUTO_SCAN_INTERVAL_STORAGE_KEY,
      String(minutes),
    );
    if (autoScan) void runScan();
  }

  function chooseInterval(next: string) {
    if (next === interval) return;
    setLoading(true);
    setLastUpdate(null);
    setFeedStatus("CONNECTING");
    setIntervalValue(next);
  }

  function submitSymbol(event: FormEvent) {
    event.preventDefault();
    let next = symbolInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (next && !next.endsWith("USDT")) next += "USDT";
    if (!/^[A-Z0-9]{2,24}USDT$/.test(next)) {
      setInputError("Enter a valid USDT perpetual, such as ETHUSDT.");
      return;
    }
    setInputError(null);
    if (next !== symbol) {
      setLoading(true);
      setLastUpdate(null);
      setFeedStatus("CONNECTING");
    }
    setSymbol(next);
    setSymbolInput(next);
  }

  function selectScannerSymbol(next: string) {
    if (next !== symbol) {
      setLoading(true);
      setLastUpdate(null);
      setFeedStatus("CONNECTING");
    }
    setSymbol(next);
    setSymbolInput(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectScannerRecommendation(row: Pick<ScannerRow, "symbol" | "style"> & {executionPlan?: ScannerRow["executionPlan"]}) {
    const frame = row.executionPlan?.timeframe;
    const minutes = frame?.endsWith("h") ? String(Number(frame.slice(0, -1)) * 60) : frame?.endsWith("m") ? frame.slice(0, -1) : "";
    const nextInterval = TIMEFRAMES.some(item => item.value === minutes) ? minutes : row.style === style ? interval : STYLE_CONFIG[row.style].interval;
    if (row.symbol !== symbol || style !== row.style || interval !== nextInterval) {
      setLoading(true);
      setLastUpdate(null);
      setFeedStatus("CONNECTING");
    }
    setStyle(row.style);
    setIntervalValue(nextInterval);
    setSymbol(row.symbol);
    setSymbolInput(row.symbol);
    setEntryMode("PREFERRED");
    window.setTimeout(() => document.getElementById("chart-focus")?.scrollIntoView({behavior: "smooth", block: "start"}), 50);
  }

  function reviewSignal(signal: Pick<SignalSnapshot, "symbol" | "style" | "flexibility">) {
    setFlexibility(signal.flexibility);
    selectScannerRecommendation(signal);
  }

  function requestTrade(row: ScannerRow, mode: "PAPER" | "MANUAL_LIVE") {
    selectScannerRecommendation(row);
    setOpportunitiesOpen(false);
    setTradeIntent({id: Date.now(), symbol: row.symbol, mode});
    window.setTimeout(() => document.getElementById("trade-manager")?.scrollIntoView({behavior: "smooth", block: "start"}), 100);
  }

  function navigateSection(id: string) {
    setNavOpen(false);
    if (id === "notifications") { openNotifications(); return; }
    if (id === "signals-center") setSignalTab("signals");
    if (id === "opportunities") setOpportunitiesOpen(true);
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({behavior: "smooth", block: "start"}), 50);
  }

  async function installApp() {
    if (appInstalled) return;
    if (!installPrompt) {
      setInstallHint(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") {
      setAppInstalled(true);
      setInstallHint(false);
    }
  }

  async function copyPlan() {
    if (entryMode === "MARKET") {
      const immediatePlan = [
        "Boma Scans " + symbol + " " + intervalLabel,
        "ENTER NOW · " + currentEntryStatus + " · " + analysis.bias,
        "Current-entry quality: " + analysis.immediateEntry.score + "/100",
        "Reason: " + currentEntryStatusReason,
        "Entry: " + formatPrice(analysis.immediateEntry.entry),
        "Hard stop: " + formatPrice(analysis.immediateEntry.stop),
        ...analysis.immediateEntry.targets.map(
          (target) =>
            "Close TP" +
            target.level +
            ": " +
            (target.available ? formatPrice(target.price) : "UNCONFIRMED") +
            " · " +
            target.distancePct.toFixed(2) +
            "% · " +
            target.rewardR.toFixed(2) +
            "R · exit " +
            target.exitPct +
            "% · " +
            target.source,
        ),
        "Weighted close-target reward: " +
          analysis.immediateEntry.weightedRewardR.toFixed(2) +
          "R",
        "Maximum stop-risk: " +
          (currentEntryStatus === "AVOID" ? 0 : currentEntryStatus === "ALLOW" ? 0.45 : 0.25).toFixed(2) +
          "% of account equity",
        "Adaptive leverage: " +
          (immediateSizingReady
            ? immediateLeveragePlan.recommendedLeverage + "×"
            : "GATED"),
        "BTC context: " +
          btcRelationship.relationship +
          " · divergence " +
          btcRelationship.divergenceVerdict,
        ...analysis.immediateEntry.reasoning.map(
          (reason) => "Reasoning: " + reason,
        ),
        "Invalidation: " + analysis.immediateEntry.invalidationText,
        ...analysis.executionPlan.steps.map((step, index) => (index + 1) + ". " + step),
        "Cancel: " + analysis.executionPlan.cancelText,
        "Close targets still require a structural stop and the same no-chase gate.",
      ].join("\n");
      try {
        await navigator.clipboard.writeText(immediatePlan);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_600);
      } catch {
        setCopied(false);
      }
      return;
    }
    const planDecision = preferredDecisionLabel;
    const plan = [
      "Boma Scans " + symbol + " " + intervalLabel,
      planDecision + " · score " + analysis.score + "/100",
      "Entry quality: " + analysis.entryGrade + " · " + analysis.entryQuality + "/100",
      "Setup type: " + analysis.setupType,
      ...analysis.entryChecks.map(
        (check) =>
          "Entry check " +
          check.status +
          ": " +
          check.label +
          " — " +
          check.detail,
      ),
      "Entry action: " + analysis.executionPlan.headline,
      ...analysis.executionPlan.steps.map((step, index) => (index + 1) + ". " + step),
      "Cancel rule: " + analysis.executionPlan.cancelText,
      "Stop: " + formatPrice(analysis.stop),
      ...analysis.takeProfits.map(
        (target) =>
          "TP" +
          target.level +
          ": " +
          (target.available ? formatPrice(target.price) : "UNCONFIRMED") +
          " · " +
          target.rewardR.toFixed(2) +
          "R · " +
          target.confidence +
          " · " +
          target.source,
      ),
      "Target reliability: " +
        analysis.metrics.targetReliability +
        "/100 · " +
        analysis.metrics.structuralTargets +
        "/5 structurally supported",
      "Candle pattern: " + analysis.metrics.candlestickPattern,
      "Weighted exit reward: " + analysis.rr.toFixed(2) + "R",
      "Reward after estimated execution costs: " + analysis.metrics.netRewardR.toFixed(2) + "R; funding excluded",
      "Break-even win rate: " + analysis.metrics.breakEvenWinRatePct.toFixed(1) + "% with estimated execution costs; funding excluded",
      "Signal basis: last closed candle · " + analysis.metrics.executionCandles + "/" + analysis.metrics.contextCandles + "/" + analysis.metrics.macroCandles + " bars",
      "BTC relationship: " +
        btcRelationship.relationship +
        " · rolling " +
        btcRelationship.historyBars +
        " bars · correlation " +
        (btcRelationship.correlation === null
          ? "unavailable"
          : signed(btcRelationship.correlation)) +
        " · beta " +
        (btcRelationship.beta === null
          ? "unavailable"
          : btcRelationship.beta.toFixed(2)),
      "BTC divergence: " +
        btcRelationship.divergence +
        " · " +
        btcRelationship.divergenceVerdict +
        " — " +
        btcRelationship.explanation,
      "Adaptive leverage: " +
        leverageLabel +
        " · permitted band " +
        leverageBandLabel +
        (sizingReady ? "" : " (activate only after TAKE and valid order sizing)"),
      "Leverage logic: " + adaptiveLeveragePlan.rationale,
      "Isolated margin at setting: " +
        (sizingReady
          ? compactNumber(adaptiveLeveragePlan.recommendedMargin) + " USDT"
          : "GATED"),
      "Risk: " + activeRiskPct.toFixed(2) + "% (medium profile)",
      "Decision support only — verify before trading.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(plan);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  }

  const feedLive = liveDataReady;
  const preferredDecisionLabel =
    !liveDataReady ? "DATA NOT READY" : !instrument?.maxLeverage || !instrument.quantityStep ? "EXCHANGE LIMITS MISSING" : btcRelationship.divergenceVerdict === "REJECT" ? "BTC REJECT" : setupReady
      ? "TAKE " + analysis.bias
      : analysis.decision === "SETUP"
        ? "WAIT FOR " +
          (analysis.setupType === "CHoCH REVERSAL" ? "RETEST" : "TRIGGER")
        : analysis.decision === "WATCH"
          ? "WATCH " + analysis.bias
          : "STAND ASIDE";
  const activePlanEntry =
    entryMode === "MARKET" ? analysis.immediateEntry.entry : analysis.entry;
  const activePlanStop =
    entryMode === "MARKET" ? analysis.immediateEntry.stop : analysis.stop;
  const activePlanTargets =
    entryMode === "MARKET"
      ? analysis.immediateEntry.targets
      : analysis.takeProfits;
  const activePlanStatus =
    entryMode === "MARKET" ? currentEntryStatus : preferredDecisionLabel;
  const activeStatusTone =
    entryMode === "MARKET"
      ? currentEntryStatus === "ALLOW"
        ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
        : currentEntryStatus === "AVOID"
          ? "border-rose-300/25 bg-rose-300/10 text-rose-200"
          : "border-amber-300/25 bg-amber-300/10 text-amber-200"
      : setupReady
        ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
        : analysis.decision === "NO TRADE"
          ? "border-rose-300/25 bg-rose-300/10 text-rose-200"
          : "border-amber-300/25 bg-amber-300/10 text-amber-200";
  const activeLeverageLabel = activeSizingReady
    ? activeLeveragePlan.recommendedLeverage + "×"
    : "GATED";
  const activeRiskLabel = activeSizingReady
    ? activeLeveragePlan.actualRiskPct.toFixed(2) + "%"
    : entryMode === "MARKET"
      ? currentEntryStatus === "AVOID" ? "GATED" : "≤" + (currentEntryStatus === "ALLOW" ? "0.45" : "0.25") + "%"
      : "≤" + analysis.riskMultiplier.toFixed(2) + "%";

  return (
    <main className="min-h-screen overflow-x-hidden pb-20 text-foreground md:pb-6">
      <Toaster position="top-right" theme="dark" />
      <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#05090f]/90 backdrop-blur-2xl">
        <div className="mx-auto flex min-h-[72px] max-w-[1680px] flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
          <button type="button" aria-label="Open navigation" onClick={() => setNavOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-400 hover:text-cyan-200"><Menu className="h-5 w-5"/></button>
          <div className="flex min-w-[170px] items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 shadow-[0_0_32px_-12px_rgba(103,232,249,0.8)]">
              <Activity className="h-5 w-5 text-cyan-200" strokeWidth={2.2} />
            </span>
            <div>
              <p className="text-base font-bold tracking-[-0.03em] text-white">
                Boma Scans
              </p>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Live trade cockpit
              </p>
            </div>
          </div>

          <form
            onSubmit={submitSymbol}
            className="order-3 flex min-w-[270px] flex-1 items-center gap-2 md:order-none md:max-w-xl"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={symbolInput}
                onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
                list="market-symbols"
                aria-label="Bybit USDT perpetual symbol"
                placeholder="Search a Bybit pair"
                className="h-10 rounded-xl border-white/[0.08] bg-white/[0.04] pl-10 font-mono text-sm uppercase text-white placeholder:text-slate-500"
              />
              <datalist id="market-symbols">
                {symbolCatalog.map((item) => (
                  <option value={item} key={item} />
                ))}
              </datalist>
            </div>
            <Button
              type="submit"
              size="sm"
              className="h-10 rounded-xl bg-cyan-200 px-4 font-semibold text-slate-950 hover:bg-cyan-100"
            >
              Analyze
            </Button>
          </form>

          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={openNotifications} aria-label={"Open notifications, " + signalAlerts.unread + " unread"} className="relative grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-200 hover:bg-cyan-300/10"><Bell className="h-5 w-5"/>{signalAlerts.unread > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-rose-500 px-1 text-center text-xs font-bold leading-5 text-white">{signalAlerts.unread > 99 ? "99+" : signalAlerts.unread}</span>}</button>
            <div
              className={
                "hidden items-center gap-2 rounded-xl border px-3 py-2 sm:flex " +
                (feedLive
                  ? "border-emerald-300/15 bg-emerald-300/[0.06]"
                  : "border-amber-300/15 bg-amber-300/[0.06]")
              }
            >
              <span
                className={
                  "h-2 w-2 rounded-full " +
                  (feedLive ? "bg-emerald-300 data-pulse" : "bg-amber-300")
                }
              />
              <div>
                <p className="text-xs font-bold text-slate-200">
                  BYBIT {feedStatus}
                </p>
                <p className="font-mono text-xs text-slate-500">
                  {latency === null ? "syncing" : latency + " ms"}
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={appInstalled}
              onClick={() => void installApp()}
              className="h-10 rounded-xl border-white/[0.08] bg-white/[0.04] px-3 text-xs text-slate-300 hover:bg-white/[0.08] hover:text-white"
            >
              <Download className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">
                {appInstalled ? "Installed" : "Install"}
              </span>
            </Button>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-3 border-t border-white/[0.05] px-4 py-2.5 lg:px-8">
          <Tabs value={flexibility} onValueChange={value => setFlexibility(value as FlexibilityMode)}>
            <TabsList aria-label="Entry flexibility mode" className="h-10 bg-white/[0.035]">{(["STRICT", "BALANCED", "FLEXIBLE"] as FlexibilityMode[]).map(mode => <TabsTrigger key={mode} value={mode} className="px-3 text-xs data-[state=active]:bg-cyan-200 data-[state=active]:text-slate-950">{mode.charAt(0) + mode.slice(1).toLowerCase()}</TabsTrigger>)}</TabsList>
          </Tabs>
          <Select value={style} onValueChange={value => chooseStyle(value as TradingStyle)}><SelectTrigger aria-label="Trading style" className="h-10 w-32 rounded-xl bg-white/[0.035]"><SelectValue/></SelectTrigger><SelectContent>{(Object.keys(STYLE_CONFIG) as TradingStyle[]).map(item => <SelectItem key={item} value={item}>{STYLE_CONFIG[item].label}</SelectItem>)}</SelectContent></Select>
          <label className="flex items-center gap-2 text-xs text-slate-500">Equity USDT<Input aria-label="Account equity in USDT" type="number" min="0" value={accountEquity} onChange={event => setAccountEquity(event.target.value)} className="h-10 w-28 rounded-xl bg-white/[0.035] font-mono text-sm text-white"/></label>
          <Button type="button" disabled={scannerRunning} onClick={() => void runScan()} className="scan-action ml-auto h-10 rounded-xl"><Radar className={"mr-2 h-4 w-4 " + (scannerRunning ? "animate-spin" : "")}/>{scannerRunning ? Math.round(scanProgress) + "% scanning" : "Scan markets"}</Button>
          <p className="w-full text-xs text-slate-500">{flexibility === "STRICT" ? "Strict: closed-candle retest confirmation and a valid entry range required." : flexibility === "BALANCED" ? "Balanced: strong closes may qualify inside the entry range. Pumps and dumps still require a later retest." : "Flexible: continuation can qualify close to structure. It cannot bypass a sharp-move retest or the no-chase ceiling."}</p>
        </div>
        {inputError ? (
          <p className="border-t border-rose-400/15 bg-rose-400/5 px-5 py-2 text-xs text-rose-300">
            {inputError}
          </p>
        ) : null}
      </header>

      {installHint ? (
        <div
          role="status"
          className="fixed right-4 top-20 z-[70] max-w-xs rounded-2xl border border-cyan-300/20 bg-[#08111b] p-4 shadow-2xl"
        >
          <div className="flex items-start gap-3">
            <Download className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
            <div>
              <p className="text-sm font-semibold text-white">Install Boma Scans</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Use your browser menu or Share sheet and choose Install app or Add
                to Home Screen. Live scans still require internet access.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setInstallHint(false)}
              className="rounded-lg p-1 text-slate-500 hover:bg-white/[0.06] hover:text-white"
              aria-label="Close install instructions"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-[1680px] px-4 py-5 lg:px-8 lg:py-7">
        <TelegramPanel signals={signalAlerts.picks.map(pick=>snapshotSignal(pick))} deliveryStatus={signalAlerts.telegramStatus}/>
        <SignalCenter alerts={signalAlerts} rows={scannerRows} tab={signalTab} onTabChange={setSignalTab}
          now={scannerNow} scanning={scannerRunning} live={scannerLive}
          onReview={reviewSignal} onPaper={row => requestTrade(row, "PAPER")}/>
        <Collapsible
          id="opportunities"
          open={opportunitiesOpen}
          onOpenChange={setOpportunitiesOpen}
          className="mb-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#08111b]/88 shadow-[0_28px_90px_-60px_rgba(56,189,248,0.65)]"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 sm:px-5"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.07]">
                <Radar className="h-5 w-5 text-cyan-200" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    Market opportunities
                  </span>
                  <span
                    className={
                      "rounded-full border px-2 py-0.5 text-xs font-bold " +
                      (scannerLive
                        ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-300"
                        : "border-amber-300/20 bg-amber-300/[0.07] text-amber-300")
                    }
                  >
                    {scannerRunning ? "SCANNING" : scannerLive ? "LIVE" : "STALE"}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  {scannerRows.length}/{scanUniverse.length || scannerRows.length} markets graded · low {riskCounts.LOW} ·
                  medium {riskCounts.MEDIUM} · high {riskCounts.HIGH}
                </span>
              </span>
              <span className="hidden text-right sm:block">
                <span className="block text-xs font-semibold text-slate-300">
                  {mediumRiskPicks.length
                    ? mediumRiskPicks.length + " qualified setup" +
                      (mediumRiskPicks.length === 1 ? "" : "s")
                    : "No qualified TAKE yet"}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  Trades stay folded until opened
                </span>
              </span>
              <ChevronDown
                className={
                  "h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200 " +
                  (opportunitiesOpen ? "rotate-180 text-cyan-200" : "")
                }
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="border-t border-white/[0.07]">
            <div className="space-y-5 p-4 sm:p-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 lg:flex-row lg:items-center">
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={scannerRunning}
                    onClick={() => void runScan()}
                    className="h-9 rounded-xl border-white/[0.08] bg-[#0b1622] text-xs text-slate-200 hover:bg-white/[0.06]"
                  >
                    {scannerRunning ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-4 w-4" />
                    )}
                    {scannerRunning ? "Scanning…" : "Scan now"}
                  </Button>
                  <label className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#0b1622] px-3 text-xs text-slate-400">
                    Auto scan
                    <Switch
                      checked={autoScan}
                      onCheckedChange={toggleAutoScan}
                      aria-label={"Auto-scan every " + autoScanIntervalLabel}
                      className="scale-90"
                    />
                  </label>
                  <Select
                    value={String(autoScanMinutes)}
                    onValueChange={chooseAutoScanInterval}
                  >
                    <SelectTrigger
                      aria-label="Choose automatic scan interval"
                      className="h-9 w-[116px] rounded-xl border-white/[0.08] bg-[#0b1622] text-xs text-slate-200"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-border bg-[#0b1622] text-slate-200">
                      {AUTO_SCAN_INTERVALS.map((option) => (
                        <SelectItem
                          key={option.minutes}
                          value={String(option.minutes)}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-slate-500">
                    Minimum interval 15 minutes
                  </span>
                </div>
                <span className="font-mono text-xs text-slate-500">
                  {lastScan
                    ? "Last scan " +
                      new Intl.DateTimeFormat("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        timeZone: "UTC",
                        hour12: false,
                      }).format(lastScan) +
                      "Z"
                    : "Awaiting first scan"}
                </span>
              </div>

              {scannerRunning ? (
                <Progress value={scanProgress} className="h-1.5 bg-slate-800" />
              ) : null}
              {scanError ? (
                <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-xs text-amber-200">
                  Live scan is unavailable. No TAKE label is issued from stale data.
                </div>
              ) : null}

              {mediumRiskPicks.length ? (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">
                      Strongest qualified now
                    </p>
                    <p className="text-xs text-slate-500">
                      {MEDIUM_RISK_MAX_OPEN_RISK_PCT.toFixed(1)}% total open-risk cap
                    </p>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {mediumRiskPicks.map((pick) => (
                      <button
                        type="button"
                        key={pick.row.symbol}
                        onClick={() => {
                          selectScannerRecommendation(pick.row);
                          setOpportunitiesOpen(false);
                        }}
                        className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.055] p-4 text-left transition-colors hover:bg-emerald-300/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-bold text-emerald-300">
                            TAKE #{pick.rank} · {pick.row.direction}
                          </span>
                          <span className="font-mono text-sm font-bold text-white">
                            {pick.row.symbol.replace("USDT", "")}/USDT
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-4 gap-2">
                          {[
                            ["GRADE", pick.row.ratingGrade + " " + pick.row.ratingScore],
                            ["ENTRY", pick.row.entryGrade + " " + pick.row.entryQuality],
                            ["LEV", pick.leverage + "×"],
                            ["NET", pick.row.netRewardR.toFixed(2) + "R"],
                          ].map(([label, value]) => (
                            <span
                              key={label}
                              className="rounded-xl bg-slate-950/45 px-2 py-2 text-center"
                            >
                              <span className="block text-xs font-bold text-slate-500">
                                {label}
                              </span>
                              <span className="mt-1 block truncate font-mono text-xs font-bold text-slate-200">
                                {value}
                              </span>
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4">
                  <p className="text-xs font-bold text-amber-300">
                    NO QUALIFIED TAKE RIGHT NOW
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {scannerRunning
                      ? "Both long and short markets are being rescored."
                      : !scannerLive
                        ? "A verified live scan is required before a TAKE can appear."
                        : closestCandidate
                          ? closestCandidate.symbol + ": " + closestCandidate.gateReason
                          : "The scanner has not found a complete setup yet."}
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-white/[0.07] pt-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">
                    All rated possibilities
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Every liquid candidate remains available; risk bands are relative,
                    not guarantees.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["ALL", "LOW", "MEDIUM", "HIGH"] as RiskFilter[]).map(
                    (filter) => (
                      <button
                        type="button"
                        key={filter}
                        aria-pressed={riskFilter === filter}
                        onClick={() => setRiskFilter(filter)}
                        className={
                          "rounded-xl border px-3 py-2 text-xs font-bold transition-colors " +
                          (riskFilter === filter
                            ? filter === "LOW"
                              ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-300"
                              : filter === "MEDIUM"
                                ? "border-amber-300/30 bg-amber-300/10 text-amber-300"
                                : filter === "HIGH"
                                  ? "border-rose-300/30 bg-rose-300/10 text-rose-300"
                                  : "border-cyan-300/30 bg-cyan-300/10 text-cyan-200"
                            : "border-white/[0.07] bg-white/[0.025] text-slate-500 hover:text-slate-200")
                        }
                      >
                        {filter === "ALL"
                          ? "ALL " + scannerRows.length
                          : filter + " " + riskCounts[filter]}
                      </button>
                    ),
                  )}
                  {(["BOTH", "LONG", "SHORT"] as DirectionFilter[]).map(
                    (filter) => (
                      <button
                        type="button"
                        key={filter}
                        aria-pressed={directionFilter === filter}
                        onClick={() => setDirectionFilter(filter)}
                        className={
                          "rounded-xl border px-3 py-2 text-xs font-bold transition-colors " +
                          (directionFilter === filter
                            ? "border-violet-300/25 bg-violet-300/10 text-violet-200"
                            : "border-white/[0.07] bg-white/[0.025] text-slate-500 hover:text-slate-200")
                        }
                      >
                        {filter === "BOTH" ? "BOTH SIDES" : filter}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="hidden grid-cols-[1.2fr_0.7fr_0.6fr_0.65fr_0.8fr_1.1fr_0.6fr_0.7fr_1.1fr_24px] gap-3 px-4 text-xs text-slate-500 lg:grid">{["Symbol", "Direction", "TA", "Rating", "Risk", "Setup", "Net R¹", "Entry", "BTC link", ""].map((label,index)=><span key={index}>{label}</span>)}</div>
                {scannerRunning && !scannerRows.length
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <div
                        key={index}
                        className="h-44 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4"
                      >
                        <div className="h-4 w-28 rounded bg-slate-800" />
                        <div className="mt-5 h-3 w-full rounded bg-slate-800/70" />
                        <div className="mt-3 h-16 w-full rounded-xl bg-slate-800/40" />
                      </div>
                    ))
                  : filteredRows.map((row) => (
                      <OpportunityRow
                        key={row.symbol}
                        row={row}
                        active={row.symbol === symbol}
                        live={scannerLive}
                        equity={equity}
                        onTrade={mode => requestTrade(row, mode)}
                        onSelect={() => {
                          selectScannerRecommendation(row);
                          setOpportunitiesOpen(false);
                        }}
                      />
                    ))}
              </div>
              {riskFilter === "ALL" && directionFilter === "BOTH" && pendingMarkets.map(item => <div key={item.symbol} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] px-4 py-3 text-sm"><span className="font-mono text-slate-300">{item.symbol} · {formatPrice(item.lastPrice)}</span><span className="text-xs text-slate-500">{scanFailures[item.symbol] ? "Data unavailable · ungraded · retry next scan" : "Analysis queued · ungraded"}</span></div>)}
              <p className="text-xs text-slate-500">¹ Net R deducts estimated spread, fees and slippage; actual fills and funding can reduce returns further. {pendingMarkets.length} ungraded markets remain in All; no rating is invented for missing data.</p>
              {!scannerRunning && !filteredRows.length && !pendingMarkets.length ? (
                <div className="rounded-2xl border border-dashed border-white/[0.08] py-12 text-center">
                  <BarChart3 className="mx-auto h-6 w-6 text-slate-700" />
                  <p className="mt-2 text-xs text-slate-500">
                    No markets match these filters.
                  </p>
                </div>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {loadError ? (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-4 text-xs text-amber-100/80">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <span>{loadError}</span>
          </div>
        ) : null}

        <section id="chart-focus" className="scroll-mt-52 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#08111b]/90 shadow-[0_34px_110px_-72px_rgba(45,212,191,0.8)]">
          <div className="border-b border-white/[0.07] p-4 sm:p-5 lg:p-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs font-bold text-slate-400">
                    BYBIT PERPETUAL
                  </span>
                  <span
                    className={
                      "rounded-full border px-2.5 py-1 text-xs font-bold " +
                      activeStatusTone
                    }
                  >
                    {activePlanStatus}
                  </span>
                  <span className="rounded-full border border-violet-300/15 bg-violet-300/[0.06] px-2.5 py-1 text-xs font-bold text-violet-200">
                    {analysis.entryGrade} ENTRY · {analysis.entryQuality}
                  </span>
                  {selectedRatedRow && <span className={"rounded-full border px-3 py-1 text-xs font-semibold " + riskTone(selectedRatedRow.riskBand)}>{selectedRatedRow.ratingGrade} · {selectedRatedRow.ratingScore} rating · {selectedRatedRow.riskBand} risk</span>}
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <h1 className="font-mono text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                    {symbol.replace("USDT", "")}
                    <span className="font-normal text-slate-500"> / USDT</span>
                  </h1>
                  <LiveValue key={symbol} value={currentPrice} label={formatPrice(currentPrice)} className="font-mono text-2xl font-semibold text-slate-100"/>
                  <span
                    className={
                      "mb-1 inline-flex items-center gap-1 font-mono text-sm font-semibold " +
                      (change24h >= 0 ? "text-emerald-300" : "text-rose-300")
                    }
                  >
                    {change24h >= 0 ? (
                      <ArrowUpRight className="h-4 w-4" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4" />
                    )}
                    {Math.abs(change24h).toFixed(2)}%
                  </span>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                  {analysis.setupType} in a {analysis.regime.toLowerCase()} regime ·
                  {" "}{analysis.metrics.trendFrames}/3 frames aligned · last closed
                  candle is the signal source.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select value={interval} onValueChange={chooseInterval}>
                  <SelectTrigger
                    aria-label="Choose chart timeframe"
                    className="h-10 w-[108px] rounded-xl border-white/[0.08] bg-white/[0.035] text-xs text-slate-200"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-[#0b1622] text-slate-200">
                    {TIMEFRAMES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 border-b border-white/[0.07] bg-[#060d15]/70 sm:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Trend"
              value={analysis.bias}
              state={analysis.metrics.trendFrames + "/3 frames"}
              accent={analysis.bias === "LONG" ? "green" : "red"}
            />
            <MetricCard
              label="Regime"
              value={analysis.regime}
              state={"ADX " + analysis.metrics.adx.toFixed(1)}
              accent={analysis.regime === "TRENDING" ? "green" : "amber"}
            />
            <MetricCard
              label="Momentum"
              value={analysis.metrics.rsi.toFixed(0) + " RSI"}
              state={"MACD " + signed(analysis.metrics.macdHistogram, 4)}
              accent="blue"
            />
            <MetricCard
              label="Participation"
              value={analysis.metrics.volumeRatio.toFixed(2) + "×"}
              state="vs 20-candle volume"
              accent={analysis.metrics.volumeRatio >= 1 ? "green" : "amber"}
            />
            <MetricCard
              label="BTC link"
              value={
                btcRelationship.correlation === null
                  ? "—"
                  : signed(btcRelationship.correlation)
              }
              state={btcRelationship.divergenceVerdict}
              accent={
                btcRelationship.divergenceVerdict === "REJECT" ? "red" : "blue"
              }
            />
            <MetricCard
              label="Execution"
              value={spread.toFixed(3) + "%"}
              state={analysis.metrics.executionCostR.toFixed(3) + "R spread"}
              accent={
                analysis.metrics.executionCostR <=
                analysis.metrics.spreadCostLimitR
                  ? "green"
                  : "red"
              }
            />
          </div>

          <div className="grid xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.75fr)]">
            <div className="min-w-0 border-b border-white/[0.07] xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2">
                  <LineChart className="h-4 w-4 text-cyan-200" />
                  <p className="text-sm font-semibold text-white">
                    Live technical chart
                  </p>
                </div>
                <p className="hidden text-xs text-slate-500 sm:block">
                  Wheel to zoom · drag to pan · ALL for full loaded history
                </p>
                <button type="button" onClick={() => setChartFullscreen(true)} aria-label="Expand chart full screen" className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"><Maximize2 className="h-4 w-4"/></button>
              </div>
              <p className="mb-2 text-sm text-slate-400" role="status">{workspaceSync.status}</p>
              {workspaceSync.conflict && <Button variant="outline" onClick={workspaceSync.loadCloud}>Back up device settings and load cloud settings</Button>}
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-300">
                <span className={candlesCurrent ? "text-emerald-300" : "text-amber-300"}>{candlesCurrent ? "Candles current" : "Candles stale / reconnecting"}</span>
                <span>{candles.length.toLocaleString()} candles · oldest {candles[0] ? new Date(candles[0].time).toLocaleDateString("en-AU", {timeZone:"Australia/Melbourne"}) : "—"}</span>
                <Button variant="outline" disabled={olderLoading || historyEnd || loading || dataMode !== "LIVE"} onClick={() => void loadOlderCandles()}>{olderLoading ? "Loading history…" : historyEnd ? "Start of available Bybit history" : "Load 1,000 older candles"}</Button>
                {historyError && <span role="alert" className="text-amber-300">{historyError}</span>}
              </div>
              <MarketChart
                candles={candles}
                analysis={analysis}
                symbol={symbol}
                intervalLabel={intervalLabel}
                loading={loading}
                style={style}
                entryMode={entryMode}
                currentEntryStatus={currentEntryStatus}
                preferredEntryReady={setupReady}
              />
            </div>

            <aside className="min-w-0 bg-[#07101a]/65">
              <div className="border-b border-white/[0.07] p-4 sm:p-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  Execution choice
                </p>
                <div className="mt-3 grid grid-cols-2 rounded-2xl border border-white/[0.08] bg-black/20 p-1">
                  <button
                    type="button"
                    onClick={() => setEntryMode("PREFERRED")}
                    className={
                      "rounded-xl px-3 py-3 text-left transition-all " +
                      (entryMode === "PREFERRED"
                        ? "bg-cyan-200 text-slate-950 shadow-lg"
                        : "text-slate-400 hover:bg-white/[0.04] hover:text-white")
                    }
                  >
                    <span className="block text-xs font-bold">Preferred entry</span>
                    <span className="mt-0.5 block text-xs opacity-70">
                      Pullback / retest
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryMode("MARKET")}
                    className={
                      "rounded-xl px-3 py-3 text-left transition-all " +
                      (entryMode === "MARKET"
                        ? "bg-violet-200 text-slate-950 shadow-lg"
                        : "text-slate-400 hover:bg-white/[0.04] hover:text-white")
                    }
                  >
                    <span className="block text-xs font-bold">Current-price check</span>
                    <span className="mt-0.5 block text-xs opacity-70">
                      Close TP map
                    </span>
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span
                      className={
                        "inline-flex rounded-full border px-2.5 py-1 text-xs font-black tracking-[0.1em] " +
                        activeStatusTone
                      }
                    >
                      {activePlanStatus}
                    </span>
                    <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">
                      {entryMode === "MARKET"
                        ? analysis.bias + " at live price"
                        : preferredDecisionLabel}
                    </h2>
                    <p className="mt-2 text-xs leading-5 text-slate-400">
                      {entryMode === "MARKET"
                        ? currentEntryStatusReason
                        : analysis.scalpPlan.triggerText}
                    </p>
                  </div>
                  <ScoreGauge
                    score={
                      entryMode === "MARKET"
                        ? analysis.immediateEntry.score
                        : analysis.entryQuality
                    }
                    label={entryMode === "MARKET" ? "NOW" : "ENTRY"}
                  />
                </div>

                <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3 text-sm">
                  <p className="font-semibold text-cyan-200">{activeLock ? "Fixed plan — entry, stop and targets locked" : "Developing setup — not an entry signal yet"}</p>
                  <p className="mt-1 text-slate-300">{activeLock ? "New candles cannot move these levels. A stop touch, failed zone or expiry cancels this plan." : "Wait for closed-candle confirmation. The draft can change as structure develops; an approved signal locks automatically."}</p>
                  {activeLock && <Button className="mt-2" variant="outline" onClick={() => {setLockedPlan(null); setHistoryReload(value => value + 1); setLoading(true);}}>Discard plan and request fresh analysis</Button>}
                </div>
                <div className="mt-4"><EntryInstructions plan={analysis.executionPlan}
                  ready={entryMode === "MARKET" ? immediateSizingReady : sizingReady}
                  reason={entryMode === "MARKET" ? currentEntryStatusReason : !setupReady && analysis.executionPlan.status === "READY" ? "Entry timing passed. Verify live data, exchange limits, BTC context and account sizing before entry." : undefined}/></div>
                {entryMode === "MARKET" ? (
                  <div className="mt-4 rounded-2xl border border-violet-300/15 bg-violet-300/[0.055] p-3">
                    <p className="flex items-center gap-2 text-xs font-semibold text-violet-200">
                      <Zap className="h-4 w-4" />
                      Aggressive alternative · reduced risk
                    </p>
                    <p className="mt-1.5 text-xs leading-5 text-slate-400">
                      Nearby targets use the same retest and no-chase rules. The stop
                      stays outside the invalidation structure; a smaller target does not justify a tighter stop.
                    </p>
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    [(entryMode === "MARKET" ? immediateSizingReady : sizingReady) ? "ENTRY QUOTE" : "CONDITIONAL ENTRY", formatPrice(activePlanEntry), "text-cyan-200"],
                    ["HARD STOP", formatPrice(activePlanStop), "text-rose-300"],
                    ["MAX RISK", activeRiskLabel, "text-amber-200"],
                    ["LEVERAGE", activeLeverageLabel, "text-violet-200"],
                  ].map(([label, value, tone]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"
                    >
                      <p className="text-xs font-bold tracking-[0.12em] text-slate-500">
                        {label}
                      </p>
                      <p className={"mt-1.5 font-mono text-sm font-bold " + tone}>
                        {value}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-xs font-semibold text-white">
                      <Target className="h-4 w-4 text-emerald-300" />
                      {entryMode === "MARKET"
                        ? "Five close technical exits"
                        : "Five TA-derived targets"}
                    </p>
                    <span className="font-mono text-xs text-slate-500">
                      {entryMode === "MARKET"
                        ? analysis.immediateEntry.weightedRewardR.toFixed(2) + "R"
                        : analysis.rr.toFixed(2) + "R weighted"}
                    </span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {activePlanTargets.map((target) => (
                      <div
                        key={target.level}
                        className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-300/10 font-mono text-xs font-black text-emerald-300">
                          {target.level}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-slate-400">
                            {target.source}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            Exit {target.exitPct}% · {target.rewardR.toFixed(2)}R · {target.confidence} · {target.confluenceCount} sources
                            {entryMode === "MARKET"
                              ? " · " +
                                analysis.immediateEntry.targets[
                                  target.level - 1
                                ].distancePct.toFixed(2) +
                                "%"
                              : ""}
                          </span>
                        </span>
                        <span className="font-mono text-xs font-bold text-emerald-200">
                          {target.available ? formatPrice(target.price) : "UNCONFIRMED"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {entryMode === "MARKET" ? (
                  <div className="mt-4 space-y-2">
                    <p className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-200">Estimated round-trip friction {analysis.immediateEntry.estimatedCostPct.toFixed(3)}% · net payoff {analysis.immediateEntry.netRewardR.toFixed(2)}R before funding. {analysis.immediateEntry.stopSource}. Unconfirmed inner targets block entry.</p>
                    {analysis.immediateEntry.reasoning.slice(0, 4).map((reason) => (
                      <p
                        key={reason}
                        className="flex gap-2 text-xs leading-5 text-slate-400"
                      >
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                        {reason}
                      </p>
                    ))}
                  </div>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyPlan()}
                  className="mt-5 h-10 w-full rounded-xl border-white/[0.08] bg-white/[0.035] text-xs text-slate-200 hover:bg-white/[0.07] hover:text-white"
                >
                  {copied ? (
                    <Check className="mr-1.5 h-4 w-4 text-emerald-300" />
                  ) : (
                    <Crosshair className="mr-1.5 h-4 w-4" />
                  )}
                  {copied
                    ? "Plan copied"
                    : entryMode === "MARKET"
                      ? "Copy enter-now plan"
                      : "Copy preferred plan"}
                </Button>
              </div>
            </aside>
          </div>
        </section>

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#08111b]/88">
            <div className="border-b border-white/[0.07] px-5 py-4">
              <p className="text-sm font-semibold text-white">
                Trade tracking & risk control
              </p>
              <p className="mt-1 text-xs text-slate-500">
                The manager follows the {entryMode === "MARKET" ? "enter-now" : "preferred"} levels currently shown on the chart.
              </p>
            </div>
            <TradeManager
              analysis={analysis}
              symbol={symbol}
              style={style}
              intervalLabel={intervalLabel}
              currentPrice={currentPrice}
              markPrice={ticker?.markPrice || currentPrice}
              currentPriceUpdatedAt={lastUpdate}
              dataMode={dataMode}
              feedLive={feedLive}
              accountEquity={equity}
              instrument={instrument}
              onOpenChart={selectScannerSymbol}
              recommendedSymbol={mediumRiskPicks[0]?.row.symbol}
              recommendedSide={mediumRiskPicks[0]?.row.bias}
              onOpenRecommendation={
                mediumRiskPicks[0]
                  ? () => selectScannerRecommendation(mediumRiskPicks[0].row)
                  : undefined
              }
              entryMode={entryMode}
              currentEntryStatus={currentEntryStatus}
              btcVerdict={btcRelationship.divergenceVerdict}
              tradeRequest={!loading && tradeIntent?.symbol === symbol ? tradeIntent : undefined}
            />
          </section>

          <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#08111b]/88">
            <div className="border-b border-white/[0.07] px-5 py-4">
              <p className="text-sm font-semibold text-white">
                Analysis evidence
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Open only the evidence you want to inspect.
              </p>
            </div>
            <Accordion type="multiple" defaultValue={["entry"]} className="px-5">
              <AccordionItem value="entry" className="border-white/[0.07]">
                <AccordionTrigger className="py-4 text-sm text-slate-100 hover:no-underline">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-cyan-200" />
                    Entry proof · {analysis.entryGrade} {analysis.entryQuality}/100
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {analysis.entryChecks.map((check) => (
                      <div
                        key={check.id}
                        className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold text-slate-200">
                            {check.label}
                          </p>
                          <span
                            className={
                              "rounded-full px-2 py-0.5 text-xs font-black " +
                              (check.status === "PASS"
                                ? "bg-emerald-300/10 text-emerald-300"
                                : check.status === "FAIL"
                                  ? "bg-rose-300/10 text-rose-300"
                                  : "bg-amber-300/10 text-amber-300")
                            }
                          >
                            {check.status}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          {check.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="structure" className="border-white/[0.07]">
                <AccordionTrigger className="py-4 text-sm text-slate-100 hover:no-underline">
                  <span className="flex items-center gap-2">
                    <Crosshair className="h-4 w-4 text-violet-200" />
                    Structure, CHoCH & reasoning
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      ["BOS", analysis.structure.bos],
                      ["CHoCH", analysis.structure.choch],
                      ["SWEEP", analysis.structure.sweep],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"
                      >
                        <p className="text-xs font-bold text-slate-500">{label}</p>
                        <p className="mt-1 font-mono text-xs font-bold text-slate-200">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 space-y-2">
                    {analysis.reasons.map((reason) => (
                      <p
                        key={reason}
                        className="flex gap-2 text-xs leading-5 text-slate-400"
                      >
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                        {reason}
                      </p>
                    ))}
                    {analysis.warnings.map((warning) => (
                      <p
                        key={warning}
                        className="flex gap-2 text-xs leading-5 text-amber-100/70"
                      >
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                        {warning}
                      </p>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="btc" className="border-white/[0.07]">
                <AccordionTrigger className="py-4 text-sm text-slate-100 hover:no-underline">
                  <span className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-blue-200" />
                    Historical BTC relationship · {btcRelationship.divergenceVerdict}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-2 sm:grid-cols-4">
                    {[
                      ["RELATIONSHIP", btcRelationship.relationship],
                      [
                        "CORRELATION",
                        btcRelationship.correlation === null
                          ? "—"
                          : signed(btcRelationship.correlation),
                      ],
                      [
                        "BETA",
                        btcRelationship.beta === null
                          ? "—"
                          : btcRelationship.beta.toFixed(2),
                      ],
                      [
                        "RELATIVE MOVE",
                        signed(btcRelationship.relativeStrengthPct) + "%",
                      ],
                      ["RESIDUAL Z", signed(btcRelationship.residualZScore)],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"
                      >
                        <p className="text-xs font-bold text-slate-500">{label}</p>
                        <p className="mt-1 font-mono text-xs font-bold text-slate-200">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-6 text-slate-400">
                    {btcRelationship.explanation}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Rolling {btcRelationship.historyBars} closed {intervalLabel} bars ·
                    pair {signed(btcRelationship.pairReturnPct)}% · BTC{" "}
                    {signed(btcRelationship.btcReturnPct)}%.
                  </p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="sizing" className="border-white/[0.07]">
                <AccordionTrigger className="py-4 text-sm text-slate-100 hover:no-underline">
                  <span className="flex items-center gap-2">
                    <CircleDollarSign className="h-4 w-4 text-emerald-200" />
                    Risk, leverage & position sizing
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-400">
                        Account equity · USDT
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={accountEquity}
                        onChange={(event) => setAccountEquity(event.target.value)}
                        min="0"
                        step="100"
                        className="mt-2 h-10 rounded-xl border-white/[0.08] bg-black/20 font-mono text-sm text-white"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        ["LEVERAGE", activeLeverageLabel],
                        [
                          "QUANTITY",
                          activeSizingReady
                            ? activeLeveragePlan.quantity.toFixed(6)
                            : "GATED",
                        ],
                        [
                          "NOTIONAL",
                          activeSizingReady
                            ? compactNumber(activeLeveragePlan.notional)
                            : "GATED",
                        ],
                        [
                          "STOP RISK",
                          activeSizingReady
                            ? activeLeveragePlan.actualRiskPct.toFixed(2) + "%"
                            : activeRiskLabel,
                        ],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"
                        >
                          <p className="text-xs font-bold text-slate-500">{label}</p>
                          <p className="mt-1 font-mono text-xs font-bold text-slate-200">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3">
                    <p className="text-xs leading-5 text-slate-400">
                      {activeLeveragePlan.rationale}. Leverage changes isolated
                      margin reserved; position quantity remains hard-stop risk sized.
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {style} ceiling {ADAPTIVE_STYLE_MAX_LEVERAGE[style]}× · Bybit
                      published maximum{" "}
                      {instrument?.maxLeverage
                        ? instrument.maxLeverage + "×"
                        : loading
                          ? "verifying"
                        : "unavailable"}.
                    </p>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-slate-400">Taker fee per fill (%)<Input key={"fee-" + preferencesReady} defaultValue={takerFeePct} type="number" min="0" max="0.3" step="0.005" onBlur={event => {const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0 && value <= 0.3) setTakerFeePct(String(value)); else event.target.value = takerFeePct;}} className="mt-2 font-mono"/></label>
                    <label className="text-xs text-slate-400">Slippage assumption per fill (%)<Input key={"slippage-" + preferencesReady} defaultValue={slippagePct} type="number" min="0" max="1" step="0.01" onBlur={event => {const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0 && value <= 1) setSlippagePct(String(value)); else event.target.value = slippagePct;}} className="mt-2 font-mono"/></label>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">Close-target validation uses these assumptions plus the current spread. Verify your actual account fee and product; special-zone fees can be higher. <a className="text-cyan-200 underline" href="https://www.bybit.com/en/help-center/article/Trading-Fee-Structure" target="_blank" rel="noreferrer">Bybit fee schedule</a>.</p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>
        </div>

        <section id="shortlist" className="sticky bottom-20 z-30 mt-5 rounded-2xl border border-cyan-300/15 bg-[#0c141d]/95 p-3 shadow-2xl backdrop-blur-2xl md:bottom-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center"><div className="min-w-40"><p className="text-sm font-semibold text-cyan-100">Qualified shortlist</p><p className="mt-1 text-xs text-slate-500">{flexibility} · max 2 ideas</p></div><div className="flex min-w-0 flex-1 snap-x gap-3 overflow-x-auto">{mediumRiskPicks.length ? mediumRiskPicks.map(pick => <div key={pick.row.symbol} className="flex min-w-[280px] flex-1 snap-center items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3"><button type="button" onClick={() => selectScannerRecommendation(pick.row)} className="text-left"><span className="block font-mono text-sm font-bold text-white">{pick.row.symbol} · {pick.row.ratingGrade}</span><span className="mt-1 block text-xs text-slate-400">{pick.row.bias} · {pick.row.riskBand} · {pick.leverage}× · {pick.row.netRewardR.toFixed(2)}R</span></button><Button type="button" size="sm" onClick={() => requestTrade(pick.row, "PAPER")}>Paper trade</Button></div>) : <p className="py-2 text-sm text-slate-500">No complete entry-ready setup yet. All other possibilities remain in the scanner.</p>}</div></div>
        </section>
        <footer className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5" />
            {lastUpdate
              ? "Last exchange event " +
                new Intl.DateTimeFormat("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "UTC",
                  hour12: false,
                }).format(lastUpdate) +
                "Z"
              : "Awaiting exchange event"}
          </span>
          <span className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" />
            Advisory and paper tracking only · no automatic Bybit order execution
          </span>
          <span className="flex items-center gap-2 text-slate-500">
            <Info className="h-3.5 w-3.5" />
            No setup or leverage suggestion guarantees profit.
          </span>
        </footer>
      </div>
      <Sheet open={navOpen} onOpenChange={setNavOpen}><SheetContent side="left" className="w-72 border-white/10 bg-[#0a0b0f]"><SheetHeader><SheetTitle>Boma Scans</SheetTitle><SheetDescription>Your trading workspace</SheetDescription></SheetHeader><nav aria-label="Workspace navigation" className="space-y-2 px-4">{[["signals-center", "Signals", Radio], ["notifications", "Notifications", Bell], ["opportunities", "Scanner", Radar], ["chart-focus", "Chart focus", LineChart], ["trade-manager", "Trade manager", BriefcaseBusiness], ["shortlist", "Shortlist", Target], ["trade-journal", "Journal", BookOpen]].map(([id,label,Icon]) => { const NavIcon = Icon as typeof Radar; return <button key={String(id)} type="button" onClick={() => navigateSection(String(id))} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-300 hover:bg-cyan-300/10 hover:text-cyan-200"><NavIcon className="h-4 w-4"/>{String(label)}</button>;})}</nav></SheetContent></Sheet>
      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-white/10 bg-[#0a0b0f]/95 px-3 py-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur md:hidden">{[["signals-center", "Signals", Radio], ["notifications", "Alerts", Bell], ["chart-focus", "Chart", LineChart], ["trade-manager", "Trades", BriefcaseBusiness]].map(([id,label,Icon]) => {const NavIcon = Icon as typeof Radar; return <button type="button" key={String(id)} onClick={() => navigateSection(String(id))} className="flex min-w-14 flex-col items-center gap-1 text-xs text-slate-400"><NavIcon className="h-5 w-5"/>{String(label)}</button>;})}</nav>
      <Dialog open={chartFullscreen} onOpenChange={setChartFullscreen}><DialogContent className="h-[95dvh] w-[98vw] max-w-none overflow-hidden border-white/10 bg-[#080d15] p-3 sm:max-w-none"><DialogTitle className="text-sm">{symbol} · {intervalLabel} chart</DialogTitle><DialogDescription className="text-xs text-slate-500">Zoom with the wheel or buttons; drag to pan. {entryMode === "MARKET" ? "Current-entry" : "Preferred"} levels.</DialogDescription><MarketChart candles={candles} analysis={analysis} symbol={symbol} intervalLabel={intervalLabel} loading={loading} style={style} entryMode={entryMode} currentEntryStatus={currentEntryStatus} preferredEntryReady={setupReady} fullscreen /></DialogContent></Dialog>
    </main>
  );
}
