import { env } from "@/app/server/env";
import { memory, recordKey } from "@/app/server/memory-store";
import { telegramCall } from "@/app/server/telegram";
import { handleCommand } from "@/app/server/telegram-controls";

type Update = { update_id: number; message?: { text?: string; date: number; chat: { id: number }; from?: { id: number; first_name?: string; last_name?: string; username?: string } }; callback_query?: { id: string; data?: string; from: { id: number }; message?: { chat: { id: number }; date: number } } };

/**
 * Fetches pending Telegram updates for the owner's bot and runs the commands.
 * Shared by the dashboard's poll endpoint and the scheduled monitor, so
 * commands work with the app closed. A short lease prevents two pollers
 * from fighting over the same updates.
 */
export async function pollTelegram(userId: string, chatId: string, origin: string): Promise<{ processed: number; error?: string }> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { processed: 0, error: "Telegram is not configured." };
  const now = Date.now();
  let lease: { offset: number } | null;
  if (env.DB) lease = await env.DB.prepare("INSERT INTO telegram_runtime(id,\"offset\",lease_until) VALUES('bot',0,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE telegram_runtime.lease_until<? RETURNING \"offset\"").bind(now + 45000, now).first<{ offset: number }>();
  else { const rt = memory().runtime; lease = rt.leaseUntil < now ? (rt.leaseUntil = now + 45000, { offset: rt.offset }) : null; }
  if (!lease) return { processed: 0 };
  let processed = 0;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset: lease.offset, limit: 5, timeout: 0, allowed_updates: ["message", "callback_query"] }), signal: AbortSignal.timeout(10000) });
    const data = await response.json() as { ok: boolean; result: Update[] };
    if (!response.ok || !data.ok) return { processed, error: "Telegram command polling unavailable; an existing webhook or connection error may be blocking it." };
    for (const update of data.result) {
      let claim: boolean;
      if (env.DB) {
        await env.DB.prepare("UPDATE telegram_runtime SET \"offset\"=CASE WHEN \"offset\">? THEN \"offset\" ELSE ? END,lease_until=? WHERE id='bot'").bind(update.update_id + 1, update.update_id + 1, Date.now() + 45000).run();
        claim = !!(await env.DB.prepare("INSERT INTO telegram_updates(id,received_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING RETURNING id").bind(update.update_id, Date.now()).first());
      } else { const m = memory(); m.runtime.offset = Math.max(m.runtime.offset, update.update_id + 1); m.runtime.leaseUntil = Date.now() + 45000; claim = !m.updates.has(update.update_id); if (claim) m.updates.set(update.update_id, Date.now()); }
      if (!claim) continue;
      const message = update.message; const callback = update.callback_query;
      const target = message?.chat.id ?? callback?.message?.chat.id; const sender = message?.from?.id ?? callback?.from.id;
      if (message?.chat.id && message.from) {
        // Record recent senders so the dashboard can offer "Use this chat" when the configured id is wrong.
        try {
          const raw = env.DB ? (await env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key='telegram-senders'").bind(userId).first<{ payload: string }>())?.payload : memory().records.get(recordKey(userId, "telegram-senders"))?.payload;
          const senders = (raw ? JSON.parse(raw) : []) as Array<{ chatId: string; name: string; text: string; at: number }>;
          const next = [{ chatId: String(message.chat.id), name: [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") || message.from.username || "Telegram user", text: (message.text ?? "").slice(0, 40), at: Date.now() }, ...senders.filter(item => item.chatId !== String(message.chat.id))].slice(0, 5);
          const payload = JSON.stringify(next);
          if (env.DB) await env.DB.prepare("INSERT INTO account_records(user_id,record_key,payload,revision,updated_at) VALUES(?,'telegram-senders',?,1,?) ON CONFLICT(user_id,record_key) DO UPDATE SET payload=excluded.payload,revision=account_records.revision+1,updated_at=excluded.updated_at").bind(userId, payload, Date.now()).run();
          else { const store = memory().records, id = recordKey(userId, "telegram-senders"); store.set(id, { payload, revision: (store.get(id)?.revision ?? 0) + 1, updatedAt: Date.now() }); }
        } catch { /* diagnostics only */ }
      }
      if (String(target) !== String(chatId) || String(sender) !== String(chatId)) continue;
      const date = message?.date ?? 0; if (message && Date.now() - date * 1000 > 30 * 60000) continue;
      let text = message?.text ?? "";
      if (callback) {
        await telegramCall(token, "answerCallbackQuery", { callback_query_id: callback.id });
        const [action, value] = String(callback.data ?? "").split(":");
        text = action === "tf" ? "/timeframe " + value : action === "risk" ? "/risk " + value : action === "analyse" ? "/analyse " + value : action === "entered" ? "/entered " + value : action === "skipped" ? "/skip " + value : "/" + action;
      }
      if (!text) continue;
      try { await handleCommand(userId, String(chatId), text, origin); processed++; }
      catch { await telegramCall(token, "sendMessage", { chat_id: chatId, text: "⚠️ Fresh analysis or command processing failed. No entry approved. Try again or open the dashboard." }); }
    }
    return { processed };
  } catch { return { processed, error: "Telegram command processing could not complete." }; }
  finally { if (env.DB) await env.DB.prepare("UPDATE telegram_runtime SET lease_until=0 WHERE id='bot'").run(); else memory().runtime.leaseUntil = 0; }
}
