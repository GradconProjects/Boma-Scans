import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/app/server/cron-auth";
import { analyseWs2, scoreWs2Log, ws2Settings } from "@/app/server/ws2/store";
import { deliverEvents, telegramConfig } from "@/app/server/telegram-delivery";
import { ws2Lines } from "@/app/lib/ws2/engine";
import type { TelegramEvent } from "@/app/lib/telegram-events";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Whale System 2 shadow scan, every 15 minutes: analyses the System 2 watchlist, logs each signal, scores old ones, and alerts only when a coin becomes ENTRY READY. */
export async function GET(request: NextRequest) {
  if (!(await cronAuthorized(request))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const started = Date.now(); const settings = await ws2Settings(); const out: Array<{ coin: string; status?: string; side?: string | null; error?: string }> = []; const events: TelegramEvent[] = [];
  const queue = [...settings.watch];
  await Promise.all(Array.from({ length: 2 }, async () => {
    for (let coin = queue.shift(); coin; coin = queue.shift()) {
      if (Date.now() - started > 40_000) { out.push({ coin, error: "skipped: out of time" }); continue; }
      try {
        const { result, previous } = await analyseWs2(coin);
        out.push({ coin, status: result.status, side: result.side });
        if (settings.alerts && result.status === "ENTRY READY" && result.side && !(previous && previous.status === "ENTRY READY" && previous.side === result.side && Date.now() - previous.at < 4 * 3_600_000))
          events.push({ key: "ws2:ready:" + result.coin + ":" + result.side + ":" + Math.floor(Date.now() / (4 * 3_600_000)), lines: [...ws2Lines(result), "🔗 Open in app: " + request.nextUrl.origin + "/whales-2?coin=" + result.coin] });
      } catch (error) { out.push({ coin, error: error instanceof Error ? error.message.slice(0, 120) : "failed" }); }
    }
  }));
  let sent = 0; if (events.length) { const config = await telegramConfig().catch(() => null); if (config) sent = (await deliverEvents(config, events, request.nextUrl.origin)).sent; }
  const scored = await scoreWs2Log(4).catch(() => 0);
  return NextResponse.json({ ok: true, analysed: out, alerts: sent, scored, ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
}
