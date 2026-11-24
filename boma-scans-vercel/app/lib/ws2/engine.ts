/**
 * WHALE SYSTEM 2 — independent positioning, squeeze-lifecycle and entry-timing engine.
 *
 * Separate from the original whale system. It borrows data (candles, the chart engine's read,
 * the tracked whale book, exchange ratios) but shares no scoring code with it.
 *
 * Principles:
 *  - Independent scores. LONG and SHORT never sum to 100; both can be poor. NO TRADE is a valid result.
 *  - Directional bias is separate from entry quality, exhaustion risk and data reliability.
 *  - Missing data is UNAVAILABLE: it scores nothing and its weight is NOT handed to other inputs.
 *  - Different trader populations are never averaged (Binance top 20% by margin, OKX top 5% by position
 *    value, Bybit accounts by count are shown and judged separately).
 *  - Retail crowding is squeeze fuel only when extreme against the coin's own history; never a trigger.
 *  - Open interest is judged in coin units; a USD change is reported separately.
 *  - Every score is an UNCALIBRATED HEURISTIC, not a probability. Weights are provisional hypotheses.
 */
export const WS2_VERSION = "WS2-0.1";
export type Side = "LONG" | "SHORT";
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Flow = { longUsd: number; shortUsd: number };
export type Ws2Status = "WATCHING" | "SETUP FORMING" | "AWAITING CONFIRMATION" | "AWAITING PULLBACK" | "ENTRY READY" | "ENTRY TRIGGERED" | "MISSED ENTRY" | "CHASING RISK" | "INVALIDATED" | "EXPIRED" | "NO TRADE" | "DATA UNAVAILABLE";
export type Ws2Input = {
  coin: string; symbol: string; at: number;
  /** Confirmed (closed) candles only, oldest first. */
  candles: { m15: Candle[]; h1: Candle[]; h4: Candle[]; d1: Candle[] };
  price: number | null;
  btc: { h1: Candle[]; h4: Candle[] } | null;
  /** Borrowed from the original chart engine (System 1). */
  chart: { bias: string; regime: string; trendFrames: number; planStatus: string; bos: string; choch: string; sweep: string; btcCorrelation: number | null; btcBeta: number | null } | null;
  /** Open interest in COIN units, oldest first, hourly. */
  oi: { series: Array<{ t: number; coins: number }> } | null;
  /** Funding per interval as a decimal (0.0001 = 0.01%). */
  funding: { current: number | null; intervalHours: number; history: number[]; at: number | null; other?: Array<{ source: string; value: number; at: number | null }> } | null;
  taker: { buyShare: number; trades: number; spanMinutes: number } | null;
  /** Bybit long share of ACCOUNTS (by count), hourly, oldest first. */
  bybitAccounts: { series: Array<{ t: number; longShare: number }> } | null;
  venues: { binanceTopPositions?: number; okxTopPositions?: number; binanceAccounts?: number; okxAccounts?: number };
  /** Ranked, non market-maker Hyperliquid accounts. null = cannot be identified for this coin. */
  whales: { bookLong: number; bookShort: number; positions: number; avgEntryLong: number | null; avgEntryShort: number | null; pnlLong: number; pnlShort: number; topShare: number; flows: { m15: Flow; h1: Flow; h4: Flow; h24: Flow }; reduced24: Flow } | null;
  /** Exchange-reported liquidations. null = not available from a timestamped source. */
  liquidations: { usd: number; longShare: number; timestamped: boolean } | null;
  settings: { equity: number; riskPct: number; leverage: number; feePct: number; slippagePct: number };
};
export type Component = { key: string; label: string; weight: number; available: boolean; bull: number; bear: number; note: string; raw: string[] };
export type Levels = { kind: "PULLBACK" | "MARKET"; entryLow: number; entryHigh: number; entry: number; stop: number; stopAtr: number; targets: Array<{ price: number; r: number; source: string }>; weightedR: number; size: { riskUsd: number; qty: number; notional: number; margin: number; estLiquidation: number; liquidationSafe: boolean } };
export type Ws2Result = {
  version: string; coin: string; symbol: string; at: number; price: number | null;
  status: Ws2Status; side: Side | null; headline: string;
  scores: { bullishBias: number; bearishBias: number; longEntry: number; shortEntry: number; longSqueeze: number; shortSqueeze: number; exhaustion: number; reliability: number; opportunity: number };
  scoreNote: string;
  components: Component[];
  squeeze: { long: { stage: string; note: string }; short: { stage: string; note: string } };
  exhaustion: { direction: "DOWN" | "UP" | "NONE"; parts: string[] };
  oi: { coinChange4h: number | null; coinChange24h: number | null; usdChange24h: number | null; read: string } | null;
  institutions: { verdict: string; lines: string[] };
  retail: { verdict: string; lines: string[] };
  whales: { verdict: string; lines: string[] };
  fundingRead: { verdict: string; lines: string[] };
  btc: { verdict: string; lines: string[] };
  feeds: Array<{ name: string; available: boolean; weight: number; detail: string }>;
  /** Per-side detail used by the decision and by calibration. */
  detail: Record<Side, { entry: number; confirmed: boolean; located: string; exhaustion: number }>;
  /** Plans for both sides, whichever leads, so a replay can score either. */
  plans: Record<Side, { pullback: Levels | null; market: Levels | null }>;
  missing: string[];
  levels: { pullback: Levels | null; market: Levels | null };
  sizing: string;
  activate: string[]; invalidate: string[];
  explain: Array<{ q: string; a: string }>;
  metrics: { atr1h: number | null; ema20: number | null; extensionAtr: number | null; change24hPct: number | null; rsi1h: number | null };
};

/** Provisional weights (hypotheses, not fitted). Sum = 100. */
export const WS2_WEIGHTS = { structure: 30, flow: 20, htf: 15, whales: 10, top: 10, retail: 5, funding: 5, btc: 5 } as const;
/**
 * Provisional decision thresholds (hypotheses, to be re-fitted from the signal log).
 * Bias is absolute evidence out of 100 and is never inflated when inputs are missing, so real readings sit lower than a normalised score would.
 */
export const WS2_THRESHOLDS = { leadBias: 35, leadGap: 15, readyBias: 45, readyEntry: 65, noTradeBelow: 30, chasingExhaustion: 60, readyMaxExhaustion: 50, minReliability: 45, readyReliability: 60 } as const;

