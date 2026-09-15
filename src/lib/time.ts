/**
 * Shared time normalization.
 *
 * This lives on its own instead of in `market.ts` because `market.ts` and
 * `venues.ts` need each other: `market.ts` reads Crypto.com's bulk ticker
 * through the venue row parser, and `venues.ts` needs this function. Keeping
 * it in `market.ts` would make the two modules a cycle, where a module-level
 * constant could be read before its own module had finished evaluating.
 */

/**
 * Normalize a provider timestamp to unix seconds, which is what `Candle.time`
 * promises. Providers disagree: Binance, Coinbase, OKX, Kraken and Crypto.com
 * report seconds, Bybit reports milliseconds. The two scales are ~1000x apart
 * (seconds reach ~1.8e9 today, milliseconds ~1.8e12), so a threshold at 1e11
 * separates them cleanly and will keep doing so for centuries. Without this, a
 * Bybit response shifts every candle by 1000x and silently wrecks the time axis.
 */
export function toSeconds(t: number): number {
  return t >= 1e11 ? Math.floor(t / 1000) : t;
}
