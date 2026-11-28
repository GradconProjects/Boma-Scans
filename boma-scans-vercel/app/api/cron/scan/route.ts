import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/app/server/cron-auth";
import { deliverEvents, readOwnerRecord, telegramConfig, writeOwnerRecord } from "@/app/server/telegram-delivery";
import { positioningFor, whaleSnapshot } from "@/app/server/positioning";
import { judgePositioning, positioningSummary } from "@/app/lib/positioning";
import { positioningMatrixFor } from "@/app/server/positioning-matrix";
import { matrixLines } from "@/app/lib/positioning-matrix";
import { signalButtons } from "@/app/lib/telegram-events";
import { reviewBeforePush } from "@/app/server/review-signal";
import { applyRefinedLevels, reviewLines } from "@/app/lib/ai-review";
import { entryCall, planKeyOf } from "@/app/lib/trigger-monitor";
import { majorEventGate, tradingWindowGate, windowVerdict, evidenceFlagLines } from "@/app/lib/push-policy";
import { pushSettings } from "@/app/server/push-settings";
import { whaleAlignment } from "@/app/server/whale-align";
import type { ScannerRow } from "@/app/lib/market";
import { analyzePair, marketRead } from "@/app/server/market-analysis";
import { parseMonitoredSymbols } from "@/app/lib/trigger-monitor";
import { getMediumRiskShortlist, isMediumRiskTake } from "@/app/lib/recommendations";
import { signalKey, snapshotSignal, telegramSignalText } from "@/app/lib/signal-alerts";
import { SCAN_TURNOVER_FLOOR, STYLE_CONFIG, STYLE_LIQUIDITY_FLOOR, type TradingStyle } from "@/app/lib/market";
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
  const limit = Number(process.env.SERVER_SCAN_PAIRS) > 0 ? Number(process.env.SERVER_SCAN_PAIRS) : 1000;
  const tickers = await marketRead({ kind: "tickers" });
  const universe = (tickers.result!.list as Array<{ symbol?: string; turnover24h?: string }>)
    .filter(item => item.symbol?.endsWith("USDT") && !BLACKLIST.has(item.symbol) && Number(item.turnover24h) >= Math.max(SCAN_TURNOVER_FLOOR, STYLE_LIQUIDITY_FLOOR[style]))
    .sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h)).slice(0, limit).map(item => item.symbol as string);
  const events: TelegramEvent[] = []; const qualified: string[] = []; const problems: string[] = []; const forming: ScannerRow[] = []; const held: Array<{ symbol: string; planKey: string; reason: string; at: number }> = [];
  const debug = request.nextUrl.searchParams.get("debug") === "1"; const diagnostics: Record<string, unknown>[] = [];
  // The whole scan must finish inside the 60-second function limit, or nothing is sent at all. So: only pairs liquid enough to
  // qualify are analysed (a pair under the style's turnover floor can never be a confirmed entry), most liquid first, and no
  // new pair is started after 38 seconds. Whatever was found by then is reviewed and sent.
  let skipped = 0; let analysed = 0;
  await mapLimit(universe, 6, async symbol => {
    if (Date.now() - now > 38_000) { skipped++; return; }
    analysed++;
    try {
      // One retry: a pair must not be dropped from the scan because a single data request failed.
      const analyse = () => analyzePair(symbol, STYLE_CONFIG[style].interval, style, flexibility, Number(workspace.fee) || 0.055, Number(workspace.slippage) || 0.02, targetStyle);
      const result = await analyse().catch(async () => { await new Promise(resolve => setTimeout(resolve, 500)); return analyse(); }); const { row } = result;
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
      try { const snapshot = await whaleSnapshot(); const data = await positioningFor(symbol, snapshot); const verdict = judgePositioning(data, row.bias, row.price, row.stop); positioning = ["", "🐋 " + verdict.headline, positioningSummary(data, row.bias), ...verdict.notes.slice(0, 3)]; } catch { /* optional context */ }
      try { positioning = ["", ...matrixLines(await positioningMatrixFor(symbol, row.bias === "SHORT" ? "SHORT" : "LONG", now))]; } catch { /* keep the short form */ }
      // A READY plan (every engine check passed) that the AI second read does not reject is a confirmed scan entry and is pushed.
      // The major-event check and whales being against it no longer hold the call; they are flagged on the card with the reason.
      // Only the owner's own Monday/Tuesday switch (off by default) can hold it.
      const gate = majorEventGate(row, result.analysis, result.candles);
      const window = tradingWindowGate(now, (await pushSettings()).tradingWindows);
      const whales = await whaleAlignment(symbol, row.bias).catch(() => ({ stance: "NEUTRAL" as const, detail: "whale data unavailable", coin: null }));
      if (!window.ok) { held.push({ symbol, planKey: planKeyOf(row), reason: window.reason ?? "held by your Monday/Tuesday switch", at: now }); return; }
      // Careful second read before the push; a REJECT holds the signal and is listed in the hourly monitor list instead.
      // The second read gets whatever time is left; if it cannot finish, the call still goes out, flagged as not reviewed.
      const TIMED_OUT = Symbol("timeout"); const budget = Math.max(2_500, 52_000 - (Date.now() - now));
      const raced = await Promise.race([reviewBeforePush(result), new Promise<typeof TIMED_OUT>(resolve => setTimeout(() => resolve(TIMED_OUT), budget))]);
      const unreviewed = raced === TIMED_OUT; const review = raced === TIMED_OUT ? null : raced;
      if (review?.verdict === "REJECT") { held.push({ symbol, planKey: planKeyOf(row), reason: review.summary, at: now }); return; }
      // The reviewer's level refinements (inside the guardrails) become the signal's levels.
      const finalPick = review?.applied ? getMediumRiskShortlist([applyRefinedLevels(row, review.applied)], equity, true, 1, now)[0] ?? pick : pick;
      events.push({ key: "signal:" + signalKey(row) + ":" + (row.executionPlan.confirmationTime ?? row.analyzedAt), symbol, lines: [...telegramSignalText(snapshotSignal(finalPick), false, now, undefined, entryCall(finalPick.row, finalPick.row.price).line).split("\n"), "", "🕰 " + windowVerdict(now).label + " · " + (windowVerdict(now).good ? "✅ " + windowVerdict(now).title : "🚩 " + windowVerdict(now).title + ": " + windowVerdict(now).detail), ...(gate.ok ? ["⚡ Major event: " + gate.event + " · stop " + (Math.abs(row.executionPlan.entry - row.stop) / result.analysis.metrics.atr).toFixed(1) + " ATR (holds ~" + gate.survivalHours + " h of normal range)"] : gate.reasons.map(r => "🚩 " + r.charAt(0).toUpperCase() + r.slice(1) + ".")), (whales.stance === "AGAINST" ? "🚩 Whales AGAINST this side: " : whales.stance === "WITH" ? "🐋 Whales with you: " : "🐋 Whales neutral: ") + whales.detail, ...positioning, ...(review ? ["", ...reviewLines(review)] : unreviewed ? ["", "🚩 The AI second read did not finish in time, so this call was not reviewed."] : []), ...evidenceFlagLines({ side: row.bias, at: now, majorEvent: gate.ok })], buttons: signalButtons(symbol) });
    } catch (error) { problems.push(symbol + ": " + (error instanceof Error ? error.message : "failed")); }
  });
  // Best forming setups: push once with levels, and follow them so the trigger / entry-range alerts fire.
  forming.sort((a, b) => b.ratingScore - a.ratingScore || b.score - a.score);
  const followed: string[] = []; // forming setups are listed, never auto-monitored (monitoring persisted too much)
  {
    // Forming setups are listed in the hourly monitor list rather than pushed one by one.
    let memory: { autoMonitored?: string[]; autoMonitoredAt?: Record<string, number>; ignored?: string[]; forming?: unknown; held?: Array<{ symbol: string; planKey: string; reason: string; at: number }> } = {};
    try { memory = JSON.parse((await readOwnerRecord("monitor-memory")) ?? "{}"); } catch { /* fresh */ }
    const ignored = new Set(memory.ignored ?? []);
    // Auto-monitoring is for qualified signals only, expires after 48 h unless the pair qualifies again, and never re-adds a pair the owner removed.
    const at: Record<string, number> = { ...(memory.autoMonitoredAt ?? {}) };
    for (const symbol of qualified) { at[symbol] = now; ignored.delete(symbol); }
    const kept = parseMonitoredSymbols(memory.autoMonitored).filter(symbol => now - (at[symbol] ?? 0) < 48 * 3_600_000 && !ignored.has(symbol));
    const next = Array.from(new Set([...qualified.filter(s => !ignored.has(s) || qualified.includes(s)), ...kept, ...followed])).slice(0, 12);
    for (const symbol of Object.keys(at)) if (!next.includes(symbol)) delete at[symbol];
    memory.ignored = Array.from(ignored); memory.autoMonitoredAt = at;
    const formingList = forming.slice(0, 8).map(row => ({ symbol: row.symbol, side: row.bias, trigger: row.executionPlan.trigger, status: row.executionPlan.status, at: now }));
    const heldList = [...held, ...(memory.held ?? []).filter(h => !held.some(x => x.symbol === h.symbol) && now - h.at < 12 * 3_600_000)].slice(0, 10);
    try { await writeOwnerRecord("monitor-memory", JSON.stringify({ ...memory, autoMonitored: next, forming: formingList, held: heldList })); } catch { /* best effort */ }
  }
  const delivery = await deliverEvents(config, events, request.nextUrl.origin);
  return NextResponse.json({ ok: true, scanned: analysed, skippedForTime: skipped, ms: Date.now() - now, universe: universe.length, qualified, held: held.map(h => h.symbol), forming: forming.map(row => row.symbol), ...(debug ? { diagnostics } : {}), sent: delivery.sent, problems: [...problems, ...delivery.errors].slice(0, 10) });
}
