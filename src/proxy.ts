import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, clientIp, limitForPath } from "@/lib/ratelimit";

/**
 * Request proxy — the single choke point in front of every API route.
 *
 * Next.js 16 renamed this convention from `middleware.ts` to `proxy.ts`.
 *
 * Rate limiting lives here rather than in the individual route handlers so that
 * new routes are protected by default: adding `/api/whatever` cannot silently
 * ship without a limit. See `@/lib/ratelimit` for the algorithm and for the
 * per-process caveat.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const limit = limitForPath(pathname);

  // Keyed per client *and* per path so a burst on one route cannot starve the
  // others — the tickers and candles polls both need to keep working.
  const result = checkRateLimit(`${clientIp(request)}:${pathname}`, limit);

  if (!result.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfterSec),
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": "0",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
