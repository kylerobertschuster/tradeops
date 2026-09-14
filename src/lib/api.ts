import type { Candle, Interval, SymbolInfo, Ticker } from "./types";
import type { WhaleTransfer } from "./onchain";
import type { HolderStats } from "./holders";
import type { VenuesResponse } from "./venues";

export type { WhaleTransfer, HolderStats, VenuesResponse };

/** Client-side fetchers for the local API routes. */

export async function fetchKlines(symbol: string, interval: Interval, limit = 500): Promise<Candle[]> {
  const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Klines request failed (${res.status})`);
  return (await res.json()) as Candle[];
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
  const res = await fetch(`/api/holders?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  return (await res.json()) as HolderStats;
}
