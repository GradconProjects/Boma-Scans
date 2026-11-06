import { NextRequest, NextResponse } from "next/server";
import { env } from "@/app/server/env";
import { SESSION_COOKIE } from "@/app/server/owner-auth";
import { createOwnerSession, equalSecret } from "@/app/lib/owner-session";
import { memory } from "@/app/server/memory-store";

export const dynamic = "force-dynamic";

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Invalid request origin." }, 403);
  const secret = env.BOMA_SYNC_SECRET;
  if (!secret || secret.length < 32) {
    return reply({ error: "Sign-in is not configured: BOMA_SYNC_SECRET is " + (secret ? "shorter than 32 characters" : "missing") + " in Vercel. Set it under Settings → Environment Variables, then Redeploy." }, 503);
  }
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
    const now = Date.now(), bucket = Math.floor(now / 900_000), key = ip + ":" + bucket;
    let attempts: number;
    if (env.DB) {
      const attempt = await env.DB.prepare("INSERT INTO login_attempts(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=login_attempts.attempts+1 RETURNING attempts").bind(key, (bucket + 1) * 900_000).first<{ attempts: number }>();
      attempts = Number(attempt?.attempts ?? 99);
      await env.DB.prepare("DELETE FROM login_attempts WHERE expires_at < ?").bind(now - 900_000).run();
    } else {
      // No database connected: rate-limit within this server instance.
      const store = memory().attempts;
      const row = store.get(key) ?? { attempts: 0, expiresAt: (bucket + 1) * 900_000 };
      row.attempts += 1; store.set(key, row); attempts = row.attempts;
    }
    if (attempts > 10) return reply({ error: "Too many sign-in attempts. Try again in 15 minutes." }, 429, { "Retry-After": "900" });
    const raw = await request.text();
    if (raw.length > 4096) return reply({ error: "Invalid password." }, 400);
    const body = JSON.parse(raw);
    if (typeof body.password !== "string" || !(await equalSecret(secret, body.password))) return reply({ error: "Incorrect owner password." }, 401);
    const token = await createOwnerSession(secret);
    return reply({ ok: true }, 200, { "Set-Cookie": SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000" }); // Lax: the cookie is sent when you arrive from Telegram or a bookmark; writes also verify Origin.
  } catch {
    return reply({ error: "Sign-in is temporarily unavailable." }, 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Invalid request origin." }, 403);
  return reply({ ok: true }, 200, { "Set-Cookie": SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
}
