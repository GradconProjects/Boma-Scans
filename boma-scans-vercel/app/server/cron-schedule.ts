import { env } from "@/app/server/env";
import { cronKey } from "@/app/server/cron-auth";
import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";

export type ScheduleState = { ok: boolean; at: number; error?: string; origin?: string };

/**
 * Registers the scheduler inside the owner's own Postgres (Supabase ships
 * pg_cron and pg_net): the database calls the monitor endpoint every minute
 * and the scan every 3 hours, so nothing outside the stack has to be set
 * up. The key stays in the private database. Re-run when the origin or key
 * changes; failures are retried hourly.
 */
export async function ensureSchedule(origin: string, force = false): Promise<ScheduleState | null> {
  if (!env.DB || !/^https:\/\//.test(origin) || !process.env.POSTGRES_URL) return null;
  const key = await cronKey();
  if (!key) return null;
  let previous: ScheduleState | null = null;
  try { previous = JSON.parse((await readOwnerRecord("cron-schedule")) ?? "null"); } catch { /* none */ }
  const stamp = origin + "#" + key.slice(0, 8) + "#scan3h";
  if (!force && previous && previous.origin === stamp && (previous.ok ? Date.now() - previous.at < 7 * 86_400_000 : Date.now() - previous.at < 3_600_000)) return previous;
  const state: ScheduleState = { ok: false, at: Date.now(), origin: stamp };
  // The statement adapter turns "?" into bind markers, so the query string is built with chr(63).
  const url = (path: string) => "'" + origin + path + "' || chr(63) || 'key=" + key + "'";
  const job = (name: string, schedule: string, path: string) =>
    "SELECT cron.schedule('" + name + "', '" + schedule + "', $job$SELECT net.http_get(url := " + url(path) + ", timeout_milliseconds := 55000)$job$)";
  try {
    await env.DB.prepare("CREATE EXTENSION IF NOT EXISTS pg_cron").run();
    await env.DB.prepare("CREATE EXTENSION IF NOT EXISTS pg_net").run();
    await env.DB.prepare(job("boma-monitor", "* * * * *", "/api/cron/monitor")).run();
    await env.DB.prepare(job("boma-scan", "0 */3 * * *", "/api/cron/scan")).run();
    state.ok = true;
  } catch (error) {
    state.error = error instanceof Error ? error.message.slice(0, 200) : "schedule failed";
  }
  try { await writeOwnerRecord("cron-schedule", JSON.stringify(state)); } catch { /* best effort */ }
  return state;
}
