import { NextRequest, NextResponse } from "next/server";
import { fetchTickers, UpstreamExhaustedError } from "@/lib/market";

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

  const tickers = await fetchTickers(symbols).catch((err: unknown) => err);

  // 200 with `{}` is not an answer: the client cannot tell "no prices right now"
  // from "every provider is refusing us", so it renders an empty board and
  // looks healthy. An exhausted upstream is a 502 — and it is explicitly
  // uncacheable, since caching a failure would keep serving it after recovery.
  if (tickers instanceof Error) {
    return NextResponse.json(
      {
        error: "upstream_unavailable",
        message:
          tickers instanceof UpstreamExhaustedError
            ? tickers.message
            : "Ticker providers failed",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(tickers, {
    headers: { "Cache-Control": "public, max-age=5, s-maxage=5" },
  });
}
