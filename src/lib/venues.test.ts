import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VENUES,
  bestFault,
  clearVenueCache,
  commonBarCount,
  capableVenues,
  deviationFromMedian,
  fetchAllVenues,
  fetchVenueCandles,
  fetchVenueTicker,
  spread,
  venueIntervalCode,
  venueSymbol,
} from "./venues";
import type { VenueId } from "./venues";

beforeEach(() => {
  clearVenueCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Route each venue's host to a canned response, recording what was requested. */
function stubVenues(handlers: Partial<Record<VenueId, (url: string) => Response>>) {
  const seen: string[] = [];
  const hosts: Record<string, VenueId> = {
    "data-api.binance.vision": "binance",
    "api.bybit.com": "bybit",
    "www.okx.com": "okx",
    "api.exchange.coinbase.com": "coinbase",
    "api.kraken.com": "kraken",
    "api.crypto.com": "cryptocom",
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const host = new URL(url).host;
    const venue = hosts[host];
    const handler = venue ? handlers[venue] : undefined;
    if (!handler) return new Response("no handler", { status: 500 });
    return handler(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return seen;
}

describe("venueSymbol", () => {
  it("translates the catalog's USDT symbol into each venue's notation", () => {
    // The three forms that are easy to get wrong and hard to notice: OKX and
    // Coinbase use a separator with a different quote asset, and Crypto.com
    // uses an underscore.
    expect(venueSymbol("binance", "BTCUSDT")).toBe("BTCUSDT");
    expect(venueSymbol("bybit", "BTCUSDT")).toBe("BTCUSDT");
    expect(venueSymbol("okx", "BTCUSDT")).toBe("BTC-USDT");
    expect(venueSymbol("coinbase", "BTCUSDT")).toBe("BTC-USD");
    expect(venueSymbol("kraken", "BTCUSDT")).toBe("BTCUSD");
    expect(venueSymbol("cryptocom", "BTCUSDT")).toBe("BTC_USDT");
  });

  it("refuses a symbol it cannot translate rather than guessing", () => {
    // A wrong translation is a wrong price; a null is a missing one. Every
    // catalog symbol is USDT-quoted, so anything else is a bug upstream.
    for (const id of VENUES.map((v) => v.id)) {
      expect(venueSymbol(id, "BTCUSDC")).toBeNull();
      expect(venueSymbol(id, "USDT")).toBeNull();
    }
  });
});

describe("interval capabilities", () => {
  it("knows that only Binance publishes 1-second candles", () => {
    expect(capableVenues("1s").map((v) => v.id)).toEqual(["binance"]);
    for (const v of VENUES.filter((x) => x.id !== "binance")) {
      expect(venueIntervalCode(v.id, "1s")).toBeNull();
    }
  });

  it("knows Coinbase has no 4h and no weekly, and can still say so from the error", async () => {
    // Coinbase's granularity whitelist is 60/300/900/3600/21600/86400 seconds.
    // 4h (14400) and 1w (604800) both answer 400 "Unsupported granularity",
    // which the first version of this reported as "unreachable" — i.e. it told
    // the user Coinbase was down when Coinbase had answered perfectly clearly.
    expect(venueIntervalCode("coinbase", "4h")).toBeNull();
    expect(venueIntervalCode("coinbase", "1w")).toBeNull();
    expect(venueIntervalCode("coinbase", "1d")).toBe("86400");

    // ...and if the table is ever wrong, the response itself still classifies.
    stubVenues({
      coinbase: () => Response.json({ message: "Unsupported granularity" }, { status: 400 }),
    });
    const { fault, candles } = await fetchVenueCandles("coinbase", "BTCUSDT", "4h", 300, 1000);
    expect(candles).toEqual([]);
    expect(fault).toBe("unsupported-interval");
  });

  it("knows that Crypto.com has no weekly timeframe", () => {
    // Verified against the live API: `timeframe=W1` answers 40003 Invalid request.
    expect(venueIntervalCode("cryptocom", "1w")).toBeNull();
    expect(capableVenues("1w").map((v) => v.id)).not.toContain("cryptocom");
  });

  it("clamps every venue to the same window, because the smallest cap wins", () => {
    // Coinbase, OKX and Crypto.com cap at 300 bars. Asking for 1000 would give
    // Binance 1000 bars and the rest 300, and the overlay would show lines that
    // appear to start at different times while both were correct.
    expect(commonBarCount("15m", 1000)).toBe(300);
    expect(commonBarCount("15m", 500)).toBe(300);
    expect(commonBarCount("15m", 100)).toBe(100);
    // Only Binance can serve 1s, so its own cap is the only one in play.
    expect(commonBarCount("1s", 1000)).toBe(1000);
  });
});

describe("spread", () => {
  it("uses the median so one outlier cannot move the middle", () => {
    const s = spread([100, 100, 100, 100, 900]);
    expect(s.median).toBe(100);
    expect(s.min).toBe(100);
    expect(s.max).toBe(900);
    expect(s.count).toBe(5);
  });

  it("averages the middle pair for an even count", () => {
    expect(spread([100, 101, 102, 103]).median).toBe(101.5);
  });

  it("ignores venues that did not report rather than treating them as zero", () => {
    // A venue that is down must not drag the spread toward its own absence.
    const s = spread([100, null, 102, undefined, 104]);
    expect(s.count).toBe(3);
    expect(s.median).toBe(102);
    expect(s.min).toBe(100);
  });

  it("reports nothing at all when no venue reported", () => {
    const s = spread([null, undefined]);
    expect(s).toMatchObject({ median: null, spreadBps: null, count: 0 });
  });

  it("expresses the gap in basis points", () => {
    // 1% of 10,000 = 100 bps.
    expect(spread([9_950, 10_050]).spreadBps).toBeCloseTo(100, 6);
  });

  it("treats a single venue as zero spread rather than as no data", () => {
    const s = spread([100]);
    expect(s.median).toBe(100);
    expect(s.spreadBps).toBe(0);
    expect(s.count).toBe(1);
  });
});

describe("deviationFromMedian", () => {
  it("is signed, and zero at the median", () => {
    expect(deviationFromMedian(101, 100)).toBeCloseTo(100, 6);
    expect(deviationFromMedian(99, 100)).toBeCloseTo(-100, 6);
    expect(deviationFromMedian(100, 100)).toBe(0);
  });

  it("stays null when either side is missing", () => {
    expect(deviationFromMedian(null, 100)).toBeNull();
    expect(deviationFromMedian(100, null)).toBeNull();
    expect(deviationFromMedian(100, 0)).toBeNull();
  });
});

describe("bestFault", () => {
  it("prefers the fault that names the problem", () => {
    // Crypto.com answers `200 {data: []}` for a pair it does not list, so the
    // candles probe can only say "empty" — while the instrument list says
    // exactly what happened. Showing "empty response" would send the user
    // hunting for a bug on our side.
    expect(bestFault("empty", "unlisted")).toBe("unlisted");
    expect(bestFault("unlisted", "empty")).toBe("unlisted");
  });

  it("ranks delisted above blocked and above unsupported", () => {
    expect(bestFault("unreachable", "delisted")).toBe("delisted");
    expect(bestFault("unsupported-interval", "unreachable")).toBe("unsupported-interval");
  });

  it("passes through a lone fault instead of inventing a rival", () => {
    expect(bestFault(null, "blocked")).toBe("blocked");
    expect(bestFault("blocked", null)).toBe("blocked");
    expect(bestFault(null, null)).toBeNull();
  });
});

describe("fetchVenueCandles", () => {
  it("does not request an interval the venue does not have", async () => {
    const seen = stubVenues({});
    const result = await fetchVenueCandles("cryptocom", "BTCUSDT", "1w", 300, 1000);

    expect(result.fault).toBe("unsupported-interval");
    expect(result.candles).toEqual([]);
    // The capability check happens before URL construction, so an impossible
    // request costs no subrequest at all.
    expect(seen).toHaveLength(0);
  });

  it("normalizes every venue to oldest-first, given the order that venue really uses", async () => {
    // Table-driven, and the fixtures below are in each venue's *actual* raw
    // order as verified against the live API — not the order the code expects.
    // The first version of this test asserted Binance and Crypto.com were
    // newest-first (they are oldest-first), so the code and the test agreed with
    // each other and both were wrong: `setData` on a reversed series throws, so
    // the failure only ever appeared in the browser.
    //
    // Binance, Kraken, Crypto.com      -> oldest-first, passed through
    // OKX, Coinbase, Bybit             -> newest-first, reversed

    const rows = {
      // [time, open, high, low, close, volume]
      oldestFirst: [
        [1700000000, "1", "1", "1", "1", "1"],
        [1700000900, "2", "2", "2", "2", "2"],
      ],
      // same candles, reversed: the venue answered newest-first
      newestFirst: [
        [1700000900, "2", "2", "2", "2", "2"],
        [1700000000, "1", "1", "1", "1", "1"],
      ],
      // Coinbase's columns are [time, low, high, open, close, volume]
      coinbaseNewestFirst: [
        [1700000900, 2, 2, 2, 2, 2],
        [1700000000, 1, 1, 1, 1, 1],
      ],
    };

    const cases: Array<{ id: VenueId; response: () => Response }> = [
      // Oldest-first venues: a reversal here is the bug being guarded against.
      { id: "binance", response: () => Response.json(rows.oldestFirst) },
      { id: "cryptocom", response: () => Response.json({ code: 0, result: { data: rows.oldestFirst.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] })) } }) },
      { id: "kraken", response: () => Response.json({ error: [], result: { XXBTZUSD: rows.oldestFirst.map((r) => [...r, 0, 1]) } }) },
      // Newest-first venues: failing to reverse breaks the chart.
      { id: "okx", response: () => Response.json({ code: "0", data: rows.newestFirst }) },
      { id: "coinbase", response: () => Response.json(rows.coinbaseNewestFirst) },
      { id: "bybit", response: () => Response.json({ retCode: 0, result: { list: rows.newestFirst } }) },
    ];

    for (const { id, response } of cases) {
      clearVenueCache();
      stubVenues({ [id]: response });

      const { candles, fault } = await fetchVenueCandles(id, "BTCUSDT", "15m", 300, 1000);

      expect(fault, `${id} fault`).toBeNull();
      expect(candles.map((c) => c.time), `${id} order`).toEqual([1700000000, 1700000900]);
      expect(candles.map((c) => c.close), `${id} closes`).toEqual([1, 2]);
    }
  });

  it("reads Coinbase's columns in Coinbase's order", async () => {
    // Coinbase is `[time, low, high, open, close, volume]` — not OHLC. Reading
    // it as OHLC swaps high and low, producing candles whose high is below
    // their low: visibly wrong in a chart, invisible in a table.
    stubVenues({
      coinbase: () =>
        Response.json([
          [1700000000, 100, 120, 105, 110, 7], // low, high, open, close, volume
        ]),
    });

    const { candles, fault } = await fetchVenueCandles("coinbase", "BTCUSDT", "15m", 300, 1000);

    expect(fault).toBeNull();
    expect(candles).toHaveLength(1);
    expect(candles[0]).toEqual({
      time: 1700000000,
      open: 105,
      high: 120,
      low: 100,
      close: 110,
      volume: 7,
    });
  });

  it("keeps Kraken's volume out of the wrong column", async () => {
    // Kraken is `[time, o, h, l, c, vwap, volume, count]` — volume is index 6,
    // and index 5 is a VWAP that would read as a plausible volume.
    stubVenues({
      kraken: () =>
        Response.json({
          error: [],
          result: {
            XXBTZUSD: [
              [1700000000, "1", "1", "1", "1", "77", "10", 3],
              [1700000900, "2", "2", "2", "2", "88", "20", 4],
            ],
          },
        }),
    });

    const { candles } = await fetchVenueCandles("kraken", "BTCUSDT", "15m", 300, 1000);

    expect(candles[0].volume).toBe(10);
    expect(candles[1].volume).toBe(20);
  });

  it("finds Kraken's candles under the pair key the exchange chose", async () => {
    // Asking for `BTCUSD` answers under `XXBTZUSD`. The key is not derivable
    // from the request, so it must be discovered from the response.
    stubVenues({
      kraken: () =>
        Response.json({
          error: [],
          result: { XXBTZUSD: [[1700000000, "1", "2", "0.5", "1.5", "1", "3", 9]], last: 1700000000 },
        }),
    });

    const { candles } = await fetchVenueCandles("kraken", "BTCUSDT", "15m", 300, 1000);
    expect(candles).toHaveLength(1);
    expect(candles[0].high).toBe(2);
  });

  it("reports a delisted pair as unlisted, not as a failure", async () => {
    stubVenues({
      kraken: () => Response.json({ error: ["EQuery:Unknown asset pair"] }),
      binance: () => Response.json({ code: -1121, msg: "Invalid symbol." }, { status: 400 }),
    });

    const kraken = await fetchVenueCandles("kraken", "MKRUSDT", "15m", 300, 1000);
    const binance = await fetchVenueCandles("binance", "MKRUSDT", "15m", 300, 1000);

    // "Not listed here" is a fact about the venue's listings. Rendering it as
    // an error would teach the user to distrust the whole table.
    expect(kraken.fault).toBe("unlisted");
    expect(binance.fault).toBe("unlisted");
  });

  it("trims a venue that returns more bars than it was asked for", async () => {
    // Kraken takes no count parameter and always answers with its full 720-bar
    // history, so it must be cut back to the shared window. Left untrimmed, its
    // line spans 7.5 days while the others span 3 — which looks exactly like the
    // venues disagreeing about price.
    stubVenues({
      kraken: () =>
        Response.json({
          error: [],
          result: {
            XXBTZUSD: Array.from({ length: 721 }, (_, i) => [
              1700000000 + i * 900,
              "1",
              "2",
              "0.5",
              String(i),
              "1",
              "1",
              1,
            ]),
          },
        }),
    });

    const { candles } = await fetchVenueCandles("kraken", "BTCUSDT", "15m", 300, 1000);

    expect(candles).toHaveLength(300);
    // The *most recent* 300, keeping oldest-first order: the last bar survives
    // and the first is 721 - 300 = index 421.
    expect(candles[candles.length - 1].close).toBe(720);
    expect(candles[0].close).toBe(421);
  });

  it("leaves a venue that returns fewer bars than asked untouched", async () => {
    stubVenues({ okx: () => Response.json({ code: "0", data: [[1700000000000, "1", "2", "0.5", "1.5", "3"]] }) });

    const { candles } = await fetchVenueCandles("okx", "BTCUSDT", "15m", 300, 1000);
    expect(candles).toHaveLength(1);
  });

  it("reports a delisted pair as delisted, not as not-listed", async () => {
    // Coinbase keeps serving historical candles for a product it has removed,
    // while `/stats` answers 400 "Not allowed for delisted products". MKR-USD
    // really does return 300 candles and no 24h stats, so calling that pair
    // "not listed" beside a full chart would read as a bug.
    stubVenues({
      coinbase: (url) =>
        url.includes("/stats")
          ? Response.json({ message: "Not allowed for delisted products" }, { status: 400 })
          : Response.json([[1700000000, 1, 2, 0.5, 1.5, 3]]),
    });

    const series = await fetchVenueCandles("coinbase", "MKRUSDT", "15m", 300, 1000);
    const ticker = await fetchVenueTicker("coinbase", "MKRUSDT", 1000);

    expect(series.candles).toHaveLength(1);
    expect(series.fault).toBeNull();
    expect(ticker.fault).toBe("delisted");
  });

  it("understands both of Kraken's ways of saying a pair does not exist", async () => {
    // Kraken answers HTTP 200 with an `error` array, and it uses two different
    // strings: "EQuery:Unknown asset pair" for a nonsense pair and
    // "EQuery:Invalid asset pair" for a real asset in an unknown pair. Matching
    // only the first reported the second as an outage.
    for (const message of ["EQuery:Unknown asset pair", "EQuery:Invalid asset pair"]) {
      clearVenueCache();
      stubVenues({ kraken: () => Response.json({ error: [message] }) });
      const { fault } = await fetchVenueCandles("kraken", "MKRUSDT", "15m", 300, 1000);
      expect(fault, message).toBe("unlisted");
    }
  });

  it("names a region block as a region block", async () => {
    stubVenues({ bybit: () => new Response("blocked from your country", { status: 403 }) });

    const { fault } = await fetchVenueCandles("bybit", "BTCUSDT", "15m", 300, 1000);
    expect(fault).toBe("blocked");
  });

  it("resolves to a fault instead of throwing when the network dies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const { fault, candles } = await fetchVenueCandles("binance", "BTCUSDT", "15m", 300, 1000);
    expect(fault).toBe("unreachable");
    expect(candles).toEqual([]);
  });

  it("reports an empty 200 as empty, not as success", async () => {
    stubVenues({ okx: () => Response.json({ code: "0", data: [] }) });

    const { fault } = await fetchVenueCandles("okx", "BTCUSDT", "15m", 300, 1000);
    expect(fault).toBe("empty");
  });

  it("stops re-probing a blocked venue on every call", async () => {
    const seen = stubVenues({ bybit: () => new Response("blocked", { status: 403 }) });

    await fetchVenueCandles("bybit", "BTCUSDT", "15m", 300, 1000);
    await fetchVenueCandles("bybit", "BTCUSDT", "15m", 300, 1000);

    // A region block will not change during the deployment's lifetime. Without
    // negative caching every poll burns a subrequest to relearn it.
    expect(seen).toHaveLength(1);
  });
});

