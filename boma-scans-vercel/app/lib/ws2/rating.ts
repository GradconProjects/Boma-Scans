import type { Levels, Side, Ws2Result } from "@/app/lib/ws2/engine";

/**
 * Calibrated rating for Whale System 2.
 * A logistic model fitted on the oldest 60% of a multi-year replay of every Bybit crypto perpetual, then checked on the
 * newer 40% it never saw. It rates a setup 1 (worst) to 10 (best) and reports what setups with that rating actually did
 * in the unseen period: how often they finished in profit and the average result in R after fees and slippage.
 */
export type DecileRow = { decile: number; train: Cell; check: Cell; val: Cell; test: Cell };
type Cell = { n: number; won: number; avgNetR: number; se: number };
export type Ws2Model = { intercept: number; coef: number[]; decileCuts: number[]; auc: Record<string, number>; deciles: DecileRow[] };
export type Ws2Calibration = { version: string; samples: number; pairs: number; from: string; to: string; stepHours: number; features: string[]; models: { market: Ws2Model; pullback: Ws2Model }; rules: Record<string, Record<string, { n: number; won?: number; avgNetR?: number; se?: number; longShare?: number }>>; blocks?: Array<{ from: string; to: string; n: number; pairs: number; typicalCoin24hPct: number; timesMarketRose: number; unseen: boolean; biasVs24h: number; ratingRank: number; rules: Record<string, { n: number; won?: number; avgNetR?: number; se?: number }> }>; directionAuc: Record<string, Record<string, number>>; componentAuc24h: Record<string, Record<string, number>>; regime: Record<string, { from: string; to: string; n: number; typicalCoin24hPct: number; timesMarketRose: number }>; pairStats: Record<string, [number, number, number | null, number | null]> };
export type Rating = { p: number; rating: number; won: number; avgNetR: number; se: number; n: number };
export type Ws2Rated = Ws2Result & {
  calibration: { ratings: Record<Side, { market: Rating | null; pullback: Rating | null }>; lead: Rating | null; leadPlain: string; pair: { samples: number; ratedSetups: number; won: number | null; avgNetR: number | null } | null; blocked: boolean; summary: string };
};
const KEYS = ["structure", "flow", "htf", "retail", "funding", "btc"];
/** The same 20 features the model was fitted on, seen from one side. */
export function ratingFeatures(r: Ws2Result, side: Side, plan: Levels | null): number[] {
  const own = side === "LONG" ? "bull" : "bear", opp = side === "LONG" ? "bear" : "bull"; const comp = (k: string) => r.components.find(c => c.key === k);
  const d = r.detail[side];
  return [...KEYS.map(k => comp(k)?.[own] ?? 0), ...KEYS.map(k => comp(k)?.[opp] ?? 0), d.entry / 100, d.exhaustion / 100, d.confirmed ? 1 : 0, d.located === "EXTENDED" ? 1 : 0, d.located === "CHASING" ? 1 : 0, (plan?.stopAtr ?? 2) / 3, (plan?.weightedR ?? 2) / 4, (side === "LONG" ? r.scores.shortSqueeze : r.scores.longSqueeze) / 100];
}
export function rate(model: Ws2Model, features: number[]): Rating {
  const z = model.intercept + features.reduce((a, v, i) => a + v * (model.coef[i] ?? 0), 0); const p = 1 / (1 + Math.exp(-z));
  const rating = model.decileCuts.filter(c => p >= c).length + 1; const row = model.deciles[rating - 1].check;
  return { p: Number(p.toFixed(3)), rating, won: row.won, avgNetR: row.avgNetR, se: row.se, n: row.n };
}
const sign = (v: number) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
/** "3-year" / "180-day": the length of the calibration history, for wording. */
export const spanWords = (cal: { from: string; to: string }) => { const days = Math.round((Date.parse(cal.to) - Date.parse(cal.from)) / 86_400_000); return days >= 540 ? (days / 365).toFixed(days % 365 < 40 || days % 365 > 325 ? 0 : 1) + "-year" : days + "-day"; };

