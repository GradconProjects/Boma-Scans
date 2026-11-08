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
  /** Long share (0–1) of positions / accounts on other venues; absent when the venue has no data for the pair. */
  venues?: ExchangeVenue[];
};
export type ExchangeVenue = { name: string; kind: "top traders" | "all accounts"; longShare: number; basis: "positions" | "accounts" };

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
  // Top-trader consensus across venues (Hyperliquid whales by notional, Binance / OKX top traders by position share).
  const topShares: Array<{ name: string; share: number }> = [];
  if (total > 0 && traders >= 3) topShares.push({ name: "Hyperliquid whales", share: longUsd / total });
  for (const venue of data.venues ?? []) if (venue.kind === "top traders") topShares.push({ name: venue.name, share: venue.longShare });
  if (topShares.length >= 2) {
    const mean = topShares.reduce((acc, v) => acc + v.share, 0) / topShares.length;
    const sameSide = side === "LONG" ? mean : 1 - mean;
    const detail = topShares.map(v => v.name + " " + Math.round(v.share * 100) + "% long").join(" · ");
    if (sameSide >= 0.58) { score += 1; notes.push("🏦 Top traders across venues lean " + side + " (" + Math.round(sameSide * 100) + "%): " + detail + "."); }
    else if (sameSide <= 0.42) { score -= 1; notes.push("🏦 Top traders across venues lean " + (side === "LONG" ? "SHORT" : "LONG") + " (" + Math.round((1 - sameSide) * 100) + "%): " + detail + "."); }
    else notes.push("🏦 Top traders across venues are split: " + detail + ".");
  } else if (topShares.length === 1 && topShares[0].name !== "Hyperliquid whales") notes.push("🏦 " + topShares[0].name + " " + Math.round(topShares[0].share * 100) + "% long.");
  for (const venue of (data.venues ?? []).filter(v => v.kind === "all accounts")) notes.push("👥 " + venue.name + " " + Math.round(venue.longShare * 100) + "% of accounts long.");
  if (stop && price > 0) {
    const beyond = data.whales.positions.filter(p => p.liquidation && p.coin === data.coin && (side === "LONG" ? p.side === "LONG" && p.liquidation < price && p.liquidation >= stop * 0.97 : p.side === "SHORT" && p.liquidation > price && p.liquidation <= stop * 1.03));
    if (beyond.length) { const sum = beyond.reduce((acc, p) => acc + p.sizeUsd, 0); notes.push("⚠️ " + formatUsd(sum) + " of whale " + side.toLowerCase() + "s liquidate within 3% of your stop (" + formatPrice(stop) + "); a wick through them is likely, so do not widen the stop into that pocket."); }
  }
  const level: PositioningVerdict["level"] = score >= 2 ? "SUPPORTS" : score <= -2 ? "AGAINST" : "NEUTRAL";
  const headline = level === "SUPPORTS" ? "Positioning supports the " + side : level === "AGAINST" ? "Positioning is against the " + side + ": half size or wait" : "Positioning neutral: trade the plan as written";
  return { level, headline, notes };
}

/** One line for a signal card or a Telegram alert: how each venue stacks up against the plan's side. */
export function positioningSummary(data: Positioning, side: "LONG" | "SHORT"): string {
  const parts: string[] = [];
  const total = data.whales.longUsd + data.whales.shortUsd;
  if (total > 0) parts.push("HL whales " + Math.round(data.whales.longUsd / total * 100) + "% long (" + formatUsd(total) + ")");
  for (const venue of data.venues ?? []) parts.push(venue.name + " " + Math.round(venue.longShare * 100) + "% long");
  if (data.crowd) parts.push("Bybit crowd " + Math.round(data.crowd.longRatio * 100) + "% long");
  const withYou = [
    ...(total > 0 ? [side === "LONG" ? data.whales.longUsd / total : data.whales.shortUsd / total] : []),
    ...(data.venues ?? []).filter(v => v.kind === "top traders").map(v => side === "LONG" ? v.longShare : 1 - v.longShare),
  ];
  const agree = withYou.length ? Math.round(withYou.reduce((a, b) => a + b, 0) / withYou.length * 100) : null;
  return (agree === null ? "" : "Smart money " + agree + "% with your " + side + " · ") + (parts.join(" · ") || "no positioning data");
}
