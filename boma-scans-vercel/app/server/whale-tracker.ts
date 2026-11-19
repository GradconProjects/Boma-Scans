import { env } from "@/app/server/env";
import { marketRead, analyzePair } from "@/app/server/market-analysis";
import { whaleAddresses, whaleSnapshot } from "@/app/server/positioning";
import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";
import { bybitSymbolFor, confirmWhaleExits, confirmWhaleSignals, diffPositions, rankWhales, whaleTradeWarnings, type EnteredTrade, type IssuedSignal, type WatchState, type WhaleEvent, type WhaleExit, type WhalePerformance, type WhaleRank, type WhaleSignal, type WhaleWarning } from "@/app/lib/whale-logic";
import { whaleTradeManagement } from "@/app/server/whale-management";
import { checkExits, type ArmedPlan } from "@/app/lib/trigger-monitor";
import { structureAdvice } from "@/app/server/trade-watch";
import { formatExitEvent } from "@/app/lib/telegram-events";
import { formatUsd } from "@/app/lib/positioning";
import { formatPrice, STYLE_CONFIG } from "@/app/lib/market";
import type { TelegramEvent } from "@/app/lib/telegram-events";

/**
 * Whale system, server side: turns the cached Hyperliquid snapshots into a
 * persistent event history, ranks the whales, confirms signals and prepares
 * the alerts. Runs inside the scheduled monitor; cheap when the snapshot has
 * not changed. Never places orders.
 */
export type WhaleSettings = { alerts: boolean; minTier: "ELITE" | "STRONG"; coins: string[]; /** Coins the owner chose to follow one by one: every directional whale move on them is reported. */ watch: string[]; /** Trades the owner is in; the early-warning system follows whale activity on them. */ entered: EnteredTrade[] };
const DEFAULT_SETTINGS: WhaleSettings = { alerts: true, minTier: "STRONG", coins: [], watch: [], entered: [] };
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

/** Remove OPEN events that were really a baseline (traders with no earlier history) since `since`, and forget issued signals. */
export async function purgeBaselineOpens(since: number): Promise<number> {
  if (!env.DB) { const before = memoryEvents.length; const earlier = new Set(memoryEvents.filter(e => e.at < since).map(e => e.trader)); for (let i = memoryEvents.length - 1; i >= 0; i--) if (memoryEvents[i].at >= since && memoryEvents[i].kind === "OPEN" && !earlier.has(memoryEvents[i].trader)) memoryEvents.splice(i, 1); await writeOwnerRecord("whale-issued", "[]"); return before - memoryEvents.length; }
  const result = await env.DB.prepare("DELETE FROM whale_events WHERE at>=? AND kind='OPEN' AND trader NOT IN (SELECT DISTINCT trader FROM whale_events WHERE at<?)").bind(since, since).run();
  await writeOwnerRecord("whale-issued", "[]");
  return result.meta.changes;
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
  const rows = await whaleAddresses(); const snapshot = await whaleSnapshot(); const closes = await recentEvents(30 * 86_400_000, 2000);
  const openBy = new Map<string, number>();
  for (const p of snapshot.positions) openBy.set(p.trader, (openBy.get(p.trader) ?? 0) + 1);
  const performances: WhalePerformance[] = rows.map(r => { const label = r.address.slice(0, 6) + "…" + r.address.slice(-4); return { trader: label, accountValue: r.accountValue, openPositions: openBy.get(label) ?? 0, windows: r.windows ?? { day: { pnl: 0, roi: 0 }, week: { pnl: 0, roi: 0 }, month: { pnl: 0, roi: 0 }, allTime: { pnl: 0, roi: 0 } } }; });
  return rankWhales(performances, closes);
}

export type WhaleSignalWithPlan = WhaleSignal & { symbol: string | null; engine?: { bias: string; regime: string; trendFrames: number; agrees: boolean; opposes: boolean; stop: number; targets: number[]; atrPct: number } | null };

