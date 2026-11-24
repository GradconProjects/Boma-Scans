import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";
import { marketRead, bars } from "@/app/server/market-analysis";
import { resolveBybitSymbol } from "@/app/lib/ws2/symbols";
import type { Candle } from "@/app/lib/ws2/engine";
import { runWs2Calibrated as runWs2 } from "@/app/lib/ws2/calibrated";
import type { Ws2Rated as Ws2Result } from "@/app/lib/ws2/rating";
import { scoreOutcome, type Ws2LogEntry } from "@/app/lib/ws2/outcomes";
import { gatherWs2, WS2_DEFAULTS, type Ws2Settings } from "@/app/server/ws2/gather";

// Whale System 2 keeps its own records (prefix "ws2-"); it never writes to another system's records.
export async function ws2Settings(): Promise<Ws2Settings> { try { return { ...WS2_DEFAULTS, ...(JSON.parse((await readOwnerRecord("ws2-settings")) ?? "{}") as Partial<Ws2Settings>) }; } catch { return WS2_DEFAULTS; } }
export async function saveWs2Settings(patch: Partial<Ws2Settings>): Promise<Ws2Settings> {
  const current = await ws2Settings(); const num = (v: unknown, lo: number, hi: number, d: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
  const next: Ws2Settings = { ...current, watch: Array.isArray(patch.watch) ? Array.from(new Set(patch.watch.map(c => String(c).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/USDT$/, "")).filter(Boolean))).slice(0, 8) : current.watch, alerts: typeof patch.alerts === "boolean" ? patch.alerts : current.alerts, universe: [0, 20, 40, 80].includes(Number(patch.universe)) ? Number(patch.universe) : current.universe, equity: num(patch.equity, 100, 1e8, current.equity), riskPct: num(patch.riskPct, 0.05, 2, current.riskPct), leverage: num(patch.leverage, 1, 25, current.leverage), feePct: current.feePct, slippagePct: current.slippagePct };
  await writeOwnerRecord("ws2-settings", JSON.stringify(next)); return next;
}
export async function ws2Log(): Promise<Ws2LogEntry[]> { try { return JSON.parse((await readOwnerRecord("ws2-log")) ?? "[]") as Ws2LogEntry[]; } catch { return []; } }
const saveLog = (log: Ws2LogEntry[]) => writeOwnerRecord("ws2-log", JSON.stringify(log.slice(-800)));

/** Latest reading per coin, for the market board. */
export type Ws2BoardRow = { coin: string; symbol: string; at: number; status: string; side: string | null; price: number | null; scores: Record<string, number>; headline: string; squeeze: string; top: string; whales: string; rating: number | null };
export async function ws2Board(): Promise<Record<string, Ws2BoardRow>> { try { return JSON.parse((await readOwnerRecord("ws2-board")) ?? "{}") as Record<string, Ws2BoardRow>; } catch { return {}; } }
const boardRow = (r: Ws2Result): Ws2BoardRow => ({ coin: r.coin, symbol: r.symbol, at: r.at, status: r.status, side: r.side, price: r.price, scores: r.scores, headline: r.headline, squeeze: r.side === "SHORT" ? r.squeeze.long.stage : r.side === "LONG" ? r.squeeze.short.stage : "—", top: r.institutions.verdict, whales: r.whales.verdict, rating: r.calibration.lead?.rating ?? null });
/** Saves a batch of readings to the board in one write and drops rows older than a day. */
export async function saveBoardRows(results: Ws2Result[], now = Date.now()) {
  if (!results.length) return;
  const board = await ws2Board(); for (const r of results) board[r.symbol] = boardRow(r);
  for (const k of Object.keys(board)) if (now - board[k].at > 86_400_000) delete board[k];
  await writeOwnerRecord("ws2-board", JSON.stringify(board));
}

