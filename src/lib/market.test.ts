import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMarketCache, fetchKlinesWithSource, fetchTickers, UpstreamExhaustedError } from "./market";

/** A `get-tickers` envelope with the real key order; only the numbers differ. */
function cryptocom(...rows: Array<Record<string, string | number>>) {
  return { id: 1, method: "public/get-tickers", code: 0, result: { data: rows } };
}

/** One row captured verbatim from a live `get-tickers` response. */
const SOL_ROW = {
  i: "SOL_USDT",
  h: "102.34",
  l: "99.01",
  a: "101.89",
  v: "146723.416",
  vv: "14794197.61",
  c: "0.0145",
  b: "101.86",
  k: "101.87",
  oi: "0",
  t: 1789395643754,
};

/**
 * The ticker chain is Binance -> OKX -> Crypto.com -> Coinbase and it stops at
 * the first provider that answers, so reaching a later link means failing the
 * earlier ones *by name*. OKX and Crypto.com get their real empty shapes here;
 * an unexpected URL throws, though note that each provider's own `catch` turns
 * that into a miss rather than a test failure.
 */
function stubProviders(cryptocomBody: unknown, binance?: unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    // Covers both `api.binance.com` and the `data-api.binance.vision` mirror.
    if (url.includes("binance")) {
      if (binance === undefined) return new Response("blocked", { status: 403 });
      return Response.json(binance);
    }
    if (url.includes("okx.com")) return Response.json({ code: "0", data: [] });
    if (url.includes("crypto.com")) return Response.json(cryptocomBody);
    throw new Error(`unexpected provider request: ${url}`);
  });
}

// `market.ts` caches provider responses at module scope, so without this a
// success in one test would answer the same URL in the next one.
beforeEach(() => {
  clearMarketCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchTickers / 24h range", () => {
  it("leaves the range null when a provider omits the field instead of inventing one", async () => {
    // A *contract* test, not a captured response: no live provider omits `h`/`l`
    // today — Crypto.com answers all five fields on all 960 instruments. That is
    // precisely why the null path has to be pinned by hand. The bug it guards
    // against reported absence as the *current price*, rendering a zero-width
    // range that read as a remarkable market fact (high === low === price on a
    // moving asset) rather than as missing data.
    vi.stubGlobal(
      "fetch",
      stubProviders(cryptocom({ i: "SOL_USDT", a: "142.5", c: "-0.0125", vv: "900" })),
    );

    const t = (await fetchTickers(["SOLUSDT"])).SOLUSDT;

    expect(t).toBeDefined();
    expect(t.price).toBe(142.5); // the ticker itself is still usable
    expect(t.high24h).toBeNull();
    expect(t.low24h).toBeNull();
    expect(t.high24h).not.toBe(t.price);
    expect(t.low24h).not.toBe(t.price);
  });

  it("converts Crypto.com's fractional change to percent through the shared venue parser", async () => {
    // `market.ts` reads these rows via `venues.ts::venueTickerFromBody` rather
    // than growing a second copy of the column map. If that one parser is ever
    // "fixed" to assume a percentage, a 1.45% move silently becomes 0.0145% and
    // the whole board reads as flat.
    vi.stubGlobal("fetch", stubProviders(cryptocom(SOL_ROW)));

    const t = (await fetchTickers(["SOLUSDT"])).SOLUSDT;

    expect(t.price).toBe(101.89);
    expect(t.change24h).toBeCloseTo(1.45);
    expect(t.high24h).toBe(102.34);
    expect(t.low24h).toBe(99.01);
    expect(t.quoteVolume).toBeCloseTo(14794197.61);
  });

  it("skips a symbol with no change field rather than reporting it as 0%", async () => {
    // 0% is itself a real market value, so it cannot double as "unknown" — the
    // same reasoning that makes the range nullable. Coinbase is the next link in
    // the chain and also declines, so the honest outcome is exhaustion.
    vi.stubGlobal(
      "fetch",
      stubProviders(cryptocom({ i: "SOL_USDT", a: "142.5", h: "145", l: "140", vv: "900" })),
    );

    await expect(fetchTickers(["SOLUSDT"])).rejects.toThrow(UpstreamExhaustedError);
  });

  it("parses Binance string fields and nulls the ones that are missing", async () => {
    vi.stubGlobal(
      "fetch",
      stubProviders({}, [
        {
          symbol: "BNBUSDT",
          lastPrice: "610.5",
          priceChangePercent: "0.5",
          highPrice: "620.25",
          lowPrice: "", // absent, and `+""` is 0 rather than NaN
          quoteVolume: "123",
        },
      ]),
    );

    const t = (await fetchTickers(["BNBUSDT"])).BNBUSDT;

    expect(t.high24h).toBe(620.25);
    expect(t.low24h).toBeNull();
    expect(t.low24h).not.toBe(0);
  });
});

