import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/app/server/cron-auth";
import { replayUniverse, replayWs2 } from "@/app/server/ws2/replay";
import { WS2_BASELINE } from "@/app/lib/ws2/engine";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Calibration data for Whale System 2 (key-protected). ?list=1 returns every crypto pair; ?symbol=X&days=90 replays the
 * engine over that pair's history with the fixed baseline parameters and returns one row per sample with its outcomes.
 */
export async function GET(request: NextRequest) {
  if (!(await cronAuthorized(request))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const q = request.nextUrl.searchParams;
  try {
    if (q.get("list")) return NextResponse.json({ universe: await replayUniverse() });
    const symbol = (q.get("symbol") ?? "").toUpperCase(); if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol)) return NextResponse.json({ error: "symbol?" }, { status: 400 });
    const days = Math.max(5, Math.min(120, Number(q.get("days")) || 90)), step = Math.max(1, Math.min(24, Number(q.get("step")) || 4));
    return NextResponse.json(await replayWs2(symbol, days, step, q.get("current") ? undefined : WS2_BASELINE), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "replay failed" }, { status: 502 }); }
}