export async function issuedSignals(): Promise<IssuedSignal[]> { try { return JSON.parse((await readOwnerRecord("whale-issued")) ?? "[]"); } catch { return []; } }
async function rememberIssued(signals: WhaleSignalWithPlan[], now: number) {
  const current = (await issuedSignals()).filter(s => now - s.at < 7 * 86_400_000);
  for (const s of signals) if (!current.some(i => i.coin === s.coin && i.side === s.side && now - i.at < 24 * 3_600_000)) current.push({ coin: s.coin, side: s.side, at: now, traders: s.whales.map(w => w.trader) });
  try { await writeOwnerRecord("whale-issued", JSON.stringify(current.slice(-60))); } catch { /* best effort */ }
}

/** Confirmed whale entry signals (with the Bybit symbol and our engine's read) and exit signals. */
export async function whaleSignals(now = Date.now()): Promise<{ signals: WhaleSignalWithPlan[]; exits: WhaleExit[]; ranks: WhaleRank[]; events: WhaleEvent[] }> {
  const ranks = await whaleRankings(); const events = await recentEvents(24 * 3_600_000);
  const exits = confirmWhaleExits(events, ranks, await issuedSignals(), now);
  const snapshot = await whaleSnapshot();
  const prices: Record<string, number> = Object.fromEntries(Object.entries(snapshot.ctx).map(([coin, c]) => [coin, c.markPx]));
  const raw = confirmWhaleSignals(events, ranks, prices, now).slice(0, 12);
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
        // The stop sits 1.5 ATR beyond the worse of their entry and the current price, so it is always on the protective side.
        const whaleStop = s.avgEntry - sign * 1.5 * atr;
        if (sign * (s.price - whaleStop) <= 0) { s.status = "UNDERWATER"; s.note = "Price " + formatPrice(s.price) + " is already through the whales' 1.5 ATR stop " + formatPrice(whaleStop) + "; this " + s.side + " call has failed. Not an entry."; }
        const anchor = s.side === "LONG" ? Math.min(s.avgEntry, s.price) : Math.max(s.avgEntry, s.price);
        const stop = anchor - sign * 1.5 * atr; const risk = Math.abs(s.price - stop);
        engine = { bias: row.bias, regime: row.regime, trendFrames: row.trendFrames, agrees: row.bias === s.side && row.trendFrames >= 2, opposes: row.bias !== s.side && row.trendFrames >= 2, stop, targets: [1, 2, 3].map(k => s.price + sign * k * risk), atrPct: analysis.metrics.atrPct };
      } catch { engine = null; }
    }
    signals.push({ ...s, symbol, engine });
  }
  return { signals, exits, ranks, events };
}

/** Telegram alerts: confirmed whale signals, plus elite opens / closes on coins the owner follows. */
/** Warnings for the owner's entered trades from the recent whale events. */
export function enteredWarnings(settings: WhaleSettings, events: WhaleEvent[], ranks: WhaleRank[], now = Date.now()): WhaleWarning[] {
  return whaleTradeWarnings(settings.entered ?? [], events, ranks, now);
}

