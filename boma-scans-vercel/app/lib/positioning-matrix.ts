import { formatPrice } from "@/app/lib/market";
import type { ExchangeVenue } from "@/app/lib/positioning";

/**
 * Positioning matrix: who is on which side, and how the three groups line up.
 *  1. WHALES: ranked, consistently profitable Hyperliquid traders (their open book and their fresh money).
 *  2. SMART MONEY: Binance and OKX top traders (largest accounts by position share).
 *  3. BYBIT CROWD: ordinary accounts on Bybit (plus Binance / OKX all-account ratios, funding and open interest).
 * Whales and smart money are followed; the crowd is read contrarian (when it is one-sided, price tends to flush it).
 */
type Side = "LONG" | "SHORT";
export type Lean = "LONG" | "SHORT" | "SPLIT" | "NO DATA";
export type Strength = "STRONG" | "MILD" | "CROWDED" | "LEANING" | "—";
export type MatrixGroup = { key: "WHALES" | "SMART MONEY" | "BYBIT CROWD"; title: string; who: string; lean: Lean; strength: Strength; longPct: number | null; facts: string[]; plain: string };
export type MatrixInput = {
  coin: string;
  price?: number;
  whales: { bookLong: number; bookShort: number; positions: number; flow24: { longUsd: number; shortUsd: number }; flow6: { longUsd: number; shortUsd: number }; top: Array<{ label: string; tier: string; rank: number; side: Side; sizeUsd: number; entry: number; pnl: number }> } | null;
  venues: ExchangeVenue[];
  crowd: { longRatio: number; longRatioPrev: number; oiChange24h: number; fundingRate: number } | null;
};
export type PositioningMatrix = {
  coin: string; groups: MatrixGroup[]; pattern: string; meaning: string; lineUp: string;
  scores: Record<Side, number>; bestSide: Side | null; bestPlain: string;
  forSide: { side: Side; score: number; verdict: "FAVOURABLE" | "MIXED" | "UNFAVOURABLE"; advice: string } | null;
  todo: string; checklist: string[];
};

const m = (v: number) => v < 1_000 ? "$0" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + Math.round(v / 1e3) + "K";
const other = (s: Side): Side => s === "LONG" ? "SHORT" : "LONG";
const dirWord = (s: Side) => s === "LONG" ? "a rise" : "a fall";

function whalesGroup(w: MatrixInput["whales"], coin: string): MatrixGroup {
  const base = { key: "WHALES" as const, title: "🐋 WHALES", who: "ranked, consistently profitable Hyperliquid traders ($1M+ accounts)" };
  if (!w) return { ...base, lean: "NO DATA", strength: "—", longPct: null, facts: [coin + " is not traded by the tracked whales."], plain: "No whale information for this coin." };
  const book = w.bookLong + w.bookShort, flow = w.flow24.longUsd + w.flow24.shortUsd;
  const bookPct = book >= 1_000_000 ? w.bookLong / book * 100 : null;
  const flowPct = flow >= 500_000 ? w.flow24.longUsd / flow * 100 : null;
  // New money counts more, but only in proportion to its size against the book: $1M of adds cannot outweigh a $100M book.
  const flowWeight = bookPct === null ? 1 : flowPct === null ? 0 : Math.min(0.6, flow / book * 10);
  const longPct = bookPct !== null && flowPct !== null ? flowWeight * flowPct + (1 - flowWeight) * bookPct : flowPct ?? bookPct;
  const disagree = bookPct !== null && flowPct !== null && ((bookPct >= 60 && flowPct <= 40) || (bookPct <= 40 && flowPct >= 60));
  const facts = [
    book > 0 ? "Open book: " + m(w.bookShort) + " short vs " + m(w.bookLong) + " long" + (bookPct !== null ? " (" + Math.round(100 - bookPct) + "% short)" : "") + " across " + w.positions + " position" + (w.positions === 1 ? "" : "s") + "." : "No ranked whale holds " + coin + " right now.",
    "New money in 24 h: " + m(w.flow24.shortUsd) + " short vs " + m(w.flow24.longUsd) + " long · last 6 h: " + m(w.flow6.shortUsd) + " short vs " + m(w.flow6.longUsd) + " long.",
    ...w.top.slice(0, 3).map(t => "#" + t.rank + " " + t.label + " (" + t.tier.toLowerCase() + ") " + t.side + " " + m(t.sizeUsd) + " from " + formatPrice(t.entry) + ", " + (t.pnl >= 0 ? "up " : "down ") + m(Math.abs(t.pnl)) + "."),
  ];
  if (longPct === null) return { ...base, lean: "NO DATA", strength: "—", longPct: null, facts, plain: "Too little whale money on " + coin + " to read a side." };
  const lean: Lean = longPct >= 60 ? "LONG" : longPct <= 40 ? "SHORT" : "SPLIT";
  const strength: Strength = lean === "SPLIT" ? "—" : (longPct >= 70 || longPct <= 30) && !disagree ? "STRONG" : "MILD";
  const fresh = flowPct === null ? "" : flowPct >= 60 ? " Their new money is going LONG." : flowPct <= 40 ? " Their new money is going SHORT." : " Their new money is split.";
  const conflict = disagree ? " Careful: they still hold mostly " + (bookPct! >= 60 ? "LONG" : "SHORT") + " but are now adding " + (flowPct! >= 60 ? "LONG" : "SHORT") + " (" + m(flow) + " of new money against a " + m(book) + " book). They may be starting to turn; treat the side as MILD until the new money grows." : "";
  return { ...base, lean, strength, longPct, facts, plain: (lean === "SPLIT" ? "The best traders are split on " + coin + "." : "The best traders are betting on " + dirWord(lean) + " (" + strength.toLowerCase() + ").") + fresh + conflict };
}