describe("fetchVenueTicker", () => {
  it("leaves Kraken's 24h change null rather than measuring a different period", async () => {
    stubVenues({
      kraken: () =>
        Response.json({
          error: [],
          result: {
            XXBTZUSD: {
              c: ["78179.4", "0.015"],
              o: "76800.0", // today's open, NOT a 24h open
              h: ["79000.0", "79500.0"],
              l: ["76000.0", "75500.0"],
              v: ["1515.16", "1943.06"],
              p: ["77620.7", "77497.5"],
            },
          },
        }),
    });

    const t = await fetchVenueTicker("kraken", "BTCUSDT", 1000);

    expect(t.price).toBe(78179.4);
    // Kraken publishes no 24h open. `o` is "today's opening price", which spans
    // a different period — using it would put a number in the 24h column that
    // is not a 24h change.
    expect(t.change24h).toBeNull();
    expect(t.fault).toBeNull();
    expect(t.high24h).toBe(79500);
    expect(t.low24h).toBe(75500);
    // 24h base volume x 24h VWAP: a better quote estimate than x last price.
    expect(t.quoteVolume).toBeCloseTo(1943.06 * 77497.5, 2);
  });

  it("scales Crypto.com's fractional 24h change into a percentage", async () => {
    stubVenues({
      cryptocom: () =>
        Response.json({
          code: 0,
          result: { data: [{ i: "BTC_USDT", a: "77974.46", h: "78381.63", l: "76387.10", v: "1788", vv: "138327878", c: "0.0169" }] },
        }),
    });

    const t = await fetchVenueTicker("cryptocom", "BTCUSDT", 1000);

    // Crypto.com reports 0.0169 for +1.69%. Leaving it unscaled would print a
    // hundredfold-too-small change.
    expect(t.change24h).toBeCloseTo(1.69, 6);
    expect(t.quoteVolume).toBe(138327878);
  });

  it("scales Bybit's fractional 24h change into a percentage", async () => {
    stubVenues({
      bybit: () =>
        Response.json({
          retCode: 0,
          result: {
            list: [
              {
                lastPrice: "78000",
                price24hPcnt: "-0.0123",
                highPrice24h: "79000",
                lowPrice24h: "77000",
                turnover24h: "1000000",
              },
            ],
          },
        }),
    });

    expect((await fetchVenueTicker("bybit", "BTCUSDT", 1000)).change24h).toBeCloseTo(-1.23, 6);
  });

  it("estimates Coinbase's quote volume from base volume and price", async () => {
    stubVenues({
      coinbase: () => Response.json({ open: "100", high: "120", low: "90", last: "110", volume: "50" }),
    });

    const t = await fetchVenueTicker("coinbase", "BTCUSDT", 1000);

    // Coinbase reports base volume only.
    expect(t.quoteVolume).toBe(5500);
    expect(t.change24h).toBeCloseTo(10, 6);
  });
});