describe("fetchTickers / provider fallback", () => {
  it("maps OKX's hyphenated pair ids when Binance is blocked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("binance")) return new Response("blocked", { status: 403 });
        if (url.includes("okx.com")) {
          return Response.json({
            code: "0",
            data: [
              {
                instId: "BTC-USDT",
                last: "100",
                open24h: "80",
                high24h: "110",
                low24h: "70",
                volCcy24h: "5000",
              },
              { instId: "DOGE-USDT", last: "1", open24h: "2" },
            ],
          });
        }
        throw new Error(`unexpected provider request: ${url}`);
      }),
    );

    const t = await fetchTickers(["BTCUSDT", "DOGEUSDT"]);

    expect(t.BTCUSDT.price).toBe(100);
    expect(t.BTCUSDT.base).toBe("BTC");
    // OKX sends no change field, so it has to be derived from the 24h open.
    expect(t.BTCUSDT.change24h).toBeCloseTo(25);
    expect(t.BTCUSDT.high24h).toBe(110);
    expect(t.BTCUSDT.quoteVolume).toBe(5000);
    expect(t.DOGEUSDT.change24h).toBeCloseTo(-50);
  });

  it("treats a delisted symbol as a provider miss rather than failing the batch", async () => {
    // Binance answers 400 for the entire batch when one symbol is unlisted,
    // which would otherwise blank every price in the watchlist.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("binance")) {
          return new Response('{"code":-1121,"msg":"Invalid symbol."}', { status: 400 });
        }
        if (url.includes("okx.com")) {
          return Response.json({
            code: "0",
            data: [{ instId: "BTC-USDT", last: "100", open24h: "100" }],
          });
        }
        throw new Error(`unexpected provider request: ${url}`);
      }),
    );

    const t = await fetchTickers(["BTCUSDT", "MKRUSDT"]);

    expect(t.BTCUSDT.price).toBe(100);
    // MKR is delisted from Binance spot; it simply is not in the answer.
    expect(t.MKRUSDT).toBeUndefined();
  });

  it("throws instead of reporting an empty board when every provider declines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("binance")) return new Response("blocked", { status: 403 });
        if (url.includes("okx.com")) return Response.json({ code: "0", data: [] });
        if (url.includes("crypto.com")) return Response.json({ code: 0, result: { data: [] } });
        if (url.includes("coinbase.com")) return new Response("not found", { status: 404 });
        throw new Error(`unexpected provider request: ${url}`);
      }),
    );

    await expect(fetchTickers(["BTCUSDT"])).rejects.toThrow(UpstreamExhaustedError);
  });
});

/**
 * Each provider's real kline shape, including the column order.
 *
 * Binance sends `[time, open, high, low, close, volume]` oldest-first; Bybit and
 * Coinbase both send newest-first, and Coinbase sends `[time, low, high, open,
 * close, volume]`. Getting these wrong swaps a high into a low, which looks
 * entirely plausible on a chart, so the fixtures exist to pin the order.
 */
const BINANCE_KLINES = [[1_700_000_000_000, "100", "110", "90", "105", "12.5"]];
const BYBIT_KLINES = { result: { list: [["1700000000000", "105", "111", "95", "104", "3.2"]] } };
const COINBASE_CANDLES = [[1_700_000_000, 90, 110, 100, 105, 7.5]];

/** A fetch stub where only the named providers answer; the rest refuse. */
function stubKlineProviders(available: ReadonlySet<string>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    // Matches both `data-api.binance.vision` and the `api.binance.com` mirror,
    // which is what the host failover tries second.
    if (url.includes("binance")) {
      return available.has("binance") ? Response.json(BINANCE_KLINES) : new Response("451", { status: 451 });
    }
    if (url.includes("bybit")) {
      return available.has("bybit") ? Response.json(BYBIT_KLINES) : new Response("403", { status: 403 });
    }
    if (url.includes("coinbase")) {
      return available.has("coinbase") ? Response.json(COINBASE_CANDLES) : new Response("429", { status: 429 });
    }
    throw new Error(`unexpected kline request: ${url}`);
  });
}

describe("fetchKlinesWithSource reports which exchange drew the chart", () => {
  it("names Binance when Binance answers", async () => {
    vi.stubGlobal("fetch", stubKlineProviders(new Set(["binance", "bybit", "coinbase"])));
    const { source, candles } = await fetchKlinesWithSource("BTCUSDT", "1d", 100);
    expect(source).toBe("binance");
    expect(candles).toEqual([
      { time: 1_700_000_000, open: 100, high: 110, low: 90, close: 105, volume: 12.5 },
    ]);
  });

  it("names Bybit when Binance refuses, and un-reverses its newest-first rows", async () => {
    // Binance answers HTTP 451 in restricted regions, which is the whole reason
    // the chain exists — and why the answer has to travel with the response.
    vi.stubGlobal("fetch", stubKlineProviders(new Set(["bybit"])));
    const { source, candles } = await fetchKlinesWithSource("BTCUSDT", "1d", 100);
    expect(source).toBe("bybit");
    expect(candles).toEqual([
      { time: 1_700_000_000, open: 105, high: 111, low: 95, close: 104, volume: 3.2 },
    ]);
  });

  it("names Coinbase as the last resort and reads its column order correctly", async () => {
    vi.stubGlobal("fetch", stubKlineProviders(new Set(["coinbase"])));
    const { source, candles } = await fetchKlinesWithSource("BTCUSDT", "1d", 100);
    expect(source).toBe("coinbase");
    // [time, low, high, open, close, volume] — a plausible misreading would
    // report high 90 / low 110.
    expect(candles).toEqual([
      { time: 1_700_000_000, open: 100, high: 110, low: 90, close: 105, volume: 7.5 },
    ]);
  });

  it("invents no source when every provider refuses", async () => {
    vi.stubGlobal("fetch", stubKlineProviders(new Set()));
    await expect(fetchKlinesWithSource("BTCUSDT", "1d", 100)).rejects.toThrow(/No market data/);
  });
});
