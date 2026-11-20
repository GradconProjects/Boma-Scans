import { positioningFor, whaleSnapshot } from "@/app/server/positioning";
import { recentEvents, whaleRankings } from "@/app/server/whale-tracker";
import { positioningMatrix, type MatrixInput, type PositioningMatrix } from "@/app/lib/positioning-matrix";

/** Live positioning matrix for a Bybit pair: ranked whale book and flows, Binance / OKX top traders, Bybit crowd, funding and open interest. */
export async function positioningMatrixFor(symbol: string, side?: "LONG" | "SHORT", now = Date.now()): Promise<PositioningMatrix & { symbol: string }> {
  const snapshot = await whaleSnapshot();
  const data = await positioningFor(symbol, snapshot);
  const coin = data.coin ?? symbol.replace(/USDT$/, "");
  let whales: MatrixInput["whales"] = null;
  if (data.coin) {
    const ranks = await whaleRankings();
    const rankBy = new Map(ranks.filter(r => !r.marketMaker && r.tier !== "WATCH").map(r => [r.trader, r]));
    const book = snapshot.positions.filter(p => p.coin === data.coin && rankBy.has(p.trader));
    const flow24 = { longUsd: 0, shortUsd: 0 }, flow6 = { longUsd: 0, shortUsd: 0 };
    for (const e of await recentEvents(24 * 3_600_000, 600)) {
      if (e.coin !== data.coin || !rankBy.has(e.trader) || !(e.kind === "OPEN" || e.kind === "ADD" || e.kind === "FLIP")) continue;
      const add = Math.max(0, e.deltaUsd);
      if (e.side === "LONG") flow24.longUsd += add; else flow24.shortUsd += add;
      if (now - e.at <= 6 * 3_600_000) { if (e.side === "LONG") flow6.longUsd += add; else flow6.shortUsd += add; }
    }
    whales = {
      bookLong: book.filter(p => p.side === "LONG").reduce((a, p) => a + p.sizeUsd, 0), bookShort: book.filter(p => p.side === "SHORT").reduce((a, p) => a + p.sizeUsd, 0), positions: book.length, flow24, flow6,
      top: book.sort((a, b) => b.sizeUsd - a.sizeUsd).slice(0, 3).map(p => { const r = rankBy.get(p.trader)!; return { label: r.label, tier: r.tier, rank: r.rank, side: p.side, sizeUsd: p.sizeUsd, entry: p.entry, pnl: p.pnl }; }),
    };
  }
  return { ...positioningMatrix({ coin, price: data.hyperliquid?.markPx, whales, venues: data.venues ?? [], crowd: data.crowd }, side), symbol };
}
