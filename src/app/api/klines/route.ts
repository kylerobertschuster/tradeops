import { NextRequest, NextResponse } from "next/server";
import { fetchKlinesWithSource } from "@/lib/market";
import type { Interval } from "@/lib/types";
import { INTERVALS } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase() ?? "";
  const interval = (request.nextUrl.searchParams.get("interval") ?? "15m") as Interval;
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "500");
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 500, 50), 1000);

  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }
  if (!INTERVALS.includes(interval)) {
    return NextResponse.json({ error: "Invalid interval" }, { status: 400 });
  }

  try {
    const { source, candles } = await fetchKlinesWithSource(symbol, interval, limit);
    // The provider travels as a header rather than in the body, so the response
    // stays a plain array for existing callers and the header is cached
    // alongside the candles it describes — they can never disagree.
    return NextResponse.json(candles, {
      headers: {
        "Cache-Control": "public, max-age=10, s-maxage=10",
        "X-Data-Source": source,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
