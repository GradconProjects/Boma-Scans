import { NextRequest, NextResponse } from "next/server";
import { getOwnerUser } from "@/app/server/owner-auth";
import { positioningFor, whaleSnapshot } from "@/app/server/positioning";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/positioning?symbols=BTCUSDT,ETHUSDT → whale (Hyperliquid) and crowd (Bybit) positioning per pair. */
export async function GET(request: NextRequest) {
  const user = await getOwnerUser();
  if (!user) return NextResponse.json({ error: "Sign in at /login." }, { status: 401 });
  const symbols = Array.from(new Set((request.nextUrl.searchParams.get("symbols") ?? "").toUpperCase().split(",").filter(s => /^[A-Z0-9]{2,24}USDT$/.test(s)))).slice(0, 16);
  if (!symbols.length) return NextResponse.json({ error: "No symbols." }, { status: 400 });
  try {
    const snapshot = await whaleSnapshot();
    const entries = await Promise.all(symbols.map(symbol => positioningFor(symbol, snapshot)));
    return NextResponse.json({ at: snapshot.at, traders: new Set(snapshot.positions.map(p => p.trader)).size, data: Object.fromEntries(entries.map(entry => [entry.symbol, entry])) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Positioning unavailable." }, { status: 502 });
  }
}
