import { whaleSnapshot } from "@/app/server/positioning";
import { recentEvents, whaleRankings } from "@/app/server/whale-tracker";
import { hyperliquidCoin } from "@/app/lib/positioning";
import { whaleStance, type WhaleAlignment } from "@/app/lib/push-policy";

/** Ranked directional whales' stance on a Bybit pair's side: fresh flow first, then the open book. */
export async function whaleAlignment(symbol: string, side: "LONG" | "SHORT"): Promise<WhaleAlignment & { coin: string | null }> {
  const snapshot = await whaleSnapshot();
  const coin = hyperliquidCoin(symbol, new Set(snapshot.universe));
  if (!coin) return { stance: "NEUTRAL", detail: "not listed on Hyperliquid", coin: null };
  const ranks = await whaleRankings();
  const directional = new Set(ranks.filter(r => !r.marketMaker && r.tier !== "WATCH").map(r => r.trader));
  const book = { longUsd: 0, shortUsd: 0 };
  for (const p of snapshot.positions) if (p.coin === coin && directional.has(p.trader)) (p.side === "LONG" ? book.longUsd += p.sizeUsd : book.shortUsd += p.sizeUsd);
  const flow = { longUsd: 0, shortUsd: 0 };
  for (const e of await recentEvents(24 * 3_600_000, 600)) if (e.coin === coin && directional.has(e.trader) && (e.kind === "OPEN" || e.kind === "ADD" || e.kind === "FLIP")) (e.side === "LONG" ? flow.longUsd += Math.max(0, e.deltaUsd) : flow.shortUsd += Math.max(0, e.deltaUsd));
  return { ...whaleStance(side, book, flow), coin };
}
