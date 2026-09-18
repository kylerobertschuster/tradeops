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
 *   4. Extra charts are cheap. A multi-chart layout multiplies the one cost
 *      that is per-chart — candle history — so every chart except the focused
 *      one refreshes at `EXTRA_PANE_MS` and leaves the venue fan-out to the
 *      focused chart. Four charts come to 6,480 requests/day, less than the
 *      single-chart ceiling above, and that is the number the tests pin.
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

/**
 * Candle history for a chart that is not the focused one.
 *
 * Kept out of `POLL_MS` on purpose, so `requestsPerDay` above keeps meaning
 * exactly what it meant: the cost of one chart. Candle history is the only
 * per-chart cost in the app, and a four-chart layout at the focused cadence
 * would spend 11,520 requests/day on it alone.
 *
 * What makes the slower cadence acceptable is the socket. Prices and the live
 * bar still arrive over the websocket at no Worker cost; the REST refresh is
 * what recomputes indicators and recovers from a dropped socket, and neither is
 * urgent in a chart you are not looking at. Two minutes versus thirty seconds
 * changes nothing you can see, and it is what keeps four charts inside the
 * budget one chart already fits in.
 */
export const EXTRA_PANE_MS = 120_000;

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
 * Requests one foreground tab spends per day showing `panes` charts.
 *
 * The focused chart pays the cadences in `POLL_MS` and every other chart pays
 * candle history at `EXTRA_PANE_MS` and nothing else. With streaming up, four
 * charts are 4,320 + 3 × 720 = 6,480 requests/day — cheaper than the 13,680 the
 * single-chart ceiling allows, which is the point: the layout is affordable
 * because the expensive per-chart endpoint is the slow one.
 *
 * `streaming: false` is the all-REST fallback, where the ticker poll comes back
 * too. Four charts then cost 13,680 + 2,160 = 15,840, which is **above** the
 * 14,000 ceiling. That is written down rather than hidden: four sockets failing
 * at once is already a degraded state, and the alternative — a chart that never
 * updates because the socket it was relying on went away — is worse than the
 * requests. `polling.test.ts` pins both numbers.
 */
export function requestsPerDayPanes(panes: number, streaming = true): number {
  const charts = Math.max(1, Math.floor(panes));
  // The two per-minute figures are counts of requests a minute; `requestsPerDay`
  // is a count of requests a day. Bring it into the same unit rather than
  // multiplying a daily figure by a day's worth of minutes.
  const focused = streaming
    ? 60_000 / POLL_MS.klines + 60_000 / POLL_MS.venues
    : requestsPerDay() / (60 * 24);
  const extra = (charts - 1) * (60_000 / EXTRA_PANE_MS);
  return Math.round((focused + extra) * 60 * 24);
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
