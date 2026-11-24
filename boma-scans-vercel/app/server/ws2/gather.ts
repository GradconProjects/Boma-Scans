import { analyzePair, bars } from "@/app/server/market-analysis";
import { positioningFor, whaleSnapshot } from "@/app/server/positioning";
import { recentEvents, whaleRankings } from "@/app/server/whale-tracker";
import { STYLE_CONFIG } from "@/app/lib/market";
import type { Candle, Flow, Ws2Input } from "@/app/lib/ws2/engine";

const BYBIT = "https://api.bybit.com";
async function bybit<T>(path: string, params: Record<string, string>): Promise<T[] | null> {
  try {
    const url = new URL(path, BYBIT); url.searchParams.set("category", "linear"); for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const d = await r.json() as { retCode?: number; result?: { list?: T[] } };
    return d.retCode === 0 && Array.isArray(d.result?.list) ? d.result!.list! : null;
  } catch { return null; }
}
/** Closed candles only: the forming candle is dropped so nothing repaints. */
async function closed(symbol: string, interval: string, ms: number, limit: number, now: number): Promise<Candle[]> {
  try { const all = await bars(symbol, interval, limit) as Candle[]; return all.filter(c => c.time + ms <= now); } catch { return []; }
}
export type Ws2Settings = { watch: string[]; alerts: boolean; equity: number; riskPct: number; leverage: number; feePct: number; slippagePct: number };
export const WS2_DEFAULTS: Ws2Settings = { watch: ["BTC", "ETH", "SOL"], alerts: true, equity: 10_000, riskPct: 0.5, leverage: 5, feePct: 0.055, slippagePct: 0.02 };

