import { NextRequest, NextResponse } from "next/server";
import { fetchHolderStats } from "@/lib/holders";
import { TRACKED_TOKENS } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "USDC").toUpperCase();
  const token = TRACKED_TOKENS.find((t) => t.symbol === symbol);
  if (!token) {
    return NextResponse.json({ error: `Unknown token: ${symbol}` }, { status: 400 });
  }
  try {
    const stats = await fetchHolderStats(token.symbol);
    return NextResponse.json(stats, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Holder fetch failed";
    // A spent rate limit is not a server fault, and the caller should be told
    // apart from a genuinely broken upstream: 503 says "try again later".
    const rateLimited = message.includes("rate limit");
    return NextResponse.json(
      { error: message },
      { status: rateLimited ? 503 : 502, headers: { "Retry-After": "60" } },
    );
  }
}
