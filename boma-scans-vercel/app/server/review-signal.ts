import { reviewSignal } from "@/app/server/ai";
import { positioningFor, whaleSnapshot } from "@/app/server/positioning";
import { judgePositioning } from "@/app/lib/positioning";
import { entryCall, planKeyOf } from "@/app/lib/trigger-monitor";
import type { analyzePair } from "@/app/server/market-analysis";
import type { SignalReview } from "@/app/lib/ai-review";

/**
 * Careful second read of a plan before it is pushed: positioning is gathered,
 * the reviewer is asked once per plan, and the stored verdict comes back.
 * Any failure returns null so a reviewer outage never blocks the engine.
 */
export async function reviewBeforePush(result: Pick<Awaited<ReturnType<typeof analyzePair>>, "row" | "analysis" | "candles">, force = false, throwOnError = false): Promise<SignalReview | null> {
  const { row, analysis, candles } = result;
  let positioning = null, positioningVerdict = null;
  try { positioning = await positioningFor(row.symbol, await whaleSnapshot()); positioningVerdict = judgePositioning(positioning, row.bias, row.price, row.stop); } catch { /* optional */ }
  try { return await reviewSignal({ row, analysis, candles, positioning, positioningVerdict, call: entryCall(row, row.price).line }, planKeyOf(row), force); }
  catch (error) { if (throwOnError) throw error; return null; }
}