/** Collects everything Whale System 2 needs for one Bybit pair. Read-only: borrows from the scanner and the whale tracker without changing them. */
export async function gatherWs2(symbol: string, settings: Ws2Settings, now = Date.now()): Promise<Ws2Input> {
  const H = 3_600_000;
  const [m15, h1, h4, d1, btcH1, btcH4, oiRaw, accRaw, fundRaw, instRaw, tickRaw, tradeRaw, analysed, snapshot] = await Promise.all([
    closed(symbol, "15", H / 4, 120, now), closed(symbol, "60", H, 320, now), closed(symbol, "240", 4 * H, 140, now), closed(symbol, "D", 24 * H, 120, now),
    symbol === "BTCUSDT" ? Promise.resolve([] as Candle[]) : closed("BTCUSDT", "60", H, 120, now), symbol === "BTCUSDT" ? Promise.resolve([] as Candle[]) : closed("BTCUSDT", "240", 4 * H, 120, now),
    bybit<{ openInterest: string; timestamp: string }>("/v5/market/open-interest", { symbol, intervalTime: "1h", limit: "200" }),
    bybit<{ buyRatio: string; timestamp: string }>("/v5/market/account-ratio", { symbol, period: "1h", limit: "500" }),
    bybit<{ fundingRate: string; fundingRateTimestamp: string }>("/v5/market/funding/history", { symbol, limit: "200" }),
    bybit<{ fundingInterval?: number }>("/v5/market/instruments-info", { symbol }),
    bybit<{ lastPrice: string; fundingRate: string }>("/v5/market/tickers", { symbol }),
    bybit<{ side: string; size: string; price: string; time: string }>("/v5/market/recent-trade", { symbol, limit: "1000" }),
    analyzePair(symbol, STYLE_CONFIG.DAY.interval, "DAY", "STRICT").catch(() => null),
    whaleSnapshot().catch(() => null),
  ]);
  const positioning = snapshot ? await positioningFor(symbol, snapshot).catch(() => null) : null;
  const coin = positioning?.coin ?? symbol.replace(/USDT$/, "");
  const venue = (name: string) => positioning?.venues?.find(v => v.name === name)?.longShare;

  // Ranked, non market-maker whales: book, entries, P&L, new exposure by window, reductions.
  let whales: Ws2Input["whales"] = null;
  if (snapshot && positioning?.coin) {
    try {
      const ranks = await whaleRankings(); const ranked = new Set(ranks.filter(r => !r.marketMaker && r.tier !== "WATCH").map(r => r.trader));
      const book = snapshot.positions.filter(p => p.coin === positioning.coin && ranked.has(p.trader));
      const sum = (side: "LONG" | "SHORT", f: (p: typeof book[number]) => number) => book.filter(p => p.side === side).reduce((a, p) => a + f(p), 0);
      const bookLong = sum("LONG", p => p.sizeUsd), bookShort = sum("SHORT", p => p.sizeUsd);
      const flows = { m15: { longUsd: 0, shortUsd: 0 }, h1: { longUsd: 0, shortUsd: 0 }, h4: { longUsd: 0, shortUsd: 0 }, h24: { longUsd: 0, shortUsd: 0 } } as Record<"m15" | "h1" | "h4" | "h24", Flow>;
      const reduced24: Flow = { longUsd: 0, shortUsd: 0 };
      for (const e of await recentEvents(24 * H, 800)) {
        if (e.coin !== positioning.coin || !ranked.has(e.trader)) continue;
        const key = e.side === "LONG" ? "longUsd" : "shortUsd"; const age = now - e.at;
        if (e.kind === "OPEN" || e.kind === "ADD" || e.kind === "FLIP") { const add = Math.max(0, e.deltaUsd); flows.h24[key] += add; if (age <= 4 * H) flows.h4[key] += add; if (age <= H) flows.h1[key] += add; if (age <= H / 4) flows.m15[key] += add; }
        else if (e.kind === "CLOSE" || e.kind === "REDUCE") reduced24[key] += Math.abs(e.deltaUsd);
      }
      if (book.length || flows.h24.longUsd + flows.h24.shortUsd > 0) whales = {
        bookLong, bookShort, positions: book.length,
        avgEntryLong: bookLong > 0 ? sum("LONG", p => p.entry * p.sizeUsd) / bookLong : null, avgEntryShort: bookShort > 0 ? sum("SHORT", p => p.entry * p.sizeUsd) / bookShort : null,
        pnlLong: sum("LONG", p => p.pnl), pnlShort: sum("SHORT", p => p.pnl),
        topShare: bookLong + bookShort > 0 ? Math.max(0, ...book.map(p => p.sizeUsd)) / (bookLong + bookShort) : 0, flows, reduced24,
      };
    } catch { whales = null; }
  }
  const price = tickRaw?.[0] ? Number(tickRaw[0].lastPrice) : null;
  const intervalHours = instRaw?.[0]?.fundingInterval ? instRaw[0].fundingInterval / 60 : 8;
  const trades = tradeRaw ?? []; const buy = trades.filter(t => t.side === "Buy").reduce((a, t) => a + Number(t.size), 0), all = trades.reduce((a, t) => a + Number(t.size), 0);
  const times = trades.map(t => Number(t.time)).filter(Number.isFinite);
  return {
    coin, symbol, at: now, price: Number.isFinite(price) ? price : null, candles: { m15, h1, h4, d1 },
    btc: btcH1.length && btcH4.length ? { h1: btcH1, h4: btcH4 } : null,
    chart: analysed ? { bias: analysed.row.bias, regime: analysed.row.regime, trendFrames: analysed.row.trendFrames, planStatus: analysed.row.executionPlan.status, bos: analysed.analysis.structure.bos, choch: analysed.analysis.structure.choch, sweep: analysed.analysis.structure.sweep, btcCorrelation: analysed.relationship.correlation, btcBeta: analysed.relationship.beta } : null,
    oi: oiRaw && oiRaw.length ? { series: oiRaw.map(o => ({ t: Number(o.timestamp), coins: Number(o.openInterest) })).filter(o => o.coins > 0).reverse() } : null,
    funding: tickRaw?.[0] || fundRaw ? { current: tickRaw?.[0] ? Number(tickRaw[0].fundingRate) : null, intervalHours, history: (fundRaw ?? []).map(f => Number(f.fundingRate)).filter(Number.isFinite).reverse(), at: now } : null,
    taker: all > 0 && times.length ? { buyShare: buy / all, trades: trades.length, spanMinutes: Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60_000)) } : null,
    bybitAccounts: accRaw && accRaw.length ? { series: accRaw.map(a => ({ t: Number(a.timestamp), longShare: Number(a.buyRatio) })).filter(a => a.longShare > 0).reverse() } : null,
    venues: { binanceTopPositions: venue("Binance top traders"), okxTopPositions: venue("OKX top traders"), binanceAccounts: venue("Binance"), okxAccounts: venue("OKX") },
    whales, liquidations: null,
    settings: { equity: settings.equity, riskPct: settings.riskPct, leverage: settings.leverage, feePct: settings.feePct, slippagePct: settings.slippagePct },
  };
}
