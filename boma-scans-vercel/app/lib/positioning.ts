import { formatPrice } from "@/app/lib/market";

/** One open perpetual position held by a top Hyperliquid trader. */
export type WhalePosition = {
  trader: string; coin: string; side: "LONG" | "SHORT"; sizeUsd: number; entry: number; leverage: number;
  liquidation: number | null; pnl: number; accountValue: number;
};

export type Positioning = {
  symbol: string; coin: string | null; at: number;
  whales: { longUsd: number; shortUsd: number; traders: number; positions: WhalePosition[] };
  hyperliquid: { funding: number; openInterestUsd: number; markPx: number } | null;
  crowd: { longRatio: number; longRatioPrev: number; oiChange24h: number; fundingRate: number } | null;
};

export type PositioningVerdict = { level: "SUPPORTS" | "NEUTRAL" | "AGAINST"; headline: string; notes: string[] };

/** Bybit symbol → Hyperliquid coin name (1000PEPE → kPEPE). */
export function hyperliquidCoin(symbol: string, universe: Set<string>): string | null {
  const base = symbol.replace(/USDT$/, "");
  const candidates = [base, base.startsWith("1000") ? "k" + base.slice(4) : "", base.startsWith("10000") ? "k" + base.slice(5) : ""].filter(Boolean);
  return candidates.find(name => universe.has(name)) ?? null;
}

const usd = (value: number) => value >= 1e9 ? (value / 1e9).toFixed(2) + "B" : value >= 1e6 ? (value / 1e6).toFixed(1) + "M" : value >= 1e3 ? (value / 1e3).toFixed(0) + "K" : value.toFixed(0);
export const formatUsd = (value: number) => "$" + usd(value);

/**
 * Decides how the live positioning relates to a plan: whale notional on the
 * same side supports it, whales against it means half size or wait, a crowded
 * retail side is contrarian fuel for the other side, and whale liquidation
 * prices just beyond the stop mean the stop sits in a liquidation pocket.
 */
export function judgePositioning(data: Positioning, side: "LONG" | "SHORT", price: number, stop?: number): PositioningVerdict {
  const notes: string[] = [];
  let score = 0;
  const { longUsd, shortUsd, traders } = data.whales;
  const total = longUsd + shortUsd;
  if (total > 0 && traders >= 3) {
    const sameSide = side === "LONG" ? longUsd / total : shortUsd / total;
    if (sameSide >= 0.6) { score += 2; notes.push("🐋 Whales agree: " + Math.round(sameSide * 100) + "% of " + formatUsd(total) + " top-trader notional is " + side + " (" + traders + " traders)."); }
    else if (sameSide <= 0.4) { score -= 2; notes.push("🐋 Whales against: " + Math.round((1 - sameSide) * 100) + "% of " + formatUsd(total) + " top-trader notional is " + (side === "LONG" ? "SHORT" : "LONG") + " (" + traders + " traders). Half size or wait for confirmation."); }
    else notes.push("🐋 Whales split: " + Math.round(sameSide * 100) + "% " + side + " of " + formatUsd(total) + " (" + traders + " traders).");
  } else if (data.coin) notes.push("🐋 Too few top-trader positions on " + data.coin + " to judge.");
  else notes.push("🐋 Not listed on Hyperliquid; whale data unavailable for this pair.");
  if (data.crowd) {
    const { longRatio, longRatioPrev, oiChange24h, fundingRate } = data.crowd;
    const crowdLong = Math.round(longRatio * 100);
    const crowdedSameSide = side === "LONG" ? longRatio >= 0.65 : longRatio <= 0.35;
    const crowdedOtherSide = side === "LONG" ? longRatio <= 0.4 : longRatio >= 0.6;
    if (crowdedSameSide) { score -= 1; notes.push("👥 Bybit crowd " + crowdLong + "% long: your side is crowded, squeezes go against you; keep the stop tight."); }
    else if (crowdedOtherSide) { score += 1; notes.push("👥 Bybit crowd " + crowdLong + "% long: the other side is crowded, a " + (side === "LONG" ? "short" : "long") + " squeeze would fuel your trade."); }
    else notes.push("👥 Bybit crowd " + crowdLong + "% long (" + (longRatio > longRatioPrev + 0.02 ? "rising" : longRatio < longRatioPrev - 0.02 ? "falling" : "steady") + " over 24 h).");
    const oi = Math.round(oiChange24h * 100);
    if (Math.abs(oi) >= 5) notes.push("📊 Open interest " + (oi > 0 ? "+" : "") + oi + "% in 24 h: " + (oi > 0 ? "new money is entering; moves can extend." : "positions are closing; expect a weaker follow-through."));
    const fundingPct = fundingRate * 100;
    if ((side === "LONG" && fundingPct >= 0.03) || (side === "SHORT" && fundingPct <= -0.03)) { score -= 1; notes.push("💸 Funding " + fundingPct.toFixed(3) + "%: you pay to hold this side; leveraged " + side.toLowerCase() + "s are crowded."); }
    else if ((side === "LONG" && fundingPct <= -0.01) || (side === "SHORT" && fundingPct >= 0.01)) { score += 1; notes.push("💸 Funding " + fundingPct.toFixed(3) + "%: you are paid to hold this side."); }
  }
  if (stop && price > 0) {
    const beyond = data.whales.positions.filter(p => p.liquidation && p.coin === data.coin && (side === "LONG" ? p.side === "LONG" && p.liquidation < price && p.liquidation >= stop * 0.97 : p.side === "SHORT" && p.liquidation > price && p.liquidation <= stop * 1.03));
    if (beyond.length) { const sum = beyond.reduce((acc, p) => acc + p.sizeUsd, 0); notes.push("⚠️ " + formatUsd(sum) + " of whale " + side.toLowerCase() + "s liquidate within 3% of your stop (" + formatPrice(stop) + "); a wick through them is likely, so do not widen the stop into that pocket."); }
  }
  const level: PositioningVerdict["level"] = score >= 2 ? "SUPPORTS" : score <= -2 ? "AGAINST" : "NEUTRAL";
  const headline = level === "SUPPORTS" ? "Positioning supports the " + side : level === "AGAINST" ? "Positioning is against the " + side + ": half size or wait" : "Positioning neutral: trade the plan as written";
  return { level, headline, notes };
}
