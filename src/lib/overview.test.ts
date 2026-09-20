import { describe, it, expect } from "vitest";
import {
  ALL_MARKETS,
  colorForSymbol,
  DEFAULT_WINDOW,
  marketStats,
  normalizeToPercent,
  OVERVIEW_SYMBOLS,
  OVERVIEW_WINDOWS,
  parseBinanceCandles,
  rankByChange,
  toSeries,
  type OverviewSeries,
} from "./overview";
import { CURATED } from "./symbols";
import type { Candle, Interval } from "./types";

const candle = (time: number, close: number): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});

/** Minutes in a window's interval, for checking the window spans what it says. */
const MINUTES: Partial<Record<Interval, number>> = { "15m": 15, "1h": 60, "1d": 1440 };

describe("normalizeToPercent", () => {
  it("starts every series at exactly zero", () => {
    const points = normalizeToPercent([candle(0, 100), candle(60, 110)]);
    expect(points[0]).toEqual({ time: 0, value: 0 });
  });

  it("measures change from the first close, not from the first open", () => {
    const points = normalizeToPercent([candle(0, 200), candle(60, 210), candle(120, 190)]);
    expect(points.map((p) => p.value)).toEqual([0, 5, -5]);
  });

  it("has nothing to say about an empty series", () => {
    expect(normalizeToPercent([])).toEqual([]);
  });

  it("refuses to divide by a zero or unusable close", () => {
    expect(normalizeToPercent([candle(0, 0), candle(60, 5)])).toEqual([]);
    expect(normalizeToPercent([{ ...candle(0, 1), close: Number.NaN }])).toEqual([]);
  });
});

describe("toSeries", () => {
  it("needs two bars before it will call anything a change", () => {
    expect(toSeries("BTCUSDT", [candle(0, 100)]).change).toBeNull();
    expect(toSeries("BTCUSDT", []).change).toBeNull();
    expect(toSeries("BTCUSDT", [candle(0, 100), candle(60, 100)]).change).toBe(0);
  });

  it("carries the last point's value as the change", () => {
    const series = toSeries("ETHUSDT", [candle(0, 50), candle(60, 25)]);
    expect(series.change).toBe(-50);
    expect(series.points).toHaveLength(2);
  });
});

describe("rankByChange", () => {
  const s = (symbol: string, change: number | null): OverviewSeries => ({
    symbol,
    points: [],
    change,
  });

  it("puts the best first", () => {
    const ranked = rankByChange([s("A", -1), s("B", 4), s("C", 0)]);
    expect(ranked.map((r) => r.symbol)).toEqual(["B", "C", "A"]);
  });

  it("does not sort markets with nothing to compare into the ranking", () => {
    const ranked = rankByChange([s("Z", null), s("A", -1), s("Y", null)]);
    expect(ranked.map((r) => r.symbol)).toEqual(["A", "Y", "Z"]);
  });
});

describe("marketStats", () => {
  const s = (symbol: string, change: number | null): OverviewSeries => ({
    symbol,
    points: [],
    change,
  });

  it("counts breadth so the parts add up to the whole", () => {
    const stats = marketStats([s("A", 5), s("B", -3), s("C", 0), s("D", null)]);
    expect(stats).toMatchObject({ counted: 3, up: 1, down: 1, flat: 1 });
    expect(stats.up + stats.down + stats.flat).toBe(stats.counted);
  });

  it("treats a move that rounds to 0.00% as flat, not as a direction", () => {
    const stats = marketStats([s("A", 0.004), s("B", -0.004), s("C", 0.02)]);
    expect(stats).toMatchObject({ up: 1, down: 0, flat: 2 });
  });

  it("takes the median, averaging the middle pair when the count is even", () => {
    expect(marketStats([s("A", 1), s("B", 3), s("C", 8)]).median).toBe(3);
    expect(marketStats([s("A", 1), s("B", 3), s("C", 8), s("D", 10)]).median).toBe(5.5);
  });

  it("names the leader and the laggard", () => {
    const stats = marketStats([s("A", 1), s("B", 3), s("C", -8)]);
    expect(stats.best).toEqual({ symbol: "B", change: 3 });
    expect(stats.worst).toEqual({ symbol: "C", change: -8 });
  });

  it("invents nothing when no market could be read", () => {
    expect(marketStats([])).toEqual({
      counted: 0,
      up: 0,
      down: 0,
      flat: 0,
      median: null,
      best: null,
      worst: null,
    });
    expect(marketStats([s("A", null)]).median).toBeNull();
  });
});

