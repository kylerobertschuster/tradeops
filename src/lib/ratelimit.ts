/**
 * In-memory, per-client rate limiting for the API routes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every `/api/*` route is an unauthenticated proxy to a free third-party
 * upstream (Binance, CoinGecko, public Ethereum RPC, BlockScout). None of those
 * have an SLA, and all of them will ban an origin that hammers them. Without a
 * limiter a single client running a `while (true) fetch(...)` loop can get this
 * deployment's egress IP blocked — which takes the whole site down, not just
 * the abuser. The limiter is therefore about protecting the service from its
 * own upstream dependencies, not just about fairness.
 *
 * SCOPE AND LIMITATION (read before relying on this)
 * -------------------------------------------------
 * State lives in module scope, so it is **per-process** and resets on cold
 * start. On a multi-instance deployment the effective limit is
 * `instances × limit`. That is adequate for stopping naive abuse and runaway
 * client loops, but it is not a hard guarantee. For a durable, cluster-wide
 * limit, back this with Redis (e.g. Upstash) behind the same `checkRateLimit`
 * interface.
 */

/** Length of one rate-limit window. */
const WINDOW_MS = 60_000;

/** Hard cap on tracked clients, so a spoofed-IP flood cannot exhaust memory. */
const MAX_TRACKED_CLIENTS = 10_000;

type ClientWindow = {
  windowStart: number;
  count: number;
  /** Count from the immediately preceding window, used for smoothing. */
  previousCount: number;
};

const windows = new Map<string, ClientWindow>();

/**
 * Per-route limits, per client, per minute.
 *
 * On-chain routes are deliberately far stricter than the rest: a single
 * `/api/whales` call fans out to eight `eth_getLogs` calls across up to four
 * RPC nodes, so it costs roughly two orders of magnitude more upstream quota
 * than a cached candle request.
 *
 * `/api/symbols` gets a generous limit because it performs a search over a
 * static in-memory list and makes no upstream call at all — the limit there is
 * only to bound CPU.
 */
const ROUTE_LIMITS: ReadonlyArray<{ prefix: string; limit: number }> = [
  { prefix: "/api/whales", limit: 30 },
  { prefix: "/api/transfers", limit: 30 },
  { prefix: "/api/holders", limit: 20 },
  { prefix: "/api/symbols", limit: 300 },
];

/**
 * Default budget. A normally-behaving client uses roughly 20 requests/minute
 * (tickers poll 12, candles 4, whale feed 3, holders 0.5), so this leaves ~6x
 * headroom for several open tabs while still shutting down a loop quickly.
 */
const DEFAULT_LIMIT = 120;

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window frees up; only meaningful when `ok` is false. */
  retryAfterSec: number;
};

/** The configured limit for a request path. */
export function limitForPath(pathname: string): number {
  for (const route of ROUTE_LIMITS) {
    if (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) {
      return route.limit;
    }
  }
  return DEFAULT_LIMIT;
}

/**
 * Sliding-window counter.
 *
 * A plain fixed window lets a client send `2 × limit` requests across a window
 * boundary (limit at the end of one window, limit at the start of the next).
 * Weighting the previous window's count by how far into the current window we
 * are smooths that out, at the cost of one extra number per client.
 */
export function checkRateLimit(key: string, limit: number, now = Date.now()): RateLimitResult {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;

  let entry = windows.get(key);
  if (!entry) {
    entry = { windowStart, count: 0, previousCount: 0 };
    windows.set(key, entry);
    pruneIfNeeded(now);
  } else if (entry.windowStart !== windowStart) {
    // Roll forward. Only carry the previous count if the last window was the
    // one immediately before this one; otherwise the client has been idle.
    entry.previousCount = entry.windowStart === windowStart - WINDOW_MS ? entry.count : 0;
    entry.count = 0;
    entry.windowStart = windowStart;
  }

  const elapsed = now - windowStart;
  const estimate = entry.previousCount * (1 - elapsed / WINDOW_MS) + entry.count;

  if (estimate >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000));
    return { ok: false, limit, remaining: 0, retryAfterSec };
  }

  entry.count += 1;
  return {
    ok: true,
    limit,
    remaining: Math.max(0, Math.floor(limit - estimate - 1)),
    retryAfterSec: 0,
  };
}

/**
 * Drop stale windows once the table grows too large.
 *
 * Entries older than two windows can never contribute to an estimate again, so
 * they are safe to remove. Walking the whole map is O(n) but only happens on a
 * growth boundary.
 */
function pruneIfNeeded(now: number): void {
  if (windows.size <= MAX_TRACKED_CLIENTS) return;
  const cutoff = Math.floor(now / WINDOW_MS) * WINDOW_MS - 2 * WINDOW_MS;
  for (const [key, entry] of windows) {
    if (entry.windowStart < cutoff) windows.delete(key);
  }
}

/**
 * Best-effort client identifier.
 *
 * Prefers headers that a proxy *sets* (and therefore overwrites) over
 * `x-forwarded-for`, which is *append*-style and can be seeded by the client.
 * Falling back to the right-most `x-forwarded-for` entry — the hop added by the
 * closest proxy — makes a spoofed first entry useless for rotating the key.
 *
 * This is abuse mitigation, not authentication: a client behind a NAT shares a
 * bucket, and a determined attacker with many source IPs can still spread out.
 */
export function clientIp(request: Request): string {
  const single = ["cf-connecting-ip", "x-vercel-forwarded-for", "x-real-ip", "fly-client-ip"];
  for (const header of single) {
    const value = request.headers.get(header)?.trim();
    if (value) return value;
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const last = hops[hops.length - 1]?.trim();
    if (last) return last;
  }

  return "unknown";
}
