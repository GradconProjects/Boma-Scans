import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** The deployed build, so open pages can notice a new deploy and reload themselves. */
export async function GET() {
  return NextResponse.json({ build: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "dev", at: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
