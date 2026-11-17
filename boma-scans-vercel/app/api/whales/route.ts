import { NextRequest, NextResponse } from "next/server";
import { getOwnerUser } from "@/app/server/owner-auth";
import { enteredWarnings, purgeBaselineOpens, recentEvents, saveWhaleSettings, trackWhales, whaleSettings, whaleSignals } from "@/app/server/whale-tracker";
import { whaleSnapshot } from "@/app/server/positioning";
import { whaleEntryAnalysis } from "@/app/server/whale-analysis";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** GET: whale signals, rankings, recent events and settings. POST: settings. */
export async function GET() {
  const user = await getOwnerUser(); if (!user) return reply({ error: "Sign in at /login." }, 401);
  const steps: Record<string, number> = {}; let step = "start"; let t = Date.now();
  const mark = (name: string) => { steps[step] = Date.now() - t; step = name; t = Date.now(); };
  try {
    await trackWhales(); mark("signals");
    const { signals, exits, ranks } = await whaleSignals(); mark("events");
    const events = await recentEvents(48 * 3_600_000, 300); mark("settings");
    const settings = await whaleSettings(); mark("warnings");
    const warnings = enteredWarnings(settings, events, ranks);
    const snapshot = await whaleSnapshot(); const prices: Record<string, number> = Object.fromEntries(Object.entries(snapshot.ctx).map(([c, x]) => [c, x.markPx])); mark("done");
    return reply({ at: Date.now(), signals, exits, ranks, events, settings, warnings, prices, steps });
  } catch (error) { return reply({ error: (error instanceof Error ? error.message : "Whale data unavailable.") + " (step: " + step + ")", steps }, 502); }
}

export async function POST(request: NextRequest) {
  const user = await getOwnerUser(); if (!user) return reply({ error: "Sign in at /login." }, 401);
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Origin rejected." }, 403);
  const body = await request.json().catch(() => ({})) as { alerts?: boolean; minTier?: "ELITE" | "STRONG"; coins?: string[]; watch?: string[]; action?: string; coin?: string; side?: "LONG" | "SHORT" };
  if (body.action === "entered" || body.action === "exited") {
    const coin = String(body.coin ?? "").replace(/[^A-Za-z0-9]/g, ""); if (!coin) return reply({ error: "Which coin?" }, 400);
    const current = await whaleSettings(); const list = (current.entered ?? []).filter(t => t.coin !== coin);
    if (body.action === "entered") {
      const side = body.side === "SHORT" ? "SHORT" : "LONG"; const price = Number((body as { price?: unknown }).price);
      let entry = Number.isFinite(price) && price > 0 ? price : 0;
      if (!entry) { try { const snapshot = await whaleSnapshot(); entry = snapshot.ctx[coin]?.markPx ?? 0; } catch { /* unknown */ } }
      list.push({ coin, side, entry, at: Date.now(), symbol: typeof (body as { symbol?: unknown }).symbol === "string" ? String((body as { symbol?: unknown }).symbol) : null });
    }
    return reply({ settings: await saveWhaleSettings({ entered: list.slice(-20), watch: body.action === "entered" ? Array.from(new Set([coin, ...(current.watch ?? [])])).slice(0, 20) : current.watch }) });
  }
  if (body.action === "watch" || body.action === "unwatch") {
    const coin = String(body.coin ?? "").replace(/[^A-Za-z0-9]/g, ""); if (!coin) return reply({ error: "Which coin?" }, 400);
    const current = await whaleSettings(); const watch = body.action === "watch" ? Array.from(new Set([coin, ...(current.watch ?? [])])).slice(0, 20) : (current.watch ?? []).filter(c => c !== coin);
    return reply({ settings: await saveWhaleSettings({ watch }) });
  }
  if (body.action === "purge-baseline") { const since = Number((body as { since?: number }).since) || Date.now() - 3_600_000; return reply({ removed: await purgeBaselineOpens(since) }); }
  if (body.action === "analyse") {
    const coin = String(body.coin ?? "").replace(/[^A-Za-z0-9]/g, "");
    if (!coin) return reply({ error: "Which coin?" }, 400);
    try { return reply({ analysis: await whaleEntryAnalysis(coin, body.side === "LONG" || body.side === "SHORT" ? body.side : undefined) }); }
    catch (error) { return reply({ error: error instanceof Error ? error.message : "Analysis failed." }, 502); }
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.alerts === "boolean") patch.alerts = body.alerts;
  if (body.minTier === "ELITE" || body.minTier === "STRONG") patch.minTier = body.minTier;
  if (Array.isArray(body.watch)) patch.watch = body.watch.map(c => String(c).replace(/[^A-Za-z0-9]/g, "")).filter(Boolean).slice(0, 20);
  if (Array.isArray(body.coins)) patch.coins = body.coins.map(c => String(c).toUpperCase().replace(/[^A-Z0-9k]/g, "")).filter(Boolean).slice(0, 30);
  return reply({ settings: await saveWhaleSettings(patch) });
}
