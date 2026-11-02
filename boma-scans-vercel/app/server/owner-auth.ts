import { cookies } from "next/headers";
import { env } from "@/app/server/env";
import { validOwnerSession } from "@/app/lib/owner-session";

export type OwnerUser = { userId: string; displayName: string; email: string; fullName: string | null };

export const SESSION_COOKIE = "__Host-boma-session";
export const loginUrl = "/login";

/**
 * Single-owner sign-in for independent hosting. The owner password
 * (BOMA_SYNC_SECRET) signs a 30-day HMAC session cookie; there are no user
 * accounts, so every device that signs in shares one private journal.
 */
export async function getOwnerUser(): Promise<OwnerUser | null> {
  const secret = env.BOMA_SYNC_SECRET;
  if (!secret || secret.length < 32) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  if (!(await validOwnerSession(token, secret))) return null;
  const email = env.TELEGRAM_OWNER_EMAIL ?? "owner";
  return { userId: "private-owner", displayName: "Owner", email, fullName: null };
}
