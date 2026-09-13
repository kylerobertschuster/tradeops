import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for uptime monitors and platform health checks.
 *
 * Deliberately does no upstream work. It answers "is this deployment serving
 * requests", not "are the data providers healthy" — probing Binance or an RPC
 * node here would spend the same request budget the rest of the app works to
 * conserve, and would report *their* outages as ours.
 *
 * `no-store` so a monitor always reaches the worker instead of a cached copy.
 */
export async function GET() {
  return NextResponse.json(
    { ok: true, service: "tradeops", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
