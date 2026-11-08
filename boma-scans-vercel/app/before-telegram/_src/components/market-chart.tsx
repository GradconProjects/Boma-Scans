"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import {
  Candle,
  ImmediateEntryStatus,
  MarketAnalysis,
  TradingStyle,
  ema,
  formatPrice,
  utcTime,
} from "@/app/before-telegram/_src/lib/market";

type MarketChartProps = {
  candles: Candle[];
  analysis: MarketAnalysis;
  symbol: string;
  intervalLabel: string;
  loading: boolean;
  style: TradingStyle;
  entryMode?: "PREFERRED" | "MARKET";
  currentEntryStatus?: ImmediateEntryStatus;
  preferredEntryReady?: boolean;
  fullscreen?: boolean;
};

const MIN_VISIBLE_CANDLES = 24;
const DEFAULT_VISIBLE_CANDLES = 96;
const MAX_VISIBLE_CANDLES = Number.MAX_SAFE_INTEGER;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function regression(values: number[]) {
  if (values.length < 2) return values;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((total, value) => total + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    numerator += (index - xMean) * (values[index] - yMean);
    denominator += (index - xMean) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;
  return values.map((_, index) => intercept + slope * index);
}

function pivotTrend(candles: Candle[], field: "low" | "high") {
  const pivots: Array<{ x: number; y: number }> = [];
  for (let index = 2; index < candles.length - 2; index += 1) {
    const value = candles[index][field];
    const neighbors = [
      candles[index - 2][field],
      candles[index - 1][field],
      candles[index + 1][field],
      candles[index + 2][field],
    ];
    const isPivot =
      field === "low"
        ? neighbors.every((neighbor) => value <= neighbor)
        : neighbors.every((neighbor) => value >= neighbor);
    if (isPivot) pivots.push({ x: index, y: value });
  }

  let points = pivots.slice(-5);
  if (points.length < 2) {
    const start = Math.max(0, candles.length - 40);
    points = candles.slice(start).map((candle, index) => ({
      x: start + index,
      y: candle[field],
    }));
  }
  if (!points.length) return { values: [] as number[], slope: 0 };

  const xMean = points.reduce((total, point) => total + point.x, 0) / points.length;
  const yMean = points.reduce((total, point) => total + point.y, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  points.forEach((point) => {
    numerator += (point.x - xMean) * (point.y - yMean);
    denominator += (point.x - xMean) ** 2;
  });
  const slope = denominator ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;
  const startIndex = Math.max(0, points[0].x - 3);
  return {
    values: candles.map((_, index) =>
      index < startIndex ? Number.NaN : intercept + slope * index,
    ),
    slope,
  };
}

export function MarketChart({
  candles,
  analysis,
  symbol,
  intervalLabel,
  loading,
  style,
  entryMode = "PREFERRED",
  currentEntryStatus,
  preferredEntryReady = analysis.entryReady,
  fullscreen = false,
}: MarketChartProps) {
  const chartId = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startOffset: number;
  } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 430 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_CANDLES);
  const [endOffset, setEndOffset] = useState(0);
  const [panning, setPanning] = useState(false);
  const effectiveCurrentStatus =
    currentEntryStatus ?? analysis.immediateEntry.status;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setDimensions({
        width: Math.max(520, rect.width),
        height: Math.max(330, rect.height),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => {
    const available = candles.length;
    const count = Math.min(available, Math.max(1, visibleCount));
    const clampedOffset = clamp(endOffset, 0, Math.max(0, available - count));
    const endIndex = Math.max(count, available - clampedOffset);
    const startIndex = Math.max(0, endIndex - count);
    const visible = candles.slice(startIndex, endIndex);
    const width = dimensions.width;
    const height = dimensions.height;
    const left = 12;
    const right = width - 110;
    const top = 28;
    const priceBottom = height - 84;
    const volumeTop = priceBottom + 15;
    const volumeBottom = height - 28;
    const step = visible.length ? (right - left) / visible.length : 1;
    const marketEntryMode = entryMode === "MARKET";
    const activeTargets = marketEntryMode
      ? analysis.immediateEntry.targets
      : analysis.takeProfits;
    const activeEntry = marketEntryMode
      ? analysis.immediateEntry.entry
      : analysis.entry;
    const activeStop = marketEntryMode
      ? analysis.immediateEntry.stop
      : analysis.stop;
    const scalpLevels =
      !marketEntryMode && analysis.decision !== "NO TRADE"
        ? [
            analysis.scalpPlan.entryLow,
            analysis.scalpPlan.entryHigh,
            analysis.scalpPlan.trigger,
            analysis.executionPlan.entryLow,
            analysis.executionPlan.entryHigh,
          ]
        : [];
    const levels =
      !marketEntryMode && analysis.decision === "NO TRADE"
        ? [analysis.support, analysis.resistance]
        : [
            activeStop,
            activeEntry,
            ...activeTargets.filter(target => target.available).map((target) => target.price),
            analysis.support,
            analysis.resistance,
            ...scalpLevels,
          ];
    const allCloses = candles.map((candle) => candle.close);
    const ema20 = ema(allCloses, 20).slice(startIndex, endIndex);
    const ema50 = ema(allCloses, 50).slice(startIndex, endIndex);
    const trend = regression(visible.map((candle) => candle.close));
    const supportTrend = pivotTrend(visible, "low");
    const resistanceTrend = pivotTrend(visible, "high");
    const trendValues = [...supportTrend.values, ...resistanceTrend.values].filter(Number.isFinite);
    const prices = visible
      .flatMap((candle) => [candle.high, candle.low])
      .concat(levels, trendValues);
    const rawMin = prices.length ? Math.min(...prices) : 0;
    const rawMax = prices.length ? Math.max(...prices) : 1;
    const padding = Math.max((rawMax - rawMin) * 0.06, rawMax * 0.0005);
    const min = rawMin - padding;
    const max = rawMax + padding;
    const range = Math.max(max - min, Number.EPSILON);
    const maxVolume = Math.max(...visible.map((candle) => candle.volume), 1);
    const toX = (index: number) => left + index * step + step / 2;
    const toY = (price: number) => top + ((max - price) / range) * (priceBottom - top);
    const pathFor = (values: number[]) => {
      let started = false;
      return values
        .map((value, index) => {
          if (!Number.isFinite(value)) return "";
          const command = started ? "L" : "M";
          started = true;
          return command + " " + toX(index).toFixed(2) + " " + toY(value).toFixed(2);
        })
        .filter(Boolean)
        .join(" ");
    };

    return {
      visible,
      clampedOffset,
      startIndex,
      endIndex,
      width,
      height,
      left,
      right,
      top,
      priceBottom,
      volumeTop,
      volumeBottom,
      step,
      min,
      max,
      maxVolume,
      toX,
      toY,
      ema20Path: pathFor(ema20),
      ema50Path: pathFor(ema50),
      trendPath: pathFor(trend),
      supportTrendPath: pathFor(supportTrend.values),
      resistanceTrendPath: pathFor(resistanceTrend.values),
      supportTrendSlope: supportTrend.slope,
      resistanceTrendSlope: resistanceTrend.slope,
      supportTrendLast: supportTrend.values[supportTrend.values.length - 1],
      resistanceTrendLast: resistanceTrend.values[resistanceTrend.values.length - 1],
    };
  }, [analysis, candles, dimensions, endOffset, entryMode, visibleCount]);

  const hover =
    hoverIndex === null ? model.visible[model.visible.length - 1] : model.visible[hoverIndex];
  const hoverX =
    hoverIndex === null ? null : model.toX(Math.min(hoverIndex, model.visible.length - 1));

  function zoomTo(nextCount: number, anchorRatio = 0.5) {
    if (!candles.length) return;
    const maximum = Math.min(MAX_VISIBLE_CANDLES, candles.length);
    const minimum = Math.min(MIN_VISIBLE_CANDLES, maximum);
    const next = clamp(Math.round(nextCount), minimum, maximum);
    if (next === model.visible.length) return;

    const ratio = clamp(anchorRatio, 0, 1);
    const anchorIndex =
      model.startIndex + Math.max(0, model.visible.length - 1) * ratio;
    const nextEnd = anchorIndex + (next - 1) * (1 - ratio) + 1;
    const nextOffset = clamp(
      Math.round(candles.length - nextEnd),
      0,
      Math.max(0, candles.length - next),
    );
    setVisibleCount(next);
    setEndOffset(nextOffset);
    setHoverIndex(null);
  }

  function zoomBy(direction: -1 | 1, anchorRatio = 0.5) {
    const amount = Math.max(4, Math.round(model.visible.length * 0.16));
    zoomTo(model.visible.length + direction * amount, anchorRatio);
  }

  function resetView() {
    setVisibleCount(Math.min(DEFAULT_VISIBLE_CANDLES, Math.max(1, candles.length)));
    setEndOffset(0);
    setHoverIndex(null);
  }

  function showAllHistory() {
    setVisibleCount(Math.min(MAX_VISIBLE_CANDLES, Math.max(1, candles.length)));
    setEndOffset(0);
    setHoverIndex(null);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!candles.length) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    zoomBy(event.deltaY > 0 ? 1 : -1, ratio);
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!model.visible.length || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startOffset: endOffset,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!model.visible.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      const plotWidth = Math.max(
        1,
        rect.width * ((model.right - model.left) / model.width),
      );
      const candleShift = Math.round(
        ((event.clientX - drag.startX) / plotWidth) * model.visible.length,
      );
      setEndOffset(
        clamp(
          drag.startOffset + candleShift,
          0,
          Math.max(0, candles.length - model.visible.length),
        ),
      );
    }
    const x = ((event.clientX - rect.left) / rect.width) * model.width;
    const index = Math.max(
      0,
      Math.min(
        model.visible.length - 1,
        Math.floor((x - model.left) / Math.max(model.step, 1)),
      ),
    );
    setHoverIndex(index);
  }

  function finishPointer(event: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanning(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(-1);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomBy(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setEndOffset((current) =>
        clamp(
          current + Math.max(1, Math.round(model.visible.length * 0.12)),
          0,
          Math.max(0, candles.length - model.visible.length),
        ),
      );
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setEndOffset((current) =>
        clamp(current - Math.max(1, Math.round(model.visible.length * 0.12)), 0, Math.max(0, candles.length - model.visible.length)),
      );
    } else if (event.key === "0" || event.key === "Home") {
      event.preventDefault();
      resetView();
    }
  }

  const zones = [
    entryMode !== "MARKET" && analysis.decision !== "NO TRADE"
      ? {
          side: analysis.bias,
          low: analysis.scalpPlan.entryLow,
          high: analysis.scalpPlan.entryHigh,
          label:
            analysis.setupType === "CHoCH REVERSAL"
              ? "CHoCH RETEST ZONE"
              : analysis.setupType === "PULLBACK"
                ? "PULLBACK ENTRY ZONE"
                : style === "SCALP"
                  ? "SCALP ENTRY ZONE"
                  : "PLANNED ENTRY ZONE",
          color: "#f5c451",
        }
      : null,
    analysis.structure.orderBlock
      ? { ...analysis.structure.orderBlock, label: "ORDER BLOCK", color: "#75a7ff" }
      : null,
    analysis.structure.fvg
      ? { ...analysis.structure.fvg, label: "FVG", color: "#bd8cff" }
      : null,
  ].filter(Boolean) as Array<{
    side: "LONG" | "SHORT";
    low: number;
    high: number;
    label: string;
    color: string;
  }>;

  const chartTargets =
    entryMode === "MARKET"
      ? analysis.immediateEntry.targets
      : analysis.takeProfits;
  const targetLevels = [...chartTargets].filter(target => target.available).reverse().map((target) => ({
    label:
      entryMode === "MARKET"
        ? "CLOSE " + target.level
        : (style === "SCALP" ? "EXIT " : "TP") + target.level,
    value: target.price,
    color: target.confidence === "HIGH" ? "#32d5a4" : "#6ee7b7",
  }));
  const tradeLevels =
    entryMode === "MARKET"
      ? [
          ...targetLevels,
          {
            label: "MARKET",
            value: analysis.immediateEntry.entry,
            color: "#67e8f9",
          },
          {
            label: "STOP",
            value: analysis.immediateEntry.stop,
            color: "#ff6875",
          },
          { label: analysis.bias === "LONG" ? "MAX BUY" : "MIN SELL", value: analysis.bias === "LONG" ? analysis.executionPlan.entryHigh : analysis.executionPlan.entryLow, color: "#fb923c" },
        ]
      : analysis.decision === "NO TRADE"
      ? []
        : [
            ...targetLevels,
            { label: preferredEntryReady ? "ENTRY" : "IF CONFIRMED", value: analysis.entry, color: "#f5c451" },
            { label: analysis.bias === "LONG" ? "MAX BUY" : "MIN SELL", value: analysis.bias === "LONG" ? analysis.executionPlan.entryHigh : analysis.executionPlan.entryLow, color: "#fb923c" },
            { label: "STOP", value: analysis.stop, color: "#ff6875" },
          ];

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      aria-label="Interactive candlestick chart. Scroll or use zoom buttons to zoom, drag to pan, arrow keys to move, and press zero to reset."
      className={
        "relative min-h-[350px] w-full overflow-hidden bg-[#080d15] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary " +
        (fullscreen ? "h-[76dvh] " : "h-[clamp(400px,54vh,650px)] ") +
        (panning ? "cursor-grabbing" : "cursor-grab")
      }
      onPointerLeave={() => {
        if (!panning) setHoverIndex(null);
      }}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onDoubleClick={resetView}
    >
      <div className="pointer-events-none absolute left-4 top-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-slate-400">
        <span className="font-sans font-semibold text-slate-200">
          {symbol} · {intervalLabel}
        </span>
        {hover ? (
          <>
            <span>O {formatPrice(hover.open)}</span>
            <span className="text-emerald-300">H {formatPrice(hover.high)}</span>
            <span className="text-rose-300">L {formatPrice(hover.low)}</span>
            <span className="text-white">C {formatPrice(hover.close)}</span>
          </>
        ) : null}
      </div>

      <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-lg border border-border bg-[#0b111a]/95 p-1 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => zoomBy(-1)}
          className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Zoom chart in"
          title="Zoom in (+)"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1)}
          className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Zoom chart out"
          title="Zoom out (−)"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={resetView}
          className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Reset chart zoom and return to live candles"
          title="Reset view (0)"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={showAllHistory}
          className="h-8 rounded-md px-2 font-mono text-xs font-bold text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Show all loaded chart history"
          title="Show all loaded candles"
        >
          ALL
        </button>
        <span className="hidden border-l border-border px-2 font-mono text-xs text-slate-500 sm:block">
          {model.visible.length} bars · {model.clampedOffset ? "HISTORY" : "LATEST LOADED"}
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-8 left-4 z-10 hidden rounded bg-[#080d15]/75 px-2 py-1 text-xs text-slate-500 md:block">
        Wheel to zoom · drag to pan · double-click to reset
      </div>

      <div
        className={
          "pointer-events-none absolute right-3 top-14 z-10 hidden max-w-[70%] items-center gap-2 rounded-md border px-2.5 py-1 text-right text-xs font-bold tracking-[0.06em] md:flex " +
          (entryMode === "MARKET"
            ? effectiveCurrentStatus === "ALLOW"
              ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-300"
              : effectiveCurrentStatus === "AVOID"
                ? "border-rose-300/25 bg-rose-300/10 text-rose-300"
                : "border-amber-300/25 bg-amber-300/10 text-amber-300"
            : preferredEntryReady
            ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-300"
            : analysis.scalpPlan.status === "STAND ASIDE"
              ? "border-rose-300/25 bg-rose-300/10 text-rose-300"
              : "border-amber-300/25 bg-amber-300/10 text-amber-300")
        }
      >
        {entryMode === "MARKET"
          ? "ENTER NOW · " + effectiveCurrentStatus + " · " + analysis.immediateEntry.score + "/100"
          : style + " · " + analysis.setupType + " · " + (preferredEntryReady ? "ENTRY READY" : analysis.entryReady ? "VERIFY LIVE GATES" : analysis.scalpPlan.status)}
      </div>

      {loading && !candles.length ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[#080d15]/85">
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <span className="h-2 w-2 rounded-full bg-primary data-pulse" />
            Synchronizing Bybit candles…
          </div>
        </div>
      ) : null}

      {!candles.length && !loading ? (
        <div className="absolute inset-0 z-20 grid place-items-center text-sm text-slate-500">
          No candle history available.
        </div>
      ) : null}

      <svg
        role="img"
        aria-label={symbol + " " + intervalLabel + " candlestick chart with technical overlays"}
        width="100%"
        height="100%"
        viewBox={"0 0 " + model.width + " " + model.height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        className="touch-none select-none"
      >
        <defs>
          <linearGradient id={chartId + "-volume"} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#75a7ff" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#75a7ff" stopOpacity="0.06" />
          </linearGradient>
          <clipPath id={chartId + "-clip"}>
            <rect
              x={model.left}
              y={model.top}
              width={model.right - model.left}
              height={model.priceBottom - model.top}
            />
          </clipPath>
        </defs>

        {Array.from({ length: 6 }).map((_, index) => {
          const y =
            model.top + ((model.priceBottom - model.top) / 5) * index;
          const price = model.max - ((model.max - model.min) / 5) * index;
          return (
            <g key={"horizontal-" + index}>
              <line
                x1={model.left}
                y1={y}
                x2={model.right}
                y2={y}
                stroke="#1c2635"
                strokeWidth="1"
              />
              <text
                x={model.right + 9}
                y={y + 4}
                fill="#66758a"
                fontSize="11"
                fontFamily="monospace"
              >
                {formatPrice(price)}
              </text>
            </g>
          );
        })}

        {Array.from({ length: 7 }).map((_, index) => {
          const x = model.left + ((model.right - model.left) / 6) * index;
          const candleIndex = Math.min(
            model.visible.length - 1,
            Math.max(0, Math.round((model.visible.length - 1) * (index / 6))),
          );
          return (
            <g key={"vertical-" + index}>
              <line
                x1={x}
                y1={model.top}
                x2={x}
                y2={model.volumeBottom}
                stroke="#121b28"
                strokeWidth="1"
              />
              {model.visible[candleIndex] ? (
                <text
                  x={x}
                  y={model.height - 8}
                  fill="#5e6d81"
                  fontSize="11"
                  textAnchor={index === 0 ? "start" : index === 6 ? "end" : "middle"}
                  fontFamily="monospace"
                >
                  {utcTime(model.visible[candleIndex].time)}
                </text>
              ) : null}
            </g>
          );
        })}

        <g clipPath={"url(#" + chartId + "-clip)"}>
          {[
            { label: "RESISTANCE", value: analysis.resistance, color: "#fb7185" },
            { label: "SUPPORT", value: analysis.support, color: "#22d3ee" },
            analysis.structure.chochLevel
              ? {
                  label: analysis.structure.choch + " CHoCH",
                  value: analysis.structure.chochLevel,
                  color: "#f5c451",
                }
              : null,
          ].filter(
            (level): level is { label: string; value: number; color: string } =>
              Boolean(level),
          ).map((level) => (
            <g key={"structure-" + level.label}>
              <line
                x1={model.left}
                y1={model.toY(level.value)}
                x2={model.right}
                y2={model.toY(level.value)}
                stroke={level.color}
                strokeWidth="1"
                strokeDasharray="2 7"
                opacity="0.28"
              />
              <text
                x={model.left + 7}
                y={model.toY(level.value) - 5}
                fill={level.color}
                fontSize="9"
                fontWeight="700"
                letterSpacing="0.8"
                opacity="0.62"
              >
                {level.label}
              </text>
            </g>
          ))}

          {zones.map((zone) => {
            const yTop = model.toY(zone.high);
            const yBottom = model.toY(zone.low);
            return (
              <g key={zone.label}>
                <rect
                  x={model.left}
                  y={Math.min(yTop, yBottom)}
                  width={model.right - model.left}
                  height={Math.max(2, Math.abs(yBottom - yTop))}
                  fill={zone.color}
                  opacity="0.075"
                />
                <line
                  x1={model.left}
                  y1={yTop}
                  x2={model.right}
                  y2={yTop}
                  stroke={zone.color}
                  strokeOpacity="0.32"
                  strokeDasharray="4 6"
                />
                <text
                  x={model.left + 8}
                  y={Math.min(yTop, yBottom) + 13}
                  fill={zone.color}
                  opacity="0.82"
                  fontSize="10"
                  fontWeight="700"
                  letterSpacing="1"
                >
                  {zone.label}
                </text>
              </g>
            );
          })}

          <path
            d={model.ema50Path}
            fill="none"
            stroke="#75a7ff"
            strokeWidth="1.35"
            opacity="0.72"
          />
          <path
            d={model.ema20Path}
            fill="none"
            stroke="#f5c451"
            strokeWidth="1.5"
            opacity="0.9"
          />
          <path
            d={model.trendPath}
            fill="none"
            stroke="#d7e0ea"
            strokeWidth="1.15"
            strokeDasharray="8 7"
            opacity="0.42"
          />

          {model.visible.map((candle, index) => {
            const x = model.toX(index);
            const openY = model.toY(candle.open);
            const closeY = model.toY(candle.close);
            const highY = model.toY(candle.high);
            const lowY = model.toY(candle.low);
            const rising = candle.close >= candle.open;
            const color = rising ? "#32d5a4" : "#ff6875";
            const candleWidth = Math.max(1.5, Math.min(7, model.step * 0.62));
            return (
              <g key={candle.time}>
                <line
                  x1={x}
                  y1={highY}
                  x2={x}
                  y2={lowY}
                  stroke={color}
                  strokeWidth="1"
                  opacity="0.9"
                />
                <rect
                  x={x - candleWidth / 2}
                  y={Math.min(openY, closeY)}
                  width={candleWidth}
                  height={Math.max(1.25, Math.abs(closeY - openY))}
                  rx="0.65"
                  fill={rising ? "#32d5a4" : "#ff6875"}
                />
              </g>
            );
          })}

          <path
            d={model.supportTrendPath}
            fill="none"
            stroke="#22d3ee"
            strokeWidth="1.7"
            strokeDasharray="7 5"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            d={model.resistanceTrendPath}
            fill="none"
            stroke="#fb7185"
            strokeWidth="1.7"
            strokeDasharray="7 5"
            strokeLinecap="round"
            opacity="0.9"
          />
          {Number.isFinite(model.supportTrendLast) ? (
            <text
              x={model.right - 7}
              y={Math.max(
                model.top + 12,
                Math.min(model.priceBottom - 5, model.toY(model.supportTrendLast) - 5),
              )}
              fill="#67e8f9"
              fontSize="9"
              fontWeight="800"
              textAnchor="end"
              letterSpacing="0.6"
            >
              SUPPORT {model.supportTrendSlope >= 0 ? "↗" : "↘"}
            </text>
          ) : null}
          {Number.isFinite(model.resistanceTrendLast) ? (
            <text
              x={model.right - 7}
              y={Math.max(
                model.top + 12,
                Math.min(model.priceBottom - 5, model.toY(model.resistanceTrendLast) - 5),
              )}
              fill="#fda4af"
              fontSize="9"
              fontWeight="800"
              textAnchor="end"
              letterSpacing="0.6"
            >
              RESISTANCE {model.resistanceTrendSlope >= 0 ? "↗" : "↘"}
            </text>
          ) : null}

          {tradeLevels.map((level) => {
            const y = model.toY(level.value);
            return (
              <line
                key={level.label}
                x1={model.left}
                y1={y}
                x2={model.right}
                y2={y}
                stroke={level.color}
                strokeWidth={
                  level.label === "ENTRY" ||
                  level.label === "TRIGGER" ||
                  level.label === "MARKET"
                    ? 1.3
                    : 1
                }
                strokeDasharray={
                  level.label === "ENTRY" ||
                  level.label === "TRIGGER" ||
                  level.label === "MARKET"
                    ? "3 4"
                    : "7 7"
                }
                opacity={
                  level.label === "TP3" ||
                  level.label === "EXIT 3" ||
                  level.label === "CLOSE 3" ||
                  level.label === "ENTRY" ||
                  level.label === "TRIGGER" ||
                  level.label === "MARKET" ||
                  level.label === "STOP"
                    ? 0.72
                    : 0.34
                }
              />
            );
          })}
        </g>

        <line
          x1={model.left}
          y1={model.volumeTop - 7}
          x2={model.right}
          y2={model.volumeTop - 7}
          stroke="#1c2635"
        />
        {model.visible.map((candle, index) => {
          const x = model.toX(index);
          const barHeight =
            (candle.volume / model.maxVolume) * (model.volumeBottom - model.volumeTop);
          return (
            <rect
              key={"volume-" + candle.time}
              x={x - Math.max(1, model.step * 0.32)}
              y={model.volumeBottom - barHeight}
              width={Math.max(1.4, model.step * 0.64)}
              height={Math.max(1, barHeight)}
              fill={candle.close >= candle.open ? "#32d5a4" : "#ff6875"}
              opacity="0.22"
            />
          );
        })}

        {tradeLevels.map((level) => {
          const y = model.toY(level.value);
          return (
            <g key={"label-" + level.label}>
              <rect
                x={model.right + 2}
                y={y - 9}
                width="106"
                height="18"
                rx="4"
                fill={level.color}
                opacity={
                  level.label === "ENTRY" ||
                  level.label === "TRIGGER" ||
                  level.label === "MARKET"
                    ? 0.95
                    : 0.75
                }
              />
              <text
                x={model.right + 55}
                y={y + 3.5}
                fill="#081019"
                fontSize="9.5"
                fontWeight="800"
                textAnchor="middle"
              >
                {level.label + " " + formatPrice(level.value)}
              </text>
            </g>
          );
        })}

        {hoverX !== null && hover ? (
          <g pointerEvents="none">
            <line
              x1={hoverX}
              y1={model.top}
              x2={hoverX}
              y2={model.volumeBottom}
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeDasharray="3 5"
              opacity="0.45"
            />
            <line
              x1={model.left}
              y1={model.toY(hover.close)}
              x2={model.right}
              y2={model.toY(hover.close)}
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeDasharray="3 5"
              opacity="0.24"
            />
          </g>
        ) : null}
      </svg>

      <div className="pointer-events-none absolute bottom-[68px] left-4 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-slate-500">
        <span className="flex items-center gap-1.5">
          <i className="h-px w-4 bg-primary" /> EMA 20
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-px w-4 bg-[#75a7ff]" /> EMA 50
        </span>
        <span className="flex items-center gap-1.5">
          <i className="w-4 border-t border-dashed border-slate-500" /> Mid trend
        </span>
        <span className="flex items-center gap-1.5 text-cyan-300/70">
          <i className="w-4 border-t border-dashed border-cyan-300" /> Support trendline
        </span>
        <span className="flex items-center gap-1.5 text-rose-300/70">
          <i className="w-4 border-t border-dashed border-rose-300" /> Resistance trendline
        </span>
      </div>
    </div>
  );
}
