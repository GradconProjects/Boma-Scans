import { cookies } from "next/headers";
import { env } from "@/app/server/env";
import { memory, recordKey } from "@/app/server/memory-store";
import { randomMaterial, validOwnerSession, type PasswordRecord } from "@/app/lib/owner-session";

export type OwnerUser = { userId: string; displayName: string; email: string; fullName: string | null };

export const SESSION_COOKIE = "__Host-boma-session";
export const OWNER_ID = "private-owner";
export const loginUrl = "/login";

async function readRecord(key: string): Promise<string | null> {
  if (env.DB) {
    const row = await env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key=?").bind(OWNER_ID, key).first<{ payload: string }>();
    return row?.payload ?? null;
  }
  return memory().records.get(recordKey(OWNER_ID, key))?.payload ?? null;
}

async function writeRecord(key: string, payload: string) {
  if (env.DB) {
    await env.DB.prepare("INSERT INTO account_records(user_id,record_key,payload,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(user_id,record_key) DO UPDATE SET payload=excluded.payload,revision=account_records.revision+1,updated_at=excluded.updated_at").bind(OWNER_ID, key, payload, Date.now()).run();
    return;
  }
  const store = memory().records, id = recordKey(OWNER_ID, key);
  store.set(id, { payload, revision: (store.get(id)?.revision ?? 0) + 1, updatedAt: Date.now() });
}

/** Stored (changeable) owner password, if one has been set from the app. */
export async function readOwnerPassword(): Promise<PasswordRecord | null> {
  try { const raw = await readRecord("owner-password"); return raw ? JSON.parse(raw) as PasswordRecord : null; } catch { return null; }
}
export async function writeOwnerPassword(record: PasswordRecord) {
  await writeRecord("owner-password", JSON.stringify(record));
}

/**
 * Cookie-signing material: the env secret plus a random server salt that is
 * created once and kept in the database, so a short login PIN never becomes
 * the signing key on its own.
 */
let cachedSalt: string | null = null;
export async function signingMaterial(): Promise<string> {
  const secret = env.BOMA_SYNC_SECRET ?? "";
  if (!cachedSalt) {
    try {
      let salt = await readRecord("owner-signing-salt");
      if (!salt) { salt = randomMaterial(); await writeRecord("owner-signing-salt", salt); }
      cachedSalt = salt;
    } catch { cachedSalt = ""; }
  }
  return secret + ":" + cachedSalt;
}

export function authConfigured() {
  return Boolean(env.BOMA_SYNC_SECRET && env.BOMA_SYNC_SECRET.length >= 4);
}

export async function getOwnerUser(): Promise<OwnerUser | null> {
  if (!authConfigured()) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  if (!token) return null;
  if (!(await validOwnerSession(token, await signingMaterial()))) return null;
  return { userId: OWNER_ID, displayName: "Owner", email: env.TELEGRAM_OWNER_EMAIL ?? "owner", fullName: null };
}
