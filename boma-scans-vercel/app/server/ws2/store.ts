import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";
import { marketRead, bars } from "@/app/server/market-analysis";
import { bybitSymbolFor } from "@/app/lib/whale-logic";
import { runWs2, type Candle, type Ws2Result } from "@/app/lib/ws2/engine";
import { scoreOutcome, type Ws2LogEntry } from "@/app/lib/ws2/outcomes";
import { gatherWs2, WS2_DEFAULTS, type Ws2Settings } from "@/app/server/ws2/gather";

// Whale System 2 keeps its own records (prefix "ws2-"); it never writes to another system's records.
export async function ws2Settings(): Promise<Ws2Settings> { try { return { ...WS2_DEFAULTS, ...(JSON.parse((await readOwnerRecord("ws2-settings")) ?? "{}") as Partial<Ws2Settings>) }; } catch { return WS2_DEFAULTS; } }
export async function saveWs2Settings(patch: Partial<Ws2Settings>): Promise<Ws2Settings> {
  const current = await ws2Settings(); const num = (v: unknown, lo: number, hi: number, d: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
  const next: Ws2Settings = { ...current, watch: Array.isArray(patch.watch) ? Array.from(new Set(patch.watch.map(c => String(c).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/USDT$/, "")).filter(Boolean))).slice(0, 8) : current.watch, alerts: typeof patch.alerts === "boolean" ? patch.alerts : current.alerts, equity: num(patch.equity, 100, 1e8, current.equity), riskPct: num(patch.riskPct, 0.05, 2, current.riskPct), leverage: num(patch.leverage, 1, 25, current.leverage), feePct: current.feePct, slippagePct: current.slippagePct };
  await writeOwnerRecord("ws2-settings", JSON.stringify(next)); return next;
}
export async function ws2Log(): Promise<Ws2LogEntry[]> { try { return JSON.parse((await readOwnerRecord("ws2-log")) ?? "[]") as Ws2LogEntry[]; } catch { return []; } }
const saveLog = (log: Ws2LogEntry[]) => writeOwnerRecord("ws2-log", JSON.stringify(log.slice(-500)));

export async function symbolFor(coin: string): Promise<string> {
  const clean = coin.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/USDT$/, "");
  try { const tickers = await marketRead({ kind: "tickers" }); return bybitSymbolFor(clean, new Set((tickers.result!.list as Array<{ symbol?: string }>).map(t => t.symbol ?? ""))) ?? clean + "USDT"; } catch { return clean + "USDT"; }
}

/** Runs Whale System 2 on a coin and appends the signal to the log (one entry per coin per 14 minutes unless the status changed). */
export async function analyseWs2(coin: string, now = Date.now()): Promise<{ result: Ws2Result; previous: Ws2LogEntry | null; logged: boolean }> {
  const settings = await ws2Settings(); const symbol = await symbolFor(coin);
  const result = runWs2(await gatherWs2(symbol, settings, now));
  const log = await ws2Log(); const previous = [...log].reverse().find(e => e.symbol === symbol) ?? null;
  const duplicate = previous && now - previous.at < 14 * 60_000 && previous.status === result.status && previous.side === result.side;
  if (!duplicate) {
    const lv = result.status === "ENTRY READY" ? result.levels.market ?? result.levels.pullback : result.levels.pullback;
    log.push({ id: symbol + ":" + now, at: now, version: result.version, coin: result.coin, symbol, status: result.status, side: result.side, price: result.price, scores: result.scores,
      plan: lv && result.side ? { entryLow: lv.entryLow, entryHigh: lv.entryHigh, entry: lv.entry, stop: lv.stop, targets: lv.targets.map(t => t.price) } : null,
      inputs: result.components.map(c => c.key + ": " + (c.available ? "bull " + c.bull.toFixed(2) + " bear " + c.bear.toFixed(2) + " · " : "") + c.note).concat(result.exhaustion.parts), costPct: 2 * settings.feePct + settings.slippagePct });
    await saveLog(log);
  }
  return { result, previous, logged: !duplicate };
}

/** Fills in outcomes for logged signals old enough to judge. A few per call, so it never runs long. */
export async function scoreWs2Log(limit = 5, now = Date.now()): Promise<number> {
  const log = await ws2Log(); let done = 0;
  for (const entry of log) {
    if (done >= limit) break;
    if (entry.outcome || now - entry.at < 4.3 * 3_600_000) continue;
    if (now - entry.at > 45 * 3_600_000 + 86_400_000) { entry.outcome = { scoredAt: now, filled: false, fillPrice: null, result: "NO PLAN", netR: null, forward4hPct: null, directionRight: null, mfeR: null, maeR: null, note: "Not scored: the 15-minute history needed is no longer available." }; done++; continue; }
    try { const candles = (await bars(entry.symbol, "15", 300) as Candle[]).filter(c => c.time + 900_000 <= now); const outcome = scoreOutcome(entry, candles, now); if (outcome && (now - entry.at >= 28.5 * 3_600_000 || !outcome.filled || outcome.result === "STOP")) { entry.outcome = outcome; done++; } } catch { /* try again next time */ }
  }
  if (done) await saveLog(log);
  return done;
}
