import { readOwnerRecord, writeOwnerRecord } from "@/app/server/telegram-delivery";
import type { WindowMode } from "@/app/lib/push-policy";

/** Owner-level push settings that no dashboard build overwrites (kept apart from the synced workspace). */
import type { TelegramMode } from "@/app/lib/telegram-policy";
export type PushSettings = { tradingWindows: WindowMode; /** ENTRIES_ONLY (default): only confirmed entry calls and messages about your own trades. */ telegramMode: TelegramMode };
export async function pushSettings(): Promise<PushSettings> {
  try { const saved = JSON.parse((await readOwnerRecord("push-settings")) ?? "{}"); return { tradingWindows: saved.tradingWindows === "BACKTESTED" ? "BACKTESTED" : "ALL", telegramMode: saved.telegramMode === "EVERYTHING" ? "EVERYTHING" : "ENTRIES_ONLY" }; } catch { return { tradingWindows: "ALL", telegramMode: "ENTRIES_ONLY" }; }
}
export async function savePushSettings(patch: Partial<PushSettings>): Promise<PushSettings> {
  const next = { ...await pushSettings(), ...patch };
  await writeOwnerRecord("push-settings", JSON.stringify(next));
  return next;
}
