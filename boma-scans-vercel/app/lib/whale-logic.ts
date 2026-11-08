/**
 * Whale system: pure logic.
 *
 * Guiding rule: follow what consistently successful whales are DOING NOW, not
 * what their existing positions say. A position that is already deep in profit
 * tells you where a whale was right yesterday; a fresh open or add by a whale
 * with a consistent record tells you where they want to be today. So the
 * engine (1) diffs position snapshots into events, (2) ranks whales by
 * consistency across time windows plus our own tracked outcomes, and
 * (3) confirms a signal only when several ranked whales open or add the same
 * side close to the current price, with nobody of rank against them.
 */
export type WhalePosition = { trader: string; coin: string; side: "LONG" | "SHORT"; sizeUsd: number; entry: number; leverage: number; liquidation: number | null; pnl: number; accountValue: number };

export type WatchedPosition = { side: "LONG" | "SHORT"; sizeUsd: number; entry: number; pnl: number; firstSeen: number; lastSeen: number; maxSizeUsd: number };
export type WatchState = { at: number; positions: Record<string, WatchedPosition> };

export type WhaleEventKind = "OPEN" | "ADD" | "REDUCE" | "CLOSE" | "FLIP";
export type WhaleEvent = { id: string; at: number; trader: string; coin: string; kind: WhaleEventKind; side: "LONG" | "SHORT"; sizeUsd: number; deltaUsd: number; entry: number; price: number; pnl: number; heldMs: number };

const key = (trader: string, coin: string) => trader + "|" + coin;
const SIZE_STEP = 0.15;

/** Diff a fresh snapshot against the watch state; returns the events and the next state. */
export function diffPositions(previous: WatchState | null, positions: WhalePosition[], at: number, markPrice: (coin: string) => number): { events: WhaleEvent[]; next: WatchState } {
  const events: WhaleEvent[] = [];
  const next: WatchState = { at, positions: {} };
  const seen = new Set<string>();
  const first = !previous;
  for (const p of positions) {
    const k = key(p.trader, p.coin); seen.add(k);
    const before = previous?.positions[k];
    const price = markPrice(p.coin) || p.entry;
    if (!before) {
      next.positions[k] = { side: p.side, sizeUsd: p.sizeUsd, entry: p.entry, pnl: p.pnl, firstSeen: at, lastSeen: at, maxSizeUsd: p.sizeUsd };
      // On the very first snapshot every position is "existing", not a fresh open.
      if (!first) events.push({ id: [p.trader, p.coin, "OPEN", at].join(":"), at, trader: p.trader, coin: p.coin, kind: "OPEN", side: p.side, sizeUsd: p.sizeUsd, deltaUsd: p.sizeUsd, entry: p.entry, price, pnl: p.pnl, heldMs: 0 });
      continue;
    }
    if (before.side !== p.side) {
      events.push({ id: [p.trader, p.coin, "FLIP", at].join(":"), at, trader: p.trader, coin: p.coin, kind: "FLIP", side: p.side, sizeUsd: p.sizeUsd, deltaUsd: p.sizeUsd, entry: p.entry, price, pnl: before.pnl, heldMs: at - before.firstSeen });
      next.positions[k] = { side: p.side, sizeUsd: p.sizeUsd, entry: p.entry, pnl: p.pnl, firstSeen: at, lastSeen: at, maxSizeUsd: p.sizeUsd };
      continue;
    }
    const change = p.sizeUsd / Math.max(before.sizeUsd, 1) - 1;
    if (change >= SIZE_STEP) events.push({ id: [p.trader, p.coin, "ADD", at].join(":"), at, trader: p.trader, coin: p.coin, kind: "ADD", side: p.side, sizeUsd: p.sizeUsd, deltaUsd: p.sizeUsd - before.sizeUsd, entry: p.entry, price, pnl: p.pnl, heldMs: at - before.firstSeen });
    else if (change <= -SIZE_STEP) events.push({ id: [p.trader, p.coin, "REDUCE", at].join(":"), at, trader: p.trader, coin: p.coin, kind: "REDUCE", side: p.side, sizeUsd: p.sizeUsd, deltaUsd: p.sizeUsd - before.sizeUsd, entry: p.entry, price, pnl: p.pnl, heldMs: at - before.firstSeen });
    next.positions[k] = { ...before, sizeUsd: p.sizeUsd, entry: p.entry, pnl: p.pnl, lastSeen: at, maxSizeUsd: Math.max(before.maxSizeUsd, p.sizeUsd) };
  }
  if (previous) for (const [k, before] of Object.entries(previous.positions)) {
    if (seen.has(k)) continue;
    const [trader, coin] = k.split("|");
    events.push({ id: [trader, coin, "CLOSE", at].join(":"), at, trader, coin, kind: "CLOSE", side: before.side, sizeUsd: 0, deltaUsd: -before.sizeUsd, entry: before.entry, price: markPrice(coin) || before.entry, pnl: before.pnl, heldMs: at - before.firstSeen });
  }
  return { events, next };
}

