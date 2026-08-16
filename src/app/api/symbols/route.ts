import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/symbols";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const results = searchSymbols(q);
  return NextResponse.json(results, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}
