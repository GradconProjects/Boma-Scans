import { z } from "zod/v4";
import { aiSettings, structured } from "@/app/server/ai";
import { analyzePair, marketRead } from "@/app/server/market-analysis";
import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";
import { bybitSymbolFor, type EnteredTrade, type WhaleWarning } from "@/app/lib/whale-logic";
import { formatPrice, STYLE_CONFIG } from "@/app/lib/market";

/**
 * Instructions for a trade the owner is in, when whales move: what to do now,
 * in figures. The reviewer gets the owner's entry, the live price, the whale
 * moves and the 1H chart; its numbers pass guardrails (stop on the protective
 * side, within 3 ATR; close between 0 and 100%). Without an AI provider a
 * rule-based fallback answers.
 */
const Schema = z.object({
  action: z.enum(["HOLD", "TIGHTEN STOP", "REDUCE", "EXIT NOW"]),
  new_stop: z.number().nullable(),
  reduce_pct: z.number().min(0).max(100),
  reasoning: z.string(),
  figures: z.array(z.string()),
  next_check: z.string(),
});
export type WhaleManagement = z.infer<typeof Schema> & { provider: string; guardrails: string[] };

const SYSTEM = `You manage open crypto perpetual positions for a trader who follows consistently successful Hyperliquid whales (Bybit USDT perps, 1H chart). The trader is IN a trade. Ranked whales just moved on this coin; some moves are against the trade (whales leaving the trader's side or taking the other side), some with it.
Decide what the trader does now, in figures: HOLD (whales still with them, structure intact), TIGHTEN STOP (give new_stop at a structural level that locks in gains or caps risk), REDUCE (reduce_pct of the position, usually 30-70, when ranked whales start leaving or price is near a target), EXIT NOW (ranked whale closed or flipped the side, or structure broke against the trade). reasoning under 300 characters quoting prices. figures: three to five short lines with exact numbers (P&L %, distance to stop, where the whales exited, next level). next_check: the exact price or event that changes the plan. Never invent data.`;

export async function whaleTradeManagement(trade: EnteredTrade, warning: WhaleWarning, price: number): Promise<WhaleManagement> {
  const cacheKey = "whale-mgmt"; const id = warning.eventIds.slice().sort().join("|");
  try { const cached = JSON.parse((await readOwnerRecord(cacheKey)) ?? "{}") as Record<string, WhaleManagement & { id: string }>; const hit = cached[trade.coin + ":" + trade.side]; if (hit && hit.id === id) return hit; } catch { /* fresh */ }
  let symbol = trade.symbol ?? null;
  if (!symbol) { try { const tickers = await marketRead({ kind: "tickers" }); symbol = bybitSymbolFor(trade.coin, new Set((tickers.result!.list as Array<{ symbol?: string }>).map(t => t.symbol ?? ""))); } catch { symbol = null; } }
  const sign = trade.side === "LONG" ? 1 : -1;
  let atr = price * 0.01; let chart: Record<string, unknown> | null = null;
  if (symbol) { try { const { row, analysis, candles } = await analyzePair(symbol, STYLE_CONFIG.DAY.interval, "DAY", "STRICT"); atr = analysis.metrics.atr; price = price || row.price; chart = { bias: row.bias, regime: row.regime, trendFrames: row.trendFrames, structure: analysis.structure, engineStop: row.stop, engineTargets: row.takeProfits.map(t => t.price), historicLevels: row.keyLevels?.summary ?? null, rsi: Math.round(analysis.metrics.rsi), adx: Math.round(analysis.metrics.adx), atr, last12Candles1h: candles.slice(-12).map(c => [new Date(c.time).toISOString().slice(5, 16), c.open, c.high, c.low, c.close]) }; } catch { chart = null; } }
  const pnlPct = trade.entry ? sign * (price - trade.entry) / trade.entry * 100 : 0;
  const settings = await aiSettings();
  let result: WhaleManagement;
  if (settings.provider === "off") {
    // Rule-based fallback.
    const action = warning.severity === "CRITICAL" ? (warning.against.some(a => a.tier !== "WATCH" && (a.kind === "CLOSE" || a.kind === "FLIP")) ? "EXIT NOW" : "REDUCE") : warning.severity === "WARNING" ? "TIGHTEN STOP" : "HOLD";
    const newStop = action === "TIGHTEN STOP" ? (pnlPct > 0 ? trade.entry : price - sign * 1.5 * atr) : null;
    result = { action, new_stop: newStop, reduce_pct: action === "REDUCE" ? 50 : action === "EXIT NOW" ? 100 : 0, reasoning: warning.headline + ". Rule-based: " + action.toLowerCase() + " because " + (warning.severity === "CRITICAL" ? "ranked whales are leaving" : warning.severity === "WARNING" ? "whale money is turning" : "whales still back the side") + ".", figures: ["P&L " + (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2) + "% at " + formatPrice(price), "Against " + Math.round(warning.againstUsd / 1e5) / 10 + "M · with " + Math.round(warning.withUsd / 1e5) / 10 + "M", ...(newStop ? ["New stop " + formatPrice(newStop)] : [])], next_check: "Next ranked whale move on " + trade.coin + " or a 1H close " + (sign > 0 ? "below" : "above") + " " + formatPrice(price - sign * atr), provider: "rules", guardrails: [] };
  } else {
    const prompt = JSON.stringify({ trade: { coin: trade.coin, symbol, side: trade.side, entry: trade.entry, enteredAt: new Date(trade.at).toISOString(), price, pnlPct: Number(pnlPct.toFixed(2)) }, whales: { severity: warning.severity, headline: warning.headline, against: warning.against, withYou: warning.withYou, againstUsd: Math.round(warning.againstUsd), withUsd: Math.round(warning.withUsd) }, chart });
    const { value, provider } = await structured(Schema, "whale_trade_management", SYSTEM, "The trader is in this trade. Decide now.\n\n" + prompt);
    const guardrails: string[] = [];
    let newStop = value.new_stop;
    if (newStop !== null) {
      const protective = sign * (price - newStop) > 0;
      if (!protective || Math.abs(price - newStop) > 3 * atr) { guardrails.push("stop " + formatPrice(newStop) + " not on the protective side within 3 ATR; set to 1.5 ATR"); newStop = price - sign * 1.5 * atr; }
    }
    result = { ...value, new_stop: newStop, provider, guardrails };
  }
  try { const cached = JSON.parse((await readOwnerRecord(cacheKey)) ?? "{}"); cached[trade.coin + ":" + trade.side] = { ...result, id }; await writeOwnerRecord(cacheKey, JSON.stringify(cached)); } catch { /* cache only */ }
  return result;
}
