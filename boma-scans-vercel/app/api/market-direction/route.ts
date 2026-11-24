import { NextResponse } from "next/server";
import { getOwnerUser } from "@/app/server/owner-auth";
import { marketDirectionNow } from "@/app/server/market-direction";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Overall market direction, its comparison with Bitcoin and which one rules. Shown on every section. */
export async function GET() {
  const user = await getOwnerUser(); if (!user) return NextResponse.json({ error: "Sign in at /login." }, { status: 401 });
  try { return NextResponse.json({ direction: await marketDirectionNow() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Market direction unavailable." }, { status: 502 }); }
}
