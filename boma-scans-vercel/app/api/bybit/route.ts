import { NextRequest, NextResponse } from "next/server";

// Bybit blocks US servers; vercel.json pins all functions to Sydney (syd1).
export const dynamic = "force-dynamic";

const API_ORIGIN = "https://api.bybit.com";
const VALID_INTERVALS = new Set([
  "1",
  "3",
  "5",
  "15",
  "30",
  "60",
  "120",
  "240",
  "360",
  "720",
  "D",
  "W",
  "M",
]);

function validSymbol(value: string) {
  return /^[A-Z0-9]{2,24}USDT$/.test(value);
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const kind = search.get("kind");
  const upstream = new URL(
    kind === "kline"
      ? "/v5/market/kline"
      : kind === "instrument" || kind === "instruments"
        ? "/v5/market/instruments-info"
        : kind === "orderbook"
          ? "/v5/market/orderbook"
          : kind === "ratio"
            ? "/v5/market/account-ratio"
            : kind === "oi"
              ? "/v5/market/open-interest"
              : "/v5/market/tickers",
    API_ORIGIN,
  );

  upstream.searchParams.set("category", "linear");

  if (kind === "kline") {
    const symbol = (search.get("symbol") ?? "").toUpperCase();
    const interval = search.get("interval") ?? "15";
    const limit = Math.floor(Math.min(1000, Math.max(1, Number(search.get("limit")) || 260)));

    if (!validSymbol(symbol) || !VALID_INTERVALS.has(interval)) {
      return NextResponse.json(
        { error: "Invalid symbol or interval." },
        { status: 400 },
      );
    }

    upstream.searchParams.set("symbol", symbol);
    upstream.searchParams.set("interval", interval);
    upstream.searchParams.set("limit", String(limit));
    const end = search.get("end");
    if (end !== null) {
      const timestamp = Number(end);
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > Date.now()) return NextResponse.json({error:"Invalid history end time."},{status:400});
      upstream.searchParams.set("end", String(timestamp));
    }
  } else if (kind === "ticker") {
    const symbol = (search.get("symbol") ?? "").toUpperCase();
    if (!validSymbol(symbol)) {
      return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
    }
    upstream.searchParams.set("symbol", symbol);
  } else if (kind === "instrument") {
    const symbol = (search.get("symbol") ?? "").toUpperCase();
    if (!validSymbol(symbol)) {
      return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
    }
    upstream.searchParams.set("symbol", symbol);
  } else if (kind === "orderbook") {
    const symbol = search.get("symbol") ?? "";
    if (!validSymbol(symbol)) {
      return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
    }
    upstream.searchParams.set("symbol", symbol);
    upstream.searchParams.set("limit", "50");
  } else if (kind === "ratio" || kind === "oi") {
    // Crowd positioning: long/short account ratio and open-interest history (hourly, last 24 h).
    const symbol = (search.get("symbol") ?? "").toUpperCase();
    if (!validSymbol(symbol)) return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
    upstream.searchParams.set("symbol", symbol);
    if (kind === "ratio") { upstream.searchParams.set("period", "1h"); upstream.searchParams.set("limit", "25"); }
    else { upstream.searchParams.set("intervalTime", "1h"); upstream.searchParams.set("limit", "25"); }
  } else if (kind === "instruments") {
    upstream.searchParams.set("limit", "1000");
    const cursor = search.get("cursor");
    if (cursor && cursor.length <= 1_000) upstream.searchParams.set("cursor", cursor);
  } else if (kind !== "tickers") {
    return NextResponse.json({ error: "Unknown market request." }, { status: 400 });
  }

  try {
    // Retry transient failures (network, 5xx, HTTP 429 and Bybit's 10006/10016
    // rate-limit/server-busy codes). A dropped pair is never graded, so it can
    // never become a signal.
    let response: Response | undefined;
    let payload: { retCode?: number; retMsg?: string; [key: string]: unknown } | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 250 * 3 ** (attempt - 1)));
      try {
        response = await fetch(upstream, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        });
        const text = await response.text();
        try { payload = JSON.parse(text) as typeof payload; }
        catch {
          // Bybit's regional block returns an HTML/CloudFront page instead of JSON.
          throw new Error("Bybit returned HTTP " + response.status + " with a non-JSON body. Bybit blocks some regions (including US servers); host this app in a non-US region such as Sydney.");
        }
        const transient = response.status >= 500 || response.status === 429 ||
          payload?.retCode === 10006 || payload?.retCode === 10016;
        if (!transient) break;
      } catch (error) { lastError = error; payload = undefined; }
    }
    if (!response || !payload) throw lastError ?? new Error("Bybit connection failed after retry.");

    if (!response.ok || payload?.retCode !== 0) {
      return NextResponse.json(
        { error: payload?.retMsg || "Bybit market data request failed." },
        { status: response.ok ? 502 : response.status },
      );
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Data-Source": "Bybit-V5",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Bybit market data unavailable.",
      },
      { status: 502 },
    );
  }
}