function smartGroup(venues: ExchangeVenue[]): MatrixGroup {
  const base = { key: "SMART MONEY" as const, title: "🏦 SMART MONEY", who: "Binance and OKX top traders (the largest accounts)" };
  const tops = venues.filter(v => v.kind === "top traders");
  if (!tops.length) return { ...base, lean: "NO DATA", strength: "—", longPct: null, facts: ["Binance / OKX do not publish top-trader data for this pair."], plain: "No smart-money data for this pair." };
  const longPct = tops.reduce((a, v) => a + v.longShare, 0) / tops.length * 100;
  const lean: Lean = longPct >= 57 ? "LONG" : longPct <= 43 ? "SHORT" : "SPLIT";
  const strength: Strength = lean === "SPLIT" ? "—" : (longPct >= 65 || longPct <= 35) ? "STRONG" : "MILD";
  const spread = tops.length >= 2 ? Math.abs(tops[0].longShare - tops[1].longShare) * 100 : 0;
  return { ...base, lean, strength, longPct, facts: [...tops.map(v => v.name + ": " + Math.round(v.longShare * 100) + "% long, " + Math.round(100 - v.longShare * 100) + "% short (by " + v.basis + ")."), ...(spread >= 15 ? ["The two exchanges disagree by " + Math.round(spread) + " points, so this read is weaker."] : [])], plain: lean === "SPLIT" ? "The big exchange traders have no clear side." : "The big exchange traders lean " + lean + " (" + strength.toLowerCase() + ")." };
}

function crowdGroup(crowd: MatrixInput["crowd"], venues: ExchangeVenue[]): MatrixGroup {
  const base = { key: "BYBIT CROWD" as const, title: "👥 BYBIT CROWD", who: "ordinary traders' accounts (read the opposite way)" };
  const retail = venues.filter(v => v.kind === "all accounts");
  const longRatio = crowd?.longRatio ?? (retail.length ? retail.reduce((a, v) => a + v.longShare, 0) / retail.length : null);
  if (longRatio === null) return { ...base, lean: "NO DATA", strength: "—", longPct: null, facts: ["No crowd data for this pair."], plain: "No crowd data." };
  const longPct = longRatio * 100;
  const facts = [
    ...(crowd ? ["Bybit: " + Math.round(longPct) + "% of accounts long (" + (crowd.longRatio > crowd.longRatioPrev + 0.02 ? "up" : crowd.longRatio < crowd.longRatioPrev - 0.02 ? "down" : "about the same") + " from " + Math.round(crowd.longRatioPrev * 100) + "% 24 h ago)."] : []),
    ...retail.map(v => v.name + " accounts: " + Math.round(v.longShare * 100) + "% long."),
    ...(crowd ? ["Funding " + (crowd.fundingRate * 100).toFixed(4) + "%: " + (crowd.fundingRate > 0.0001 ? "longs pay shorts (longs are the eager side)." : crowd.fundingRate < -0.0001 ? "shorts pay longs (shorts are the eager side)." : "nobody is paying much; leverage is balanced.")] : []),
    ...(crowd && Math.abs(crowd.oiChange24h) >= 0.03 ? ["Open interest " + (crowd.oiChange24h > 0 ? "+" : "") + Math.round(crowd.oiChange24h * 100) + "% in 24 h: " + (crowd.oiChange24h > 0 ? "new positions are piling in, so a flush can be sharp." : "positions are closing; moves may fade.")] : []),
  ];
  const lean: Lean = longPct >= 60 ? "LONG" : longPct <= 40 ? "SHORT" : "SPLIT";
  const strength: Strength = lean === "SPLIT" ? "—" : (longPct >= 70 || longPct <= 30) ? "CROWDED" : "LEANING";
  return { ...base, lean, strength, longPct, facts, plain: lean === "SPLIT" ? "Ordinary traders are balanced; no squeeze fuel either way." : Math.round(lean === "LONG" ? longPct : 100 - longPct) + "% of ordinary traders bet on " + dirWord(lean) + ". " + (strength === "CROWDED" ? "That is very one-sided: price often moves against them to flush them out, which favours " + other(lean) + "." : "Mildly one-sided; small squeeze fuel for " + other(lean) + ".") };
}

