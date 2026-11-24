import { runWs2, type Candle, type Levels, type Side, type Ws2Input, type Ws2Params } from "@/app/lib/ws2/engine";
import { scoreOutcome, type Ws2LogEntry } from "@/app/lib/ws2/outcomes";

/**
 * Historical replay of Whale System 2 for one Bybit pair, used for calibration.
 * At each sample time the engine sees only candles, open interest, account ratios and funding that existed by then
 * (no look-ahead), and both sides' plans are scored against the 15-minute candles that followed.
 * Not replayable, so absent here and left at provisional weights: whale positions, exchange top-trader ratios, taker flow, liquidations.
 */
const BYBIT = "https://api.bybit.com"; const H = 3_600_000;
async function page<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const url = new URL(path, BYBIT); url.searchParams.set("category", "linear"); for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(9_000) }); if (r.status === 429 || r.status === 403) { await new Promise(res => setTimeout(res, 700 * (attempt + 1))); continue; } if (!r.ok) return []; const d = await r.json() as { retCode?: number; result?: { list?: T[] } }; if (d.retCode === 10006) { await new Promise(res => setTimeout(res, 700 * (attempt + 1))); continue; } return d.retCode === 0 && Array.isArray(d.result?.list) ? d.result!.list! : []; }
    catch { await new Promise(res => setTimeout(res, 300)); }
  }
  return [];
}
async function klines(symbol: string, interval: string, ms: number, since: number, now: number): Promise<Candle[]> {
  const out: Candle[] = []; let end = now;
  for (let i = 0; i < 24 && end > since; i++) {
    const rows = await page<string[]>("/v5/market/kline", { symbol, interval, limit: "1000", end: String(end) }); if (!rows.length) break;
    for (const r of rows) out.push({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) });
    const oldest = Number(rows[rows.length - 1][0]); if (oldest >= end) break; end = oldest - 1; if (rows.length < 1000) break;
  }
  const seen = new Set<number>(); return out.filter(c => c.time + ms <= now && !seen.has(c.time) && seen.add(c.time)).sort((a, b) => a.time - b.time);
}
async function timeSeries<T>(path: string, params: Record<string, string>, limit: number, stamp: (row: T) => number, since: number, now: number, pages: number): Promise<T[]> {
  const out: T[] = []; let end = now;
  for (let i = 0; i < pages && end > since; i++) {
    const rows = await page<T>(path, { ...params, limit: String(limit), endTime: String(end) }); if (!rows.length) break; out.push(...rows);
    const oldest = Math.min(...rows.map(stamp)); if (!(oldest < end)) break; end = oldest - 1; if (rows.length < limit) break;
  }
  const seen = new Set<number>(); return out.filter(r => { const t = stamp(r); return Number.isFinite(t) && !seen.has(t) && seen.add(t); }).sort((a, b) => stamp(a) - stamp(b));
}
const RESULTS = ["UNFILLED", "INVALIDATED BEFORE ENTRY", "STOP", "TP1", "TP2", "TP3", "TP4", "TP5", "EXPIRED IN TRADE", "NO PLAN"];
const r3 = (v: number | null | undefined) => v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000;
export const REPLAY_COLUMNS = ["t", "bull", "bear", "entryL", "entryS", "exhL", "exhS", "confL", "confS", "locL", "locS", "rel", "struB", "struS", "flowB", "flowS", "htfB", "htfS", "retB", "retS", "funB", "funS", "btcB", "btcS", "sqL", "sqS", "fwd4", "fwd24",
  ...["LP", "LM", "SP", "SM"].flatMap(k => [k + "_filled", k + "_res", k + "_netR", k + "_mfe", k + "_mae", k + "_stopAtr", k + "_wR"])];

