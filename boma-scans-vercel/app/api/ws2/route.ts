import { NextRequest, NextResponse } from "next/server";
import { getOwnerUser } from "@/app/server/owner-auth";
import { analyseWs2, saveWs2Settings, scoreWs2Log, ws2Board, ws2Log, ws2Settings } from "@/app/server/ws2/store";
import { ensureWs2Schedule } from "@/app/server/ws2/schedule";
import { summarise } from "@/app/lib/ws2/outcomes";
import { WS2_SOURCES } from "@/app/lib/ws2/registry";
import { WS2_THRESHOLDS, WS2_WEIGHTS } from "@/app/lib/ws2/engine";
import { WS2_CALIBRATION } from "@/app/lib/ws2/calibrated";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Whale System 2. GET: settings, signal log, performance, method. POST: analyse a coin or change settings. */
export async function GET(request: NextRequest) {
  const user = await getOwnerUser(); if (!user) return reply({ error: "Sign in at /login." }, 401);
  const schedule = await ensureWs2Schedule(request.nextUrl.origin).catch(() => null);
  await scoreWs2Log(3).catch(() => 0);
  const log = await ws2Log(); const now = Date.now();
  const { pairStats: _pairs, ...calibration } = WS2_CALIBRATION; void _pairs;
  return reply({ version: WS2_CALIBRATION.version, calibration, settings: await ws2Settings(), log: log.slice(-120).reverse(), board: Object.values(await ws2Board()).sort((a, b) => (b.scores.opportunity ?? 0) - (a.scores.opportunity ?? 0)), performance: [7, 30, 90].map(d => summarise(log, d, now)), sources: WS2_SOURCES, weights: WS2_WEIGHTS, thresholds: WS2_THRESHOLDS, schedule });
}
export async function POST(request: NextRequest) {
  const user = await getOwnerUser(); if (!user) return reply({ error: "Sign in at /login." }, 401);
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Origin rejected." }, 403);
  const body = await request.json().catch(() => ({})) as { action?: string; coin?: string; watch?: string[]; alerts?: boolean; universe?: number; equity?: number; riskPct?: number; leverage?: number };
  if (body.action === "analyse") {
    const coin = String(body.coin ?? "").replace(/[^A-Za-z0-9]/g, ""); if (!coin) return reply({ error: "Which coin?" }, 400);
    try { const { result } = await analyseWs2(coin); return reply({ result }); } catch (error) { return reply({ error: error instanceof Error ? error.message : "Analysis failed." }, 502); }
  }
  if (body.action === "settings") return reply({ settings: await saveWs2Settings(body) });
  return reply({ error: "Unknown action." }, 400);
}