function score(side: Side, w: MatrixGroup, s: MatrixGroup, c: MatrixGroup, funding: number | null): number {
  let x = 0;
  if (w.lean === side) x += w.strength === "STRONG" ? 3 : 2; else if (w.lean === other(side)) x -= w.strength === "STRONG" ? 3 : 2;
  if (s.lean === side) x += s.strength === "STRONG" ? 2 : 1; else if (s.lean === other(side)) x -= s.strength === "STRONG" ? 2 : 1;
  if (c.lean === other(side)) x += c.strength === "CROWDED" ? 2 : 1; else if (c.lean === side) x -= c.strength === "CROWDED" ? 2 : 1;
  if (funding !== null) { const pays = side === "LONG" ? funding >= 0.0003 : funding <= -0.0003; const paid = side === "LONG" ? funding <= -0.0001 : funding >= 0.0001; if (pays) x -= 1; else if (paid) x += 0.5; }
  return Math.max(0, Math.min(100, Math.round(50 + 50 * x / 7.5)));
}

function pattern(w: MatrixGroup, s: MatrixGroup, c: MatrixGroup): { pattern: string; meaning: string } {
  const dir = (g: MatrixGroup) => g.lean === "LONG" || g.lean === "SHORT" ? g.lean : null;
  const W = dir(w), S = dir(s), C = dir(c);
  if (W && S && W === S && C && C !== W) return { pattern: "STRONG HANDS vs CROWD (best setup)", meaning: "Whales and smart money are both " + W + " while ordinary traders are " + C + ". This is the setup that pays most often: the strong hands are on one side and the crowd's stop-losses sit on the other, ready to fuel the move." };
  if (W && S && W === S && C === W) return { pattern: "EVERYONE ON ONE SIDE (crowded)", meaning: "Whales, smart money and the crowd are all " + W + ". The direction is probably right, but the trade is crowded and late: when everyone is already in, sharp shakeouts against " + W + " are common. Use half size, take profit early and never move the stop further away." };
  if (W && S && W === S) return { pattern: "STRONG HANDS ALIGNED", meaning: "Whales and smart money agree on " + W + "; the crowd is balanced. Good, but with less squeeze fuel than when the crowd is on the other side." };
  if (W && S && W !== S) return { pattern: "WHALES vs SMART MONEY (conflict)", meaning: "The two strong-hand groups disagree: whales are " + W + ", exchange top traders are " + S + ". Whales are weighted more because their record is tracked, but conflicts like this often chop both ways. Small size at most, or wait for one side to give in." };
  if (W && C && C !== W) return { pattern: "WHALES vs CROWD", meaning: "Whales are " + W + " and the crowd is " + C + "; smart money has no clear side. A good contrarian setup led by the whales." };
  if (W && C === W) return { pattern: "WHALES WITH THE CROWD", meaning: "Whales and ordinary traders are both " + W + " and smart money is undecided. Follow the whales, but expect shakeouts because the crowd is on the same side." };
  if (W) return { pattern: "WHALES LEAD", meaning: "Only the whales have a clear side (" + W + "). Smart money and the crowd are undecided. Follow with normal caution." };
  if (S && C && C !== S) return { pattern: "SMART MONEY vs CROWD", meaning: "Exchange top traders are " + S + " against a " + C + " crowd, and the whales have no clear side. A moderate setup." };
  if (S) return { pattern: "SMART MONEY LEADS", meaning: "Only exchange top traders have a clear side (" + S + "); whales are undecided. A weak read on its own." };
  if (C && c.strength === "CROWDED") return { pattern: "ONLY THE CROWD IS ONE-SIDED", meaning: "No strong hands have a side, but ordinary traders are crowded " + C + ". Fading them works only with a clear chart signal; on its own this is not a trade." };
  return { pattern: "NO EDGE", meaning: "Nobody important has a clear side. Positioning gives no help here; trade only on the chart, with small size." };
}