export type WhalePerformance = { trader: string; accountValue: number; windows: Record<"day" | "week" | "month" | "allTime", { pnl: number; roi: number }> };
export type WhaleRank = WhalePerformance & { rank: number; tier: "ELITE" | "STRONG" | "WATCH"; score: number; trackedCloses: number; trackedWinRate: number | null; trackedPnl: number; consistency: number; label: string };

/**
 * Rank by consistency, not by one lucky month: a point per profitable window,
 * month ROI (capped), and our own tracked closes once there are enough of
 * them. Elite = top 10, Strong = next 15.
 */
export function rankWhales(performances: WhalePerformance[], closes: WhaleEvent[]): WhaleRank[] {
  const ranked = performances.map(p => {
    const mine = closes.filter(e => e.trader === p.trader && e.kind === "CLOSE");
    const wins = mine.filter(e => e.pnl > 0).length;
    const winRate = mine.length >= 5 ? wins / mine.length : null;
    const consistency = (["day", "week", "month", "allTime"] as const).filter(w => p.windows[w].pnl > 0).length;
    const monthRoi = Math.max(-0.5, Math.min(1, p.windows.month.roi));
    const score = consistency * 10 + monthRoi * 40 + (winRate === null ? 0 : (winRate - 0.5) * 40) + Math.min(10, Math.log10(Math.max(1, p.windows.allTime.pnl)) );
    return { ...p, score, consistency, trackedCloses: mine.length, trackedWinRate: winRate, trackedPnl: mine.reduce((a, e) => a + e.pnl, 0) };
  }).sort((a, b) => b.score - a.score);
  return ranked.map((p, index) => ({ ...p, rank: index + 1, tier: index < 10 ? "ELITE" : index < 25 ? "STRONG" : "WATCH", label: p.trader.slice(0, 6) + "…" + p.trader.slice(-4) }));
}

export type WhaleSignal = {
  coin: string; side: "LONG" | "SHORT"; at: number;
  whales: Array<{ label: string; trader: string; tier: WhaleRank["tier"]; kind: WhaleEventKind; deltaUsd: number; entry: number; at: number }>;
  opposed: Array<{ label: string; tier: WhaleRank["tier"]; kind: WhaleEventKind; deltaUsd: number }>;
  score: number; confidence: number; status: "NEW ENTRY" | "ENTRY AVAILABLE" | "RAN AWAY" | "WEAK";
  avgEntry: number; price: number; distancePct: number; flowUsd: number; distinct: number;
  note: string;
};

const WINDOW_MS = 12 * 3_600_000;
const tierWeight: Record<WhaleRank["tier"], number> = { ELITE: 2, STRONG: 1, WATCH: 0.25 };

/**
 * Confirmation engine. Groups fresh OPEN / ADD / FLIP events by coin and side,
 * weighs them by the whale's tier, discounts positions that are already deep
 * in profit (that is yesterday's call) and anyone of rank on the other side,
 * and keeps a signal only when the entry is still near the current price.
 */
