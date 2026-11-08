import { NextRequest, NextResponse } from "next/server";
import { env } from "@/app/server/env";
import { getOwnerUser } from "@/app/server/owner-auth";
export const dynamic = "force-dynamic";

/**
 * Sync for the "Before Telegram" build. Same shape as /api/sync, but records
 * live under the "before/" prefix so the old build and the current scanner
 * never overwrite each other's workspace or journal.
 */
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const PREFIX = "before/";
export async function GET(request: NextRequest) {
  const user = await getOwnerUser();
  if (!user) return reply({ error: "Sign in at /login with your owner password to sync across devices." }, 401);
  if (!env.DB) return reply({ error: "Cloud sync is off: no database connected. Your device copy is in use." }, 503);
  const scope = request.nextUrl.searchParams.get("scope");
  if (scope !== "workspace" && scope !== "trade") return reply({ error: "Invalid scope." }, 400);
  const result = await env.DB.prepare("SELECT record_key AS key,payload,revision FROM account_records WHERE user_id=? AND (record_key=? OR record_key LIKE ?)").bind(user.userId, PREFIX + scope, PREFIX + scope + "/%").all<{ key: string; payload: string; revision: number }>();
  return reply({ records: result.results.map(row => ({ key: row.key.slice(PREFIX.length), value: JSON.parse(row.payload), revision: row.revision })) });
}
export async function PUT(request: NextRequest) {
  const user = await getOwnerUser();
  if (!user) return reply({ error: "Sign in at /login to sync." }, 401);
  if (!env.DB) return reply({ error: "Cloud sync is off: no database connected. Device copy retained." }, 503);
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Origin rejected." }, 403);
  const text = await request.text();
  if (text.length > 400000) return reply({ error: "Record too large." }, 413);
  let body: { key?: unknown; value?: unknown; revision?: unknown };
  try { body = JSON.parse(text); } catch { return reply({ error: "Invalid JSON." }, 400); }
  const { key, value, revision } = body;
  if (typeof key !== "string" || !/^(workspace|trade\/[A-Za-z0-9-]{1,100})$/.test(key) || !Number.isSafeInteger(revision) || (revision as number) < 0 || !value || typeof value !== "object") return reply({ error: "Invalid record." }, 400);
  const stored = PREFIX + key; const payload = JSON.stringify(value); const now = Date.now();
  const row = await env.DB.prepare("INSERT INTO account_records(user_id,record_key,payload,revision,updated_at) SELECT ?,?,?,1,? WHERE ?=0 ON CONFLICT(user_id,record_key) DO UPDATE SET payload=excluded.payload,revision=account_records.revision+1,updated_at=excluded.updated_at WHERE account_records.revision=? RETURNING revision").bind(user.userId, stored, payload, now, revision, revision).first<{ revision: number }>();
  if (!row && (revision as number) > 0) {
    const updated = await env.DB.prepare("UPDATE account_records SET payload=?, revision=revision+1,updated_at=? WHERE user_id=? AND record_key=? AND revision=? RETURNING revision").bind(payload, now, user.userId, stored, revision).first<{ revision: number }>();
    if (updated) return reply({ revision: updated.revision });
  }
  return row ? reply({ revision: row.revision }) : reply({ error: "Changed on another device. Review the cloud copy before saving." }, 409);
}