/** Adds the calibrated rating, the pair's own record and the one validated rule: setups rated 1–2 are blocked. */
export function applyCalibration(r: Ws2Result, cal: Ws2Calibration): Ws2Rated {
  const ratings = { LONG: { market: null, pullback: null }, SHORT: { market: null, pullback: null } } as Ws2Rated["calibration"]["ratings"];
  if (r.status !== "DATA UNAVAILABLE") for (const side of ["LONG", "SHORT"] as const) {
    if (r.plans[side].market) ratings[side].market = rate(cal.models.market, ratingFeatures(r, side, r.plans[side].market));
    if (r.plans[side].pullback) ratings[side].pullback = rate(cal.models.pullback, ratingFeatures(r, side, r.plans[side].pullback));
  }
  const lead = r.side ? (r.status === "ENTRY READY" ? ratings[r.side].market : ratings[r.side].pullback) ?? ratings[r.side].market : null;
  const ps = cal.pairStats[r.symbol]; const pair = ps ? { samples: ps[0], ratedSetups: ps[1], won: ps[2], avgNetR: ps[3] } : null;
  const blocked = !!lead && lead.rating <= 2 && r.status !== "DATA UNAVAILABLE";
  const leadPlain = lead && r.side ? "Rating " + lead.rating + "/10 for this " + r.side + ". In the newest 40% of the " + spanWords(cal) + " test, which the model never saw, " + lead.n.toLocaleString("en-AU") + " setups with this rating finished in profit " + Math.round(lead.won * 100) + "% of the time and averaged " + sign(lead.avgNetR) + "R after fees (±" + lead.se.toFixed(2) + ")." : "No side leads, so there is no setup to rate.";
  const summary = "CALIBRATED on " + cal.samples.toLocaleString("en-AU") + " replayed readings from " + cal.pairs + " Bybit crypto pairs, " + cal.from + " to " + cal.to + ". What the test showed: the rating reliably separates bad setups from better ones, but no group of setups made money after fees. Use this system to avoid bad trades; it has not shown a profit edge.";
  const out: Ws2Rated = { ...r, version: cal.version, scoreNote: summary, calibration: { ratings, lead, leadPlain, pair, blocked, summary } };
  if (blocked && lead && r.side) {
    out.status = "NO TRADE";
    out.headline = "No trade on " + r.coin + ". The bias is " + r.side + ", but setups like this one are rated " + lead.rating + "/10: in the test they finished in profit only " + Math.round(lead.won * 100) + "% of the time and lost " + Math.abs(lead.avgNetR).toFixed(2) + "R on average. Stand aside.";
    out.sizing = "NOT AUTHORISED. Setups with this rating lost money in the calibration test.";
    out.scores = { ...r.scores, opportunity: 0 };
    out.activate = ["A rating of 3/10 or better. That needs a fairer entry area or a wider, structural stop."]; 
  } else if (lead && r.side && r.status === "ENTRY READY") {
    out.headline = r.headline + " Rating " + lead.rating + "/10: similar setups averaged " + sign(lead.avgNetR) + "R after fees in the test, so this is a fair entry, not a proven edge.";
  }
  out.explain = [...r.explain, { q: "What is this setup's track record?", a: leadPlain + (pair && pair.ratedSetups >= 20 && pair.avgNetR !== null ? " On " + r.symbol + " itself, " + pair.ratedSetups + " well-rated setups (8–10) over the whole test averaged " + sign(pair.avgNetR) + "R and " + Math.round((pair.won ?? 0) * 100) + "% finished in profit (a small sample, partly from the fitting period)." : "") }];
  return out;
}

export function ratingLines(r: Ws2Rated): string[] {
  const c = r.calibration; if (!c.lead || !r.side) return ["🎓 Calibrated: no side leads, nothing to rate."];
  return ["🎓 CALIBRATED RATING: " + c.lead.rating + "/10" + (c.blocked ? " · BLOCKED" : ""), c.leadPlain, ...(c.pair && c.pair.ratedSetups >= 20 && c.pair.avgNetR !== null ? ["📒 This pair: " + c.pair.ratedSetups + " well-rated setups in the test averaged " + sign(c.pair.avgNetR) + "R."] : [])];
}
