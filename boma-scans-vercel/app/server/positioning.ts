import { marketRead } from "@/app/server/market-analysis";
import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";
import { hyperliquidCoin, type Positioning, type WhalePosition } from "@/app/lib/positioning";

const HL_INFO = "https://api.hyperliquid.xyz/info";
const HL_LEADERBOARD = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
const WHALE_COUNT = 60;
const WHALES_TTL = 24 * 3_600_000;
const POSITIONS_TTL = 3 * 60_000;

type LeaderRow = { ethAddress: string; accountValue: string; windowPerformances: Array<[string, { pnl: string; roi: string; vlm: string }]> };
type Snapshot = { at: number; universe: string[]; ctx: Record<string, { funding: number; openInterestUsd: number; markPx: number }>; positions: WhalePosition[] };

async function hlInfo<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(HL_INFO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) throw new Error("Hyperliquid responded " + response.status);
  return response.json() as Promise<T>;
}

/** Top profitable Hyperliquid traders (≥ $1M account value, ranked by 30-day PnL), refreshed daily. */
async function whaleAddresses(): Promise<Array<{ address: string; accountValue: number }>> {
  try {
    const cached = JSON.parse((await readOwnerRecord("hl-whales")) ?? "null") as { at: number; rows: Array<{ address: string; accountValue: number }> } | null;
    if (cached && Date.now() - cached.at < WHALES_TTL && cached.rows.length) return cached.rows;
  } catch { /* refresh */ }
  const response = await fetch(HL_LEADERBOARD, { signal: AbortSignal.timeout(25_000), cache: "no-store" });
  if (!response.ok) throw new Error("Hyperliquid leaderboard responded " + response.status);
  const data = await response.json() as { leaderboardRows: LeaderRow[] };
  const monthPnl = (row: LeaderRow) => Number(row.windowPerformances.find(([name]) => name === "month")?.[1].pnl ?? 0);
  const rows = data.leaderboardRows.filter(row => Number(row.accountValue) >= 1_000_000).sort((a, b) => monthPnl(b) - monthPnl(a)).slice(0, WHALE_COUNT)
    .map(row => ({ address: row.ethAddress, accountValue: Number(row.accountValue) }));
  await writeOwnerRecord("hl-whales", JSON.stringify({ at: Date.now(), rows }));
  return rows;
}

type ClearingHouse = { assetPositions: Array<{ position: { coin: string; szi: string; entryPx: string; positionValue: string; unrealizedPnl: string; liquidationPx: string | null; leverage: { value: number } } }> };

/** Live positions of the whale list plus per-coin funding/OI, cached for 3 minutes. */
export async function whaleSnapshot(): Promise<Snapshot> {
  try {
    const cached = JSON.parse((await readOwnerRecord("hl-positions")) ?? "null") as Snapshot | null;
    if (cached && Date.now() - cached.at < POSITIONS_TTL) return cached;
  } catch { /* refresh */ }
  const [meta, ctxs] = await hlInfo<[{ universe: Array<{ name: string; isDelisted?: boolean }> }, Array<{ funding: string; openInterest: string; markPx: string }>]>({ type: "metaAndAssetCtxs" });
  const universe: string[] = []; const ctx: Snapshot["ctx"] = {};
  meta.universe.forEach((asset, index) => { if (asset.isDelisted) return; universe.push(asset.name); const c = ctxs[index]; if (c) ctx[asset.name] = { funding: Number(c.funding), openInterestUsd: Number(c.openInterest) * Number(c.markPx), markPx: Number(c.markPx) }; });
  const whales = await whaleAddresses();
  const positions: WhalePosition[] = [];
  for (let i = 0; i < whales.length; i += 12) {
    const batch = whales.slice(i, i + 12);
    const results = await Promise.allSettled(batch.map(whale => hlInfo<ClearingHouse>({ type: "clearinghouseState", user: whale.address })));
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const whale = batch[index];
      for (const { position } of result.value.assetPositions) {
        const size = Number(position.szi); if (!size) continue;
        positions.push({ trader: whale.address.slice(0, 6) + "…" + whale.address.slice(-4), coin: position.coin, side: size > 0 ? "LONG" : "SHORT", sizeUsd: Number(position.positionValue), entry: Number(position.entryPx), leverage: position.leverage.value, liquidation: position.liquidationPx ? Number(position.liquidationPx) : null, pnl: Number(position.unrealizedPnl), accountValue: whale.accountValue });
      }
    });
  }
  const snapshot: Snapshot = { at: Date.now(), universe, ctx, positions };
  try { await writeOwnerRecord("hl-positions", JSON.stringify(snapshot)); } catch { /* cache only */ }
  return snapshot;
}

async function bybitCrowd(symbol: string): Promise<Positioning["crowd"]> {
  try {
    const [ratio, oi, ticker] = await Promise.all([marketRead({ kind: "ratio", symbol }), marketRead({ kind: "oi", symbol }), marketRead({ kind: "ticker", symbol })]);
    const ratios = ratio.result!.list as Array<{ buyRatio: string; timestamp: string }>;
    const ois = oi.result!.list as Array<{ openInterest: string; timestamp: string }>;
    const first = ratios[0], last = ratios[ratios.length - 1];
    const oiNow = Number(ois[0]?.openInterest), oiThen = Number(ois[ois.length - 1]?.openInterest);
    const t = (ticker.result!.list as Array<{ fundingRate: string }>)[0];
    if (!first) return null;
    return { longRatio: Number(first.buyRatio), longRatioPrev: Number(last?.buyRatio ?? first.buyRatio), oiChange24h: oiThen > 0 ? oiNow / oiThen - 1 : 0, fundingRate: Number(t?.fundingRate ?? 0) };
  } catch { return null; }
}

/** Whale and crowd positioning for a pair, from one shared snapshot. */
export async function positioningFor(symbol: string, snapshot: Snapshot): Promise<Positioning> {
  const universe = new Set(snapshot.universe);
  const coin = hyperliquidCoin(symbol, universe);
  const positions = coin ? snapshot.positions.filter(p => p.coin === coin).sort((a, b) => b.sizeUsd - a.sizeUsd) : [];
  const longUsd = positions.filter(p => p.side === "LONG").reduce((acc, p) => acc + p.sizeUsd, 0);
  const shortUsd = positions.filter(p => p.side === "SHORT").reduce((acc, p) => acc + p.sizeUsd, 0);
  return { symbol, coin, at: snapshot.at, whales: { longUsd, shortUsd, traders: positions.length, positions: positions.slice(0, 12) }, hyperliquid: coin ? snapshot.ctx[coin] ?? null : null, crowd: await bybitCrowd(symbol) };
}