export function confirmWhaleSignals(events: WhaleEvent[], ranks: WhaleRank[], prices: Record<string, number>, now = Date.now()): WhaleSignal[] {
  const rankBy = new Map(ranks.map(r => [r.trader, r]));
  const fresh = events.filter(e => now - e.at <= WINDOW_MS && (e.kind === "OPEN" || e.kind === "ADD" || e.kind === "FLIP") && rankBy.has(e.trader));
  const groups = new Map<string, WhaleEvent[]>();
  for (const e of fresh) { const g = e.coin + "|" + e.side; groups.set(g, [...(groups.get(g) ?? []), e]); }
  const signals: WhaleSignal[] = [];
  for (const [g, list] of groups) {
    const [coin, side] = g.split("|") as [string, "LONG" | "SHORT"];
    const price = prices[coin]; if (!price) continue;
    // One entry per whale (the latest), new money only.
    const byTrader = new Map<string, WhaleEvent>();
    for (const e of list.sort((a, b) => a.at - b.at)) byTrader.set(e.trader, e);
    const entries = Array.from(byTrader.values()).map(e => { const r = rankBy.get(e.trader)!; const profitShare = e.sizeUsd > 0 ? e.pnl / e.sizeUsd : 0; const alreadyProfitable = e.kind === "ADD" && profitShare > 0.05 && e.heldMs > 24 * 3_600_000; return { e, r, weight: tierWeight[r.tier] * (alreadyProfitable ? 0.4 : 1) * Math.min(1.5, Math.max(0.5, Math.log10(Math.max(100_000, e.deltaUsd)) - 5)) }; });
    const opposed = events.filter(e => now - e.at <= WINDOW_MS && e.coin === coin && e.side !== side && (e.kind === "OPEN" || e.kind === "ADD" || e.kind === "FLIP") && rankBy.has(e.trader) && rankBy.get(e.trader)!.tier !== "WATCH").map(e => ({ label: rankBy.get(e.trader)!.label, tier: rankBy.get(e.trader)!.tier, kind: e.kind, deltaUsd: e.deltaUsd }));
    const score = entries.reduce((a, x) => a + x.weight, 0) - opposed.reduce((a, o) => a + tierWeight[o.tier] * 0.8, 0);
    // Only elite and strong whales count towards the confirmation; watch-tier whales add a little weight but cannot confirm on their own.
    const distinct = entries.filter(x => x.r.tier !== "WATCH").length;
    const flowUsd = entries.reduce((a, x) => a + Math.max(0, x.e.deltaUsd), 0);
    const avgEntry = entries.reduce((a, x) => a + x.e.entry * Math.max(1, x.e.deltaUsd), 0) / Math.max(1, entries.reduce((a, x) => a + Math.max(1, x.e.deltaUsd), 0));
    const sign = side === "LONG" ? 1 : -1;
    const distancePct = sign * (price - avgEntry) / avgEntry * 100;
    const eliteCount = entries.filter(x => x.r.tier === "ELITE").length;
    const strong = distinct >= 2 && score >= 2.5 || (eliteCount >= 1 && flowUsd >= 1_000_000 && score >= 2);
    const status: WhaleSignal["status"] = !strong ? "WEAK" : distancePct > 2 ? "RAN AWAY" : Math.abs(distancePct) <= 0.6 ? "NEW ENTRY" : "ENTRY AVAILABLE";
    const confidence = Math.max(0, Math.min(100, Math.round(35 + score * 12 + (distinct - 1) * 8 - opposed.length * 12 - Math.max(0, distancePct) * 6)));
    const note = (strong ? distinct + " ranked whale" + (distinct === 1 ? "" : "s") + " " + (eliteCount ? "(" + eliteCount + " elite) " : "") + "opened or added " + side + " " + coin + " in the last 12 h, " + Math.round(flowUsd / 1e5) / 10 + "M of new money" : "Not enough ranked whales behind this " + side + " yet") + (opposed.length ? "; " + opposed.length + " ranked whale" + (opposed.length === 1 ? "" : "s") + " on the other side" : "") + (status === "RAN AWAY" ? "; price has moved " + distancePct.toFixed(1) + "% past their average entry, wait for a pullback" : ".");
    signals.push({ coin, side, at: Math.max(...entries.map(x => x.e.at)), whales: entries.map(x => ({ label: x.r.label, trader: x.e.trader, tier: x.r.tier, kind: x.e.kind, deltaUsd: x.e.deltaUsd, entry: x.e.entry, at: x.e.at })), opposed, score, confidence, status, avgEntry, price, distancePct, flowUsd, distinct, note });
  }
  return signals.filter(s => s.status !== "WEAK").sort((a, b) => b.confidence - a.confidence);
}

/** Bybit symbol for a Hyperliquid coin: BTC → BTCUSDT, kPEPE → 1000PEPEUSDT. */
export function bybitSymbolFor(coin: string, symbols: Set<string>): string | null {
  const candidates = [coin + "USDT", coin.startsWith("k") ? "1000" + coin.slice(1) + "USDT" : "", coin.startsWith("k") ? "10000" + coin.slice(1) + "USDT" : ""].filter(Boolean);
  return candidates.find(s => symbols.has(s)) ?? null;
}
