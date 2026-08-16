import type { Candle, Interval, Ticker } from "./types";
import { ALL_SYMBOLS } from "./symbols";

/**
 * Server-side market data layer.
 * Providers (no API keys required): Binance -> Bybit -> Coinbase/CoinGecko.
 */

const BINANCE_IV: Record<Interval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
};

const BYBIT_IV: Record<Interval, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1w": "W",
};

const COINBASE_GRAN: Record<Interval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

const cache = new Map<string, { t: number; data: unknown }>();

async function cachedJson(url: string, ttlMs = 5000): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttlMs) return hit.data;
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const data = await res.json();
  cache.set(url, { t: Date.now(), data });
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return data;
}

async function binanceKlines(symbol: string, interval: Interval, limit: number): Promise<Candle[] | null> {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${BINANCE_IV[interval]}&limit=${limit}`;
    const data = (await cachedJson(url, 5000)) as unknown[];
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map((k) => {
      const r = k as number[];
      return {
        time: Math.floor(r[0] / 1000),
        open: +r[1],
        high: +r[2],
        low: +r[3],
        close: +r[4],
        volume: +r[5],
      };
    });
  } catch {
    return null;
  }
}

async function bybitKlines(symbol: string, interval: Interval, limit: number): Promise<Candle[] | null> {
  try {
    const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${BYBIT_IV[interval]}&limit=${limit}`;
    const data = (await cachedJson(url, 5000)) as { result?: { list?: string[][] } };
    const list = data?.result?.list;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list
      .map((k) => ({
        time: +k[0],
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
      }))
      .reverse();
  } catch {
    return null;
  }
}

async function coinbaseKlines(symbol: string, interval: Interval, limit: number): Promise<Candle[] | null> {
  try {
    const base = symbol.replace(/USDT$/, "");
    const url = `https://api.exchange.coinbase.com/products/${base}-USD/candles?granularity=${COINBASE_GRAN[interval]}`;
    const data = (await cachedJson(url, 5000)) as unknown[];
    if (!Array.isArray(data) || data.length === 0) return null;
    // Coinbase order: [time, low, high, open, close, volume], newest first
    return data
      .map((c) => {
        const r = c as number[];
        return { time: r[0], open: +r[3], high: +r[2], low: +r[1], close: +r[4], volume: +r[5] };
      })
      .reverse()
      .slice(-limit);
  } catch {
    return null;
  }
}

export async function fetchKlines(symbol: string, interval: Interval, limit = 500): Promise<Candle[]> {
  const providers = [binanceKlines, bybitKlines, coinbaseKlines];
  for (const provider of providers) {
    const result = await provider(symbol, interval, limit);
    if (result && result.length > 0) return result;
  }
  throw new Error(`No market data available for ${symbol}`);
}

async function binanceTickers(symbols: string[]): Promise<Record<string, Ticker> | null> {
  try {
    const q = encodeURIComponent(JSON.stringify(symbols));
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${q}`;
    const data = (await cachedJson(url, 3000)) as Array<Record<string, string>>;
    if (!Array.isArray(data)) return null;
    const out: Record<string, Ticker> = {};
    for (const t of data) {
      const base = t.symbol.replace(/USDT$/, "");
      out[t.symbol] = {
        symbol: t.symbol,
        base,
        price: +t.lastPrice,
        change24h: +t.priceChangePercent,
        high24h: +t.highPrice,
        low24h: +t.lowPrice,
        quoteVolume: +t.quoteVolume,
      };
    }
    return out;
  } catch {
    return null;
  }
}

async function coingeckoTickers(symbols: string[]): Promise<Record<string, Ticker> | null> {
  try {
    const infos = symbols
      .map((s) => ALL_SYMBOLS.find((x) => x.symbol === s))
      .filter((x) => x?.cgId) as Array<{ symbol: string; base: string; cgId: string }>;
    if (infos.length === 0) return null;
    const ids = infos.map((i) => i.cgId).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_high_low=true&include_24hr_vol=true`;
    const data = (await cachedJson(url, 5000)) as Record<string, {
      usd?: number;
      usd_24h_change?: number;
      usd_24h_high?: number;
      usd_24h_low?: number;
      usd_24h_vol?: number;
    }>;
    const out: Record<string, Ticker> = {};
    for (const info of infos) {
      const d = data?.[info.cgId];
      if (!d?.usd) continue;
      out[info.symbol] = {
        symbol: info.symbol,
        base: info.base,
        price: d.usd,
        change24h: d.usd_24h_change ?? 0,
        high24h: d.usd_24h_high ?? d.usd,
        low24h: d.usd_24h_low ?? d.usd,
        quoteVolume: d.usd_24h_vol ?? 0,
      };
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export async function fetchTickers(symbols: string[]): Promise<Record<string, Ticker>> {
  if (symbols.length === 0) return {};
  const binance = await binanceTickers(symbols);
  if (binance) return binance;
  const cg = await coingeckoTickers(symbols);
  if (cg) return cg;
  return {};
}
