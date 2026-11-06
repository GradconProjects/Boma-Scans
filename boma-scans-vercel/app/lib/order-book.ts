/**
 * Order-book balance from Bybit's /v5/market/orderbook (linear, 50 levels).
 *
 * This is an execution aid, not a signal: resting bid/ask depth shows where the
 * immediate pressure sits and whether a limit order would be buying into a wall.
 * Depth can be pulled or spoofed within seconds, so it is never a reason to
 * enter on its own.
 */
export type OrderBookBalance = {
  symbol: string;
  updatedAt: number;
  mid: number;
  /** Notional (USDT) resting within 1% of the mid price. */
  bidUsd: number;
  askUsd: number;
  /** 0..100: share of near-price depth on the bid side. */
  bidPct: number;
  /** Notional on the single largest level each side, as a share of that side. */
  largestBidWallPct: number;
  largestAskWallPct: number;
  verdict: "BID HEAVY" | "BALANCED" | "ASK HEAVY";
};

type RawBook = { s?: string; b?: [string, string][]; a?: [string, string][]; ts?: number | string };

export function summarizeOrderBook(symbol: string, raw: RawBook, now = Date.now(), bandPct = 1): OrderBookBalance | null {
  const bids = (raw.b ?? []).map(([price, size]) => [Number(price), Number(size)] as const).filter(([p, s]) => p > 0 && s >= 0);
  const asks = (raw.a ?? []).map(([price, size]) => [Number(price), Number(size)] as const).filter(([p, s]) => p > 0 && s >= 0);
  if (!bids.length || !asks.length) return null;
  const bestBid = Math.max(...bids.map(([p]) => p)), bestAsk = Math.min(...asks.map(([p]) => p));
  const mid = (bestBid + bestAsk) / 2;
  if (!(mid > 0)) return null;
  const inBand = ([p]: readonly [number, number]) => Math.abs(p - mid) / mid * 100 <= bandPct;
  const notional = (levels: (readonly [number, number])[]) => levels.filter(inBand).map(([p, s]) => p * s);
  const bidLevels = notional(bids), askLevels = notional(asks);
  const bidUsd = bidLevels.reduce((a, b) => a + b, 0), askUsd = askLevels.reduce((a, b) => a + b, 0);
  const total = bidUsd + askUsd;
  if (!(total > 0)) return null;
  const bidPct = bidUsd / total * 100;
  return {
    symbol, updatedAt: now, mid, bidUsd, askUsd, bidPct,
    largestBidWallPct: bidUsd ? Math.max(...bidLevels) / bidUsd * 100 : 0,
    largestAskWallPct: askUsd ? Math.max(...askLevels) / askUsd * 100 : 0,
    verdict: bidPct >= 60 ? "BID HEAVY" : bidPct <= 40 ? "ASK HEAVY" : "BALANCED",
  };
}

/** Plain-language read of the book for the trade side. */
export function orderBookAdvice(book: OrderBookBalance, side: "LONG" | "SHORT") {
  const withSide = side === "LONG" ? book.bidPct : 100 - book.bidPct;
  if (withSide >= 60) return "Resting depth favours your side (" + withSide.toFixed(0) + "% within 1% of price). Limit fills near the zone are plausible; do not chase.";
  if (withSide <= 40) return "Resting depth leans against your side (" + (100 - withSide).toFixed(0) + "% opposing within 1% of price). Expect your limit to be tested; keep the stop and size as planned, never widen.";
  return "Depth is balanced near price. Rely on the closed-candle trigger, not the book.";
}
