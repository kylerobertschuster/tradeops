import { NextRequest, NextResponse } from "next/server";
import { fetchAddressTransfers } from "@/lib/onchain";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const address = (request.nextUrl.searchParams.get("address") ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const transfers = await fetchAddressTransfers(address);
    return NextResponse.json(
      { address, transfers },
      { headers: { "Cache-Control": "public, max-age=20, s-maxage=20" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, transfers: [] }, { status: 502 });
  }
}
