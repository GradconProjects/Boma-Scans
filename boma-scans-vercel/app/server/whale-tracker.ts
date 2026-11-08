import { env } from "@/app/server/env";
import { marketRead, analyzePair } from "@/app/server/market-analysis";
import { whaleAddresses, whaleSnapshot } from "@/app/server/positioning";
import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";
import { bybitSymbolFor, confirmWhaleSignals, diffPositions, rankWhales, type WatchState, type WhaleEvent, type WhalePerformance, type WhaleRank, type WhaleSignal } from "@/app/lib/whale-logic";
import { formatUsd } from "@/app/lib/positioning";
import { formatPrice, STYLE_CONFIG } from "@/app/lib/market";
import type { TelegramEvent } from "@/app/lib/telegram-events";

/**
 * Whale system, server side: turns the cached Hyperliquid snapshots into a
 * persistent event history, ranks the whales, confirms signals and prepares
 * the alerts. Runs inside the scheduled monitor; cheap when the snapshot has
 * not changed. Never places orders.
 */
export type WhaleSettings = { alerts: boolean; minTier: "ELITE" | "STRONG"; coins: string[] };
const DEFAULT_SETTINGS: WhaleSettings = { alerts: true, minTier: "STRONG", coins: [] };
const memoryEvents: WhaleEvent[] = [];

export async function whaleSettings(): Promise<WhaleSettings> {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse((await readOwnerRecord("whale-settings")) ?? "{}") }; } catch { return DEFAULT_SETTINGS; }
}
export async function saveWhaleSettings(patch: Partial<WhaleSettings>) {
  const next = { ...await whaleSettings(), ...patch };
  await writeOwnerRecord("whale-settings", JSON.stringify(next));
  return next;
}