export async function whaleAlerts(signals: WhaleSignalWithPlan[], exits: WhaleExit[], events: WhaleEvent[], ranks: WhaleRank[], settings: WhaleSettings, now = Date.now(), prices: Record<string, number> = {}): Promise<TelegramEvent[]> {
  const out: TelegramEvent[] = [];
  // Early warning on trades the owner is in: whale moves against the position in the last 15 minutes, with instructions in figures.
  for (const trade of settings.entered ?? []) {
    const fresh = whaleTradeWarnings([trade], events.filter(e => now - e.at < 15 * 60_000), ranks, now, 15 * 60_000)[0];
    if (!fresh) continue;
    const price = prices[trade.coin] ?? 0; const sign = trade.side === "LONG" ? 1 : -1;
    const pnlPct = price && trade.entry ? sign * (price - trade.entry) / trade.entry * 100 : null;
    const management = await whaleTradeManagement(trade, fresh, price).catch(() => null);
    const icon = fresh.severity === "CRITICAL" ? "🚨" : fresh.severity === "WARNING" ? "⚠️" : "ℹ️";
    out.push({ key: "whale:warn:" + trade.coin + ":" + trade.side + ":" + fresh.eventIds.slice().sort().join("|").slice(0, 120), symbol: trade.symbol ?? undefined, lines: [
      icon + " WHALE " + fresh.severity + " · " + trade.coin + " " + trade.side + " (your trade)",
      "📍 Price " + formatPrice(price) + " · your entry " + formatPrice(trade.entry) + (pnlPct !== null ? " · " + (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2) + "%" : ""),
      fresh.headline + ".",
      "",
      ...fresh.against.map(a => "• AGAINST " + a.label + " (" + a.tier.toLowerCase() + ") " + a.kind.toLowerCase() + " " + a.side + " " + formatUsd(Math.abs(a.deltaUsd)) + (a.kind === "CLOSE" || a.kind === "REDUCE" || a.kind === "FLIP" ? " · " + (a.pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(a.pnl)) + " · held " + a.heldHours + " h" : "")),
      ...fresh.withYou.map(w => "• WITH " + w.label + " (" + w.tier.toLowerCase() + ") " + w.kind.toLowerCase() + " " + formatUsd(Math.abs(w.deltaUsd))),
      "",
      ...(management ? [
        (management.action === "EXIT NOW" ? "⛔ " : management.action === "REDUCE" ? "✂️ " : management.action === "TIGHTEN STOP" ? "🛡 " : "✅ ") + management.action + (management.reduce_pct ? " · close " + management.reduce_pct + "%" : "") + (management.new_stop ? " · stop to " + formatPrice(management.new_stop) : ""),
        management.reasoning,
        ...(management.figures.length ? management.figures.map(f => "• " + f) : []),
        "⏭ Next: " + management.next_check,
        ...(management.guardrails.length ? ["📐 " + management.guardrails.join("; ")] : []),
      ] : ["Instructions unavailable right now; re-run the analysis in the whale section."]),
    ], buttons: [{ text: "🐋 Whale read " + trade.coin, data: "wread:" + trade.coin + ":" + trade.side }, { text: "❌ I exited " + trade.coin, data: "wexit:" + trade.coin }] });
  }
  // Six-hourly check-in for each entered trade: where the whale book stands.
  for (const trade of settings.entered ?? []) {
    const bucket = Math.floor(now / (6 * 3_600_000));
    const w = whaleTradeWarnings([trade], events, ranks, now, 6 * 3_600_000)[0];
    const price = prices[trade.coin] ?? 0; const sign = trade.side === "LONG" ? 1 : -1;
    out.push({ key: "whale:checkin:" + trade.coin + ":" + trade.side + ":" + bucket, lines: [
      "🕐 Whale check-in · " + trade.coin + " " + trade.side + " (your trade)",
      "📍 Price " + formatPrice(price) + " · entry " + formatPrice(trade.entry) + (price && trade.entry ? " · " + (sign * (price - trade.entry) >= 0 ? "+" : "") + (sign * (price - trade.entry) / trade.entry * 100).toFixed(2) + "%" : ""),
      w ? w.headline + " over the last 6 h (" + w.against.length + " moves against, " + w.withYou.length + " with)." : "No directional whale moves on " + trade.coin + " in the last 6 h.",
    ] });
  }
  const bucket = Math.floor(now / (6 * 3_600_000));
  const rankBy0 = new Map(ranks.map(r => [r.trader, r]));
  // Pairs the owner monitors one by one always report, even with general whale alerts off.
  // Entry calls only when the whales are not losing on the call and the 1H chart does not trend the other way.
  const pushable = (s: WhaleSignalWithPlan) => s.status !== "RAN AWAY" && s.status !== "WEAK" && s.status !== "UNDERWATER" && !s.engine?.opposes;
  const entrySignals = settings.alerts ? signals.filter(s => pushable(s) && s.confidence >= 50) : [];
  const watched = new Set(settings.watch ?? []);
  // Watched coins: every directional whale move of $100K+, any tier, and entry / exit signals without the confidence floor.
  for (const e of events.filter(e => watched.has(e.coin) && now - e.at < 15 * 60_000 && Math.abs(e.deltaUsd) >= 100_000)) {
    const r = rankBy0.get(e.trader); if (!r || r.marketMaker) continue;
    out.push({ key: "whale:watch:" + e.id, lines: ["👁 " + e.coin + " watch · " + r.label + " (" + r.tier.toLowerCase() + ", #" + r.rank + ") " + e.kind + " " + e.side, "📍 " + formatUsd(Math.abs(e.deltaUsd)) + (e.kind === "CLOSE" ? " closed · P&L " + (e.pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(e.pnl)) + " · held " + Math.round(e.heldMs / 3_600_000) + " h" : " at " + formatPrice(e.entry) + " · price " + formatPrice(e.price))] });
  }
  for (const s of signals.filter(s => watched.has(s.coin) && pushable(s) && !entrySignals.includes(s))) entrySignals.push(s);
  for (const x of settings.alerts ? exits : exits.filter(x => watched.has(x.coin))) {
    out.push({ key: "whale:exit:" + x.coin + ":" + x.side + ":" + Math.floor(x.at / (3 * 3_600_000)), lines: [
      "🐋 WHALE EXIT · " + x.coin + " " + x.side + " · " + (x.urgency === "LEAVE" ? "LEAVE THE TRADE" : "REDUCE"),
      "📍 Whales realised " + (x.realizedPnl >= 0 ? "+" : "−") + formatUsd(Math.abs(x.realizedPnl)) + " on the way out",
      "",
      ...x.whales.map(w => "• " + w.label + " (" + w.tier.toLowerCase() + (w.wasLeader ? ", led the entry" : "") + ") " + w.kind.toLowerCase() + " " + formatUsd(Math.abs(w.deltaUsd)) + " · " + (w.pnl >= 0 ? "+" : "−") + formatUsd(Math.abs(w.pnl)) + " · held " + w.heldHours + " h"),
      "",
      x.note,
      x.urgency === "LEAVE" ? "If you followed this side, close or trail the remainder now; the whales who made the call have left." : "If you followed this side, take a partial and tighten the stop; one of the whales is cutting.",
    ] });
  }
  await rememberIssued(entrySignals, now);
  for (const s of entrySignals) {
    const lines = [
      "🐋 WHALE SIGNAL · " + s.coin + " " + s.side + " · " + s.status + " · " + s.confidence + "%",
      "🧭 " + (s.engine?.agrees ? "Call: " + s.side + " " + s.coin + ". Whales and the 1h chart agree." : s.engine ? "Call: " + s.side + " " + s.coin + " with half size. Whales are " + s.side + "; the 1h chart is neutral (" + s.engine.bias + ", " + s.engine.trendFrames + "/3 frames), not against." : "Information only: not listed on Bybit."),
      "📍 Price " + formatPrice(s.price) + " · whales' avg entry " + formatPrice(s.avgEntry) + " (" + (s.distancePct >= 0 ? "+" : "") + s.distancePct.toFixed(2) + "%)",
      "",
      ...s.whales.map(w => "• " + w.label + " (" + w.tier.toLowerCase() + ") " + w.kind.toLowerCase() + " " + formatUsd(Math.max(0, w.deltaUsd)) + " @ " + formatPrice(w.entry)),
      ...(s.opposed.length ? ["", "⚠️ Against: " + s.opposed.map(o => o.label + " " + o.kind.toLowerCase() + " " + formatUsd(Math.abs(o.deltaUsd))).join(", ")] : []),
      "",
      ...(s.engine ? ["📈 Chart (1h): bias " + s.engine.bias + " · " + s.engine.regime + " · " + s.engine.trendFrames + "/3 frames " + (s.engine.agrees ? "· agrees with the whales" : "· neutral, not against"), "🛑 Stop " + formatPrice(s.engine.stop) + " (1.5 ATR beyond their entry or price, whichever is worse)", "🎯 Targets " + s.engine.targets.map(t => formatPrice(t)).join(" / ") + " (1R / 2R / 3R)"] : ["📈 Not listed on Bybit; information only."]),
      "",
      s.note,
      "No order is placed. Follow what ranked whales do now, not what their old positions say.",
    ];
    lines[0] = "🐋 WHALE ENTRY · " + s.coin + " " + s.side + " · " + s.status + " · " + s.confidence + "%";
    out.push({ key: "whale:signal:" + s.coin + ":" + s.side + ":" + bucket, symbol: s.symbol ?? undefined, lines, buttons: s.symbol ? [{ text: "✅ I entered this " + s.side, data: "went:" + s.coin + ":" + s.side }, { text: "✏️ Entered " + s.side + " at…", data: "wenterat:" + s.coin + ":" + s.side }, { text: "👁 Watch " + s.coin + " whales", data: "wwatch:" + s.coin }, { text: "🐋 Whale read " + s.coin, data: "wread:" + s.coin + ":" + s.side }] : undefined });
  }
  if (!settings.alerts) return out;
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

/** Levels for a trade the owner just entered: the planner's if it produced them, else 1.5 ATR(1H) stop and 1R / 2R / 3R targets. */
export async function levelsForEntered(trade: EnteredTrade): Promise<{ stop: number; targets: number[]; source: string; call?: string; chart?: string }> {
  const sign = trade.side === "LONG" ? 1 : -1;
  if (!trade.symbol) return { stop: trade.entry * (1 - sign * 0.03), targets: [1, 2, 3].map(k => trade.entry * (1 + sign * 0.03 * k)), source: "3% fallback (not on Bybit)" };
  const { row, analysis } = await analyzePair(trade.symbol, STYLE_CONFIG.DAY.interval, "DAY", "STRICT");
  const atr = analysis.metrics.atr; const stop = trade.entry - sign * 1.5 * atr; const risk = Math.abs(trade.entry - stop);
  const engineAgrees = row.bias === trade.side;
  const targets = engineAgrees && row.takeProfits.length >= 3 && row.takeProfits.every(t => sign * (t.price - trade.entry) > 0) ? row.takeProfits.slice(0, 3).map(t => t.price) : [1, 2, 3].map(k => trade.entry + sign * k * risk);
  return { stop: engineAgrees && sign * (trade.entry - row.stop) > 0 && sign * (trade.entry - row.stop) <= 2.5 * atr ? row.stop : stop, targets, source: engineAgrees ? "1H engine levels (chart agrees with the whales)" : "1.5 ATR stop and 1R / 2R / 3R targets (chart does not confirm the side yet)", chart: row.bias + " · " + row.regime + " · " + row.trendFrames + "/3 frames" };
}

/** Confirmation card when the owner records a whale trade. */
export function enteredCard(trade: EnteredTrade, levels: { stop: number; targets: number[]; source: string; chart?: string }, stance: { stance: string; detail: string }): TelegramEvent {
  const sign = trade.side === "LONG" ? 1 : -1; const risk = Math.max(Math.abs(trade.entry - levels.stop), trade.entry * 1e-4);
  return { key: "whale:entered:" + trade.coin + ":" + trade.at, symbol: trade.symbol ?? undefined, lines: [
    "✅ WHALE TRADE RECORDED · " + trade.coin + " " + trade.side + (trade.symbol ? " · " + trade.symbol : ""),
    "👉 Entry: " + formatPrice(trade.entry),
    "❌ StopLoss: " + formatPrice(levels.stop) + "   −" + (Math.abs(trade.entry - levels.stop) / trade.entry * 100).toFixed(2) + "%",
    ...levels.targets.map((t, i) => "🎯 Target " + (i + 1) + ": " + formatPrice(t) + "   +" + (sign * (t - trade.entry) / trade.entry * 100).toFixed(2) + "%  ·  " + (sign * (t - trade.entry) / risk).toFixed(1) + "R"),
    "",
    "🐋 Whales " + (stance.stance === "WITH" ? "with you: " : stance.stance === "AGAINST" ? "AGAINST you: " : "neutral: ") + stance.detail,
    ...(levels.chart ? ["📈 Chart (1h): " + levels.chart] : []),
    "📐 Levels: " + levels.source,
    "",
    "From now until you tap \"I exited\": every whale move on " + trade.coin + " with instructions in figures, each target and the stop as price reaches them, structure changes against the trade, and a check-in every 6 h.",
  ], buttons: [{ text: "🐋 Whale read " + trade.coin, data: "wread:" + trade.coin + ":" + trade.side }, { text: "❌ I exited " + trade.coin, data: "wexit:" + trade.coin }] };
}

export function exitedCard(trade: EnteredTrade, price: number): TelegramEvent {
  const sign = trade.side === "LONG" ? 1 : -1; const pnl = price && trade.entry ? sign * (price - trade.entry) / trade.entry * 100 : null;
  return { key: "whale:exited:" + trade.coin + ":" + Date.now(), lines: ["❌ WHALE TRADE CLOSED · " + trade.coin + " " + trade.side, "👉 Entry " + formatPrice(trade.entry) + (price ? " · exit around " + formatPrice(price) : "") + (pnl !== null ? " · " + (pnl >= 0 ? "+" : "") + pnl.toFixed(2) + "%" : "") + " · held " + Math.round((Date.now() - trade.at) / 3_600_000) + " h", "Whale monitoring of this pair has stopped; " + trade.coin + " stays on the watch list."] };
}

/**
 * Every minute, for each trade the owner is in: price against the stop and
 * targets (exits in order), and the engine's structure read (leave / protect).
 * Returns the alerts and the trades with their hit counters advanced.
 */
export async function followEnteredTrades(settings: WhaleSettings, now = Date.now()): Promise<{ events: TelegramEvent[]; entered: EnteredTrade[]; changed: boolean }> {
  const events: TelegramEvent[] = []; const next: EnteredTrade[] = []; let changed = false;
  for (const trade of settings.entered ?? []) {
    if (!trade.symbol || !trade.stop || !trade.targets?.length) { next.push(trade); continue; }
    try {
      const { row, analysis } = await analyzePair(trade.symbol, STYLE_CONFIG.DAY.interval, "DAY", "STRICT");
      const plan: ArmedPlan = { symbol: trade.symbol, side: trade.side, planKey: "whale:" + trade.coin + ":" + trade.at, entry: trade.entry, stop: trade.stop, targets: trade.targets, weights: [40, 30, 30].slice(0, trade.targets.length), hit: trade.hit ?? 0, armedAt: trade.at, tp2At: trade.tp2At, confirmed: true, style: "DAY" };
      const result = checkExits(plan, row.price, now);
      for (const exit of result.events) events.push({ ...formatExitEvent(exit), lines: ["🐋 " + formatExitEvent(exit).lines[0], ...formatExitEvent(exit).lines.slice(1)] });
      if (result.next) events.push(...structureAdvice(result.next, analysis, row, now));
      const updated: EnteredTrade = result.next ? { ...trade, hit: result.next.hit, tp2At: result.next.tp2At } : { ...trade, hit: trade.targets.length };
      if (updated.hit !== trade.hit || updated.tp2At !== trade.tp2At) changed = true;
      next.push(updated);
    } catch { next.push(trade); }
  }
  return { events, entered: next, changed };
}
