import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/app/server/cron-auth";
import { logWs2, nextUniverseSlice, readWs2, saveBoardRows, scoreWs2Log, symbolFor, ws2Settings } from "@/app/server/ws2/store";
import { deliverEvents, telegramConfig } from "@/app/server/telegram-delivery";
import { ws2RatedLines as ws2Lines } from "@/app/lib/ws2/calibrated";
import type { Ws2Rated as Ws2Result } from "@/app/lib/ws2/rating";
import type { TelegramEvent } from "@/app/lib/telegram-events";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Whale System 2 shadow scan, every 15 minutes. Each run reads the watchlist plus the next slice of the most-traded
 * Bybit pairs (the whole universe is covered about once an hour), updates the market board, logs changed signals,
 * scores old ones, and alerts only when a coin becomes ENTRY READY.
 */
export async function GET(request: NextRequest) {
  if (!(await cronAuthorized(request))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const started = Date.now(); const settings = await ws2Settings();
  const watch = (await Promise.all(settings.watch.map(c => symbolFor(c).catch(() => null)))).filter((s): s is string => !!s);
  const take = Math.max(0, Number(request.nextUrl.searchParams.get("take")) || 10);
  const slice = await nextUniverseSlice(settings.universe, take, new Set(watch)).catch(() => [] as string[]);
  const queue = Array.from(new Set([...watch, ...slice])); const results: Ws2Result[] = []; const errors: Array<{ symbol: string; error: string }> = [];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let symbol = queue.shift(); symbol; symbol = queue.shift()) {
      if (Date.now() - started > 42_000) { errors.push({ symbol, error: "skipped: out of time" }); continue; }
      try { results.push(await readWs2(symbol, settings)); } catch (error) { errors.push({ symbol, error: error instanceof Error ? error.message.slice(0, 100) : "failed" }); }
    }
  }));
  await saveBoardRows(results).catch(() => undefined);
  const { previous } = await logWs2(results, settings).catch(() => ({ previous: {} as Record<string, { status: string; side: string | null; at: number } | null> }));
  const events: TelegramEvent[] = [];
  if (settings.alerts) for (const r of results) {
    const p = previous[r.symbol];
    // One call per coin and side: while it stays ENTRY READY it is not sent again; the daily key is a second guard.
    if (r.status === "ENTRY READY" && r.side && !(p && p.status === "ENTRY READY" && p.side === r.side && Date.now() - p.at < 24 * 3_600_000))
      events.push({ key: "ws2:ready:" + r.coin + ":" + r.side + ":" + Math.floor(Date.now() / 86_400_000), lines: [...ws2Lines(r), "🔗 Open in app: " + request.nextUrl.origin + "/whales-2?coin=" + r.coin] });
  }
  let sent = 0; if (events.length) { const config = await telegramConfig().catch(() => null); if (config) sent = (await deliverEvents(config, events, request.nextUrl.origin)).sent; }
  const scored = await scoreWs2Log(4).catch(() => 0);
  return NextResponse.json({ ok: true, analysed: results.map(r => ({ coin: r.coin, status: r.status, side: r.side, opportunity: r.scores.opportunity, rating: r.calibration.lead?.rating ?? null })), errors, alerts: sent, scored, ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
}
