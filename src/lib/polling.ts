/**
 * Poll cadences, and the rule that keeps them affordable.
 *
 * On Cloudflare Workers Free we get 100,000 requests/day, and a cache hit
 * still counts as a request — Cloudflare bills cache hits as requests and only
 * spares them the CPU time. Edge caching therefore buys back nothing from the
 * request budget; the only lever is how many requests the browser makes.
 *
 * At the original cadences (5s / 15s / 20s / 120s) one foreground tab spent
 * ~28,000 requests a day, so the entire free tier covered roughly three open
 * tabs. Two rules fix that:
 *
 *   1. A hidden tab makes no requests. Nobody can see a background tab, so
 *      every request it issues is wasted. Polling stops when the document
 *      hides and resumes with an immediate refresh when it is visible again.
 *   2. The cadences are slower. 15s / 30s / 30s / 120s is still live enough for
 *      a dashboard and costs up to ~12,200 requests/day per foreground tab in
 *      the worst case (chart plus the on-chain tab; `RightPanel` only mounts
 *      `OnchainPanel` when that tab is active, so the default view is ~8,600).
 *
 * `polling.test.ts` fails if a future edit shortens these past the budget, so
 * the hosting maths cannot silently regress.
 */

export const POLL_MS = {
  tickers: 15_000,
  klines: 30_000,
  whales: 30_000,
  holders: 120_000,
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
