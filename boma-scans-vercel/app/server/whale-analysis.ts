import { z } from "zod/v4";
import { aiSettings, structured } from "@/app/server/ai";
import { analyzePair, marketRead } from "@/app/server/market-analysis";
import { positioningFor, whaleSnapshot } from "@/app/server/positioning";
import { recentEvents, whaleRankings } from "@/app/server/whale-tracker";
import { bybitSymbolFor, confirmWhaleSignals, type WhaleEvent, type WhaleRank, type WhaleSignal } from "@/app/lib/whale-logic";
import { judgePositioning, positioningSummary } from "@/app/lib/positioning";
import { compactSignalLines } from "@/app/lib/signal-alerts";
import { entryCall } from "@/app/lib/trigger-monitor";
import { formatPrice, STYLE_CONFIG } from "@/app/lib/market";

/**
 * Full entry analysis for a coin inside the whale system: what the ranked
 * whales did (their entries, flow, who is against), what the Bybit 1H chart
 * says (the scanner's own plan with window, trigger, stop and targets), how
 * the crowd is positioned, and a reviewer's whale-specific plan with
 * guardrails. Information only; nothing is executed.
 */
const PlanSchema = z.object({
  decision: z.enum(["ENTER NOW", "WAIT", "NO TRADE"]),
  side: z.enum(["LONG", "SHORT"]),
  confidence: z.number().min(0).max(100),
  thesis: z.string(),
  entry_low: z.number(),
  entry_high: z.number(),
  trigger: z.string(),
  stop: z.number(),
  targets: z.array(z.number()),
  invalidation: z.string(),
  risks: z.array(z.string()),
  management: z.string(),
});
export type WhalePlan = z.infer<typeof PlanSchema> & { provider: string; guardrails: string[] };

export type WhaleAnalysis = {
  coin: string; symbol: string | null; side: "LONG" | "SHORT"; at: number; price: number;
  whales: { signal: WhaleSignal | null; recent: WhaleEvent[]; longUsd: number; shortUsd: number; ranked: number };
  chart: { call: string; lines: string[]; bias: string; regime: string; trendFrames: number; status: string; checks: Array<{ label: string; status: string }>; keyLevels?: string; atr: number; atrPct: number } | null;
  positioning: { verdict: string; summary: string; notes: string[] } | null;
  plan: WhalePlan | null;
  planError?: string;
};

const SYSTEM = `You are the entry planner of a crypto perpetual-futures desk that follows consistently successful Hyperliquid whales (Bybit USDT perps, 1H chart, Melbourne trader). Rule: follow what ranked whales are doing NOW, not what their old positions say.
You receive: the whales' fresh opens / adds / closes on this coin with their entries and sizes, who is against them, the rule engine's own 1H plan (window, trigger, stop, targets, checks), historic levels, crowd positioning and the last 24 1H candles.
Produce one actionable plan in the required JSON shape. decision: ENTER NOW only when the whales' thesis and the chart agree and price is inside a sensible entry window now; WAIT with the exact trigger to wait for; NO TRADE when whales are split, the move has run away (price more than 2% past their average entry without a pullback) or the chart contradicts them. Entry window: a tight price range near the whales' average entry or the chart's zone, never chasing. Stop: at a structural level beyond the whales' entries, between 0.8 and 2.5 ATR(1H) from the window. Targets: three to five prices in the trade's direction between 1R and 5R of the risk, at visible levels. Quote prices exactly as given. Keep thesis under 300 characters, risks at most three short items, management one sentence (partials, moving the stop, what cancels the idea).`;

