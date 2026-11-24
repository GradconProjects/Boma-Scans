import { env } from "@/app/server/env";
import { cronKey } from "@/app/server/cron-auth";
import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";

/** Whale System 2's own 15-minute job in the owner's database scheduler. Separate from the scanner's jobs; removing it leaves them untouched. */
export async function ensureWs2Schedule(origin: string): Promise<{ ok: boolean; at: number; error?: string; origin?: string } | null> {
  if (!env.DB || !/^https:\/\//.test(origin) || !process.env.POSTGRES_URL) return null;
  const key = await cronKey(); if (!key) return null;
  const stamp = origin + "#" + key.slice(0, 8) + "#ws2-15m";
  let previous: { ok: boolean; at: number; origin?: string } | null = null;
  try { previous = JSON.parse((await readOwnerRecord("ws2-schedule")) ?? "null"); } catch { /* none */ }
  if (previous && previous.origin === stamp && (previous.ok ? Date.now() - previous.at < 7 * 86_400_000 : Date.now() - previous.at < 3_600_000)) return previous;
  const state: { ok: boolean; at: number; error?: string; origin?: string } = { ok: false, at: Date.now(), origin: stamp };
  try {
    // The statement adapter turns "?" into bind markers, so the query string is built with chr(63).
    await env.DB.prepare("SELECT cron.schedule('boma-ws2', '*/15 * * * *', $job$SELECT net.http_get(url := '" + origin + "/api/cron/ws2' || chr(63) || 'key=" + key + "', timeout_milliseconds := 55000)$job$)").run();
    state.ok = true;
  } catch (error) { state.error = error instanceof Error ? error.message.slice(0, 200) : "schedule failed"; }
  try { await writeOwnerRecord("ws2-schedule", JSON.stringify(state)); } catch { /* best effort */ }
  return state;
}
