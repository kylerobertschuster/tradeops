import type { Candle, Interval, SymbolInfo, Ticker } from "./types";
import type { WhaleTransfer } from "./onchain";

export type { WhaleTransfer };

/** Client-side fetchers for the local API routes. */

export async function fetchKlines(symbol: string, interval: Interval, limit = 500): Promise<Candle[]> {
  const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Klines request failed (${res.status})`);
  return (await res.json()) as Candle[];
}

export async function fetchTickers(symbols: string[]): Promise<Record<string, Ticker>> {
  if (symbols.length === 0) return {};
  const res = await fetch(`/api/tickers?symbols=${encodeURIComponent(symbols.join(","))}`);
  if (!res.ok) return {};
  return (await res.json()) as Record<string, Ticker>;
}

export async function searchSymbols(q: string): Promise<SymbolInfo[]> {
  const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return (await res.json()) as SymbolInfo[];
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
