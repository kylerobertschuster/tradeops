import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTickers } from "./market";

/**
 * The 24h range is optional data and must stay absent when a provider does not
 * supply it. It used to be coalesced to the current price, which rendered a
 * zero-width "24h range" — missing data dressed up as a remarkable fact.
 *
 * Binance 403s on some networks, which is the only way to reach the CoinGecko
 * branch; stubbing it as blocked keeps these tests honest about which provider
 * they actually exercise.
 */
function stubProviders(coingecko: unknown, binance?: unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("binance.com")) {
      if (binance === undefined) return new Response("blocked", { status: 403 });
      return Response.json(binance);
    }
    if (url.includes("coingecko.com")) return Response.json(coingecko);
    throw new Error(`unexpected provider request: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchTickers / 24h range", () => {
  it("leaves the range null when CoinGecko omits the fields it was asked for", async () => {
    // Verbatim shape of a real CoinGecko free-tier reply: `include_24hr_high_low=true`
    // is accepted and then neither usd_24h_high nor usd_24h_low is returned.
    vi.stubGlobal(
      "fetch",
      stubProviders({
        solana: { usd: 142.5, usd_24h_vol: 900, usd_24h_change: -1.25 },
      }),
    );

    const t = (await fetchTickers(["SOLUSDT"])).SOLUSDT;

    expect(t).toBeDefined();
    expect(t.price).toBe(142.5); // the ticker itself is still usable
    expect(t.high24h).toBeNull();
    expect(t.low24h).toBeNull();
    // The specific regression: absence must never be reported as the price,
    // which is what made high === low === price on a moving asset.
    expect(t.high24h).not.toBe(t.price);
    expect(t.low24h).not.toBe(t.price);
  });

  it("keeps a real range when the provider does supply one", async () => {
    vi.stubGlobal(
      "fetch",
      stubProviders({
        ripple: { usd: 2.15, usd_24h_high: 2.31, usd_24h_low: 2.04, usd_24h_change: 3.1 },
      }),
    );

    const t = (await fetchTickers(["XRPUSDT"])).XRPUSDT;

    expect(t.high24h).toBe(2.31);
    expect(t.low24h).toBe(2.04);
  });

  it("parses Binance string fields and nulls the ones that are missing", async () => {
    vi.stubGlobal(
      "fetch",
      stubProviders(
        {},
        [
          {
            symbol: "BNBUSDT",
            lastPrice: "610.5",
            priceChangePercent: "0.5",
            highPrice: "620.25",
            lowPrice: "", // absent, and `+""` is 0 rather than NaN
            quoteVolume: "123",
          },
        ],
      ),
    );

    const t = (await fetchTickers(["BNBUSDT"])).BNBUSDT;

    expect(t.high24h).toBe(620.25);
    expect(t.low24h).toBeNull();
    expect(t.low24h).not.toBe(0);
  });
});
