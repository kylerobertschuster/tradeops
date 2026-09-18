/**
 * Shared upstream fetch helpers.
 *
 * Every outbound request to a third party (Binance, Bybit, Coinbase,
 * CoinGecko, public RPC, BlockScout) MUST be bounded. Without a deadline a
 * single stalled upstream holds the request open until the platform kills it —
 * and because the provider failover chains await each provider in turn, one
 * hung Binance socket also prevents the Bybit and Coinbase fallbacks from ever
 * running. A timeout is therefore both a resource guard and a correctness fix.
 */

export const UPSTREAM_TIMEOUT_MS = 8_000;

/**
 * Remaining time before `deadline` (epoch ms), clamped to `[0, cap]`.
 *
 * Provider failover chains try several upstreams in sequence. Bounding each
 * attempt is not enough — the tail latency is attempts x timeout, which on a
 * serverless platform means the whole invocation budget burns out while the
 * user stares at a spinner. Chains therefore share one overall deadline and
 * stop early once it is exhausted.
 */
export function budgetMs(deadline: number, cap: number = UPSTREAM_TIMEOUT_MS): number {
  return Math.max(0, Math.min(cap, deadline - Date.now()));
}

export class UpstreamTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Upstream timed out after ${timeoutMs}ms (${hostOf(url)})`);
    this.name = "UpstreamTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * A refusal from an upstream, carrying the status code.
 *
 * The code is the whole point: some refusals describe the request (429, 500 —
 * retry, the next one may work) and some describe the network this code is
 * running on (403, 451 — a datacentre-IP ban or a geo-block, which will fail
 * identically for every later request). Callers that can tell the two apart
 * stop paying a dead round trip on every cache miss.
 */
export class UpstreamStatusError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`HTTP ${status} from ${hostOf(url)}`);
    this.name = "UpstreamStatusError";
    this.url = url;
    this.status = status;
  }

  /** True when retrying is pointless: the host is refusing this network. */
  get isHardRefusal(): boolean {
    return this.status === 403 || this.status === 451;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * `fetch` with a hard deadline.
 *
 * A caller-supplied `init.signal` is combined with the timeout so both
 * cancellation sources remain effective.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    // Only attribute the failure to the deadline if our timer is what fired —
    // otherwise the caller cancelled and the original error should propagate.
    if (timeout.aborted) throw new UpstreamTimeoutError(url, timeoutMs);
    throw e;
  }
}

/** Host of a URL, for error messages. Falls back to the raw string. */
export function upstreamHost(url: string): string {
  return hostOf(url);
}