export async function whaleEntryAnalysis(coin: string, requestedSide?: "LONG" | "SHORT", now = Date.now()): Promise<WhaleAnalysis> {
  const snapshot = await whaleSnapshot();
  const prices: Record<string, number> = Object.fromEntries(Object.entries(snapshot.ctx).map(([c, x]) => [c, x.markPx]));
  const ranks: WhaleRank[] = await whaleRankings();
  const events = (await recentEvents(48 * 3_600_000, 600)).filter(e => e.coin === coin);
  const signals = confirmWhaleSignals(events, ranks, prices, now).filter(s => s.coin === coin);
  const positions = snapshot.positions.filter(p => p.coin === coin);
  const longUsd = positions.filter(p => p.side === "LONG").reduce((a, p) => a + p.sizeUsd, 0), shortUsd = positions.filter(p => p.side === "SHORT").reduce((a, p) => a + p.sizeUsd, 0);
  const rankBy = new Map(ranks.map(r => [r.trader, r]));
  const ranked = positions.filter(p => (rankBy.get(p.trader)?.tier ?? "WATCH") !== "WATCH").length;
  const signal = (requestedSide ? signals.find(s => s.side === requestedSide) : signals[0]) ?? null;
  const side: "LONG" | "SHORT" = requestedSide ?? signal?.side ?? (longUsd >= shortUsd ? "LONG" : "SHORT");
  let symbols = new Set<string>();
  try { const tickers = await marketRead({ kind: "tickers" }); symbols = new Set((tickers.result!.list as Array<{ symbol?: string }>).map(t => t.symbol ?? "")); } catch { /* no mapping */ }
  const symbol = bybitSymbolFor(coin, symbols);
  const result: WhaleAnalysis = { coin, symbol, side, at: now, price: prices[coin] ?? 0, whales: { signal, recent: events.slice(0, 20), longUsd, shortUsd, ranked }, chart: null, positioning: null, plan: null };
  if (!symbol) { result.planError = "Not listed on Bybit; whale flow is information only."; return result; }
  const analysed = await analyzePair(symbol, STYLE_CONFIG.DAY.interval, "DAY", "STRICT");
  const { row, analysis, candles } = analysed;
  result.price = row.price;
  const plan = row.executionPlan;
  result.chart = {
    call: entryCall(row, row.price).line,
    lines: compactSignalLines({ symbol, side: row.bias, entryLow: plan.entryLow, entryHigh: plan.entryHigh, entry: plan.entry, trigger: plan.trigger, timeframe: plan.timeframe, stop: row.stop, targets: row.takeProfits.map(t => ({ price: t.price, available: t.available })), expiresAt: plan.expiresAt, zoneLow: plan.zoneLow, zoneHigh: plan.zoneHigh, keyLevels: row.keyLevels?.summary }),
    bias: row.bias, regime: row.regime, trendFrames: row.trendFrames, status: plan.status, checks: row.entryChecks.filter(c => c.required).map(c => ({ label: c.label, status: c.status })), keyLevels: row.keyLevels?.summary, atr: analysis.metrics.atr, atrPct: analysis.metrics.atrPct,
  };
  try { const data = await positioningFor(symbol, snapshot); const verdict = judgePositioning(data, side, row.price, row.stop); result.positioning = { verdict: verdict.headline, summary: positioningSummary(data, side), notes: verdict.notes.slice(0, 4) }; } catch { /* optional */ }
  const settings = await aiSettings();
  if (settings.provider === "off") { result.planError = "No AI provider configured; chart and whale context only."; return result; }
  const prompt = JSON.stringify({
    coin, symbol, requestedSide: requestedSide ?? null, price: row.price, atr1h: Number(analysis.metrics.atr.toPrecision(6)),
    whaleSignal: signal ? { side: signal.side, status: signal.status, confidence: signal.confidence, avgEntry: signal.avgEntry, distancePct: Number(signal.distancePct.toFixed(2)), flowUsd: Math.round(signal.flowUsd), whales: signal.whales.map(w => ({ tier: w.tier, kind: w.kind, deltaUsd: Math.round(w.deltaUsd), entry: w.entry, hoursAgo: Number(((now - w.at) / 3_600_000).toFixed(1)) })), opposed: signal.opposed } : null,
    recentWhaleEvents: events.slice(0, 15).map(e => ({ tier: rankBy.get(e.trader)?.tier ?? "WATCH", kind: e.kind, side: e.side, deltaUsd: Math.round(e.deltaUsd), entry: e.entry, pnl: Math.round(e.pnl), hoursAgo: Number(((now - e.at) / 3_600_000).toFixed(1)) })),
    openWhaleBook: { longUsd: Math.round(longUsd), shortUsd: Math.round(shortUsd), rankedTraders: ranked },
    enginePlan: { bias: row.bias, status: plan.status, regime: row.regime, trendFrames: row.trendFrames, call: result.chart.call, window: [plan.zoneLow, plan.zoneHigh], entry: plan.entry, trigger: plan.trigger, stop: row.stop, targets: row.takeProfits.map(t => t.price), checks: result.chart.checks, historicLevels: row.keyLevels ? { summary: row.keyLevels.summary, detail: row.keyLevels.detail } : null },
    positioning: result.positioning, structure: { bos: analysis.structure.bos, choch: analysis.structure.choch, sweep: analysis.structure.sweep },
    metrics: { rsi: Math.round(analysis.metrics.rsi), adx: Math.round(analysis.metrics.adx), atrPct: Number(analysis.metrics.atrPct.toFixed(2)), volumeRatio: Number(analysis.metrics.volumeRatio.toFixed(2)), fundingPct: Number((analysis.metrics.fundingRate * 100).toFixed(4)) },
    last24Candles1h: candles.slice(-24).map(c => [new Date(c.time).toISOString().slice(5, 16), c.open, c.high, c.low, c.close, Math.round(c.volume)]),
  });
  try {
    const { value, provider } = await structured(PlanSchema, "whale_entry_plan", SYSTEM, "Plan this coin for the trader.\n\n" + prompt);
    // Guardrails on the reviewer's numbers.
    const guardrails: string[] = [];
    const sign = value.side === "LONG" ? 1 : -1; const atr = analysis.metrics.atr;
    let [low, high] = [Math.min(value.entry_low, value.entry_high), Math.max(value.entry_low, value.entry_high)];
    if (high - low > 3 * atr) { guardrails.push("entry window wider than 3 ATR, tightened"); const mid = (low + high) / 2; low = mid - atr; high = mid + atr; }
    const anchor = sign > 0 ? low : high; const stopDist = sign * (anchor - value.stop);
    let stop = value.stop;
    if (!(stopDist >= 0.8 * atr && stopDist <= 2.5 * atr)) { guardrails.push("stop " + formatPrice(value.stop) + " outside 0.8–2.5 ATR, set to 1.5 ATR beyond the window"); stop = anchor - sign * 1.5 * atr; }
    const risk = Math.abs((sign > 0 ? high : low) - stop);
    let targets = value.targets.filter(t => sign * (t - (sign > 0 ? high : low)) / risk >= 1 && sign * (t - (sign > 0 ? high : low)) / risk <= 5).sort((a, b) => sign * (a - b));
    if (targets.length < 3) { guardrails.push("targets outside 1R–5R, replaced by 1R / 2R / 3R"); const base = sign > 0 ? high : low; targets = [1, 2, 3].map(k => base + sign * k * risk); }
    result.plan = { ...value, entry_low: low, entry_high: high, stop, targets, provider, guardrails };
  } catch (error) { result.planError = error instanceof Error ? error.message : "The planner could not assess this coin."; }
  return result;
}
