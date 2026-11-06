import { NextRequest, NextResponse } from "next/server";
import { env } from "@/app/server/env";
import { memory } from "@/app/server/memory-store";
import { SESSION_COOKIE, authConfigured, getOwnerUser, readOwnerPassword, signingMaterial, writeOwnerPassword } from "@/app/server/owner-auth";
import { MIN_PASSWORD_LENGTH, createOwnerSession, equalSecret, hashPassword, verifyPassword } from "@/app/lib/owner-session";

export const dynamic = "force-dynamic";

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const cookie = (token: string, maxAge: number) => SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge; // Lax: sent when arriving from Telegram or a bookmark; writes also verify Origin.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Per-address (10 per 15 min) and global (30 per hour) attempt limits make a short PIN impractical to guess online. */
async function limited(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const windows: Array<[string, number, number]> = [["ip:" + ip + ":" + Math.floor(now / 900_000), (Math.floor(now / 900_000) + 1) * 900_000, 10], ["global:" + Math.floor(now / 3_600_000), (Math.floor(now / 3_600_000) + 1) * 3_600_000, 30]];
  let blocked = false;
  for (const [key, expiresAt, limit] of windows) {
    let attempts: number;
    if (env.DB) {
      const row = await env.DB.prepare("INSERT INTO login_attempts(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=login_attempts.attempts+1 RETURNING attempts").bind(key, expiresAt).first<{ attempts: number }>();
      attempts = Number(row?.attempts ?? 99);
    } else {
      const store = memory().attempts;
      const row = store.get(key) ?? { attempts: 0, expiresAt };
      row.attempts += 1; store.set(key, row); attempts = row.attempts;
    }
    if (attempts > limit) blocked = true;
  }
  if (env.DB) await env.DB.prepare("DELETE FROM login_attempts WHERE expires_at < ?").bind(now - 3_600_000).run();
  return blocked;
}

async function checkPassword(password: string) {
  const stored = await readOwnerPassword();
  if (stored) return verifyPassword(password, stored);
  const secret = env.BOMA_SYNC_SECRET ?? "";
  return secret.length >= MIN_PASSWORD_LENGTH && (await equalSecret(secret, password));
}

/** Session state for the login page. */
export async function GET() {
  const owner = await getOwnerUser();
  const stored = owner ? await readOwnerPassword() : null;
  return reply({ configured: authConfigured(), signedIn: !!owner, changeable: !!env.DB, source: stored ? "app" : "env" });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Invalid request origin." }, 403);
  if (!authConfigured()) return reply({ error: "Sign-in is not configured: BOMA_SYNC_SECRET is " + (env.BOMA_SYNC_SECRET ? "shorter than " + MIN_PASSWORD_LENGTH + " characters" : "missing") + " in Vercel. Set it under Settings → Environment Variables, then Redeploy." }, 503);
  try {
    if (await limited(request)) return reply({ error: "Too many sign-in attempts. Try again later." }, 429, { "Retry-After": "900" });
    const raw = await request.text();
    if (raw.length > 4096) return reply({ error: "Invalid password." }, 400);
    const body = JSON.parse(raw);
    if (typeof body.password !== "string" || !(await checkPassword(body.password))) { await sleep(800); return reply({ error: "Incorrect owner password." }, 401); }
    const token = await createOwnerSession(await signingMaterial());
    return reply({ ok: true }, 200, { "Set-Cookie": cookie(token, 7_776_000) });
  } catch (error) {
    return reply({ error: "Sign-in is temporarily unavailable: " + (error instanceof Error ? error.message : "unknown error") }, 503);
  }
}

/** Change the password from inside the app (signed in, current password required). */
export async function PUT(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Invalid request origin." }, 403);
  const owner = await getOwnerUser();
  if (!owner) return reply({ error: "Sign in first." }, 401);
  if (!env.DB) return reply({ error: "Changing the password needs the database (Vercel Storage → Connect Supabase). Until then, change BOMA_SYNC_SECRET in Vercel and redeploy." }, 503);
  try {
    if (await limited(request)) return reply({ error: "Too many attempts. Try again later." }, 429);
    const body = JSON.parse(await request.text());
    if (typeof body.current !== "string" || !(await checkPassword(body.current))) { await sleep(800); return reply({ error: "Current password is incorrect." }, 401); }
    if (typeof body.next !== "string" || body.next.length < MIN_PASSWORD_LENGTH || body.next.length > 256) return reply({ error: "New password must be at least " + MIN_PASSWORD_LENGTH + " characters." }, 400);
    await writeOwnerPassword(await hashPassword(body.next));
    return reply({ ok: true, message: "Password changed. Use it on every device from now on; existing sign-ins stay valid." });
  } catch {
    return reply({ error: "Password change is temporarily unavailable." }, 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Invalid request origin." }, 403);
  return reply({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
}
