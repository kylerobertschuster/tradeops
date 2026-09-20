import type { Candle, Interval, SymbolInfo, Ticker } from "./types";
// Type-only imports, erased at build time: the client bundle never pulls in the
// server modules these types are declared in.
import type { WhaleTransfer } from "./onchain";
import type { HolderStats } from "./holders";
import type { MarketSource } from "./market";
import type { VenuesResponse } from "./venues";
// A value import, not a type one: the browser calls BlockScout itself for
// holders. `holders.ts` depends only on the token list and the fetch helper,
// so this pulls no server-side market data into the client bundle.
import { BLOCKSCOUT_BASE, fetchHolderStats } from "./holders";
// Browser-direct market history for the market overview. `overview.ts` imports
// only types and the symbol catalogue, so this pulls no server code — and no
// server-only env — into the client bundle.
import { BINANCE_DIRECT, parseBinanceCandles } from "./overview";

export type { WhaleTransfer, HolderStats, VenuesResponse };

/** Client-side fetchers for the local API routes. */

/** The upstreams that can serve candles, and the only accepted header values. */
const MARKET_SOURCES: readonly MarketSource[] = ["binance", "binanceus", "bybit", "coinbase"];

/**
 * A candle series and the exchange that served it.
 *
 * `source` is `null` only when the header is missing or unrecognised — an older
 * cached response, or something other than this app answering. The chart says
 * so rather than picking a name, because a wrong attribution is worse than
 * none.
 */
export type CandlesResponse = {
  candles: Candle[];
  source: MarketSource | null;
};

export async function fetchKlines(
  symbol: string,
  interval: Interval,
  limit = 500,
): Promise<CandlesResponse> {
  const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Klines request failed (${res.status})`);
  const header = res.headers.get("x-data-source");
  const source = MARKET_SOURCES.find((s) => s === header) ?? null;
  return { candles: (await res.json()) as Candle[], source };
}

export async function fetchTickers(symbols: string[]): Promise<Record<string, Ticker>> {
  if (symbols.length === 0) return {};
  const res = await fetch(`/api/tickers?symbols=${encodeURIComponent(symbols.join(","))}`);
  // A non-200 means every provider declined. Returning `{}` here would be
  // indistinguishable from "no prices", so the caller is told instead and can
  // decide to keep the last good values on screen.
  if (!res.ok) throw new Error(`Tickers request failed (${res.status})`);
  return (await res.json()) as Record<string, Ticker>;
}

export async function searchSymbols(q: string): Promise<SymbolInfo[]> {
  const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return (await res.json()) as SymbolInfo[];
}

/**
 * All venues' own candles and 24h stats for one symbol.
 *
 * `bars` is a ceiling, not a promise: the venues have different history caps,
 * so the route clamps every venue to the same window and reports the count it
 * actually used as `bars`. Treating fewer bars than requested as an error would
 * fire on nearly every call.
 */
export async function fetchVenues(
  symbol: string,
  interval: Interval,
  bars = 300,
): Promise<VenuesResponse> {
  const res = await fetch(
    `/api/venues?symbol=${encodeURIComponent(symbol)}&interval=${interval}&bars=${bars}`,
  );
  if (!res.ok) throw new Error(`Venues request failed (${res.status})`);
  return (await res.json()) as VenuesResponse;
}

export async function fetchWhales(minUsd = 1_000_000, blocks = 15): Promise<WhaleTransfer[]> {
  const res = await fetch(`/api/whales?minUsd=${minUsd}&blocks=${blocks}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { transfers?: WhaleTransfer[] };
  return data.transfers ?? [];
}

export async function fetchAddressTransfers(address: string): Promise<WhaleTransfer[]> {
  const res = await fetch(`/api/transfers?address=${encodeURIComponent(address)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { transfers?: WhaleTransfer[] };
  return data.transfers ?? [];
}

export async function fetchHolders(symbol: string): Promise<HolderStats | null> {
  // Asked of BlockScout directly first, because BlockScout rate-limits by IP
  // and the hosted deploy's Worker shares its egress IP with every other
  // Cloudflare Worker — the server route answers `429 Too many requests` to a
  // visitor's first, uncached request. The visitor's own connection has its
  // own 180-per-minute allowance, so it is the reliable path; the same-origin
  // route stays as the fallback for networks BlockScout refuses or blocks.
  try {
    return await fetchHolderStats(symbol, BLOCKSCOUT_BASE);
  } catch {
    // Fall through: the route has its own cache, and may already hold an
    // answer this tab has not seen.
  }
  const res = await fetch(`/api/holders?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  return (await res.json()) as HolderStats;
}

/**
 * Candle history for one market, asked of the venue by the browser itself.
 *
 * This is the one fetcher here that does not call our own Worker, and the
 * omission is the point. The market overview reads twenty-four markets at once,
 * and each market is a separate upstream request: served through a route of
 * ours, one page load would fan out into twenty-four subrequests on the
 * tightest limit in the deployment. The browser has its own connection and its
 * own allowance, and the venue serves this endpoint with
 * `access-control-allow-origin: *` — so the Worker never sees the request, and
 * the free-tier budget is spent by the charts rather than by the overview.
 *
 * What that costs is the visitor's bandwidth, which is why it is measured in
 * hundreds of kilobytes every few minutes rather than in requests.
 *
 * A market the venue will not serve rejects, and the caller treats a rejection
 * as "no history for this market" rather than retrying: the overview is a
 * glance at everything, and one unlisted pair must not hold up the other
 * twenty-three. `parseBinanceCandles` is the same reading of the same payload
 * the Worker does, kept in the pure module so it can be tested without a
 * network.
 */
export async function fetchOverviewCandles(
  symbol: string,
  interval: Interval,
  bars: number,
): Promise<Candle[]> {
  // Our interval names are Binance's own codes — `BINANCE_IV` in `market.ts` is
  // the identity — so nothing is translated here, and a divergence would be a
  // type error rather than a silent 400.
  const url = `${BINANCE_DIRECT}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${bars}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`market data host answered ${res.status} for ${symbol}`);
  return parseBinanceCandles((await res.json()) as unknown);
}