export function positioningMatrix(input: MatrixInput, side?: Side): PositioningMatrix {
  const w = whalesGroup(input.whales, input.coin), s = smartGroup(input.venues), c = crowdGroup(input.crowd, input.venues);
  const funding = input.crowd?.fundingRate ?? null;
  const scores = { LONG: score("LONG", w, s, c, funding), SHORT: score("SHORT", w, s, c, funding) };
  const top: Side = scores.LONG >= scores.SHORT ? "LONG" : "SHORT";
  const bestSide = scores[top] >= 62 ? top : null;
  const p = pattern(w, s, c);
  const lineUp = "Whales " + w.lean + (w.strength !== "—" ? " (" + w.strength.toLowerCase() + ")" : "") + " · Smart money " + s.lean + (s.strength !== "—" ? " (" + s.strength.toLowerCase() + ")" : "") + " · Crowd " + c.lean + (c.strength !== "—" ? " (" + c.strength.toLowerCase() + ")" : "");
  const bestPlain = bestSide ? "Positioning favours " + bestSide + " on " + input.coin + " (" + scores[bestSide] + "/100)." : "Positioning does not favour either side clearly (LONG " + scores.LONG + " · SHORT " + scores.SHORT + " out of 100).";
  let forSide: PositioningMatrix["forSide"] = null;
  if (side) {
    const sc = scores[side];
    const verdict = sc >= 65 ? "FAVOURABLE" : sc <= 40 ? "UNFAVOURABLE" : "MIXED";
    forSide = { side, score: sc, verdict, advice: verdict === "FAVOURABLE" ? "Your " + side + " has the big money behind it. Normal size is fine if the chart entry is valid." : verdict === "MIXED" ? "Your " + side + " has only partial backing. Use half size, take the first profit early and keep the stop where it is." : "The big money is on the other side of your " + side + ". Skip it, or wait until the whales and smart money turn." };
  }
  const todo = forSide ? forSide.advice : bestSide ? "If the chart gives an entry, prefer " + bestSide + " trades on " + input.coin + ". Avoid " + other(bestSide) + " trades here." : "Do not use positioning as a reason to trade " + input.coin + " right now. Wait for whales or smart money to pick a side.";
  const checklist = [
    (w.lean === "LONG" || w.lean === "SHORT" ? "✔" : "✖") + " Whales have a side",
    (s.lean !== "NO DATA" && s.lean !== "SPLIT" && s.lean === w.lean ? "✔" : "✖") + " Smart money agrees with whales",
    (c.lean !== "SPLIT" && c.lean !== "NO DATA" && (w.lean === "LONG" || w.lean === "SHORT") && c.lean !== w.lean ? "✔" : "✖") + " Crowd is on the other side (squeeze fuel)",
    (funding === null || !(w.lean === "LONG" ? funding >= 0.0003 : w.lean === "SHORT" ? funding <= -0.0003 : false) ? "✔" : "✖") + " Funding does not punish the whales' side",
  ];
  return { coin: input.coin, groups: [w, s, c], pattern: p.pattern, meaning: p.meaning, lineUp, scores, bestSide, bestPlain, forSide, todo, checklist };
}

/** Telegram lines: heavy, detailed, plain-English positioning section. */
export function matrixLines(x: PositioningMatrix): string[] {
  return [
    "🧭 POSITIONING · " + x.coin + " · WHALES vs SMART MONEY vs BYBIT CROWD",
    "━━━━━━━━━━━━━━",
    ...x.groups.flatMap(g => ["", g.title + ": " + g.lean + (g.strength !== "—" ? " · " + g.strength : "") + (g.longPct !== null ? " · " + Math.round(g.longPct) + "% long" : ""), "   (" + g.who + ")", ...g.facts.map(f => "   • " + f), "   💬 " + g.plain]),
    "",
    "━━━━━━━━━━━━━━",
    "🔗 HOW THEY LINE UP: " + x.lineUp,
    "📐 Pattern: " + x.pattern,
    "💬 " + x.meaning,
    "",
    "📊 Positioning score: LONG " + x.scores.LONG + "/100 · SHORT " + x.scores.SHORT + "/100",
    "🎯 " + x.bestPlain,
    ...(x.forSide ? ["📌 For your " + x.forSide.side + ": " + x.forSide.verdict + " (" + x.forSide.score + "/100)"] : []),
    "",
    "Checklist:",
    ...x.checklist.map(c => "   " + c),
    "",
    "✅ POSITIONING ADVICE: " + x.todo,
  ];
}
