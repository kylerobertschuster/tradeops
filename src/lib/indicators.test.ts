import { describe, expect, it } from "vitest";
import { sma, ema, rsi, macd, bollinger, vwap, volumeProfile } from "./indicators";

/**
 * Wilder's canonical RSI reference series ("New Concepts in Technical Trading
 * Systems"). Used below to pin the smoothing against an external source rather
 * than against our own output.
 */
const WILDER = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
  46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25,
  45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13,
];

describe("sma", () => {
  it("returns null until the window is full, then the trailing mean", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });

  it("handles period 1 as a passthrough", () => {
    expect(sma([5, 7, 9], 1)).toEqual([5, 7, 9]);
  });

  it("returns all nulls when there is not enough data", () => {
    expect(sma([1, 2], 3)).toEqual([null, null]);
  });

  it("always matches the input length", () => {
    // Length mismatch would silently misalign every overlay on the chart.
    for (const period of [1, 3, 20, 50]) {
      expect(sma(WILDER, period)).toHaveLength(WILDER.length);
    }
  });

  it("uses a sliding window rather than a global mean", () => {
    // Guards the `sum -= values[i - period]` eviction in the loop.
    const out = sma([10, 10, 10, 100], 3);
    expect(out[2]).toBe(10);
    expect(out[3]).toBeCloseTo(40, 10);
  });
});

