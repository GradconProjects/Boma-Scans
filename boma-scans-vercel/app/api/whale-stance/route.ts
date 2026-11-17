import { NextRequest, NextResponse } from "next/server";
import { getOwnerUser } from "@/app/server/owner-auth";
import { whaleAlignment } from "@/app/server/whale-align";
import { recentEvents, whaleRankings } from "@/app/server/whale-tracker";
import { hyperliquidCoin } from "@/app/lib/positioning";
import { whaleSnapshot } from "@/app/server/positioning";
export const dynamic = "force-dynamic";

/** GET ?symbol=XRPUSDT&side=SHORT → ranked whales' stance on the side plus their last moves on the coin. Used by the Before Telegram build to cross-check its signals. */
export async function GET(request: NextRequest) {
  const user = await getOwnerUser(); if (!user) return NextResponse.json({ error: "Sign in at /login." }, { status: 401 });
  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "").toUpperCase(); const side = request.nextUrl.searchParams.get("side") === "SHORT" ? "SHORT" : "LONG";
  if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol)) return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
  try {
    const stance = await whaleAlignment(symbol, side);
    const snapshot = await whaleSnapshot(); const coin = hyperliquidCoin(symbol, new Set(snapshot.universe));
    const ranks = await whaleRankings(); const rankBy = new Map(ranks.map(r => [r.trader, r]));
    const moves = coin ? (await recentEvents(24 * 3_600_000, 600)).filter(e => e.coin === coin && rankBy.has(e.trader) && !rankBy.get(e.trader)!.marketMaker && Math.abs(e.deltaUsd) >= 100_000).slice(0, 8).map(e => ({ at: e.at, label: rankBy.get(e.trader)!.label, tier: rankBy.get(e.trader)!.tier, kind: e.kind, side: e.side, deltaUsd: e.deltaUsd, entry: e.entry })) : [];
    const book = coin ? snapshot.positions.filter(p => p.coin === coin && (rankBy.get(p.trader)?.tier ?? "WATCH") !== "WATCH").reduce((acc, p) => { acc[p.side === "LONG" ? "longUsd" : "shortUsd"] += p.sizeUsd; return acc; }, { longUsd: 0, shortUsd: 0 }) : null;
    return NextResponse.json({ symbol, side, coin, stance: stance.stance, detail: stance.detail, moves, book }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Whale data unavailable." }, { status: 502 }); }
}