describe("fetchAllVenues", () => {
  it("returns every venue's data even when one of them is blocked", async () => {
    stubVenues({
      binance: () => Response.json([[1700000000000, "1", "2", "0.5", "1.5", "3"]]),
      bybit: () => new Response("blocked", { status: 403 }),
    });

    const out = await fetchAllVenues("BTCUSDT", "15m", 300);

    // The whole point: a failing venue is one row's problem, not the request's.
    expect(out.series).toHaveLength(VENUES.length);
    expect(out.tickers).toHaveLength(VENUES.length);
    expect(out.series.find((s) => s.id === "binance")?.candles).toHaveLength(1);
    expect(out.series.find((s) => s.id === "bybit")?.fault).toBe("blocked");
  });

  it("requests the same bar count from every capable venue", async () => {
    const seen = stubVenues({});
    await fetchAllVenues("BTCUSDT", "15m", 1000);

    const binanceLimits = seen
      .filter((u) => u.includes("binance") && u.includes("klines"))
      .map((u) => Number(new URL(u).searchParams.get("limit")));
    const okxLimits = seen
      .filter((u) => u.includes("okx") && u.includes("candles"))
      .map((u) => Number(new URL(u).searchParams.get("limit")));

    // Binance would happily return 1000 bars, but then the two lines would
    // cover different time ranges and the overlay would be a lie.
    expect(binanceLimits).toEqual([300]);
    expect(okxLimits).toEqual([300]);
  });
});
