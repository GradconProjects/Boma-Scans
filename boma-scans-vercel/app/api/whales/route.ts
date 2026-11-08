import { NextRequest, NextResponse } from "next/server";
import { getOwnerUser } from "@/app/server/owner-auth";
import { recentEvents, saveWhaleSettings, trackWhales, whaleSettings, whaleSignals } from "@/app/server/whale-tracker";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** GET: whale signals, rankings, recent events and settings. POST: settings. */
export async function GET() {
  const user = await getOwnerUser(); if (!user) return reply({ error: "Sign in at /login." }, 401);
  try {
    await trackWhales();
    const [{ signals, ranks }, events, settings] = await Promise.all([whaleSignals(), recentEvents(48 * 3_600_000, 300), whaleSettings()]);
    return reply({ at: Date.now(), signals, ranks, events, settings });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "Whale data unavailable." }, 502); }
}

export async function POST(request: NextRequest) {
  const user = await getOwnerUser(); if (!user) return reply({ error: "Sign in at /login." }, 401);
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Origin rejected." }, 403);
  const body = await request.json().catch(() => ({})) as { alerts?: boolean; minTier?: "ELITE" | "STRONG"; coins?: string[] };
  const patch: Record<string, unknown> = {};
  if (typeof body.alerts === "boolean") patch.alerts = body.alerts;
  if (body.minTier === "ELITE" || body.minTier === "STRONG") patch.minTier = body.minTier;
  if (Array.isArray(body.coins)) patch.coins = body.coins.map(c => String(c).toUpperCase().replace(/[^A-Z0-9k]/g, "")).filter(Boolean).slice(0, 30);
  return reply({ settings: await saveWhaleSettings(patch) });
}