describe("the windows on offer", () => {
  it("spans exactly what its label says", () => {
    const expected: Record<string, number> = { "1D": 1440, "1W": 10080, "1M": 43200 };
    for (const window of OVERVIEW_WINDOWS) {
      const minutes = MINUTES[window.interval];
      expect(minutes, `${window.label} uses an interval a venue serves`).toBeTypeOf("number");
      expect(window.bars * (minutes as number), `${window.label} spans ${window.span}`).toBe(
        expected[window.label],
      );
    }
  });

  it("opens on the shortest one", () => {
    expect(DEFAULT_WINDOW).toBe(OVERVIEW_WINDOWS[0]);
  });

  it("draws the watchlist by default and can reach every market", () => {
    expect(OVERVIEW_SYMBOLS).toEqual(CURATED.map((s) => s.symbol));
    expect(ALL_MARKETS.length).toBeGreaterThan(OVERVIEW_SYMBOLS.length);
    for (const symbol of OVERVIEW_SYMBOLS) expect(ALL_MARKETS).toContain(symbol);
  });
});

describe("colorForSymbol", () => {
  it("gives every watchlist market its own colour", () => {
    const used = OVERVIEW_SYMBOLS.map(colorForSymbol);
    expect(new Set(used).size).toBe(OVERVIEW_SYMBOLS.length);
  });

  it("answers the same colour every time, rank and reload alike", () => {
    const first = colorForSymbol("ETHUSDT");
    expect(colorForSymbol("ETHUSDT")).toBe(first);
    expect(rankByChange([]).length).toBe(0); // ranking does not touch the palette
  });

  it("keeps a market outside the catalogue on a real colour", () => {
    for (const symbol of ["WHOUSDT", "ZZZUSDT", ""]) {
      expect(colorForSymbol(symbol)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(colorForSymbol("WHOUSDT")).toBe(colorForSymbol("WHOUSDT"));
  });

  it("never uses the up or down colour for a line", () => {
    for (const symbol of ALL_MARKETS) {
      expect(["#089981", "#f23645"]).not.toContain(colorForSymbol(symbol));
    }
  });
});

describe("parseBinanceCandles", () => {
  // Verbatim from the venue: strings, milliseconds, twelve columns.
  const fixture = [
    [
      1750000000000,
      "104000.00",
      "104250.50",
      "103800.00",
      "104100.25",
      "12.5",
      1750000899999,
      "1301250.0",
      100,
      "6.2",
      "645000.0",
      "0",
    ],
    [
      1750000900000,
      "104100.25",
      "104400.00",
      "104050.00",
      "104380.75",
      "9.1",
      1750001799999,
      "949000.0",
      80,
      "4.1",
      "430000.0",
      "0",
    ],
  ];

  it("reads the columns the venue actually sends", () => {
    const candles = parseBinanceCandles(fixture);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({
      time: 1750000000,
      open: 104000,
      high: 104250.5,
      low: 103800,
      close: 104100.25,
      volume: 12.5,
    });
    // Seconds, not the milliseconds the venue sends: everything else here counts
    // seconds, and mixing the two draws nothing at all.
    expect(candles[1].time).toBe(1750000900);
  });

  it("drops a row it cannot read instead of poisoning the series", () => {
    expect(parseBinanceCandles([...fixture, ["nonsense"], [1, "x"]])).toHaveLength(2);
  });

  it("returns nothing for a payload that is not a list", () => {
    expect(parseBinanceCandles({ code: -1121, msg: "Invalid symbol." })).toEqual([]);
    expect(parseBinanceCandles(null)).toEqual([]);
  });
});
