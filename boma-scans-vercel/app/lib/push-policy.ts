import type { Candle, MarketAnalysis, ScannerRow } from "@/app/lib/market";

/**
 * What may be pushed to Telegram as an entry call. The app shows every graded
 * setup; the phone gets only entries that (1) follow a major structural
 * event, a confirmed break of structure, a change of character or a
 * liquidity sweep on the trade's side, (2) carry a stop the trade can
 * reasonably hold for four hours or more, and (3) are not fought by the
 * ranked whales. Everything else stays in the app.
 */
export type PushGate = { ok: boolean; reasons: string[]; event: string | null; survivalHours: number };

export const MIN_STOP_ATR = 2;          // ~ one 4-hour range on the 1H chart
export const RECENT_HOURS = 4;          // the last four closed candles must not have traded through the stop

export function majorEventGate(row: Pick<ScannerRow, "bias" | "setupType" | "stop" | "entry" | "executionPlan">, analysis: Pick<MarketAnalysis, "structure" | "metrics">, candles: Candle[]): PushGate {
  const side = row.bias; const sign = side === "LONG" ? 1 : -1;
  const want = side === "LONG" ? "BULLISH" : "BEARISH";
  const s = analysis.structure;
  const event = s.choch === want ? "change of character (CHoCH) " + side.toLowerCase() : s.bos === want ? "break of structure " + side.toLowerCase() : s.sweep === want ? "liquidity sweep " + side.toLowerCase() : row.setupType === "BREAKOUT" || row.setupType === "CHoCH REVERSAL" ? row.setupType.toLowerCase() + " setup" : null;
  const reasons: string[] = [];
  if (!event) reasons.push("no major structural event (CHoCH, break of structure or sweep) behind this entry");
  const entry = row.executionPlan.entry; const risk = Math.abs(entry - row.stop); const atr = analysis.metrics.atr;
  const survivalHours = atr > 0 ? Math.round((risk / atr) ** 2 * 10) / 10 : 0; // random-walk estimate: range grows with the square root of time
  if (risk < MIN_STOP_ATR * atr) reasons.push("stop is " + (risk / atr).toFixed(1) + " ATR from the entry; a four-hour hold needs about " + MIN_STOP_ATR + " ATR");
  const recent = candles.slice(-RECENT_HOURS - 1, -1);
  const adverse = recent.length ? Math.max(...recent.map(c => sign * (entry - (sign > 0 ? c.low : c.high)))) : 0;
  if (recent.length && adverse >= risk * 0.8) reasons.push("price traded within 20% of the stop in the last four hours");
  return { ok: reasons.length === 0, reasons, event, survivalHours };
}

export type WhaleAlignment = { stance: "WITH" | "AGAINST" | "NEUTRAL"; detail: string };

/** Whether ranked directional whales are with, against, or indifferent to a side on a coin. */
export function whaleStance(side: "LONG" | "SHORT", book: { longUsd: number; shortUsd: number }, freshFlow: { longUsd: number; shortUsd: number }): WhaleAlignment {
  const flowTotal = freshFlow.longUsd + freshFlow.shortUsd;
  const bookTotal = book.longUsd + book.shortUsd;
  const mine = (x: { longUsd: number; shortUsd: number }) => side === "LONG" ? x.longUsd : x.shortUsd;
  if (flowTotal >= 500_000) {
    const share = mine(freshFlow) / flowTotal;
    if (share >= 0.65) return { stance: "WITH", detail: Math.round(share * 100) + "% of the whales' fresh money in the last 24 h is " + side };
    if (share <= 0.35) return { stance: "AGAINST", detail: Math.round((1 - share) * 100) + "% of the whales' fresh money in the last 24 h is " + (side === "LONG" ? "SHORT" : "LONG") };
  }
  if (bookTotal >= 1_000_000) {
    const share = mine(book) / bookTotal;
    if (share >= 0.7) return { stance: "WITH", detail: Math.round(share * 100) + "% of the ranked whales' open book is " + side };
    if (share <= 0.3) return { stance: "AGAINST", detail: Math.round((1 - share) * 100) + "% of the ranked whales' open book is " + (side === "LONG" ? "SHORT" : "LONG") };
  }
  return { stance: "NEUTRAL", detail: "ranked whales are split or absent on this coin" };
}
