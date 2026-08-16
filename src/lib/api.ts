import type { Candle, Interval, SymbolInfo, Ticker } from "./types";

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