describe("ema", () => {
  it("seeds from the SMA of the first window, then applies k = 2/(n+1)", () => {
    // window [1,2,3] -> seed 2, k = 0.5
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("returns all nulls when the input is shorter than the period", () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });

  it("stays flat on a constant series", () => {
    const out = ema([7, 7, 7, 7], 3);
    expect(out.slice(2)).toEqual([7, 7]);
  });
});

describe("rsi", () => {
  it("matches Wilder's reference value for the first period", () => {
    // Hand-derived from the changes in WILDER: avgGain 3.34/14, avgLoss 1.40/14.
    const out = rsi(WILDER, 14);
    expect(out[14]).toBeCloseTo(70.46, 1);
  });

  it("reports 100 when there are only gains", () => {
    expect(rsi([1, 2, 3], 2)[2]).toBe(100);
  });

  it("reports 0 when there are only losses", () => {
    expect(rsi([3, 2, 1], 2)[2]).toBe(0);
  });

  it("reports a neutral 50 for a perfectly flat series", () => {
    // avgGain + avgLoss === 0 must not divide by zero.
    expect(rsi([1, 1, 1], 2)[2]).toBe(50);
  });

  it("applies Wilder smoothing on subsequent bars", () => {
    // after +1, +1 -> avgGain 1, avgLoss 0 (RSI 100)
    // then -1 -> avgGain (1*1+0)/2 = 0.5, avgLoss (0*1+1)/2 = 0.5 -> RS 1 -> 50
    expect(rsi([1, 2, 3, 2], 2)[3]).toBe(50);
  });

  it("never leaves the 0..100 domain", () => {
    for (const v of rsi(WILDER, 14)) {
      if (v != null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("returns all nulls when the input is too short", () => {
    expect(rsi(WILDER.slice(0, 14), 14).every((v) => v === null)).toBe(true);
  });
});

describe("macd", () => {
  const out = macd(WILDER);

  it("aligns all three series to the input length", () => {
    expect(out.macd).toHaveLength(WILDER.length);
    expect(out.signal).toHaveLength(WILDER.length);
    expect(out.histogram).toHaveLength(WILDER.length);
  });

  it("equals fast EMA minus slow EMA wherever both exist", () => {
    const fast = ema(WILDER, 12);
    const slow = ema(WILDER, 26);
    for (let i = 0; i < WILDER.length; i++) {
      if (fast[i] != null && slow[i] != null) {
        expect(out.macd[i]).toBeCloseTo((fast[i] as number) - (slow[i] as number), 10);
      }
    }
  });

  it("never emits a signal before the MACD line starts", () => {
    const firstMacd = out.macd.findIndex((v) => v != null);
    expect(firstMacd).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < firstMacd; i++) {
      expect(out.signal[i]).toBeNull();
      expect(out.histogram[i]).toBeNull();
    }
  });

  it("keeps histogram === macd - signal", () => {
    for (let i = 0; i < WILDER.length; i++) {
      const m = out.macd[i];
      const s = out.signal[i];
      if (m != null && s != null) {
        expect(out.histogram[i]).toBeCloseTo(m - s, 10);
      }
    }
  });

  it("degrades to nulls when there is not enough history", () => {
    const tiny = macd([1, 2, 3]);
    expect(tiny.macd.every((v) => v === null)).toBe(true);
    expect(tiny.signal.every((v) => v === null)).toBe(true);
  });
});

describe("bollinger", () => {
  it("centres the band on the SMA and offsets by mult * population sd", () => {
    // [1,2,3]: mean 2, variance 2/3, sd 0.8165
    const out = bollinger([1, 2, 3], 3, 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]!.middle).toBeCloseTo(2, 10);
    expect(out[2]!.upper).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3), 10);
    expect(out[2]!.lower).toBeCloseTo(2 - 2 * Math.sqrt(2 / 3), 10);
  });

  it("collapses to a single value on a flat series", () => {
    const out = bollinger([5, 5, 5, 5], 3);
    expect(out[3]).toEqual({ upper: 5, middle: 5, lower: 5 });
  });

  it("keeps upper >= middle >= lower", () => {
    for (const b of bollinger(WILDER, 20, 2)) {
      if (b) {
        expect(b.upper).toBeGreaterThanOrEqual(b.middle);
        expect(b.middle).toBeGreaterThanOrEqual(b.lower);
      }
    }
  });
});

describe("vwap", () => {
  const candle = (high: number, low: number, close: number, volume: number) => ({
    high,
    low,
    close,
    volume,
  });

  it("uses the typical price weighted by volume, cumulatively", () => {
    const out = vwap([candle(10, 10, 10, 2), candle(20, 20, 20, 1)]);
    expect(out[0]).toBeCloseTo(10, 10);
    // (10*2 + 20*1) / 3
    expect(out[1]).toBeCloseTo(40 / 3, 10);
  });

  it("returns null while cumulative volume is zero", () => {
    const out = vwap([candle(10, 10, 10, 0)]);
    expect(out[0]).toBeNull();
  });

  it("matches the input length", () => {
    expect(vwap([candle(1, 1, 1, 1)])).toHaveLength(1);
  });
});

describe("volumeProfile", () => {
  const bar = (low: number, high: number, volume: number) => ({
    low,
    high,
    close: (low + high) / 2,
    volume,
  });

  it("matches a hand-computed profile", () => {
    // Range 0..3 over 4 bins -> step 0.75, so the bins are
    //   [0,0.75) [0.75,1.5) [1.5,2.25) [2.25,3]
    const p = volumeProfile(
      [bar(0, 1, 10), bar(0, 0, 30), bar(1, 3, 20)],
      4,
    )!;
    expect(p.step).toBeCloseTo(0.75, 10);
    // 10 spans bins 0-1 (5 each), 30 lands whole in bin 0, 20 spans bins 1-3
    // (6.667 each) -> [35, 11.667, 6.667, 6.667]
    expect(p.bins.map((b) => b.volume)).toEqual([
      expect.closeTo(35, 9),
      expect.closeTo(11.6667, 3),
      expect.closeTo(6.6667, 3),
      expect.closeTo(6.6667, 3),
    ]);
    // POC is bin 0 (35). Target is 0.7 * 60 = 42; adding bin 1 reaches 46.67.
    // So the value area is bins 0-1: edges 0 .. 1.5.
    expect(p.poc).toBeCloseTo(0.375, 10);
    expect(p.val).toBeCloseTo(0, 10);
    expect(p.vah).toBeCloseTo(1.5, 10);
    expect(p.totalVolume).toBeCloseTo(60, 9);
  });

  it("conserves volume — nothing is created or lost by the binning", () => {
    // The span arithmetic is the easiest thing to get off by one, and an
    // off-by-one either duplicates or drops volume.
    const candles = [
      bar(100, 105, 3),
      bar(101, 103, 7.5),
      bar(99, 100, 0.25),
      bar(103, 108, 12),
      bar(104, 104, 5.125),
      bar(102, 107, 8),
    ];
    const p = volumeProfile(candles, 24)!;
    const binned = p.bins.reduce((s, b) => s + b.volume, 0);
    const input = candles.reduce((s, c) => s + c.volume, 0);
    expect(binned).toBeCloseTo(input, 9);
    expect(p.totalVolume).toBeCloseTo(input, 9);
  });

  it("keeps the value area at or above 70% and containing the POC", () => {
    // A realistic ramp: heavy acceptance low, thin tail high.
    const candles = Array.from({ length: 120 }, (_, i) =>
      bar(100 + i * 0.1, 101 + i * 0.1, 100 - i * 0.5),
    );
    const p = volumeProfile(candles, 40)!;
    const inVA = p.bins
      .filter((b) => b.low >= p.val - 1e-9 && b.high <= p.vah + 1e-9)
      .reduce((s, b) => s + b.volume, 0);
    expect(inVA / p.totalVolume).toBeGreaterThanOrEqual(0.7);
    expect(p.val).toBeLessThanOrEqual(p.poc + 1e-9);
    expect(p.poc).toBeLessThanOrEqual(p.vah + 1e-9);
  });

  it("makes the POC the highest-volume bin", () => {
    const p = volumeProfile(
      [bar(10, 11, 1), bar(11, 12, 50), bar(12, 13, 2), bar(13, 14, 1)],
      8,
    )!;
    const max = Math.max(...p.bins.map((b) => b.volume));
    const pocBin = p.bins.reduce((a, b) => (b.volume > a.volume ? b : a));
    expect(pocBin.volume).toBeCloseTo(max, 10);
    expect(p.poc).toBeCloseTo(pocBin.price, 10);
  });

  it("produces contiguous, non-overlapping bins", () => {
    const p = volumeProfile([bar(5, 25, 10), bar(6, 20, 10)], 16)!;
    expect(p.bins).toHaveLength(16);
    for (let i = 0; i < p.bins.length - 1; i++) {
      expect(p.bins[i].high).toBeCloseTo(p.bins[i + 1].low, 10);
    }
    // Bins tile the observed range exactly.
    expect(p.bins[0].low).toBeCloseTo(5, 10);
    expect(p.bins[p.bins.length - 1].high).toBeCloseTo(25, 10);
  });

  it("collapses a perfectly flat window to a single bin", () => {
    const p = volumeProfile([bar(50, 50, 4), bar(50, 50, 6)], 32)!;
    expect(p.step).toBe(0);
    expect(p.bins).toHaveLength(1);
    expect(p.poc).toBe(50);
    expect(p.val).toBe(50);
    expect(p.vah).toBe(50);
    expect(p.totalVolume).toBeCloseTo(10, 10);
  });

  it("ignores zero-volume bars when measuring the range", () => {
    // The 0..100 gap traded nothing, so it must not smear the profile flat.
    const wide = volumeProfile(
      [bar(0, 100, 0), bar(50, 50.4, 10)],
      4,
    )!;
    expect(wide.bins[0].low).toBeCloseTo(50, 10);
    expect(wide.bins[wide.bins.length - 1].high).toBeCloseTo(50.4, 10);
  });

  it("splits a single bar evenly across the bins it spans", () => {
    const p = volumeProfile([bar(0, 4, 40)], 4)!;
    for (const b of p.bins) expect(b.volume).toBeCloseTo(10, 10);
    expect(p.totalVolume).toBeCloseTo(40, 10);
  });

  it("returns null when there is nothing to profile", () => {
    expect(volumeProfile([])).toBeNull();
    expect(volumeProfile([bar(1, 2, 0), bar(3, 4, 0)])).toBeNull();
    expect(volumeProfile([bar(1, 2, 10)], 0)).toBeNull();
    expect(volumeProfile([bar(1, 2, 10)], -3)).toBeNull();
    expect(volumeProfile([bar(1, 2, 10)], 2.5)).toBeNull();
  });

  it("discards non-finite bars instead of poisoning the profile", () => {
    const p = volumeProfile(
      [bar(1, 2, 10), bar(NaN, 2, 5), bar(1, Infinity, 5), bar(1, 2, NaN), bar(1, 2, -5)],
      4,
    )!;
    expect(p.totalVolume).toBeCloseTo(10, 10);
    expect(p.bins.every((b) => Number.isFinite(b.volume))).toBe(true);
  });

  it("is deterministic and breaks volume ties toward the lower price", () => {
    const candles = [bar(0, 2, 5), bar(2, 4, 5), bar(4, 6, 5)];
    expect(volumeProfile(candles, 6)).toEqual(volumeProfile(candles, 6));
    // A single bar spread over 4 bins puts 10 in every bin, so all four tie
    // for the POC. Ties must not drift with iteration order.
    const tied = volumeProfile([bar(0, 4, 40)], 4)!;
    expect(new Set(tied.bins.map((b) => b.volume)).size).toBe(1);
    expect(tied.poc).toBe(tied.bins[0].price);
  });
});
