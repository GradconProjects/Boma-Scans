import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/app/server/cron-auth";
import { replayScanner, replayUniverse, replayWs2 } from "@/app/server/ws2/replay";
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
    const days = Math.max(5, Math.min(200, Number(q.get("days")) || 180)), step = Math.max(1, Math.min(24, Number(q.get("step")) || 4));
    // ?end=<ms> replays an older window ending at that time, so long histories can be collected in chunks.
    const end = Number(q.get("end")); const now = Number.isFinite(end) && end > 1_500_000_000_000 && end < Date.now() ? end : Date.now();
    // ?system=scanner replays the original Scanner's rules with the same scoring, for comparison.
    if (q.get("system") === "scanner") return NextResponse.json(await replayScanner(symbol, days, step, now), { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(await replayWs2(symbol, days, step, q.get("current") ? undefined : WS2_BASELINE, now), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "replay failed" }, { status: 502 }); }
}