async function insertEvents(events: WhaleEvent[]) {
  if (!events.length) return;
  if (!env.DB) { memoryEvents.push(...events); memoryEvents.splice(0, Math.max(0, memoryEvents.length - 2000)); return; }
  for (const e of events) {
    await env.DB.prepare("INSERT INTO whale_events(id,at,trader,coin,kind,side,size_usd,delta_usd,entry,price,pnl,held_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
      .bind(e.id, e.at, e.trader, e.coin, e.kind, e.side, e.sizeUsd, e.deltaUsd, e.entry, e.price, e.pnl, e.heldMs).run();
  }
}

export async function recentEvents(sinceMs: number, limit = 400): Promise<WhaleEvent[]> {
  const since = Date.now() - sinceMs;
  if (!env.DB) return memoryEvents.filter(e => e.at >= since).slice(-limit).reverse();
  const rows = (await env.DB.prepare("SELECT id,at,trader,coin,kind,side,size_usd,delta_usd,entry,price,pnl,held_ms FROM whale_events WHERE at>=? ORDER BY at DESC LIMIT ?").bind(since, limit).all<Record<string, unknown>>()).results;
  return rows.map(r => ({ id: String(r.id), at: Number(r.at), trader: String(r.trader), coin: String(r.coin), kind: r.kind as WhaleEvent["kind"], side: r.side as WhaleEvent["side"], sizeUsd: Number(r.size_usd), deltaUsd: Number(r.delta_usd), entry: Number(r.entry), price: Number(r.price), pnl: Number(r.pnl), heldMs: Number(r.held_ms) }));
}

/** Diff the latest snapshot against the stored watch state and persist the resulting events. */
export async function trackWhales(now = Date.now()): Promise<{ events: WhaleEvent[]; snapshotAt: number; prices: Record<string, number> }> {
  const snapshot = await whaleSnapshot();
  const prices: Record<string, number> = Object.fromEntries(Object.entries(snapshot.ctx).map(([coin, c]) => [coin, c.markPx]));
  let state: WatchState | null = null;
  try { state = JSON.parse((await readOwnerRecord("whale-watch")) ?? "null"); } catch { state = null; }
  if (state && state.at >= snapshot.at) return { events: [], snapshotAt: snapshot.at, prices };
  const { events, next } = diffPositions(state, snapshot.positions.map(p => ({ ...p, trader: p.trader })), snapshot.at, coin => prices[coin] ?? 0);
  // Positions carry the shortened trader label from the positioning cache; events keep that label as the trader id.
  await insertEvents(events);
  try { await writeOwnerRecord("whale-watch", JSON.stringify(next)); } catch { /* best effort */ }
  void now;
  return { events, snapshotAt: snapshot.at, prices };
}

export async function whaleRankings(): Promise<WhaleRank[]> {
  const rows = await whaleAddresses();
  const closes = await recentEvents(30 * 86_400_000, 2000);
  const performances: WhalePerformance[] = rows.map(r => ({ trader: r.address.slice(0, 6) + "…" + r.address.slice(-4), accountValue: r.accountValue, windows: r.windows ?? { day: { pnl: 0, roi: 0 }, week: { pnl: 0, roi: 0 }, month: { pnl: 0, roi: 0 }, allTime: { pnl: 0, roi: 0 } } }));
  return rankWhales(performances, closes);
}

export type WhaleSignalWithPlan = WhaleSignal & { symbol: string | null; engine?: { bias: string; regime: string; trendFrames: number; agrees: boolean; stop: number; targets: number[]; atrPct: number } | null };

/** Confirmed whale signals with the Bybit symbol and our engine's read of the same chart. */
export async function whaleSignals(now = Date.now()): Promise<{ signals: WhaleSignalWithPlan[]; ranks: WhaleRank[]; events: WhaleEvent[] }> {
  const [ranks, events] = await Promise.all([whaleRankings(), recentEvents(24 * 3_600_000)]);
  const snapshot = await whaleSnapshot();
  const prices: Record<string, number> = Object.fromEntries(Object.entries(snapshot.ctx).map(([coin, c]) => [coin, c.markPx]));
  const raw = confirmWhaleSignals(events, ranks, prices, now).slice(0, 8);
  let symbols = new Set<string>();
  try { const tickers = await marketRead({ kind: "tickers" }); symbols = new Set((tickers.result!.list as Array<{ symbol?: string }>).map(t => t.symbol ?? "")); } catch { /* no mapping */ }
  const signals: WhaleSignalWithPlan[] = [];
  for (const s of raw) {
    const symbol = bybitSymbolFor(s.coin, symbols);
    let engine: WhaleSignalWithPlan["engine"] = null;
    if (symbol) {
      try {
        const { row, analysis } = await analyzePair(symbol, STYLE_CONFIG.DAY.interval, "DAY", "STRICT");
        const atr = analysis.metrics.atr; const sign = s.side === "LONG" ? 1 : -1;
        // Own logic: the whales give the direction and the entry area; the chart gives the risk. Stop 1.5 ATR(1H) beyond the whales' average entry, targets at 1R / 2R / 3R from the current price.
        const stop = s.avgEntry - sign * 1.5 * atr; const risk = Math.abs(s.price - stop);
        engine = { bias: row.bias, regime: row.regime, trendFrames: row.trendFrames, agrees: row.bias === s.side && row.trendFrames >= 2, stop, targets: [1, 2, 3].map(k => s.price + sign * k * risk), atrPct: analysis.metrics.atrPct };
      } catch { engine = null; }
    }
    signals.push({ ...s, symbol, engine });
  }
  return { signals, ranks, events };
}

/** Telegram alerts: confirmed whale signals, plus elite opens / closes on coins the owner follows. */
export function whaleAlerts(signals: WhaleSignalWithPlan[], events: WhaleEvent[], ranks: WhaleRank[], settings: WhaleSettings, now = Date.now()): TelegramEvent[] {
  if (!settings.alerts) return [];
  const out: TelegramEvent[] = [];
  const bucket = Math.floor(now / (6 * 3_600_000));
  for (const s of signals.filter(s => s.status !== "RAN AWAY" && s.confidence >= 55)) {
    const lines = [
      "🐋 WHALE SIGNAL · " + s.coin + " " + s.side + " · " + s.status + " · " + s.confidence + "%",
      "📍 Price " + formatPrice(s.price) + " · whales' avg entry " + formatPrice(s.avgEntry) + " (" + (s.distancePct >= 0 ? "+" : "") + s.distancePct.toFixed(2) + "%)",
      "",
      ...s.whales.map(w => "• " + w.label + " (" + w.tier.toLowerCase() + ") " + w.kind.toLowerCase() + " " + formatUsd(Math.max(0, w.deltaUsd)) + " @ " + formatPrice(w.entry)),
      ...(s.opposed.length ? ["", "⚠️ Against: " + s.opposed.map(o => o.label + " " + o.kind.toLowerCase() + " " + formatUsd(Math.abs(o.deltaUsd))).join(", ")] : []),
      "",
      ...(s.engine ? ["📈 Chart (1h): bias " + s.engine.bias + " · " + s.engine.regime + " · " + s.engine.trendFrames + "/3 frames " + (s.engine.agrees ? "· agrees with the whales" : "· does not confirm yet"), "🛑 Stop idea " + formatPrice(s.engine.stop) + " (1.5 ATR beyond their entry)", "🎯 Targets " + s.engine.targets.map(t => formatPrice(t)).join(" / ") + " (1R / 2R / 3R)"] : ["📈 Not listed on Bybit; information only."]),
      "",
      s.note,
      "No order is placed. Follow what ranked whales do now, not what their old positions say.",
    ];
    out.push({ key: "whale:signal:" + s.coin + ":" + s.side + ":" + bucket, symbol: s.symbol ?? undefined, lines, buttons: s.symbol ? [{ text: "📊 Analyse " + s.coin, data: "analyse:" + s.symbol }, { text: "👀 Monitor " + s.coin, data: "monitor:" + s.symbol }] : undefined });
  }
  const minTier = settings.minTier === "ELITE" ? ["ELITE"] : ["ELITE", "STRONG"];
  const rankBy = new Map(ranks.map(r => [r.trader, r]));
  for (const e of events.filter(e => now - e.at < 15 * 60_000)) {
    const r = rankBy.get(e.trader); if (!r || !minTier.includes(r.tier)) continue;
    if (settings.coins.length && !settings.coins.includes(e.coin)) continue;
    if (!(e.kind === "OPEN" || e.kind === "CLOSE" || e.kind === "FLIP") || Math.abs(e.deltaUsd) < 250_000) continue;
    out.push({ key: "whale:event:" + e.id, lines: [
      "🐋 " + r.label + " (" + r.tier.toLowerCase() + ", #" + r.rank + ") " + e.kind + " " + e.side + " " + e.coin,
      "📍 " + formatUsd(Math.abs(e.deltaUsd)) + (e.kind === "CLOSE" ? " closed · P&L " + (e.pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(e.pnl)) + " · held " + Math.round(e.heldMs / 3_600_000) + " h" : " at " + formatPrice(e.entry) + " · price " + formatPrice(e.price)),
    ] });
  }
  return out;
}
