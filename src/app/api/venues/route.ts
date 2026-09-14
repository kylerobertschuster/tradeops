import { NextRequest, NextResponse } from "next/server";
import { fetchAllVenues } from "@/lib/venues";
import type { Interval } from "@/lib/types";
import { INTERVALS } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Every venue's own view of one symbol, in one browser request.
 *
 * The fan-out is deliberate and is the whole feature: `market.ts` answers this
 * question by picking a winner, which hides the fact that venues disagree. Here
 * each venue reports separately, and a venue that is blocked, delisted, or slow
 * comes back as a named fault alongside the others' data rather than taking the
 * whole response down with it.
 *
 * One browser request, `2 x 6` upstream subrequests. The client-side polling
 * budget in `lib/polling.ts` is therefore unchanged by this route.
 *
 * An interval only some venues offer (1s, which is Binance-only) is answered
 * normally rather than refused: the others report `unsupported-interval` and
 * the strip says so per row. That costs no subrequests at all — the capability
 * check happens before any request is built — and it is the honest answer,
 * because "this venue does not offer 1-second candles" is information the user
 * wants, not an error.
 */
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase() ?? "";
  const interval = (request.nextUrl.searchParams.get("interval") ?? "15m") as Interval;
  const barsRaw = Number(request.nextUrl.searchParams.get("bars") ?? "300");
  const bars = Math.min(Math.max(Number.isFinite(barsRaw) ? barsRaw : 300, 50), 1000);

  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }
  if (!INTERVALS.includes(interval)) {
    return NextResponse.json({ error: "Invalid interval" }, { status: 400 });
  }

  try {
    const payload = await fetchAllVenues(symbol, interval, bars, request.signal);
    return NextResponse.json(payload, {
      headers: {
        // Shorter than the upstream TTL so a burst of clients collapses onto
        // one fan-out per edge location, without the strip feeling stale.
        "Cache-Control": "public, max-age=5, s-maxage=5",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
