import { env } from "@/app/server/env";
import { memory, recordKey } from "@/app/server/memory-store";
import { OWNER_ID } from "@/app/server/owner-auth";
import { telegramCall, telegramChunks } from "@/app/server/telegram";
import { renderTelegramHtml } from "@/app/lib/signal-alerts";
import { keyboardRows } from "@/app/lib/telegram-events";
import type { TelegramEvent } from "@/app/lib/telegram-events";
import { telegramDecision, type PolicyContext, type TelegramMode } from "@/app/lib/telegram-policy";

export type TelegramConfig = { chatId: string; enabled: boolean };

export async function readOwnerRecord(key: string): Promise<string | null> {
  if (env.DB) {
    const row = await env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key=?").bind(OWNER_ID, key).first<{ payload: string }>();
    return row?.payload ?? null;
  }
  return memory().records.get(recordKey(OWNER_ID, key))?.payload ?? null;
}

export async function writeOwnerRecord(key: string, payload: string) {
  if (env.DB) {
    await env.DB.prepare("INSERT INTO account_records(user_id,record_key,payload,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(user_id,record_key) DO UPDATE SET payload=excluded.payload,revision=account_records.revision+1,updated_at=excluded.updated_at").bind(OWNER_ID, key, payload, Date.now()).run();
    return;
  }
  const store = memory().records, id = recordKey(OWNER_ID, key);
  store.set(id, { payload, revision: (store.get(id)?.revision ?? 0) + 1, updatedAt: Date.now() });
}

export async function telegramConfig(): Promise<TelegramConfig | null> {
  try {
    const raw = await readOwnerRecord("telegram");
    if (raw) return JSON.parse(raw) as TelegramConfig;
  } catch { /* fall through */ }
  return env.TELEGRAM_CHAT_ID ? { chatId: env.TELEGRAM_CHAT_ID, enabled: true } : null;
}

async function claim(key: string): Promise<boolean> {
  const id = "event:" + key;
  if (env.DB) return !!(await env.DB.prepare("INSERT INTO telegram_deliveries(user_id,signal_key,status,created_at) VALUES(?,?,'PENDING',?) ON CONFLICT(user_id,signal_key) DO NOTHING RETURNING status").bind(OWNER_ID, id, Date.now()).first());
  const seen = memory().deliveries, memoryId = recordKey(OWNER_ID, id);
  if (seen.has(memoryId)) return false;
  seen.set(memoryId, Date.now());
  return true;
}

/** The owner's Telegram mode and entered whale trades, read straight from the records (no import cycle). Defaults to entries only. */
export async function telegramPolicyContext(): Promise<PolicyContext> {
  let mode: TelegramMode = "ENTRIES_ONLY"; let enteredCoins: string[] = [];
  try { const saved = JSON.parse((await readOwnerRecord("push-settings")) ?? "{}") as { telegramMode?: string }; if (saved.telegramMode === "EVERYTHING") mode = "EVERYTHING"; } catch { /* default */ }
  try { const whales = JSON.parse((await readOwnerRecord("whale-settings")) ?? "{}") as { entered?: Array<{ coin?: string }> }; enteredCoins = (whales.entered ?? []).map(t => String(t.coin ?? "")).filter(Boolean); } catch { /* none */ }
  return { mode, enteredCoins };
}

/**
 * Sends each event once (de-duplicated by key across devices and the scheduler).
 * Every scheduled message passes through here, so this is where "confirmed entries only" is enforced: anything else is
 * dropped before it is claimed or sent.
 */
export async function deliverEvents(config: TelegramConfig, events: TelegramEvent[], origin: string): Promise<{ sent: number; errors: string[]; filtered: number }> {
  const token = env.TELEGRAM_BOT_TOKEN;
  let sent = 0; const errors: string[] = [];
  if (!token || !config.enabled) return { sent, errors: ["Telegram not configured"], filtered: 0 };
  const context = await telegramPolicyContext().catch(() => ({ mode: "ENTRIES_ONLY" as TelegramMode, enteredCoins: [] as string[] }));
  const allowed = events.filter(event => telegramDecision(event.key, context).send); const filtered = events.length - allowed.length;
  for (const event of allowed.slice(0, 20)) {
    const lines = event.symbol && !event.lines.some(line => line.startsWith("🔗 ")) ? [...event.lines, "🔗 Open in app: " + origin.replace(/\/$/, "") + "/?pair=" + event.symbol] : event.lines;
    if (!(await claim(event.key))) continue;
    try {
      const chunks = telegramChunks(renderTelegramHtml(lines));
      for (const [index, chunk] of chunks.entries()) await telegramCall(token, "sendMessage", { chat_id: config.chatId, text: chunk, parse_mode: "HTML", ...(event.buttons && index === chunks.length - 1 ? { reply_markup: keyboardRows(event.buttons) } : {}) });
      if (env.DB) await env.DB.prepare("UPDATE telegram_deliveries SET status='SENT' WHERE user_id=? AND signal_key=?").bind(OWNER_ID, "event:" + event.key).run();
      sent++;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "delivery failed");
      if (env.DB) await env.DB.prepare("UPDATE telegram_deliveries SET status='UNCONFIRMED' WHERE user_id=? AND signal_key=?").bind(OWNER_ID, "event:" + event.key).run();
    }
  }
  return { sent, errors, filtered };
}