export async function replayWs2(symbol: string, days: number, stepHours: number, params: Ws2Params | undefined, now = Date.now()) {
  const since = now - days * 24 * H; const warm = since - 16 * 24 * H;
  const [h1, m15, h4, d1, btcH1, btcH4, oiRaw, accRaw, fundRaw, inst] = await Promise.all([
    klines(symbol, "60", H, warm, now), klines(symbol, "15", H / 4, since - 2 * 24 * H, now), klines(symbol, "240", 4 * H, since - 30 * 24 * H, now), klines(symbol, "D", 24 * H, since - 130 * 24 * H, now),
    symbol === "BTCUSDT" ? Promise.resolve([] as Candle[]) : klines("BTCUSDT", "60", H, warm, now), symbol === "BTCUSDT" ? Promise.resolve([] as Candle[]) : klines("BTCUSDT", "240", 4 * H, since - 30 * 24 * H, now),
    timeSeries<{ openInterest: string; timestamp: string }>("/v5/market/open-interest", { symbol, intervalTime: "1h" }, 200, r => Number(r.timestamp), warm, now, 30),
    timeSeries<{ buyRatio: string; timestamp: string }>("/v5/market/account-ratio", { symbol, period: "1h" }, 500, r => Number(r.timestamp), since - 21 * 24 * H, now, 12),
    timeSeries<{ fundingRate: string; fundingRateTimestamp: string }>("/v5/market/funding/history", { symbol }, 200, r => Number(r.fundingRateTimestamp), since - 40 * 24 * H, now, 10),
    page<{ fundingInterval?: number }>("/v5/market/instruments-info", { symbol }),
  ]);
  const oi = oiRaw.map(o => ({ t: Number(o.timestamp), coins: Number(o.openInterest) })).filter(o => o.coins > 0);
  const acc = accRaw.map(a => ({ t: Number(a.timestamp), longShare: Number(a.buyRatio) })).filter(a => a.longShare > 0);
  const fund = fundRaw.map(f => ({ t: Number(f.fundingRateTimestamp), v: Number(f.fundingRate) })).filter(f => Number.isFinite(f.v));
  const intervalHours = inst[0]?.fundingInterval ? inst[0].fundingInterval / 60 : 8;
  const meta = { symbol, days, stepHours, h1: h1.length, m15: m15.length, h4: h4.length, d1: d1.length, oi: oi.length, accounts: acc.length, funding: fund.length, firstH1: h1[0]?.time ?? null };
  const rows: Array<Array<number | null>> = [];
  if (h1.length < 120 || m15.length < 400) return { meta, columns: REPLAY_COLUMNS, rows };
  // Index pointers advance with time: "known by t" means the candle had closed (or the reading was stamped) by t.
  const upto = <T,>(arr: T[], closedBy: (x: T) => number) => { let i = 0; return (t: number) => { while (i < arr.length && closedBy(arr[i]) <= t) i++; return i; }; };
  const pH1 = upto(h1, c => c.time + H), pM = upto(m15, c => c.time + H / 4), pH4 = upto(h4, c => c.time + 4 * H), pD = upto(d1, c => c.time + 24 * H), pB1 = upto(btcH1, c => c.time + H), pB4 = upto(btcH4, c => c.time + 4 * H), pOi = upto(oi, o => o.t), pAcc = upto(acc, a => a.t), pF = upto(fund, f => f.t);
  const start = Math.ceil(Math.max(since, (h1[0].time + 60 * H)) / (stepHours * H)) * stepHours * H; const last = now - 29 * H;
  const settings = { equity: 10_000, riskPct: 0.5, leverage: 5, feePct: 0.055, slippagePct: 0.02 }; const costPct = 2 * settings.feePct + settings.slippagePct;
  for (let t = start; t <= last; t += stepHours * H) {
    const iM = pM(t); if (iM < 30) continue; const iH = pH1(t); if (iH < 60) continue;
    const iF = pF(t); const btc = btcH1.length ? { h1: btcH1.slice(Math.max(0, pB1(t) - 120), pB1(t)), h4: btcH4.slice(Math.max(0, pB4(t) - 120), pB4(t)) } : null;
    const iO = pOi(t), iA = pAcc(t);
    const input: Ws2Input = {
      coin: symbol.replace(/USDT$/, ""), symbol, at: t, price: m15[iM - 1].close,
      candles: { m15: m15.slice(Math.max(0, iM - 120), iM), h1: h1.slice(Math.max(0, iH - 320), iH), h4: h4.slice(Math.max(0, pH4(t) - 140), pH4(t)), d1: d1.slice(Math.max(0, pD(t) - 120), pD(t)) },
      btc: btc && btc.h1.length >= 55 && btc.h4.length >= 55 ? btc : null, chart: null,
      oi: iO >= 25 ? { series: oi.slice(Math.max(0, iO - 200), iO) } : null,
      funding: iF >= 1 ? { current: fund[iF - 1].v, intervalHours, history: fund.slice(Math.max(0, iF - 200), iF).map(f => f.v), at: fund[iF - 1].t } : null,
      taker: null, bybitAccounts: iA >= 1 ? { series: acc.slice(Math.max(0, iA - 500), iA) } : null, venues: {}, whales: null, liquidations: null, settings,
    };
    const r = runWs2(input, params); const c = (k: string) => r.components.find(x => x.key === k)!;
    const after = m15.slice(iM, Math.min(m15.length, iM + 29 * 4 + 2)); const px = input.price!;
    const at = (hours: number) => { const k = iM - 1 + hours * 4; return k < m15.length ? r3((m15[k].close / px - 1) * 100) : null; };
    const plan = (side: Side, lv: Levels | null): Array<number | null> => {
      if (!lv) return [0, 9, null, null, null, null, null];
      const entry: Ws2LogEntry = { id: "", at: t, version: "", coin: "", symbol, status: "WATCHING", side, price: px, scores: {}, plan: { entryLow: lv.entryLow, entryHigh: lv.entryHigh, entry: lv.entry, stop: lv.stop, targets: lv.targets.map(x => x.price) }, inputs: [], costPct };
      const o = scoreOutcome(entry, after, t + 30 * H); if (!o) return [0, 9, null, null, null, lv.stopAtr, lv.weightedR];
      return [o.filled ? 1 : 0, RESULTS.indexOf(o.result), r3(o.netR), r3(o.mfeR), r3(o.maeR), lv.stopAtr, lv.weightedR];
    };
    const loc = (v: string) => v === "GOOD" ? 0 : v === "EXTENDED" ? 1 : v === "CHASING" ? 2 : 3;
    rows.push([t, r.scores.bullishBias, r.scores.bearishBias, r.detail.LONG.entry, r.detail.SHORT.entry, r.detail.LONG.exhaustion, r.detail.SHORT.exhaustion, r.detail.LONG.confirmed ? 1 : 0, r.detail.SHORT.confirmed ? 1 : 0, loc(r.detail.LONG.located), loc(r.detail.SHORT.located), r.scores.reliability,
      ...["structure", "flow", "htf", "retail", "funding", "btc"].flatMap(k => [r3(c(k).bull), r3(c(k).bear)]), r.scores.longSqueeze, r.scores.shortSqueeze, at(4), at(24),
      ...plan("LONG", r.plans.LONG.pullback), ...plan("LONG", r.plans.LONG.market), ...plan("SHORT", r.plans.SHORT.pullback), ...plan("SHORT", r.plans.SHORT.market)]);
  }
  return { meta, columns: REPLAY_COLUMNS, rows };
}

/** Every crypto USDT perpetual on Bybit (stock and commodity contracts left out), with 24 h turnover. */
export async function replayUniverse(): Promise<Array<{ symbol: string; turnover: number }>> {
  const [tickers, instruments] = await Promise.all([page<{ symbol: string; turnover24h: string }>("/v5/market/tickers", {}), page<{ symbol: string; symbolType?: string; status?: string }>("/v5/market/instruments-info", { limit: "1000" })]);
  const skip = new Set(instruments.filter(i => ["stock", "commodity", "forex", "index", "etf"].includes((i.symbolType ?? "").toLowerCase())).map(i => i.symbol));
  return tickers.filter(t => /^[A-Z0-9]{2,24}USDT$/.test(t.symbol) && !skip.has(t.symbol)).map(t => ({ symbol: t.symbol, turnover: Number(t.turnover24h) })).sort((a, b) => b.turnover - a.turnover);
}
