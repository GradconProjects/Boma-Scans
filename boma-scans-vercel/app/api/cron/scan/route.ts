import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/app/server/cron-auth";
import { deliverEvents, readOwnerRecord, telegramConfig, writeOwnerRecord } from "@/app/server/telegram-delivery";
import { positioningFor, whaleSnapshot } from "@/app/server/positioning";
import { judgePositioning } from "@/app/lib/positioning";
import { formatFormingSetup, signalButtons } from "@/app/lib/telegram-events";
import type { ScannerRow } from "@/app/lib/market";
import { analyzePair, marketRead } from "@/app/server/market-analysis";
import { parseMonitoredSymbols } from "@/app/lib/trigger-monitor";
import { getMediumRiskShortlist, isMediumRiskTake } from "@/app/lib/recommendations";
import { signalKey, snapshotSignal, telegramSignalText } from "@/app/lib/signal-alerts";
import { STYLE_CONFIG, STYLE_LIQUIDITY_FLOOR, type TradingStyle } from "@/app/lib/market";
import type { FlexibilityMode } from "@/app/lib/entry-policy";
import type { TelegramEvent } from "@/app/lib/telegram-events";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BLACKLIST = new Set(["USDCUSDT", "USDEUSDT", "FDUSDUSDT", "DAIUSDT", "TUSDUSDT"]);

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (index < items.length) { const i = index++; out[i] = await fn(items[i]); } }));
  return out;
}

/**
 * Scheduled scan of the most liquid pairs. A pair that qualifies is pushed as
 * a signal and added to the server's monitored list so its entry and exits are
 * followed automatically. SERVER_SCAN_PAIRS (default 30) caps the universe.
 */
export async function GET(request: NextRequest) {
  if (!(await cronAuthorized(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = Date.now();
  const config = await telegramConfig();
  if (!config?.enabled) return NextResponse.json({ skipped: "Telegram not connected" });
  let workspace: Record<string, unknown> = {};
  try { workspace = JSON.parse((await readOwnerRecord("workspace")) ?? "{}"); } catch { /* defaults */ }
  const style = (["SCALP", "DAY", "SWING", "POSITION"].includes(String(workspace.style)) ? workspace.style : "DAY") as TradingStyle;
  const flexibility = (["STRICT", "BALANCED", "FLEXIBLE"].includes(String(workspace.flexibility)) ? workspace.flexibility : "STRICT") as FlexibilityMode;
  const targetStyle = workspace.targetStyle === "LADDER" ? "LADDER" : "TA";
  const equity = Number(workspace.equity) > 0 ? Number(workspace.equity) : 10_000;
  const limit = Math.min(80, Math.max(5, Number(process.env.SERVER_SCAN_PAIRS) || 50));
  const tickers = await marketRead({ kind: "tickers" });
  const universe = (tickers.result!.list as Array<{ symbol?: string; turnover24h?: string }>)
    .filter(item => item.symbol?.endsWith("USDT") && !BLACKLIST.has(item.symbol) && Number(item.turnover24h) >= STYLE_LIQUIDITY_FLOOR[style])
    .sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h)).slice(0, limit).map(item => item.symbol as string);
  const events: TelegramEvent[] = []; const qualified: string[] = []; const problems: string[] = []; const forming: ScannerRow[] = [];
  const debug = request.nextUrl.searchParams.get("debug") === "1"; const diagnostics: Record<string, unknown>[] = [];
  await mapLimit(universe, 4, async symbol => {
    try {
      const { row } = await analyzePair(symbol, STYLE_CONFIG[style].interval, style, flexibility, Number(workspace.fee) || 0.055, Number(workspace.slippage) || 0.02, targetStyle);
      if (debug) diagnostics.push({ symbol, decision: row.decision, bias: row.bias, setup: row.setupType, regime: row.regime, trendFrames: row.trendFrames, entryReady: row.entryReady, plan: row.executionPlan.status, direction: row.direction, score: row.score, entryQuality: row.entryQuality, rating: row.ratingScore, riskBand: row.riskBand, btc: row.btcRelationship.divergenceVerdict, costR: Number(row.executionCostR.toFixed(2)), costLimit: Number(row.spreadCostLimitR.toFixed(2)), failedChecks: row.entryChecks.filter(c => c.required && c.status !== "PASS").map(c => c.label), analyzedAgeS: Math.round((now - row.analyzedAt) / 1000), lev: row.exchangeMaxLeverage, step: row.quantityStep });
      if (!isMediumRiskTake(row, true, now)) {
        // Setup forming: trend, regime and quality are there; only the retest and the closed-candle trigger are missing.
        if ((row.decision === "SETUP" || row.decision === "WATCH") && row.direction !== "WAIT" && row.regime === "TRENDING" && row.trendFrames >= (row.setupType === "CHoCH REVERSAL" ? 1 : 3)
          && ["WAIT_RETEST", "WAIT_PRICE", "WAIT_CONFIRMATION"].includes(row.executionPlan.status) && row.score >= 60 && row.ratingScore >= 66 && row.btcRelationship.divergenceVerdict !== "REJECT") forming.push(row);
        return;
      }
      const pick = getMediumRiskShortlist([row], equity, true, 1, now)[0];
      if (!pick) return;
      qualified.push(symbol);
      let positioning: string[] = [];
      try { const snapshot = await whaleSnapshot(); const verdict = judgePositioning(await positioningFor(symbol, snapshot), row.bias, row.price, row.stop); positioning = ["", "🐋 " + verdict.headline, ...verdict.notes.slice(0, 3)]; } catch { /* optional context */ }
      events.push({ key: "signal:" + signalKey(row) + ":" + (row.executionPlan.confirmationTime ?? row.analyzedAt), symbol, lines: [...telegramSignalText(snapshotSignal(pick), false, now).split("\n"), ...positioning], buttons: signalButtons(symbol) });
    } catch (error) { problems.push(symbol + ": " + (error instanceof Error ? error.message : "failed")); }
  });
  // Best forming setups: push once with levels, and follow them so the trigger / entry-range alerts fire.
  forming.sort((a, b) => b.ratingScore - a.ratingScore || b.score - a.score);
  const followed = forming.slice(0, 6).map(row => row.symbol);
  for (const row of forming.slice(0, 4)) events.push(formatFormingSetup(row, now));
  if (qualified.length || followed.length) {
    let memory: { autoMonitored?: string[]; ignored?: string[] } = {};
    try { memory = JSON.parse((await readOwnerRecord("monitor-memory")) ?? "{}"); } catch { /* fresh */ }
    const ignored = new Set(memory.ignored ?? []);
    const next = Array.from(new Set([...qualified, ...parseMonitoredSymbols(memory.autoMonitored), ...followed.filter(symbol => !ignored.has(symbol))])).slice(0, 12);
    try { await writeOwnerRecord("monitor-memory", JSON.stringify({ ...memory, autoMonitored: next })); } catch { /* best effort */ }
  }
  const delivery = await deliverEvents(config, events, request.nextUrl.origin);
  return NextResponse.json({ ok: true, scanned: universe.length, qualified, forming: forming.map(row => row.symbol), ...(debug ? { diagnostics } : {}), sent: delivery.sent, problems: [...problems, ...delivery.errors].slice(0, 10) });
}
