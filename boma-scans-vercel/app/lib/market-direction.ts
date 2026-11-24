import { trendRead, type Candle } from "@/app/lib/ws2/engine";

/**
 * Overall market direction, its comparison with Bitcoin, and which one rules.
 * "Market" = the most-traded crypto perpetuals on Bybit other than BTC (stock and commodity contracts are left out).
 */
export type Dir = "UP" | "DOWN" | "FLAT";
export type Window = { label: "1 h" | "4 h" | "24 h"; btcPct: number; marketPct: number; breadthUp: number; withBtc: number; btcDir: Dir; marketDir: Dir };
export type MarketDirection = {
  at: number; coins: number;
  overall: "BULLISH" | "BEARISH" | "MIXED"; overallPlain: string;
  btc: { trend: "BULLISH" | "BEARISH" | "MIXED"; price: number; note: string };
  market: { trend: "BULLISH" | "BEARISH" | "MIXED"; note: string };
  windows: Window[];
  correlation: number;
  ruler: "BTC RULES" | "ALTS RULE" | "SHARED"; rulerPlain: string;
  strength: "ALTS STRONGER" | "BTC STRONGER" | "EVEN"; strengthPlain: string;
  advice: string;
  leaders: Array<{ coin: string; pct24: number; vsBtc: number }>; laggards: Array<{ coin: string; pct24: number; vsBtc: number }>;
};
const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const change = (c: Candle[], bars: number) => c.length > bars ? (c[c.length - 1].close / c[c.length - 1 - bars].close - 1) * 100 : 0;
const dir = (pct: number, flat: number): Dir => pct > flat ? "UP" : pct < -flat ? "DOWN" : "FLAT";
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length); if (n < 12) return null;
  const x = a.slice(-n), y = b.slice(-n); const mx = x.reduce((p, c) => p + c, 0) / n, my = y.reduce((p, c) => p + c, 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
const returns = (c: Candle[], n = 48) => c.slice(-n - 1).map((x, i, a) => i ? x.close / a[i - 1].close - 1 : 0).slice(1);

/** `btc` and each alt: closed 1h candles, oldest first. `btc4h`: closed 4h candles for the trend. */
export function marketDirection(btc: Candle[], btc4h: Candle[], alts: Array<{ coin: string; h1: Candle[] }>, now: number): MarketDirection | null {
  const usable = alts.filter(a => a.h1.length >= 30); if (btc.length < 30 || usable.length < 5) return null;
  const windows: Window[] = ([["1 h", 1, 0.15], ["4 h", 4, 0.3], ["24 h", 24, 0.75]] as const).map(([label, bars, flat]) => {
    const b = change(btc, bars); const each = usable.map(a => change(a.h1, bars)); const m = median(each); const bd = dir(b, flat);
    return { label, btcPct: b, marketPct: m, breadthUp: each.filter(v => v > 0).length / each.length, withBtc: bd === "FLAT" ? 0.5 : each.filter(v => (bd === "UP" ? v > 0 : v < 0)).length / each.length, btcDir: bd, marketDir: dir(m, flat) };
  });
  const br = returns(btc); const corrs = usable.map(a => correlation(returns(a.h1), br)).filter((v): v is number => v !== null); const corr = corrs.length ? corrs.reduce((p, c) => p + c, 0) / corrs.length : 0;
  const t1 = trendRead(btc), t4 = trendRead(btc4h); const bull = (t1?.bull ?? 0) * 0.4 + (t4?.bull ?? 0) * 0.6, bear = (t1?.bear ?? 0) * 0.4 + (t4?.bear ?? 0) * 0.6;
  const btcTrend = bull - bear >= 0.25 ? "BULLISH" : bear - bull >= 0.25 ? "BEARISH" : "MIXED";
  const w4 = windows[1], w24 = windows[2];
  const marketTrend = w24.breadthUp >= 0.6 && w4.marketPct > 0 ? "BULLISH" : w24.breadthUp <= 0.4 && w4.marketPct < 0 ? "BEARISH" : w24.breadthUp >= 0.7 ? "BULLISH" : w24.breadthUp <= 0.3 ? "BEARISH" : "MIXED";
  const overall = btcTrend === marketTrend ? btcTrend : btcTrend === "MIXED" ? marketTrend : marketTrend === "MIXED" ? btcTrend : "MIXED";
  const btcQuiet = Math.abs(w4.btcPct) < 0.3 && Math.abs(w24.btcPct) < 1; const altsMoving = Math.abs(w4.marketPct) >= 1 || Math.abs(w24.marketPct) >= 2.5;
  const ruler: MarketDirection["ruler"] = corr >= 0.65 && (w4.withBtc >= 0.7 || w24.withBtc >= 0.7) && !btcQuiet ? "BTC RULES" : corr < 0.45 || (btcQuiet && altsMoving) ? "ALTS RULE" : "SHARED";
  const gap = w24.marketPct - w24.btcPct; const strength: MarketDirection["strength"] = gap >= 1 ? "ALTS STRONGER" : gap <= -1 ? "BTC STRONGER" : "EVEN";
  const pctS = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  const rulerPlain = ruler === "BTC RULES" ? "Bitcoin is leading. " + Math.round(Math.max(w4.withBtc, w24.withBtc) * 100) + "% of coins are moving the same way as BTC, and they track it closely (link " + corr.toFixed(2) + " out of 1). Watch BTC first; most coins will follow it." : ruler === "ALTS RULE" ? "Coins are moving on their own. The link to Bitcoin is weak (" + corr.toFixed(2) + " out of 1)" + (btcQuiet ? " and BTC is quiet" : "") + ". Judge each coin by its own chart; BTC tells you little right now." : "Neither fully leads. Coins partly follow Bitcoin (link " + corr.toFixed(2) + " out of 1) and partly move on their own. Check both BTC and the coin's own chart.";
  const strengthPlain = strength === "ALTS STRONGER" ? "Over 24 h the typical coin did " + pctS(w24.marketPct) + " against BTC " + pctS(w24.btcPct) + ": coins are stronger than Bitcoin (money is taking more risk)." : strength === "BTC STRONGER" ? "Over 24 h the typical coin did " + pctS(w24.marketPct) + " against BTC " + pctS(w24.btcPct) + ": Bitcoin is stronger and coins are weaker (money is playing safe)." : "Over 24 h the typical coin (" + pctS(w24.marketPct) + ") and BTC (" + pctS(w24.btcPct) + ") moved about the same.";
  const overallPlain = overall === "BULLISH" ? "The market is going UP: Bitcoin's trend is up and " + Math.round(w24.breadthUp * 100) + "% of coins are higher than a day ago." : overall === "BEARISH" ? "The market is going DOWN: Bitcoin's trend is down and only " + Math.round(w24.breadthUp * 100) + "% of coins are higher than a day ago." : "The market is MIXED: Bitcoin's trend is " + btcTrend.toLowerCase() + " while the coins are " + marketTrend.toLowerCase() + " (" + Math.round(w24.breadthUp * 100) + "% higher than a day ago).";
  const advice = overall === "BULLISH" ? (ruler === "BTC RULES" ? "Favour LONG setups, and only while BTC holds up. If BTC turns down, expect most longs to fail together." : ruler === "ALTS RULE" ? "Favour LONG setups on coins that are strong on their own chart. BTC is not the driver, so pick coin by coin." : "Favour LONG setups; check BTC is not falling before you enter.") + (strength === "BTC STRONGER" ? " Coins are lagging BTC, so use smaller size on alt longs." : "")
    : overall === "BEARISH" ? (ruler === "BTC RULES" ? "Favour SHORT setups or stay out. Longs on coins are fighting Bitcoin's fall and usually lose." : ruler === "ALTS RULE" ? "Favour SHORT setups on coins that are weak on their own chart. BTC is not the driver, so pick coin by coin." : "Favour SHORT setups or wait; check BTC is not bouncing before you enter.") + (strength === "ALTS STRONGER" ? " Coins are holding up better than BTC, so shorts may be slow." : "")
    : "No clear tide. Take only the cleanest setups with smaller size, or wait until Bitcoin and the coins agree.";
  const ranked = usable.map(a => { const p = change(a.h1, 24); return { coin: a.coin, pct24: p, vsBtc: p - w24.btcPct }; }).sort((a, b) => b.vsBtc - a.vsBtc);
  return { at: now, coins: usable.length, overall, overallPlain, btc: { trend: btcTrend, price: btc[btc.length - 1].close, note: "1h: " + (t1?.note ?? "n/a") + ". 4h: " + (t4?.note ?? "n/a") + "." }, market: { trend: marketTrend, note: Math.round(w24.breadthUp * 100) + "% of " + usable.length + " coins are up over 24 h; the typical coin is " + pctS(w4.marketPct) + " over 4 h." }, windows, correlation: corr, ruler, rulerPlain, strength, strengthPlain, advice, leaders: ranked.slice(0, 3), laggards: ranked.slice(-3).reverse() };
}

export function marketDirectionLines(m: MarketDirection): string[] {
  const arrow = (d: string) => d === "BULLISH" || d === "UP" ? "🟢⬆" : d === "BEARISH" || d === "DOWN" ? "🔴⬇" : "⚪➡"; const p = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  return ["🌍 MARKET DIRECTION · " + arrow(m.overall) + " " + m.overall, m.overallPlain, "", "₿ Bitcoin: " + arrow(m.btc.trend) + " " + m.btc.trend + " · 🪙 Coins (" + m.coins + "): " + arrow(m.market.trend) + " " + m.market.trend,
    ...m.windows.map(w => "• " + w.label + ": BTC " + p(w.btcPct) + " · coins " + p(w.marketPct) + " · " + Math.round(w.breadthUp * 100) + "% of coins up"),
    "", "👑 WHO RULES: " + m.ruler, m.rulerPlain, "", "💪 " + m.strength + ": " + m.strengthPlain,
    "", "🏆 Strongest vs BTC: " + m.leaders.map(l => l.coin + " " + p(l.pct24)).join(", "), "🐢 Weakest vs BTC: " + m.laggards.map(l => l.coin + " " + p(l.pct24)).join(", "), "", "✅ WHAT TO DO: " + m.advice];
}
