import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";
import type { WindowMode } from "@/app/lib/push-policy";

/** Owner-level push settings that no dashboard build overwrites (kept apart from the synced workspace). */
export type PushSettings = { tradingWindows: WindowMode };
export async function pushSettings(): Promise<PushSettings> {
  try { const saved = JSON.parse((await readOwnerRecord("push-settings")) ?? "{}"); return { tradingWindows: saved.tradingWindows === "ALL" ? "ALL" : "BACKTESTED" }; } catch { return { tradingWindows: "BACKTESTED" }; }
}
export async function savePushSettings(patch: Partial<PushSettings>): Promise<PushSettings> {
  const next = { ...await pushSettings(), ...patch };
  await writeOwnerRecord("push-settings", JSON.stringify(next));
  return next;
}
