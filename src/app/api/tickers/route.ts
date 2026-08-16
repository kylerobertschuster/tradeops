import { NextRequest, NextResponse } from "next/server";
import { fetchTickers } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9]{2,20}USDT$/.test(s)),
    ),
  ).slice(0, 60);

  if (symbols.length === 0) {
    return NextResponse.json({}, { headers: { "Cache-Control": "public, max-age=5, s-maxage=5" } });
  }

  const tickers = await fetchTickers(symbols);
  return NextResponse.json(tickers, {
    headers: { "Cache-Control": "public, max-age=5, s-maxage=5" },
  });
}