// ───────────── maths helpers (confirmed candles only; no look-ahead) ─────────────
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const last = <T,>(a: T[], n = 1) => a[a.length - n];
export function ema(values: number[], period: number): number[] { const k = 2 / (period + 1); const out: number[] = []; values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k))); return out; }
export function atr(c: Candle[], period = 14): number | null { if (c.length < period + 1) return null; let sum = 0; for (let i = c.length - period; i < c.length; i++) sum += Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); return sum / period; }
export function rsi(c: Candle[], period = 14): number | null { if (c.length < period + 1) return null; let g = 0, l = 0; for (let i = c.length - period; i < c.length; i++) { const d = c[i].close - c[i - 1].close; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
/** Share of history at or below the value, 0–100. null with fewer than `min` points. */
export function percentile(history: number[], value: number, min = 60): number | null { if (history.length < min) return null; return history.filter(v => v <= value).length / history.length * 100; }
/** Swing pivots confirmed by `wing` closed candles on each side (known only after the right wing closed). */
export function pivots(c: Candle[], wing = 3): { highs: Array<{ i: number; price: number }>; lows: Array<{ i: number; price: number }> } {
  const highs: Array<{ i: number; price: number }> = [], lows: Array<{ i: number; price: number }> = [];
  for (let i = wing; i < c.length - wing; i++) {
    let hi = true, lo = true;
    for (let j = i - wing; j <= i + wing; j++) { if (j === i) continue; if (c[j].high >= c[i].high) hi = false; if (c[j].low <= c[i].low) lo = false; }
    if (hi) highs.push({ i, price: c[i].high }); if (lo) lows.push({ i, price: c[i].low });
  }
  return { highs, lows };
}
/** Trend read of one timeframe: independent bullish and bearish strength, each 0–1. */
export function trendRead(c: Candle[]): { bull: number; bear: number; note: string } | null {
  if (c.length < 55) return null;
  const closes = c.map(x => x.close); const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const px = last(closes), a = last(e20), b = last(e50), slope = a - e20[e20.length - 6];
  const p = pivots(c.slice(-80)); const h = p.highs.slice(-2), l = p.lows.slice(-2);
  const hh = h.length === 2 && h[1].price > h[0].price, hl = l.length === 2 && l[1].price > l[0].price, lh = h.length === 2 && h[1].price < h[0].price, ll = l.length === 2 && l[1].price < l[0].price;
  const bull = (a > b ? 0.3 : 0) + (slope > 0 ? 0.2 : 0) + (px > a ? 0.2 : 0) + (hh ? 0.15 : 0) + (hl ? 0.15 : 0);
  const bear = (a < b ? 0.3 : 0) + (slope < 0 ? 0.2 : 0) + (px < a ? 0.2 : 0) + (lh ? 0.15 : 0) + (ll ? 0.15 : 0);
  return { bull, bear, note: (a > b ? "EMA20 above EMA50" : "EMA20 below EMA50") + ", " + (slope > 0 ? "rising" : "falling") + ", price " + (px > a ? "above" : "below") + " EMA20" + (hh && hl ? ", higher highs and higher lows" : lh && ll ? ", lower highs and lower lows" : ", mixed swings") };
}
/**
 * System 2's own structure read on closed 1h candles, so it is reproducible in a historical replay.
 * BOS: a close in the last 6 candles beyond the latest confirmed swing in the direction of the prior swing sequence.
 * CHoCH: the same break against the prior sequence. Sweep: a wick through the latest swing in the last 3 candles that closed back inside.
 */
export function structureRead(c: Candle[]): { bos: "BULLISH" | "BEARISH" | "NONE"; choch: "BULLISH" | "BEARISH" | "NONE"; sweep: "BULLISH" | "BEARISH" | "NONE" } {
  const none = { bos: "NONE", choch: "NONE", sweep: "NONE" } as const; if (c.length < 40) return none;
  const w = c.slice(-86, -6); const p = pivots(w); if (p.highs.length < 2 || p.lows.length < 2) return none;
  const h = p.highs.slice(-2), l = p.lows.slice(-2); const up = h[1].price > h[0].price && l[1].price > l[0].price, down = h[1].price < h[0].price && l[1].price < l[0].price;
  const recent = c.slice(-6); const brokeUp = recent.some(x => x.close > h[1].price), brokeDown = recent.some(x => x.close < l[1].price);
  const last3 = c.slice(-3); const sweptHigh = last3.some(x => x.high > h[1].price && x.close < h[1].price), sweptLow = last3.some(x => x.low < l[1].price && x.close > l[1].price);
  return { bos: brokeUp && !down ? "BULLISH" : brokeDown && !up ? "BEARISH" : "NONE", choch: brokeUp && down ? "BULLISH" : brokeDown && up ? "BEARISH" : "NONE", sweep: sweptLow ? "BULLISH" : sweptHigh ? "BEARISH" : "NONE" };
}
/** Pearson correlation of the last `n` 1h returns of two candle series aligned by time. */
export function returnCorrelation(a: Candle[], b: Candle[], n = 48): number | null {
  const bm = new Map(b.map(x => [x.time, x.close])); const xs: number[] = [], ys: number[] = [];
  for (let i = Math.max(1, a.length - n); i < a.length; i++) { const b1 = bm.get(a[i].time), b0 = bm.get(a[i - 1].time); if (b1 && b0) { xs.push(a[i].close / a[i - 1].close - 1); ys.push(b1 / b0 - 1); } }
  if (xs.length < 24) return null; const mx = xs.reduce((p, q) => p + q, 0) / xs.length, my = ys.reduce((p, q) => p + q, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
const pct = (v: number, d = 1) => (v >= 0 ? "+" : "") + (v * 100).toFixed(d) + "%";
const share = (v: number) => Math.round(v * 100) + "% long";
const usd = (v: number) => Math.abs(v) >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : Math.abs(v) >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + Math.round(v / 1e3) + "K";
export const fmt = (v: number) => v >= 1000 ? v.toFixed(2) : v >= 10 ? v.toFixed(3) : v >= 0.1 ? v.toFixed(4) : v.toPrecision(4);
const changeOver = (series: Array<{ t: number; coins: number }>, hours: number): number | null => { if (series.length < hours + 1) return null; const now = last(series).coins, then = series[series.length - 1 - hours].coins; return then > 0 ? now / then - 1 : null; };

// ───────────── the engine ─────────────
/** The first, uncalibrated parameter set (WS2-0.1). Kept unchanged so every later version can be compared with it. */
export const WS2_BASELINE = { weights: { structure: 30, flow: 20, htf: 15, whales: 10, top: 10, retail: 5, funding: 5, btc: 5 }, thresholds: { leadBias: 35, leadGap: 15, readyBias: 45, readyEntry: 65, noTradeBelow: 30, chasingExhaustion: 60, readyMaxExhaustion: 50, minReliability: 45, readyReliability: 60 } } as const;
export type Ws2Params = { weights: Record<keyof typeof WS2_WEIGHTS, number>; thresholds: Record<keyof typeof WS2_THRESHOLDS, number> };
export function runWs2(input: Ws2Input, params: Ws2Params = { weights: WS2_WEIGHTS, thresholds: WS2_THRESHOLDS }): Ws2Result {
  const WEIGHTS = params.weights;
  const { h1, h4, d1, m15 } = input.candles;
  const price = input.price ?? (h1.length ? last(h1).close : null);
  const atr1h = atr(h1), atrD = atr(d1), closes = h1.map(c => c.close);
  const e20 = closes.length >= 25 ? last(ema(closes, 20)) : null;
  const rsi1h = rsi(h1);
  const change24 = h1.length >= 25 && price ? price / h1[h1.length - 25].close - 1 : null;
  const extensionAtr = price !== null && e20 !== null && atr1h ? (price - e20) / atr1h : null;
  const components: Component[] = [];
  const add = (key: keyof typeof WS2_WEIGHTS, label: string, c: { available: boolean; bull?: number; bear?: number; note: string; raw?: string[] }) => components.push({ key, label, weight: WEIGHTS[key], available: c.available, bull: clamp(c.bull ?? 0), bear: clamp(c.bear ?? 0), note: c.note, raw: c.raw ?? [] });

  // 1. Price action and market structure (1h). System 2 reads structure itself so live and replay results match.
  const own = structureRead(h1);
  const t1 = trendRead(h1);
  if (t1) {
    const sb = (own.bos === "BULLISH" ? 0.15 : 0) + (own.choch === "BULLISH" ? 0.15 : 0), sr = (own.bos === "BEARISH" ? 0.15 : 0) + (own.choch === "BEARISH" ? 0.15 : 0);
    add("structure", "Price action and structure (1h)", { available: true, bull: t1.bull * 0.7 + sb, bear: t1.bear * 0.7 + sr, note: t1.note + "; break of structure " + own.bos.toLowerCase() + ", change of character " + own.choch.toLowerCase() + (input.chart ? "; scanner regime " + input.chart.regime.toLowerCase() : ""), raw: ["EMA20 " + (e20 ? fmt(e20) : "n/a"), "ATR(1h) " + (atr1h ? fmt(atr1h) : "n/a"), "RSI(1h) " + (rsi1h?.toFixed(0) ?? "n/a")] });
  } else add("structure", "Price action and structure (1h)", { available: false, note: "UNAVAILABLE: fewer than 55 closed 1h candles." });

  // 2. Open interest (coin units) and execution flow
  const oiC4 = input.oi ? changeOver(input.oi.series, 4) : null, oiC24 = input.oi ? changeOver(input.oi.series, 24) : null;
  const px4 = h1.length >= 5 && price ? price / h1[h1.length - 5].close - 1 : null;
  const oiUsd24 = oiC24 !== null && change24 !== null ? (1 + oiC24) * (1 + change24) - 1 : null;
  let oiRead = "UNAVAILABLE";
  if (oiC4 !== null && px4 !== null) {
    const up = px4 > 0.002, down = px4 < -0.002, rising = oiC4 > 0.01, falling = oiC4 < -0.01;
    oiRead = !rising && !falling ? "Open interest in coins is flat over 4 h: little change in outstanding positions." : up && rising ? "Price up with coin open interest up: new exposure with the rise (hypothesis: fresh longs)." : up && falling ? "Price up with coin open interest down: possible short covering, a weaker kind of rise." : down && rising ? "Price down with coin open interest up: new exposure with the fall (hypothesis: fresh shorts)." : down && falling ? "Price down with coin open interest down: possible long liquidation or closing; fuel is being used up." : "Price flat; open interest " + (rising ? "building." : "draining.");
    const t = input.taker; const tb = t && t.trades >= 200 ? (t.buyShare > 0.55 ? 0.2 : 0) : 0, ts = t && t.trades >= 200 ? (t.buyShare < 0.45 ? 0.2 : 0) : 0;
    add("flow", "Open interest (coins) and execution flow", { available: true, bull: (up ? (rising ? 0.8 : falling ? 0.35 : 0.5) : 0) + tb, bear: (down ? (rising ? 0.8 : falling ? 0.35 : 0.5) : 0) + ts, note: oiRead, raw: ["Price 4 h " + pct(px4, 2), "OI coins 4 h " + pct(oiC4, 2), "OI coins 24 h " + (oiC24 === null ? "n/a" : pct(oiC24, 2)), "OI USD 24 h " + (oiUsd24 === null ? "n/a" : pct(oiUsd24, 2)) + " (includes the price change)", t ? "Taker buys " + Math.round(t.buyShare * 100) + "% of last " + t.trades + " trades (" + t.spanMinutes + " min)" : "Taker flow UNAVAILABLE"] });
  } else add("flow", "Open interest (coins) and execution flow", { available: false, note: "UNAVAILABLE: no open-interest history for this pair." });

  // 3. Higher timeframes
  const t4 = trendRead(h4), tD = trendRead(d1);
  if (t4 || tD) add("htf", "Higher-timeframe trend (4h, daily)", { available: true, bull: ((t4?.bull ?? 0) * 0.6 + (tD?.bull ?? 0) * 0.4) / ((t4 ? 0.6 : 0) + (tD ? 0.4 : 0)), bear: ((t4?.bear ?? 0) * 0.6 + (tD?.bear ?? 0) * 0.4) / ((t4 ? 0.6 : 0) + (tD ? 0.4 : 0)), note: "4h: " + (t4?.note ?? "UNAVAILABLE") + ". Daily: " + (tD?.note ?? "UNAVAILABLE") + "." });
  else add("htf", "Higher-timeframe trend (4h, daily)", { available: false, note: "UNAVAILABLE: not enough 4h / daily history." });

  // 4. Whales: new exposure counts; established profitable books are not an endorsement
  const w = input.whales; const whaleLines: string[] = []; let whaleVerdict = "UNAVAILABLE";
  if (w && (w.bookLong + w.bookShort > 0 || w.flows.h24.longUsd + w.flows.h24.shortUsd > 0)) {
    const book = w.bookLong + w.bookShort, f = w.flows.h24, ft = f.longUsd + f.shortUsd;
    const freshShare = ft >= 250_000 ? f.longUsd / ft : null, bookShare = book >= 1_000_000 ? w.bookLong / book : null;
    const shortProfit = w.bookShort > 0 ? w.pnlShort / w.bookShort : 0, longProfit = w.bookLong > 0 ? w.pnlLong / w.bookLong : 0;
    const estLong = bookShare !== null && bookShare >= 0.6, estShort = bookShare !== null && bookShare <= 0.4;
    const established = estShort && shortProfit > 0.05 ? "Established SHORT book already " + pct(shortProfit, 0) + " in profit: an old call, with profit-taking (short-covering) risk. Not an endorsement of a new short here." : estLong && longProfit > 0.05 ? "Established LONG book already " + pct(longProfit, 0) + " in profit: an old call, with profit-taking risk. Not an endorsement of a new long here." : null;
    const bookW = established ? 0.2 : 0.4;
    const bull = (freshShare !== null ? clamp((freshShare - 0.5) * 2.5) * 0.6 : 0) + (estLong ? clamp((bookShare! - 0.5) * 2.5) * bookW : 0);
    const bear = (freshShare !== null ? clamp((0.5 - freshShare) * 2.5) * 0.6 : 0) + (estShort ? clamp((0.5 - bookShare!) * 2.5) * bookW : 0);
    whaleVerdict = freshShare === null ? (bookShare === null ? "TOO SMALL TO READ" : "NO NEW EXPOSURE (book " + (estLong ? "long" : estShort ? "short" : "split") + ")") : freshShare >= 0.6 ? "NEW MONEY LONG" : freshShare <= 0.4 ? "NEW MONEY SHORT" : "NEW MONEY SPLIT";
    whaleLines.push("Open book (" + w.positions + " ranked accounts' positions): " + usd(w.bookLong) + " long vs " + usd(w.bookShort) + " short" + (bookShare !== null ? " (" + share(bookShare) + ")" : "") + ".",
      "Average entry: long " + (w.avgEntryLong ? fmt(w.avgEntryLong) : "n/a") + " · short " + (w.avgEntryShort ? fmt(w.avgEntryShort) : "n/a") + ". Unrealised: long " + (w.pnlLong >= 0 ? "+" : "−") + usd(Math.abs(w.pnlLong)) + " · short " + (w.pnlShort >= 0 ? "+" : "−") + usd(Math.abs(w.pnlShort)) + ".",
      "New exposure (opens and adds): 15 min " + usd(w.flows.m15.longUsd) + " L / " + usd(w.flows.m15.shortUsd) + " S · 1 h " + usd(w.flows.h1.longUsd) + " / " + usd(w.flows.h1.shortUsd) + " · 4 h " + usd(w.flows.h4.longUsd) + " / " + usd(w.flows.h4.shortUsd) + " · 24 h " + usd(f.longUsd) + " / " + usd(f.shortUsd) + ".",
      "Reduced or closed in 24 h: " + usd(w.reduced24.longUsd) + " of longs · " + usd(w.reduced24.shortUsd) + " of shorts.",
      "Concentration: the largest account holds " + Math.round(w.topShare * 100) + "% of the book" + (w.topShare >= 0.5 ? " (one account dominates; treat as one opinion)." : "."),
      ...(established ? [established] : []),
      "Caveat: a futures position is not a whole portfolio. A short here may hedge spot held elsewhere. Market makers are excluded.");
    add("whales", "Whale positioning (ranked Hyperliquid accounts)", { available: true, bull, bear, note: whaleVerdict + (established ? ". " + established : ""), raw: whaleLines.slice(0, 4) });
  } else { whaleLines.push("No identifiable ranked whale exposure on " + input.coin + ". Nothing is assumed."); add("whales", "Whale positioning (ranked Hyperliquid accounts)", { available: false, note: "UNAVAILABLE: whale exposure cannot be identified for this coin; no whale-led advice is given." }); }

  // 5. Exchange top traders: separate populations, never averaged
  const bt = input.venues.binanceTopPositions, ot = input.venues.okxTopPositions; const instLines: string[] = []; let instVerdict = "UNAVAILABLE";
  const lean = (v: number | undefined) => v === undefined ? null : v >= 0.57 ? "LONG" : v <= 0.43 ? "SHORT" : "NEUTRAL";
  const bl = lean(bt), ol = lean(ot);
  if (bt !== undefined) instLines.push("Binance top-trader position ratio: " + share(bt) + " (top 20% of users by margin balance) → " + bl + "."); else instLines.push("Binance top-trader position ratio: UNAVAILABLE.");
  if (ot !== undefined) instLines.push("OKX top-trader position ratio: " + share(ot) + " (top 5% by open position value) → " + ol + "."); else instLines.push("OKX top-trader position ratio: UNAVAILABLE.");
  instLines.push("These are different trader populations and are not averaged. Large accounts are not proven to be profitable or right.");
  if (bl || ol) {
    const leans = [bl, ol].filter(Boolean) as string[]; const longs = leans.filter(x => x === "LONG").length, shorts = leans.filter(x => x === "SHORT").length;
    instVerdict = longs && shorts ? "DISAGREE (one exchange long, the other short)" : longs === 2 ? "BOTH LEAN LONG" : shorts === 2 ? "BOTH LEAN SHORT" : longs ? "ONE LEANS LONG, the other neutral or missing: does not support shorts" : shorts ? "ONE LEANS SHORT, the other neutral or missing: does not support longs" : "NO CLEAR SIDE";
    add("top", "Exchange top-trader positioning", { available: true, bull: longs && shorts ? 0 : longs === 2 ? 1 : longs ? 0.4 : 0, bear: longs && shorts ? 0 : shorts === 2 ? 1 : shorts ? 0.4 : 0, note: instVerdict, raw: instLines.slice(0, 2) });
  } else add("top", "Exchange top-trader positioning", { available: false, note: "UNAVAILABLE on both exchanges for this pair." });

  // 6. Retail crowd: only extreme against the coin's own history counts, and only as fuel
  const acc = input.bybitAccounts?.series ?? []; const retailLines: string[] = []; let retailVerdict = "UNAVAILABLE"; let crowdLong: number | null = null, crowdPct: number | null = null, crowdChange24: number | null = null;
  if (acc.length) {
    crowdLong = last(acc).longShare; crowdPct = percentile(acc.map(a => a.longShare), crowdLong);
    crowdChange24 = acc.length >= 25 ? crowdLong - acc[acc.length - 25].longShare : null;
    const hist = acc.map(a => a.longShare).sort((a, b) => a - b); const median = hist[Math.floor(hist.length / 2)];
    retailLines.push("Bybit market account ratio (accounts by count, not money): " + share(crowdLong) + ".",
      crowdPct === null ? "History too short (" + acc.length + " h) to judge whether this is unusual for " + input.coin + "." : "Against its own last " + Math.round(acc.length / 24) + " days: " + Math.round(crowdPct) + "th percentile (typical " + share(median) + ").",
      "24 h change: " + (crowdChange24 === null ? "n/a" : (crowdChange24 >= 0 ? "+" : "") + (crowdChange24 * 100).toFixed(1) + " points" + (Math.abs(crowdChange24) < 0.02 ? " (unchanged: crowding is not building)." : crowdChange24 > 0 ? " (crowding is building)." : " (crowding is unwinding).")),
      ...(input.venues.binanceAccounts !== undefined ? ["Binance all accounts: " + share(input.venues.binanceAccounts) + "."] : []), ...(input.venues.okxAccounts !== undefined ? ["OKX all accounts: " + share(input.venues.okxAccounts) + "."] : []));
    const extremeLong = crowdPct !== null && crowdPct >= 90 && crowdLong >= 0.6, extremeShort = crowdPct !== null && crowdPct <= 10 && crowdLong <= 0.4;
    retailVerdict = extremeLong ? "UNUSUALLY LONG for this coin: long-squeeze fuel (not a trigger)" : extremeShort ? "UNUSUALLY SHORT for this coin: short-squeeze fuel (not a trigger)" : crowdPct === null ? "CANNOT JUDGE (short history)" : "NORMAL for this coin: no edge from the crowd";
    add("retail", "Retail crowd (Bybit accounts)", { available: true, bull: extremeShort ? 0.6 : 0, bear: extremeLong ? 0.6 : 0, note: retailVerdict, raw: retailLines.slice(0, 3) });
  } else add("retail", "Retail crowd (Bybit accounts)", { available: false, note: "UNAVAILABLE: no account-ratio data." });

  // 7. Funding: normalised per 8 h, judged against its own history; near zero proves nothing
  const fu = input.funding; const fundLines: string[] = []; let fundVerdict = "UNAVAILABLE"; let fundExtreme: "POS" | "NEG" | null = null;
  if (fu && fu.current !== null) {
    const per8 = fu.current * 8 / fu.intervalHours; const hist8 = fu.history.map(v => v * 8 / fu.intervalHours); const p = percentile(hist8, per8, 30);
    fundExtreme = p !== null && p >= 90 && per8 >= 0.0003 ? "POS" : p !== null && p <= 10 && per8 <= -0.0003 ? "NEG" : null;
    fundVerdict = fundExtreme === "POS" ? "EXTREME POSITIVE: longs pay heavily (long-squeeze vulnerability)" : fundExtreme === "NEG" ? "EXTREME NEGATIVE: shorts pay heavily (short-squeeze vulnerability)" : "ORDINARY: says nothing about direction, and does not prove leverage is balanced";
    fundLines.push("Bybit funding: " + (fu.current * 100).toFixed(4) + "% per " + fu.intervalHours + " h = " + (per8 * 100).toFixed(4) + "% per 8 h" + (p === null ? "." : " (" + Math.round(p) + "th percentile of its last " + hist8.length + " settlements)."),
      "Holding cost: a " + (per8 > 0 ? "LONG pays" : "SHORT pays") + " about " + (Math.abs(per8) * 100 * 3).toFixed(3) + "% per day at this rate.");
    for (const o of fu.other ?? []) if (Math.sign(o.value) !== Math.sign(fu.current) || Math.abs(o.value - fu.current) > 0.00005) fundLines.push("⚠️ Discrepancy: " + o.source + " shows " + (o.value * 100).toFixed(4) + "%" + (o.at ? "" : " (no timestamp)") + ". Different time, interval or source; the timestamped Bybit value is used.");
    add("funding", "Funding", { available: true, bull: fundExtreme === "NEG" ? 0.5 : 0, bear: fundExtreme === "POS" ? 0.5 : 0, note: fundVerdict, raw: fundLines.slice(0, 2) });
  } else add("funding", "Funding", { available: false, note: "UNAVAILABLE." });

  // 8. Bitcoin context
  const b1 = input.btc ? trendRead(input.btc.h1) : null, b4 = input.btc ? trendRead(input.btc.h4) : null; const corr = (input.btc ? returnCorrelation(h1, input.btc.h1) : null) ?? input.chart?.btcCorrelation ?? null; const btcLines: string[] = []; let btcVerdict = "UNAVAILABLE";
  if (input.coin === "BTC") { btcVerdict = "THIS IS BITCOIN"; add("btc", "Bitcoin and wider market", { available: false, note: "Not applicable: the instrument is BTC." }); }
  else if (b1 && b4) {
    const link = corr === null ? 0.6 : clamp(Math.abs(corr)); const bull = (b1.bull * 0.5 + b4.bull * 0.5) * link, bear = (b1.bear * 0.5 + b4.bear * 0.5) * link;
    btcVerdict = (b4.bear > b4.bull + 0.2 ? "BTC 4h bearish" : b4.bull > b4.bear + 0.2 ? "BTC 4h bullish" : "BTC 4h mixed") + (corr === null ? "" : "; " + input.coin + " correlation " + corr.toFixed(2) + (Math.abs(corr) >= 0.6 ? " (mostly following BTC)" : " (moving partly on its own)"));
    btcLines.push("BTC 1h: " + b1.note + ".", "BTC 4h: " + b4.note + ".", corr === null ? "Correlation UNAVAILABLE." : "Rolling correlation " + corr.toFixed(2) + (input.chart?.btcBeta != null ? ", beta " + input.chart.btcBeta.toFixed(2) : "") + ".");
    add("btc", "Bitcoin and wider market", { available: true, bull, bear, note: btcVerdict, raw: btcLines });
  } else add("btc", "Bitcoin and wider market", { available: false, note: "UNAVAILABLE." });

  // ── Independent directional bias (missing inputs score nothing; their weight is not redistributed)
  const bullishBias = Math.round(components.reduce((a, c) => a + c.weight * c.bull, 0));
  const bearishBias = Math.round(components.reduce((a, c) => a + c.weight * c.bear, 0));

  // ── Exhaustion: has the move already happened?
  const moveDir: "DOWN" | "UP" | "NONE" = change24 === null ? "NONE" : change24 <= -0.02 ? "DOWN" : change24 >= 0.02 ? "UP" : "NONE";
  const exParts: string[] = []; let ex = 0;
  if (moveDir !== "NONE" && price !== null) {
    const disp = atrD ? Math.abs(price - h1[h1.length - 25].close) / atrD : null;
    if (disp !== null) { const s = clamp(disp / 1.5) * 30; ex += s; exParts.push("24 h move " + pct(change24!, 1) + " = " + disp.toFixed(1) + " daily ATR (" + Math.round(s) + "/30)."); }
    if (extensionAtr !== null) { const away = moveDir === "DOWN" ? -extensionAtr : extensionAtr; const s = clamp(away / 3) * 25; ex += s; exParts.push("Price is " + Math.abs(extensionAtr).toFixed(1) + " ATR " + (extensionAtr < 0 ? "below" : "above") + " the 1h EMA20 (" + Math.round(s) + "/25)."); }
    if (rsi1h !== null) { const s = moveDir === "DOWN" ? clamp((35 - rsi1h) / 15) * 15 : clamp((rsi1h - 65) / 15) * 15; ex += s; exParts.push("RSI(1h) " + rsi1h.toFixed(0) + " (" + Math.round(s) + "/15)."); }
    if (oiC24 !== null) { const s = clamp(-oiC24 / 0.08) * 15; ex += s; exParts.push("Coin open interest " + pct(oiC24, 1) + " in 24 h" + (oiC24 < -0.02 ? ": positions were closed during the move, so fuel was used (" : " (") + Math.round(s) + "/15)."); }
    if (h1.length >= 27) { const vol = (from: number, to: number) => h1.slice(from, to).reduce((a, c) => a + c.volume, 0) / 3; let peak = 0; for (let i = h1.length - 24; i <= h1.length - 3; i++) peak = Math.max(peak, vol(i, i + 3)); const now = vol(h1.length - 3, h1.length); const s = peak > 0 && now < peak * 0.6 ? 10 : 0; ex += s; exParts.push("Volume now is " + (peak > 0 ? Math.round(now / peak * 100) : 0) + "% of the move's peak" + (s ? ": selling/buying pressure is fading (10/10)." : " (0/10).")); }
    const c3 = h1.slice(-3); const wick = c3.some(c => { const range = c.high - c.low; if (range <= 0) return false; return moveDir === "DOWN" ? (Math.min(c.open, c.close) - c.low) / range >= 0.5 : (c.high - Math.max(c.open, c.close)) / range >= 0.5; });
    if (wick) { ex += 5; exParts.push("A recent 1h candle rejected the move with a long wick (5/5)."); }
    if (input.liquidations && input.liquidations.usd > 0) { const oneSided = moveDir === "DOWN" ? input.liquidations.longShare : 1 - input.liquidations.longShare; if (oneSided >= 0.8) { ex += 10; exParts.push(Math.round(oneSided * 100) + "% of " + usd(input.liquidations.usd) + " reported liquidations were " + (moveDir === "DOWN" ? "longs" : "shorts") + ": that fuel is already burnt" + (input.liquidations.timestamped ? "" : " (snapshot without a precise time)") + " (+10)."); } }
    else exParts.push("Exchange-reported liquidations: UNAVAILABLE (Bybit has no public history; none is invented).");
  } else exParts.push("No large move in the last 24 h; nothing to exhaust.");
  const exhaustion = Math.round(clamp(ex / 100) * 100);
  const exhaustionFor = (side: Side) => (side === "SHORT" && moveDir === "DOWN") || (side === "LONG" && moveDir === "UP") ? exhaustion : Math.round(exhaustion * 0.15);

  // ── Squeeze potential and lifecycle (long squeeze = longs forced out, price falls)
  const oiHist = input.oi?.series.map(s => s.coins) ?? []; const oiPct = oiHist.length ? percentile(oiHist, last(oiHist), 48) : null;
  const squeezeScore = (longSq: boolean) => {
    let s = 0;
    if (crowdLong !== null && crowdPct !== null) s += longSq ? clamp((crowdPct - 60) / 40) * 35 * (crowdLong >= 0.55 ? 1 : 0.4) : clamp((40 - crowdPct) / 40) * 35 * (crowdLong <= 0.45 ? 1 : 0.4);
    if (fundExtreme === (longSq ? "POS" : "NEG")) s += 20;
    if (oiPct !== null) s += clamp((oiPct - 50) / 50) * 20;
    if (crowdChange24 !== null) s += longSq ? clamp(crowdChange24 / 0.05) * 10 : clamp(-crowdChange24 / 0.05) * 10;
    const st = components.find(c => c.key === "structure"); if (st?.available) s += (longSq ? st.bear : st.bull) * 15;
    const used = (longSq ? moveDir === "DOWN" : moveDir === "UP") ? exhaustion / 100 : 0;
    return Math.round(s * (1 - 0.6 * used));
  };
  const stage = (longSq: boolean): { stage: string; note: string } => {
    if (!h1.length || !atrD || price === null) return { stage: "UNKNOWN", note: "Not enough data." };
    const ref = h1[Math.max(0, h1.length - 25)].close; const window = h1.slice(-24);
    const extreme = longSq ? Math.min(...window.map(c => c.low)) : Math.max(...window.map(c => c.high));
    const dispMax = (longSq ? ref - extreme : extreme - ref) / atrD; const reclaim = Math.abs(ref - extreme) > 0 ? (longSq ? price - extreme : extreme - price) / Math.abs(ref - extreme) : 0;
    const fuel = crowdLong !== null && (longSq ? crowdLong >= 0.6 : crowdLong <= 0.4);
    const who = longSq ? "longs" : "shorts";
    if (dispMax < 0.5) return fuel ? { stage: "2 · SQUEEZE BUILDING", note: "The crowd is one-sided (" + who + ") but price has not moved against them yet. Fuel, no trigger." } : { stage: "1 · NO SQUEEZE CONDITIONS", note: "No one-sided crowd and no forced move." };
    if (reclaim >= 0.5) return { stage: "7 · RECOVERY OR REVERSAL", note: "Price has taken back " + Math.round(reclaim * 100) + "% of the squeeze move. The squeeze is likely over." };
    const fading = exParts.some(p => p.includes("fading")) || exParts.some(p => p.includes("long wick"));
    if (dispMax >= 1.5 || (oiC24 !== null && oiC24 <= -0.05)) return fading || (rsi1h !== null && (longSq ? rsi1h <= 28 : rsi1h >= 72)) ? { stage: "6 · POTENTIAL EXHAUSTION", note: "A " + dispMax.toFixed(1) + " daily-ATR move against " + who + " with fading pressure. Much of the fuel is already spent; entering now is chasing." } : { stage: "5 · LATE-STAGE SQUEEZE", note: "A " + dispMax.toFixed(1) + " daily-ATR move against " + who + ". Late: remaining fuel is unknown." };
    if (dispMax >= 1) return { stage: "4 · ACTIVE SQUEEZE", note: "Price is " + dispMax.toFixed(1) + " daily ATR against " + who + " and still going." };
    return { stage: "3 · INITIAL TRIGGER", note: "Price has started moving against " + who + " (" + dispMax.toFixed(1) + " daily ATR)." };
  };

  // ── Levels, built separately for a pullback entry and a market entry
  const buildLevels = (side: Side, kind: "PULLBACK" | "MARKET"): Levels | null => {
    if (price === null || !atr1h || e20 === null) return null;
    const sign = side === "LONG" ? 1 : -1; const p1 = pivots(h1.slice(-120)), p4 = pivots(h4.slice(-90), 2), pd = pivots(d1.slice(-90), 2);
    let entryLow: number, entryHigh: number, entry: number;
    if (kind === "MARKET") { entry = price; entryLow = price - 0.1 * atr1h; entryHigh = price + 0.1 * atr1h; }
    else { const mid = side === "SHORT" ? Math.max(e20, price) : Math.min(e20, price); entryLow = mid - (side === "SHORT" ? 0.2 : 0.3) * atr1h; entryHigh = mid + (side === "SHORT" ? 0.3 : 0.2) * atr1h; entry = mid; }
    const recent = h1.slice(-20); const structural = side === "SHORT" ? Math.max(...recent.map(c => c.high), entryHigh) + 0.3 * atr1h : Math.min(...recent.map(c => c.low), entryLow) - 0.3 * atr1h;
    const dist = clamp(Math.abs(structural - entry), 1.2 * atr1h, 3 * atr1h); const stop = entry - sign * dist; const risk = dist;
    const cands = [...(side === "SHORT" ? p1.lows : p1.highs).map(p => ({ price: p.price, source: "1h swing" })), ...(side === "SHORT" ? p4.lows : p4.highs).map(p => ({ price: p.price, source: "4h swing" })), ...(side === "SHORT" ? pd.lows : pd.highs).map(p => ({ price: p.price, source: "daily swing" }))]
      .map(c => ({ ...c, r: sign * (c.price - entry) / risk })).filter(c => c.r >= 0.7 && c.r <= 8).sort((a, b) => a.r - b.r);
    const targets: Levels["targets"] = []; for (const c of cands) { if (targets.length >= 5) break; if (!targets.length || c.r - last(targets).r >= 0.5) targets.push({ price: c.price, r: Number(c.r.toFixed(2)), source: c.source }); }
    for (const r of [1, 1.8, 2.8, 4, 5.5, 3.4, 6.5, 2.2, 7.5]) { if (targets.length >= 5) break; if (targets.every(t => Math.abs(t.r - r) >= 0.5)) targets.push({ price: entry + sign * r * risk, r, source: "volatility multiple (no structure found)" }); }
    targets.sort((a, b) => a.r - b.r);
    const alloc = [0.3, 0.25, 0.2, 0.15, 0.1]; const weightedR = Number(targets.reduce((a, t, i) => a + t.r * (alloc[i] ?? 0), 0).toFixed(2));
    const s = input.settings; const riskUsd = s.equity * s.riskPct / 100; const perUnit = risk + entry * (2 * s.feePct + s.slippagePct) / 100; const qty = riskUsd / perUnit; const notional = qty * entry;
    const estLiquidation = side === "LONG" ? entry * (1 - 1 / s.leverage + 0.005) : entry * (1 + 1 / s.leverage - 0.005);
    return { kind, entryLow, entryHigh, entry, stop, stopAtr: Number((risk / atr1h).toFixed(2)), targets, weightedR, size: { riskUsd, qty, notional, margin: notional / s.leverage, estLiquidation, liquidationSafe: side === "LONG" ? estLiquidation < stop - 0.5 * atr1h : estLiquidation > stop + 0.5 * atr1h } };
  };

  // ── Entry quality: location, lower-timeframe confirmation, structure, reward; minus exhaustion
  const m15Trend = (() => { if (m15.length < 25) return null; const cl = m15.map(c => c.close), e = ema(cl, 20); const c = last(m15), p = m15[m15.length - 2]; return { below: c.close < last(e) && c.high <= p.high, above: c.close > last(e) && c.low >= p.low }; })();
  const entryQuality = (side: Side): { score: number; confirmed: boolean; located: "CHASING" | "EXTENDED" | "GOOD" | "UNKNOWN" } => {
    if (extensionAtr === null) return { score: 0, confirmed: false, located: "UNKNOWN" };
    const away = side === "SHORT" ? -extensionAtr : extensionAtr; // how far price has already run in the trade's direction
    const located = away > 1.5 ? "CHASING" : away > 0.7 ? "EXTENDED" : "GOOD";
    const loc = away > 1.5 ? 0 : away > 0.7 ? 12 : away >= -1 ? 35 : 20;
    const confirmed = !!m15Trend && (side === "SHORT" ? m15Trend.below : m15Trend.above); const conf = confirmed ? 25 : 0;
    const want = side === "LONG" ? "BULLISH" : "BEARISH"; const struct = (own.bos === want ? 8 : 0) + (own.choch === want ? 8 : 0) + (own.sweep === want ? 4 : 0);
    const lv = buildLevels(side, "PULLBACK"); const rr = lv ? clamp(lv.weightedR / 2) * 20 : 0;
    return { score: Math.round(clamp((loc + conf + struct + rr - 0.3 * exhaustionFor(side)) / 100) * 100), confirmed, located };
  };
  const longQ = entryQuality("LONG"), shortQ = entryQuality("SHORT");

  // ── Data reliability (separate from direction)
  const fresh = (t: number | null | undefined, maxMin: number) => !!t && input.at - t <= maxMin * 60_000;
  const feeds: Ws2Result["feeds"] = [
    { name: "Bybit candles (15m, 1h, 4h, daily)", weight: 25, available: h1.length >= 55 && fresh(last(h1)?.time, 130), detail: h1.length + " closed 1h candles" + (h1.length ? ", last closed " + Math.round((input.at - last(h1).time) / 60_000 - 60) + " min ago" : "") },
    { name: "Bybit open interest (coin units)", weight: 12, available: !!input.oi && input.oi.series.length >= 25, detail: input.oi ? input.oi.series.length + " hourly points" : "UNAVAILABLE" },
    { name: "Bybit funding and history", weight: 8, available: !!fu && fu.current !== null, detail: fu ? fu.history.length + " settlements, every " + fu.intervalHours + " h" : "UNAVAILABLE" },
    { name: "Bybit account ratio history", weight: 10, available: acc.length >= 60, detail: acc.length ? acc.length + " hourly points" : "UNAVAILABLE" },
    { name: "Binance top-trader position ratio", weight: 7, available: bt !== undefined, detail: bt !== undefined ? share(bt) : "UNAVAILABLE" },
    { name: "OKX top-trader position ratio", weight: 7, available: ot !== undefined, detail: ot !== undefined ? share(ot) : "UNAVAILABLE" },
    { name: "Hyperliquid ranked whale positions", weight: 12, available: !!w, detail: w ? w.positions + " positions" : "UNAVAILABLE" },
    { name: "Bybit taker buy/sell (recent trades)", weight: 7, available: !!input.taker && input.taker.trades >= 200, detail: input.taker ? input.taker.trades + " trades over " + input.taker.spanMinutes + " min" : "UNAVAILABLE" },
    { name: "Bitcoin context", weight: 7, available: input.coin === "BTC" || (!!b1 && !!b4), detail: b1 && b4 ? "1h and 4h" : input.coin === "BTC" ? "n/a" : "UNAVAILABLE" },
    { name: "Exchange-reported liquidations", weight: 5, available: !!input.liquidations?.timestamped, detail: input.liquidations ? (input.liquidations.timestamped ? "timestamped" : "snapshot without a precise time") : "UNAVAILABLE (no public Bybit history)" },
  ];
  const reliability = Math.round(feeds.reduce((a, f) => a + (f.available ? f.weight : 0), 0));

  // ── Status: bias is not entry readiness
  const T = params.thresholds;
  const lead: Side | null = bullishBias >= T.leadBias && bullishBias - bearishBias >= T.leadGap ? "LONG" : bearishBias >= T.leadBias && bearishBias - bullishBias >= T.leadGap ? "SHORT" : null;
  const q = lead === "LONG" ? longQ : lead === "SHORT" ? shortQ : null; const bias = lead === "LONG" ? bullishBias : bearishBias; const exh = lead ? exhaustionFor(lead) : 0;
  let status: Ws2Status;
  if (reliability < T.minReliability || price === null || !atr1h) status = "DATA UNAVAILABLE";
  else if (!lead) status = bullishBias < T.noTradeBelow && bearishBias < T.noTradeBelow ? "NO TRADE" : "WATCHING";
  else if (exh >= T.chasingExhaustion || q!.located === "CHASING") status = "CHASING RISK";
  else if (q!.score >= T.readyEntry && q!.confirmed && exh < T.readyMaxExhaustion && reliability >= T.readyReliability && bias >= T.readyBias) status = "ENTRY READY";
  else if (q!.located === "EXTENDED") status = "AWAITING PULLBACK";
  else status = bias >= T.readyBias ? "AWAITING CONFIRMATION" : "SETUP FORMING";
  const opportunity = lead && status !== "DATA UNAVAILABLE" ? Math.round((bias * 0.45 + q!.score * 0.55) * (1 - exh / 200) * (0.5 + reliability / 200)) : 0;
  const pullback = lead ? buildLevels(lead, "PULLBACK") : null, market = lead ? buildLevels(lead, "MARKET") : null;

  // ── Plain-language output
  const dirWord = lead === "LONG" ? "bullish" : lead === "SHORT" ? "bearish" : "unclear";
  const sq = { long: stage(true), short: stage(false) };
  const criticalMissing = feeds.filter(f => !f.available && f.weight >= 10).map(f => f.name);
  const headline = status === "DATA UNAVAILABLE" ? "Cannot judge " + input.coin + " right now: " + (h1.length < 55 ? "Bybit returned only " + h1.length + " closed 1h candles for " + input.symbol + " (55 are needed; a newly listed pair needs about 3 days of history)." : price === null ? "Bybit returned no live price for " + input.symbol + "." : "too many inputs are missing (" + (criticalMissing.join("; ") || "several feeds") + ").") + " Nothing is guessed. Try again in a few minutes." : status === "NO TRADE" ? "No trade on " + input.coin + ": neither direction has enough evidence. That is a valid result." : status === "WATCHING" ? "Mixed evidence on " + input.coin + " (bullish " + bullishBias + ", bearish " + bearishBias + "). Watch only." : status === "CHASING RISK" ? "Bias is " + dirWord + ", but the move has largely happened. Entering now is chasing. Wait." : status === "AWAITING PULLBACK" ? "Bias is " + dirWord + ". Price has run from a fair entry; wait for it to come back." : status === "AWAITING CONFIRMATION" ? "Bias is " + dirWord + " and price is in a fair area, but the 15-minute chart has not confirmed. Wait." : status === "SETUP FORMING" ? "A " + dirWord + " setup is forming on " + input.coin + ". Not ready." : "Entry ready: " + lead + " " + input.coin + ". Check the levels and the risk first.";
  const sizing = status === "ENTRY READY" && (pullback ?? market) ? "Risk " + input.settings.riskPct + "% of equity (" + usd((pullback ?? market)!.size.riskUsd) + "). Size is computed from the stop distance, fees and slippage only; it does not depend on how strong the positioning looks." : "NOT AUTHORISED. No position size is approved until the status is ENTRY READY. The figures shown are what the size would be.";
  const activate: string[] = [], invalidate: string[] = [];
  if (lead && pullback && atr1h && e20 !== null) {
    const s = lead === "SHORT";
    if (status === "CHASING RISK" || status === "AWAITING PULLBACK") activate.push((s ? "A relief rally back to " : "A dip back to ") + fmt(pullback.entryLow) + "–" + fmt(pullback.entryHigh) + " (around the 1h EMA20) that " + (s ? "fails: a 15m close back below the 15m EMA20 with a lower high." : "holds: a 15m close back above the 15m EMA20 with a higher low."));
    if (status === "AWAITING CONFIRMATION" || status === "SETUP FORMING") activate.push("A closed 15m candle " + (s ? "below" : "above") + " its EMA20 with a " + (s ? "lower high" : "higher low") + " while price is between " + fmt(pullback.entryLow) + " and " + fmt(pullback.entryHigh) + ".");
    activate.push("Coin-unit open interest rising while price moves " + (s ? "down" : "up") + " (new exposure, not just closures).", "Exhaustion risk below " + T.readyMaxExhaustion + " and data reliability at least " + T.readyReliability + ".");
    invalidate.push("A closed 1h candle " + (s ? "above " : "below ") + fmt(pullback.stop) + " (the structural stop).", "The 1h trend read flips: EMA20 crosses EMA50 the other way.", s ? "Sharp recovery after heavy long liquidations (short-squeeze risk for late shorts)." : "Sharp drop after heavy short liquidations (long-squeeze risk for late longs).", "The signal expires 4 hours after it is issued if no entry triggers.");
  } else { activate.push("One direction reaching a bias of " + T.leadBias + " or more with a " + T.leadGap + "-point lead over the other."); invalidate.push("Nothing to invalidate: there is no trade."); }
  const top3 = (side: "bull" | "bear") => components.filter(c => c.available && c[side] > 0).sort((a, b) => b.weight * b[side] - a.weight * a[side]).slice(0, 3).map(c => c.label + " (" + Math.round(c.weight * c[side]) + " of " + c.weight + ")").join("; ") || "nothing";
  const explain = [
    { q: "Why this direction?", a: lead ? "The " + dirWord + " evidence scores " + bias + "/100 against " + (lead === "LONG" ? bearishBias : bullishBias) + " for the other side. Biggest contributors: " + top3(lead === "LONG" ? "bull" : "bear") + "." : "There is no direction. Bullish evidence " + bullishBias + ", bearish " + bearishBias + "; neither leads by enough." },
    { q: "Why now?", a: status === "ENTRY READY" ? "Price is in a fair entry area, the 15-minute chart has confirmed and the move is not exhausted." : "Not now. " + headline },
    { q: "Why not the opposite direction?", a: lead ? "The other side's evidence: " + top3(lead === "LONG" ? "bear" : "bull") + ". Its entry quality is " + (lead === "LONG" ? shortQ.score : longQ.score) + "/100." : "Both sides are weak; choosing either would be a guess." },
    { q: "What could go wrong?", a: [instVerdict.startsWith("DISAGREE") || instVerdict.includes("does not support") ? "Exchange top traders do not clearly back this side (" + instVerdict + ")." : "", exh >= 50 ? "The move is stretched (exhaustion " + exh + "/100); a snap-back is likely." : "", lead === "SHORT" ? "Short-squeeze: " + sq.short.stage + "." : lead === "LONG" ? "Long-squeeze: " + sq.long.stage + "." : "", btcVerdict !== "UNAVAILABLE" ? btcVerdict + "." : ""].filter(Boolean).join(" ") || "Normal market risk; nothing specific stands out." },
    { q: "Has the move already happened?", a: moveDir === "NONE" ? "No large move in the last 24 hours." : "Price moved " + pct(change24!, 1) + " in 24 hours. Exhaustion risk " + exhaustion + "/100. " + (lead === "SHORT" ? sq.long.note : lead === "LONG" ? sq.short.note : "") },
    { q: "What would invalidate the setup?", a: invalidate.slice(0, 2).join(" ") },
    { q: "How reliable is the supporting data?", a: "Reliability " + reliability + "/100. Unavailable: " + (feeds.filter(f => !f.available).map(f => f.name).join("; ") || "nothing") + ". Unavailable inputs score zero; their weight is not given to anything else." },
    { q: "What should I wait for before entering?", a: status === "ENTRY READY" ? "Nothing more. Place the stop the moment you are filled." : activate[0] ?? "A clear direction." },
  ];
  return {
    version: WS2_VERSION, coin: input.coin, symbol: input.symbol, at: input.at, price, status, side: lead, headline,
    scores: { bullishBias, bearishBias, longEntry: longQ.score, shortEntry: shortQ.score, longSqueeze: squeezeScore(true), shortSqueeze: squeezeScore(false), exhaustion, reliability, opportunity },
    scoreNote: "UNCALIBRATED HEURISTIC SCORES. They rank evidence; they are not probabilities of winning. Weights are provisional until the signal log has enough outcomes to test them.",
    components, squeeze: sq, exhaustion: { direction: moveDir, parts: exParts },
    oi: input.oi ? { coinChange4h: oiC4, coinChange24h: oiC24, usdChange24h: oiUsd24, read: oiRead + (oiC24 !== null && oiUsd24 !== null && Math.abs(oiUsd24 - oiC24) > 0.03 ? " In USD it changed " + pct(oiUsd24, 1) + " over 24 h, but in coins only " + pct(oiC24, 1) + ": most of the USD change is the price move, not positions closing." : "") } : null,
    institutions: { verdict: instVerdict, lines: instLines }, retail: { verdict: retailVerdict, lines: retailLines }, whales: { verdict: whaleVerdict, lines: whaleLines }, fundingRead: { verdict: fundVerdict, lines: fundLines }, btc: { verdict: btcVerdict, lines: btcLines },
    feeds, detail: { LONG: { entry: longQ.score, confirmed: longQ.confirmed, located: longQ.located, exhaustion: exhaustionFor("LONG") }, SHORT: { entry: shortQ.score, confirmed: shortQ.confirmed, located: shortQ.located, exhaustion: exhaustionFor("SHORT") } },
    plans: { LONG: { pullback: buildLevels("LONG", "PULLBACK"), market: buildLevels("LONG", "MARKET") }, SHORT: { pullback: buildLevels("SHORT", "PULLBACK"), market: buildLevels("SHORT", "MARKET") } },
    missing: feeds.filter(f => !f.available).map(f => f.name + " (" + f.detail + ")"),
    levels: { pullback, market }, sizing, activate, invalidate, explain,
    metrics: { atr1h, ema20: e20, extensionAtr, change24hPct: change24 === null ? null : change24 * 100, rsi1h },
  };
}

/** Telegram / text rendering. */
export function ws2Lines(r: Ws2Result): string[] {
  const lv = r.levels.pullback; const s = r.scores;
  return [
    "🐋² WHALE SYSTEM 2 · " + r.coin + " · " + r.status + (r.side ? " · bias " + r.side : ""),
    "📍 Price " + (r.price ? fmt(r.price) : "n/a") + " · " + r.version,
    "", "✅ WHAT TO DO: " + r.headline,
    "", "📊 SCORES (each 0–100, independent; not probabilities)",
    "• Bullish bias " + s.bullishBias + " · Bearish bias " + s.bearishBias,
    "• LONG entry quality " + s.longEntry + " · SHORT entry quality " + s.shortEntry,
    "• Long-squeeze potential " + s.longSqueeze + " · Short-squeeze potential " + s.shortSqueeze,
    "• Exhaustion risk " + s.exhaustion + " · Data reliability " + s.reliability + " · Opportunity " + s.opportunity,
    "", "🐋 Whales: " + r.whales.verdict, ...r.whales.lines.slice(0, 3).map(l => "   • " + l),
    "🏦 Exchange top traders: " + r.institutions.verdict, ...r.institutions.lines.slice(0, 2).map(l => "   • " + l),
    "👥 Retail crowd: " + r.retail.verdict, ...r.retail.lines.slice(0, 3).map(l => "   • " + l),
    "💸 Funding: " + r.fundingRead.verdict,
    "📈 Open interest: " + (r.oi?.read ?? "UNAVAILABLE"),
    "🔥 Long squeeze: " + r.squeeze.long.stage + " · Short squeeze: " + r.squeeze.short.stage,
    "₿ " + r.btc.verdict,
    ...(lv && r.side ? ["", "📐 LEVELS IF IT ACTIVATES (" + r.side + ", pullback entry)", "👉 Entry " + fmt(lv.entryLow) + " – " + fmt(lv.entryHigh), "❌ Stop " + fmt(lv.stop) + " (" + lv.stopAtr + " ATR)", ...lv.targets.map((t, i) => "🎯 TP" + (i + 1) + " " + fmt(t.price) + " · " + t.r + "R · " + t.source), "⚖️ Weighted reward " + lv.weightedR + "R across the five targets"] : []),
    "", "💰 Size: " + r.sizing,
    "", "⏳ WAIT FOR", ...r.activate.map(a => "• " + a),
    "⛔ INVALID IF", ...r.invalidate.slice(0, 3).map(a => "• " + a),
    "", ...r.explain.filter(e => ["What could go wrong?", "Has the move already happened?"].includes(e.q)).flatMap(e => ["❓ " + e.q, e.a]),
    "", "No order is placed. Shadow mode: this signal is logged and scored later.",
  ];
}
