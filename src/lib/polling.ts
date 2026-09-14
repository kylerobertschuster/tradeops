/**
 * Poll cadences, and the rule that keeps them affordable.
 *
 * These are **fallback** cadences. Prices and candles normally arrive over a
 * websocket straight from the exchange (`src/lib/live.ts`), which never touches
 * the Worker and so costs nothing against the request quota. Polling only runs
 * when that socket is unavailable, or for the chart's candle history, which is
 * re-fetched to recompute indicators.
 *
 * On Cloudflare Workers Free we get 100,000 requests/day, and a cache hit
 * still counts as a request — Cloudflare bills cache hits as requests and only
 * spares them the CPU time. Edge caching therefore buys back nothing from the
 * request budget; the only lever is how many requests the browser makes.
 *
 * At the original cadences (5s / 15s / 20s / 120s), with every price polled
 * over REST, one foreground tab spent ~28,000 requests a day, so the entire
 * free tier covered roughly three open tabs. Three rules fix that:
 *
 *   1. Streaming replaces polling. While the socket is live the ticker poll is
 *      skipped entirely, which is most of the traffic.
 *   2. A hidden tab makes no requests. Nobody can see a background tab, so
 *      every request it issues is wasted. Polling stops when the document
 *      hides and resumes with an immediate refresh when it is visible again.
 *   3. The fallback cadences are slower. 15s / 30s / 30s / 120s / 60s is still
 *      live enough for a dashboard and bounds the cost when streaming is down.
 *      With every endpoint polled over REST, one foreground tab is 13,680
 *      requests/day, so the free tier covers about seven.
 *
 * What is left while streaming is the chart's candle history (klines, 30s) and
 * the multi-venue fan-out (venues, 60s), which together cost about 4,300
 * requests/day on the default view; the on-chain panels add roughly 3,600 more
 * and `RightPanel` only mounts them while that tab is open. `polling.test.ts`
 * fails if a future edit shortens these past the budget, so the hosting maths
 * cannot silently regress.
 */

export const POLL_MS = {
  tickers: 15_000,
  klines: 30_000,
  whales: 30_000,
  holders: 120_000,
  /**
   * Multi-venue comparison (`/api/venues`).
   *
   * Slower than the other cadences on purpose, for two reasons. It is the most
   * expensive endpoint in the app — one incoming request fans out to 12
   * upstream ones — and it is the least urgent: the strip labels each row
   * `live` or `polled`, and the primary venue already ticks over the websocket
   * at no Worker cost. A minute-old venue spread is still the right answer to
   * "do these venues disagree?", which moves on the scale of funding rates and
   * order-book depth, not seconds.
   */
  venues: 60_000,
} as const;

/** Cloudflare Workers Free plan allowance, per day, resetting at 00:00 UTC. */
export const WORKERS_FREE_REQUESTS_PER_DAY = 100_000;

/**
 * Requests one always-visible tab spends per day across the polled endpoints.
 * Used by the tests to pin the cadences to a hosting budget.
 */
export function requestsPerDay(intervals: Record<string, number> = POLL_MS): number {
  const perMinute = Object.values(intervals).reduce((total, ms) => total + 60_000 / ms, 0);
  return Math.round(perMinute * 60 * 24);
}

/**
 * Whether the document is visible. Server rendering and non-browser
 * environments have no `document`, and should be treated as visible so an
 * initial fetch still happens.
 */
function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * Run `task` on an interval, but only while the document is visible.
 *
 * Returns a cleanup function. The task runs once immediately when polling
 * starts — including when a hidden tab becomes visible again, so you never
 * return to a stale screen.
 */
export function startVisiblePolling(task: () => void, intervalMs: number): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;

  const start = () => {
    if (timer !== undefined) return;
    task();
    timer = setInterval(() => {
      if (documentVisible()) task();
    }, intervalMs);
  };

  const stop = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  const onVisibilityChange = () => (documentVisible() ? start() : stop());

  if (documentVisible()) start();
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
