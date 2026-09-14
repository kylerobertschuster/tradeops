import type { Candle, Interval, Ticker } from "./types";
import { ALL_SYMBOLS } from "./symbols";
import { fetchWithTimeout, budgetMs, UPSTREAM_TIMEOUT_MS } from "./http";

/**
 * Server-side market data layer.
 * Providers (no API keys required): Binance -> Bybit -> Coinbase/CoinGecko.
 */

/**
 * Parse an optional provider number field.
 *
 * Providers return these as strings and routinely omit them, and `+""` is 0 —
 * not NaN — so a missing 24h high would silently become a real-looking $0.00.
 * Absence has to survive as null all the way to the UI.
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const BINANCE_IV: Record<Interval, string> = {
  "1s": "1s",
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
};

// Bybit and Coinbase do not offer 1-second candles (Bybit's floor is 1m, and
// Coinbase's `/candles` granularity starts at 60s). `null` means "this provider
// cannot serve that interval" so the chain skips it instead of asking for a
// different interval and silently mislabelling the result.
const BYBIT_IV: Record<Interval, string | null> = {
  "1s": null,
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1w": "W",
};

const COINBASE_GRAN: Record<Interval, number | null> = {
  "1s": null,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

const cache = new Map<string, { t: number; data: unknown }>();

/**
 * Drop every cached provider response.
 *
 * Exported for tests: this cache lives at module scope, so without a way to
 * clear it a success in one test answers the same URL in the next one.
 */
export function clearMarketCache(): void {
  cache.clear();
}

/**
 * Normalize a provider timestamp to unix seconds, which is what `Candle.time`
 * promises. Providers disagree: Binance and Coinbase report seconds, Bybit
 * reports milliseconds. The two scales are ~1000x apart (seconds reach ~1.8e9
 * today, milliseconds ~1.8e12), so a threshold at 1e11 separates them cleanly
 * and will keep doing so for centuries. Without this, a Bybit response shifts
 * every candle by 1000x and silently wrecks the time axis.
 */
export function toSeconds(t: number): number {
  return t >= 1e11 ? Math.floor(t / 1000) : t;
}

/** Overall budget for a full provider-failover chain (see `budgetMs`). */
const CHAIN_BUDGET_MS = 12_000;

async function cachedJson(url: string, ttlMs = 5000, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttlMs) return hit.data;
  const res = await fetchWithTimeout(
    url,
    { headers: { accept: "application/json" }, cache: "no-store" },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const data = await res.json();
  cache.set(url, { t: Date.now(), data });
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return data;
}

/**
 * Binance hosts, tried in order.
 *
 * `api.binance.com` answers HTTP 451 ("Service unavailable from a restricted
 * location") from US egress, which is where this app's Cloudflare Worker runs,
 * so asking it first spent the budget before falling through to another
 * provider entirely. `data-api.binance.vision` is Binance's public market-data
 * mirror: the same public endpoints, no API key, and not geo-restricted. The
 * main host stays as a second attempt for regions where the mirror is blocked.
 */
const BINANCE_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