/** The most-traded Bybit USDT perpetuals, by 24 h turnover. The universe is whatever trades most today; nothing is hand-picked. */
export async function ws2Universe(size: number): Promise<string[]> {
  if (size <= 0) return [];
  try { const tickers = await marketRead({ kind: "tickers" }); return (tickers.result!.list as Array<{ symbol?: string; turnover24h?: string }>).filter(t => /^[A-Z0-9]{2,24}USDT$/.test(t.symbol ?? "")).sort((a, b) => Number(b.turnover24h ?? 0) - Number(a.turnover24h ?? 0)).slice(0, size).map(t => t.symbol!); } catch { return []; }
}
/** Next slice of the universe for this run; the cursor walks the whole list and wraps. */
export async function nextUniverseSlice(size: number, take: number, skip: Set<string>): Promise<string[]> {
  const all = (await ws2Universe(size)).filter(s => !skip.has(s)); if (!all.length) return [];
  let cursor = 0; try { cursor = Number(JSON.parse((await readOwnerRecord("ws2-cursor")) ?? "0")) || 0; } catch { cursor = 0; }
  const out = Array.from({ length: Math.min(take, all.length) }, (_, i) => all[(cursor + i) % all.length]);
  await writeOwnerRecord("ws2-cursor", JSON.stringify((cursor + take) % all.length));
  return out;
}

/** The real Bybit pair for what was typed or tapped; throws a plain message when Bybit does not list it. */
export async function symbolFor(coin: string): Promise<string> {
  const tickers = await marketRead({ kind: "tickers" });
  const symbol = resolveBybitSymbol(coin, new Set((tickers.result!.list as Array<{ symbol?: string }>).map(t => t.symbol ?? "")));
  if (!symbol) throw new Error("\"" + coin + "\" is not a Bybit USDT perpetual. Try the coin's ticker, for example BTC, SOL or PEPE.");
  return symbol;
}

/** Runs Whale System 2 on a coin and appends the signal to the log (one entry per coin per 14 minutes unless the status changed). */
export async function analyseWs2(coin: string, now = Date.now()): Promise<{ result: Ws2Result; previous: Ws2LogEntry | null; logged: boolean }> {
  const settings = await ws2Settings(); const symbol = await symbolFor(coin);
  const result = runWs2(await gatherWs2(symbol, settings, now));
  await saveBoardRows([result], now).catch(() => undefined);
  const logged = await logWs2([result], settings);
  return { result, previous: logged.previous[symbol] ?? null, logged: logged.added > 0 };
}
/** Analyses a Bybit symbol without writing anything; the batch scan saves the board and the log once at the end. */
export async function readWs2(symbol: string, settings: Ws2Settings, now = Date.now()): Promise<Ws2Result> { return runWs2(await gatherWs2(symbol, settings, now)); }
/**
 * Appends signals to the log. A coin gets a new entry when its status or side changed, or its last entry is 4 hours old,
 * so a market-wide scan records decisions, not repeats. Coins with no direction are logged only when that is a change.
 */
export async function logWs2(results: Ws2Result[], settings: Ws2Settings, now = Date.now()): Promise<{ added: number; previous: Record<string, Ws2LogEntry | null> }> {
  const log = await ws2Log(); const previousBy: Record<string, Ws2LogEntry | null> = {}; let added = 0;
  for (const result of results) {
    const symbol = result.symbol; const previous = [...log].reverse().find(e => e.symbol === symbol) ?? null; previousBy[symbol] = previous;
    const duplicate = previous && previous.status === result.status && previous.side === result.side && now - previous.at < 4 * 3_600_000;
    if (duplicate) continue;
    added++;
    {
    const lv = result.status === "ENTRY READY" ? result.levels.market ?? result.levels.pullback : result.levels.pullback;
    log.push({ id: symbol + ":" + now, at: now, version: result.version, coin: result.coin, symbol, status: result.status, side: result.side, price: result.price, scores: { ...result.scores, rating: result.calibration.lead?.rating ?? 0 },
      plan: lv && result.side ? { entryLow: lv.entryLow, entryHigh: lv.entryHigh, entry: lv.entry, stop: lv.stop, targets: lv.targets.map(t => t.price) } : null,
      inputs: result.components.map(c => c.key + ": " + (c.available ? "bull " + c.bull.toFixed(2) + " bear " + c.bear.toFixed(2) : "UNAVAILABLE")), costPct: 2 * settings.feePct + settings.slippagePct });
    }
  }
  if (added) await saveLog(log);
  return { added, previous: previousBy };
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
