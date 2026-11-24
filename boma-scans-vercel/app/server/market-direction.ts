import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";
import { marketDirection, type MarketDirection } from "@/app/lib/market-direction";
import type { Candle } from "@/app/lib/ws2/engine";

const BYBIT = "https://api.bybit.com";
async function list<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const url = new URL(path, BYBIT); url.searchParams.set("category", "linear"); for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) }); if (!r.ok) throw new Error("Bybit " + r.status);
  const d = await r.json() as { retCode?: number; result?: { list?: T[] } }; if (d.retCode !== 0 || !d.result?.list) throw new Error("Bybit data unavailable"); return d.result.list;
}
const closed = async (symbol: string, interval: string, ms: number, limit: number, now: number): Promise<Candle[]> =>
  (await list<string[]>("/v5/market/kline", { symbol, interval, limit: String(limit) })).map(r => ({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) })).reverse().filter(c => c.time + ms <= now);
const STABLE = /^(USDC|USDE|FDUSD|TUSD|DAI|PYUSD|USD1|BUSD|USTC)USDT$/;
let memo: { at: number; value: MarketDirection } | null = null;

/** Market direction for all sections; shared and cached for 3 minutes so every page shows the same reading. */
export async function marketDirectionNow(now = Date.now()): Promise<MarketDirection> {
  if (memo && now - memo.at < 180_000) return memo.value;
  try { const saved = JSON.parse((await readOwnerRecord("market-direction")) ?? "null") as MarketDirection | null; if (saved && now - saved.at < 180_000) { memo = { at: saved.at, value: saved }; return saved; } } catch { /* recompute */ }
  const [tickers, instruments] = await Promise.all([list<{ symbol: string; turnover24h: string }>("/v5/market/tickers", {}), list<{ symbol: string; symbolType?: string; status?: string }>("/v5/market/instruments-info", { limit: "1000" }).catch(() => [])]);
  // Crypto only: Bybit marks stock and commodity contracts with a symbolType; plain crypto perpetuals have none.
  const nonCrypto = new Set(instruments.filter(i => ["stock", "commodity", "forex", "index", "etf"].includes((i.symbolType ?? "").toLowerCase())).map(i => i.symbol));
  const alts = tickers.filter(t => /^[A-Z0-9]{2,24}USDT$/.test(t.symbol) && t.symbol !== "BTCUSDT" && !nonCrypto.has(t.symbol) && !STABLE.test(t.symbol)).sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h)).slice(0, 30).map(t => t.symbol);
  const H = 3_600_000;
  const [btc, btc4h, ...rest] = await Promise.all([closed("BTCUSDT", "60", H, 80, now), closed("BTCUSDT", "240", 4 * H, 120, now), ...alts.map(s => closed(s, "60", H, 80, now).catch(() => [] as Candle[]))]);
  const value = marketDirection(btc, btc4h, alts.map((s, i) => ({ coin: s.replace(/USDT$/, ""), h1: rest[i] })), now);
  if (!value) throw new Error("Not enough market data.");
  memo = { at: now, value }; try { await writeOwnerRecord("market-direction", JSON.stringify(value)); } catch { /* cache only */ }
  return value;
}