/** Fetch `path` from the first Binance host that answers. */
async function binanceJson(path: string, ttlMs: number, timeoutMs: number): Promise<unknown> {
  let lastError: unknown = new Error("no Binance host attempted");
  for (const host of BINANCE_HOSTS) {
    try {
      return await cachedJson(`${host}${path}`, ttlMs, timeoutMs);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function binanceKlines(symbol: string, interval: Interval, limit: number, timeoutMs: number): Promise<Candle[] | null> {
  try {
    const path = `/api/v3/klines?symbol=${symbol}&interval=${BINANCE_IV[interval]}&limit=${limit}`;
    const data = (await binanceJson(path, 5000, timeoutMs)) as unknown[];
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map((k) => {
      const r = k as number[];
      return {
        time: toSeconds(r[0]),
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

async function bybitKlines(symbol: string, interval: Interval, limit: number, timeoutMs: number): Promise<Candle[] | null> {
  const intervalCode = BYBIT_IV[interval];
  if (intervalCode === null) return null;
  try {
    const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${intervalCode}&limit=${limit}`;
    const data = (await cachedJson(url, 5000, timeoutMs)) as { result?: { list?: string[][] } };
    const list = data?.result?.list;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list
      .map((k) => ({
        time: toSeconds(+k[0]),
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

async function coinbaseKlines(symbol: string, interval: Interval, limit: number, timeoutMs: number): Promise<Candle[] | null> {
  const granularity = COINBASE_GRAN[interval];
  if (granularity === null) return null;
  try {
    const base = symbol.replace(/USDT$/, "");
    const url = `https://api.exchange.coinbase.com/products/${base}-USD/candles?granularity=${granularity}`;
    const data = (await cachedJson(url, 5000, timeoutMs)) as unknown[];
    if (!Array.isArray(data) || data.length === 0) return null;
    // Coinbase order: [time, low, high, open, close, volume], newest first
    return data
      .map((c) => {
        const r = c as number[];
        return { time: toSeconds(r[0]), open: +r[3], high: +r[2], low: +r[1], close: +r[4], volume: +r[5] };
      })
      .reverse()
      .slice(-limit);
  } catch {
    return null;
  }
}

export async function fetchKlines(symbol: string, interval: Interval, limit = 500): Promise<Candle[]> {
  const providers = [binanceKlines, bybitKlines, coinbaseKlines];
  const deadline = Date.now() + CHAIN_BUDGET_MS;
  for (const provider of providers) {
    // Stop before starting an attempt we cannot finish within the budget.
    const timeoutMs = budgetMs(deadline);
    if (timeoutMs <= 0) break;
    const result = await provider(symbol, interval, limit, timeoutMs);
    if (result && result.length > 0) return result;
  }
  throw new Error(`No market data available for ${symbol}`);
}

async function binanceTickers(symbols: string[], timeoutMs: number): Promise<Record<string, Ticker> | null> {
  try {
    const q = encodeURIComponent(JSON.stringify(symbols));
    // Binance answers 400 `{"code":-1121,"msg":"Invalid symbol."}` for the whole
    // batch if even one symbol is unlisted (MKR and FTM were both delisted from
    // spot), so a miss here must fall through to the next provider rather than
    // failing every symbol in the watchlist.
    const data = (await binanceJson(
      `/api/v3/ticker/24hr?symbols=${q}`,
      3000,
      timeoutMs,
    )) as Array<Record<string, string>>;
    if (!Array.isArray(data)) return null;
    const out: Record<string, Ticker> = {};
    for (const t of data) {
      const base = t.symbol.replace(/USDT$/, "");
      out[t.symbol] = {
        symbol: t.symbol,
        base,
        price: +t.lastPrice,
        change24h: +t.priceChangePercent,
        high24h: num(t.highPrice),
        low24h: num(t.lowPrice),
        quoteVolume: +t.quoteVolume,
      };
    }
    return out;
  } catch {
    return null;
  }
}

async function coingeckoTickers(symbols: string[], timeoutMs: number): Promise<Record<string, Ticker> | null> {
  try {
    const infos = symbols
      .map((s) => ALL_SYMBOLS.find((x) => x.symbol === s))
      .filter((x) => x?.cgId) as Array<{ symbol: string; base: string; cgId: string }>;
    if (infos.length === 0) return null;
    const ids = infos.map((i) => i.cgId).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_high_low=true&include_24hr_vol=true`;
    const data = (await cachedJson(url, 5000, timeoutMs)) as Record<string, {
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
        // CoinGecko's free tier accepts `include_24hr_high_low` and then returns
        // neither field, so these are genuinely null in the common case rather
        // than an edge case. Do not fall back to `d.usd`.
        high24h: num(d.usd_24h_high),
        low24h: num(d.usd_24h_low),
        quoteVolume: d.usd_24h_vol ?? 0,
      };
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * OKX spot tickers: every listed pair in one response, so this fallback costs
 * a single subrequest no matter how large the watchlist is.
 */
async function okxTickers(symbols: string[], timeoutMs: number): Promise<Record<string, Ticker> | null> {
  try {
    const wanted = new Set(symbols);
    const data = (await cachedJson(
      "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
      5000,
      timeoutMs,
    )) as {
      data?: Array<{
        instId?: string;
        last?: string;
        open24h?: string;
        high24h?: string;
        low24h?: string;
        volCcy24h?: string;
      }>;
    };
    const rows = data?.data;
    if (!Array.isArray(rows)) return null;
    const out: Record<string, Ticker> = {};
    for (const r of rows) {
      // OKX writes spot pairs as `BTC-USDT`; our catalog uses `BTCUSDT`.
      const sym = (r.instId ?? "").replace("-", "");
      if (!wanted.has(sym)) continue;
      const price = num(r.last);
      if (price == null) continue;
      const open = num(r.open24h);
      out[sym] = {
        symbol: sym,
        base: sym.replace(/USDT$/, ""),
        price,
        // OKX returns no change field, so derive it from the 24h open.
        change24h: open ? ((price - open) / open) * 100 : 0,
        high24h: num(r.high24h),
        low24h: num(r.low24h),
        // `volCcy24h` is already quoted in USDT for spot pairs.
        quoteVolume: num(r.volCcy24h) ?? 0,
      };
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Coinbase spot stats.
 *
 * This is one subrequest per symbol, so it runs after the bulk providers — but
 * it is the one fallback verified reachable from the Worker when Binance is
 * geo-blocked, which is exactly when it is needed. Chunked because Coinbase's
 * public API tolerates roughly 10 requests/second.
 */
async function coinbaseTickers(symbols: string[], timeoutMs: number): Promise<Record<string, Ticker> | null> {
  try {
    const pairs = symbols.filter((s) => s.endsWith("USDT")).slice(0, 60);
    if (pairs.length === 0) return null;
    const out: Record<string, Ticker> = {};
    const CHUNK = 8;
    for (let i = 0; i < pairs.length; i += CHUNK) {
      if (timeoutMs <= 0) break;
      const rows = await Promise.all(
        pairs.slice(i, i + CHUNK).map(async (sym) => {
          try {
            const base = sym.replace(/USDT$/, "");
            const d = (await cachedJson(
              `https://api.exchange.coinbase.com/products/${base}-USD/stats`,
              5000,
              timeoutMs,
            )) as { open?: string; high?: string; low?: string; last?: string; volume?: string };
            const price = num(d?.last);
            if (price == null) return null;
            const open = num(d?.open);
            const ticker: Ticker = {
              symbol: sym,
              base,
              price,
              change24h: open ? ((price - open) / open) * 100 : 0,
              high24h: num(d?.high),
              low24h: num(d?.low),
              // Coinbase reports base volume, so this is a quote estimate.
              quoteVolume: (num(d?.volume) ?? 0) * price,
            };
            return ticker;
          } catch {
            // A 404 for an unlisted pair is expected; skip just that symbol.
            return null;
          }
        }),
      );
      for (const r of rows) if (r) out[r.symbol] = r;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Every ticker provider declined to answer.
 *
 * This exists so an exhausted upstream can be reported as a failure. The route
 * used to answer 200 with `{}`, which the client rendered as "no prices" while
 * looking exactly like success — a dead provider stayed invisible in
 * production for as long as nobody checked the payload.
 */
export class UpstreamExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamExhaustedError";
  }
}

export async function fetchTickers(symbols: string[]): Promise<Record<string, Ticker>> {
  if (symbols.length === 0) return {};
  const deadline = Date.now() + CHAIN_BUDGET_MS;
  const providers = [binanceTickers, okxTickers, coinbaseTickers, coingeckoTickers];
  for (const provider of providers) {
    const remaining = budgetMs(deadline);
    if (remaining <= 0) break;
    const result = await provider(symbols, remaining);
    if (result && Object.keys(result).length > 0) return result;
  }
  throw new UpstreamExhaustedError(
    `No ticker provider returned data for ${symbols.length} symbol(s)`,
  );
}
