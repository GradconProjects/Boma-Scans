import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/app/server/cron-auth";
import { deliverEvents, readOwnerRecord, telegramConfig, writeOwnerRecord } from "@/app/server/telegram-delivery";
import { analyzePair, marketRead } from "@/app/server/market-analysis";
import { evaluateMonitor, parseArmedPlans, parseMonitoredSymbols, transitionMonitor, type MonitorEntry, type MonitorMemory } from "@/app/lib/trigger-monitor";
import { formatExitEvent, formatMonitorDigest, formatMonitorEvent, formatMonitorUpdate, type TelegramEvent } from "@/app/lib/telegram-events";
import { getMediumRiskShortlist, isMediumRiskTake } from "@/app/lib/recommendations";
import { signalKey, snapshotSignal, telegramSignalText } from "@/app/lib/signal-alerts";
import { STYLE_CONFIG, type ScannerRow, type TradingStyle } from "@/app/lib/market";
import type { FlexibilityMode } from "@/app/lib/entry-policy";
import { pollTelegram } from "@/app/server/telegram-poll";
import { structureAdvice } from "@/app/server/trade-watch";
import { OWNER_ID } from "@/app/server/owner-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Memory = { symbols: Record<string, MonitorMemory>; autoMonitored?: string[]; lastRunAt?: number; lastError?: string };
const MAX_PAIRS = 12;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (index < items.length) { const i = index++; out[i] = await fn(items[i]); } }));
  return out;
}

/**
 * Scheduled monitoring: analyses every monitored pair on the server, compares
 * the live price with the plan, and pushes entry, confirmation, exit and
 * digest messages to Telegram. Works with the dashboard closed.
 */
export async function GET(request: NextRequest) {
  if (!(await cronAuthorized(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = Date.now();
  const config = await telegramConfig();
  if (!config?.enabled) return NextResponse.json({ skipped: "Telegram not connected" });
  // Commands sent from Telegram (Entered / Skipped buttons, /status …) are handled here, so they work with the app closed.
  const commands = await pollTelegram(OWNER_ID, config.chatId, request.nextUrl.origin).catch(() => ({ processed: 0 }));
  let workspace: Record<string, unknown> = {};
  try { workspace = JSON.parse((await readOwnerRecord("workspace")) ?? "{}"); } catch { /* defaults */ }
  let memory: Memory = { symbols: {} };
  try { memory = { symbols: {}, ...JSON.parse((await readOwnerRecord("monitor-memory")) ?? "{}") }; } catch { /* fresh */ }
  const monitored = Array.from(new Set([...parseMonitoredSymbols(workspace.monitored), ...parseMonitoredSymbols(memory.autoMonitored)])).slice(0, MAX_PAIRS);
  // Plans armed on a device (synced in the workspace) are adopted when the server has none.
  for (const plan of parseArmedPlans(workspace.armed)) { memory.symbols[plan.symbol] ??= {}; if (!memory.symbols[plan.symbol].armed && memory.symbols[plan.symbol].skipped !== plan.planKey) memory.symbols[plan.symbol].armed = plan; }
  const style = (["SCALP", "DAY", "SWING", "POSITION"].includes(String(workspace.style)) ? workspace.style : "DAY") as TradingStyle;
  const flexibility = (["STRICT", "BALANCED", "FLEXIBLE"].includes(String(workspace.flexibility)) ? workspace.flexibility : "STRICT") as FlexibilityMode;
  const targetStyle = workspace.targetStyle === "LADDER" ? "LADDER" : "TA";
  const equity = Number(workspace.equity) > 0 ? Number(workspace.equity) : 10_000;
  const events: TelegramEvent[] = []; const entries: MonitorEntry[] = []; const problems: string[] = [];
  let prices: Record<string, number> = {};
  try {
    const tickers = await marketRead({ kind: "tickers" });
    for (const raw of tickers.result!.list as Array<{ symbol?: string; lastPrice?: string }>) if (raw.symbol && monitored.includes(raw.symbol)) prices[raw.symbol] = Number(raw.lastPrice);
  } catch (error) { problems.push("tickers: " + (error instanceof Error ? error.message : "failed")); }
  await mapLimit(monitored, 3, async symbol => {
    let row: ScannerRow | undefined; let analysis: Awaited<ReturnType<typeof analyzePair>>["analysis"] | undefined;
    try { const result = await analyzePair(symbol, STYLE_CONFIG[style].interval, style, flexibility, Number(workspace.fee) || 0.055, Number(workspace.slippage) || 0.02, targetStyle); row = result.row; analysis = result.analysis; }
    catch (error) { problems.push(symbol + ": " + (error instanceof Error ? error.message : "analysis failed")); }
    const entry = evaluateMonitor(symbol, row, prices[symbol]);
    entries.push(entry);
    const step = transitionMonitor(memory.symbols[symbol] ?? {}, entry, row, now);
    memory.symbols[symbol] = step.memory;
    if (step.alert) { const event = formatMonitorEvent(entry); if (event) events.push(event); }
    if (step.followUp) { const event = formatMonitorEvent(entry); if (event) events.push(event); }
    for (const kind of step.updates) events.push(formatMonitorUpdate(entry, kind));
    for (const exit of step.exits) events.push(formatExitEvent(exit));
    // Still in the trade: ask the engine whether structure says leave or protect.
    if (step.memory.armed && row && analysis) events.push(...structureAdvice(step.memory.armed, analysis, row, now));
    // A monitored pair that qualifies as a full signal is announced as one.
    if (row && isMediumRiskTake(row, true, now)) {
      const pick = getMediumRiskShortlist([row], equity, true, 1, now)[0];
      if (pick) events.push({ key: "signal:" + signalKey(row) + ":" + (row.executionPlan.confirmationTime ?? row.analyzedAt), symbol, lines: telegramSignalText(snapshotSignal(pick), false, now).split("\n") });
    }
  });
  const digest = formatMonitorDigest(entries.filter(entry => entry.price !== null), now);
  if (digest) events.push(digest);
  for (const symbol of Object.keys(memory.symbols)) if (!monitored.includes(symbol)) delete memory.symbols[symbol];
  memory.lastRunAt = now; memory.lastError = problems[0];
  const delivery = await deliverEvents(config, events, request.nextUrl.origin);
  try { await writeOwnerRecord("monitor-memory", JSON.stringify(memory)); } catch (error) { problems.push("memory: " + (error instanceof Error ? error.message : "save failed")); }
  return NextResponse.json({ ok: true, commands: commands.processed, monitored, states: Object.fromEntries(entries.map(entry => [entry.symbol, entry.state])), inTrade: Object.entries(memory.symbols).filter(([, m]) => m.armed).map(([symbol]) => symbol), sent: delivery.sent, problems: [...problems, ...delivery.errors] });
}
