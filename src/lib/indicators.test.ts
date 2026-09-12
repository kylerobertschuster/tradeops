import { describe, expect, it } from "vitest";
import { sma, ema, rsi, macd, bollinger, vwap } from "./indicators";

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
