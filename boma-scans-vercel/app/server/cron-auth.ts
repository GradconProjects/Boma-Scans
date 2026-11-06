import { env } from "@/app/server/env";

/**
 * Scheduled endpoints are protected by CRON_SECRET. When it is not set, a key
 * is derived from the owner password so the app can still be driven by an
 * external scheduler without another Vercel variable; set CRON_SECRET for a
 * key that does not depend on the sign-in password.
 */
export async function cronKey(): Promise<string> {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  const secret = env.BOMA_SYNC_SECRET ?? "";
  if (!secret) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("boma-cron:" + secret));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function cronAuthorized(request: Request): Promise<boolean> {
  const key = await cronKey();
  if (!key) return false;
  const url = new URL(request.url);
  const provided = url.searchParams.get("key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!provided || provided.length !== key.length) return false;
  let different = 0;
  for (let i = 0; i < key.length; i++) different |= key.charCodeAt(i) ^ provided.charCodeAt(i);
  return different === 0;
}
