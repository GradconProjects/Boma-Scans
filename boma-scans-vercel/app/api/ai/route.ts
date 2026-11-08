import { NextRequest, NextResponse } from "next/server";
import { getOwnerUser } from "@/app/server/owner-auth";
import { aiSettings, saveAiSettings, storedReviews, type AiProvider } from "@/app/server/ai";
import { analyzePair } from "@/app/server/market-analysis";
import { reviewBeforePush } from "@/app/server/review-signal";
import { readOwnerRecord } from "@/app/server/telegram-delivery";
import { STYLE_CONFIG, type TradingStyle } from "@/app/lib/market";
import type { FlexibilityMode } from "@/app/lib/entry-policy";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** GET: reviewer settings and stored reviews. POST {provider} switches provider; POST {action:"review", symbol} reviews a pair now. */
export async function GET() {
  const user = await getOwnerUser(); if (!user) return reply({ error: "Sign in at /login." }, 401);
  const [settings, reviews] = await Promise.all([aiSettings(), storedReviews()]);
  return reply({ settings, reviews });
}

export async function POST(request: NextRequest) {
  const user = await getOwnerUser(); if (!user) return reply({ error: "Sign in at /login." }, 401);
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "Origin rejected." }, 403);
  const body = await request.json().catch(() => ({})) as { provider?: string; action?: string; symbol?: string };
  if (body.provider) {
    if (!["anthropic", "openai", "off"].includes(body.provider)) return reply({ error: "Unknown provider." }, 400);
    const current = await aiSettings();
    if (body.provider !== "off" && !current.available.includes(body.provider as AiProvider)) return reply({ error: (body.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY") + " is not set in Vercel." }, 400);
    return reply({ settings: { ...await saveAiSettings({ provider: body.provider as AiProvider }), available: current.available } });
  }
  if (body.action === "review") {
    const symbol = String(body.symbol ?? "").toUpperCase();
    if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol)) return reply({ error: "Invalid symbol." }, 400);
    const settings = await aiSettings();
    if (settings.provider === "off") return reply({ error: "No AI provider configured. Add ANTHROPIC_API_KEY in Vercel." }, 400);
    let workspace: Record<string, unknown> = {};
    try { workspace = JSON.parse((await readOwnerRecord("workspace")) ?? "{}"); } catch { /* defaults */ }
    const style = (["SCALP", "DAY", "SWING", "POSITION"].includes(String(workspace.style)) ? workspace.style : "DAY") as TradingStyle;
    const flexibility = (["STRICT", "BALANCED", "FLEXIBLE"].includes(String(workspace.flexibility)) ? workspace.flexibility : "STRICT") as FlexibilityMode;
    try {
      const result = await analyzePair(symbol, STYLE_CONFIG[style].interval, style, flexibility, Number(workspace.fee) || 0.055, Number(workspace.slippage) || 0.02, workspace.targetStyle === "LADDER" ? "LADDER" : "TA");
      const review = await reviewBeforePush(result, true, true);
      if (!review) return reply({ error: "No AI provider configured." }, 400);
      return reply({ review });
    } catch (error) { return reply({ error: error instanceof Error ? error.message : "Review failed." }, 502); }
  }
  return reply({ error: "Unknown action." }, 400);
}
