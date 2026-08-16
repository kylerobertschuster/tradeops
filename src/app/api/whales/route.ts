import { NextRequest, NextResponse } from "next/server";
import { fetchWhaleTransfers } from "@/lib/onchain";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const minUsdRaw = Number(request.nextUrl.searchParams.get("minUsd") ?? "1000000");
  const blocksRaw = Number(request.nextUrl.searchParams.get("blocks") ?? "15");
  const minUsd = Number.isFinite(minUsdRaw) ? Math.min(Math.max(minUsdRaw, 100_000), 100_000_000) : 1_000_000;
  const blocks = Number.isFinite(blocksRaw) ? Math.min(Math.max(blocksRaw, 5), 100) : 15;

  try {
    const transfers = await fetchWhaleTransfers(minUsd, blocks);
    return NextResponse.json(
      { transfers, minUsd, blocks },
      { headers: { "Cache-Control": "public, max-age=15, s-maxage=15" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, transfers: [] }, { status: 502 });
  }
}
