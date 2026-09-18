import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatPrice,
  formatUsd,
  formatCompact,
  formatPct,
  formatQty,
  formatTime,
  timeAgo,
  shortAddr,
  formatCompactNum,
  formatTokenAmount,
  chartPriceDecimals,
  formatChartPrice,
} from "./format";

afterEach(() => {
  vi.useRealTimers();
});

describe("unparseable input", () => {
  // Every formatter must degrade to an em dash rather than "NaN" or "$NaN".
  const bad = [undefined, null, NaN, Infinity, -Infinity];
  const fns = [
    formatPrice,
    formatUsd,
    formatCompact,
    formatPct,
    formatQty,
    formatCompactNum,
  ];

  it.each(fns.map((f) => [f.name, f] as const))("%s renders —", (_name, fn) => {
    for (const v of bad) expect(fn(v as number)).toBe("—");
  });
});

describe("formatPrice", () => {
  it("uses 2 decimals at or above 1000", () => {
    expect(formatPrice(1000)).toBe("1,000.00");
    expect(formatPrice(64234.5)).toBe("64,234.50");
  });

  it("allows up to 4 decimals between 1 and 1000", () => {
    expect(formatPrice(1)).toBe("1.00");
    expect(formatPrice(2.5)).toBe("2.50");
    expect(formatPrice(999.9949)).toBe("999.9949");
  });

  it("allows up to 8 decimals below 1 — small-cap tokens need the range", () => {
    expect(formatPrice(0.5)).toBe("0.5000");
    expect(formatPrice(0.12345678)).toBe("0.12345678");
  });
});

describe("formatUsd", () => {
  it("defaults to cents", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  it("drops the fraction part when cents=false", () => {
    expect(formatUsd(1234.2, false)).toBe("$1,234");
  });
});

describe("formatCompact", () => {
  it("scales through T/B/M/K with a dollar sign", () => {
    expect(formatCompact(1e12)).toBe("$1.00T");
    expect(formatCompact(1.5e9)).toBe("$1.50B");
    expect(formatCompact(2.25e6)).toBe("$2.25M");
    expect(formatCompact(1500)).toBe("$1.50K");
    expect(formatCompact(999)).toBe("$999.00");
  });

  it("puts the sign outside the dollar sign", () => {
    expect(formatCompact(-1.5e6)).toBe("-$1.50M");
    expect(formatCompact(-999)).toBe("-$999.00");
  });

  it("treats zero as a plain amount", () => {
    expect(formatCompact(0)).toBe("$0.00");
  });
});

describe("formatPct", () => {
  it("adds a plus sign for gains only", () => {
    expect(formatPct(2.5)).toBe("+2.50%");
    expect(formatPct(-2.5)).toBe("-2.50%");
    expect(formatPct(0)).toBe("0.00%");
  });

  it("omits the sign when signed=false", () => {
    expect(formatPct(2.5, false)).toBe("2.50%");
  });
});

/**
 * The chart axis, where the library's fixed two decimals used to be the whole
 * story — see the comment on `chartPriceDecimals` for what that looked like on
 * a memecoin.
 */
describe("chartPriceDecimals", () => {
  it("gives whole numbers when the axis spans thousands", () => {
    expect(chartPriceDecimals(10000)).toBe(0);
    expect(chartPriceDecimals(100)).toBe(0);
  });

  it("adds a digit for every power of ten the axis comes down to", () => {
    expect(chartPriceDecimals(10)).toBe(1);
    expect(chartPriceDecimals(1)).toBe(2);
    expect(chartPriceDecimals(0.1)).toBe(3);
    expect(chartPriceDecimals(0.5)).toBe(3);
    expect(chartPriceDecimals(0.01)).toBe(4);
  });

  it("reaches the sub-cent tokens the fixed format flattened to 0.00", () => {
    // DOGE's whole daily range, then PEPE's, then a zoom into PEPE.
    expect(chartPriceDecimals(0.02)).toBe(4);
    expect(chartPriceDecimals(0.00001)).toBe(7);
    expect(chartPriceDecimals(0.000001)).toBe(8);
  });

  it("stops at 8, the library's own limit on tick spacing", () => {
    expect(chartPriceDecimals(1e-9)).toBe(8);
    expect(chartPriceDecimals(1e-30)).toBe(8);
  });

  it("falls back to the old behaviour for a range it cannot use", () => {
    // Called before any candles are loaded, and after a degenerate fit.
    for (const range of [0, -1, NaN, Infinity]) {
      expect(chartPriceDecimals(range)).toBe(2);
    }
  });
});

describe("formatChartPrice", () => {
  it("groups thousands, which toFixed does not", () => {
    expect(formatChartPrice(101200, 0)).toBe("101,200");
    expect(formatChartPrice(1500.5, 2)).toBe("1,500.50");
  });

  it("applies the digit count to every label, not just the ones that need it", () => {
    expect(formatChartPrice(0.0842, 4)).toBe("0.0842");
    expect(formatChartPrice(0.085, 4)).toBe("0.0850");
    expect(formatChartPrice(0.08425, 5)).toBe("0.08425");
  });

  it("keeps a memecoin price distinguishable from its neighbour", () => {
    // The pair that used to render as `0.00` and `0.00` side by side.
    expect(formatChartPrice(0.00001234, 8)).toBe("0.00001234");
    expect(formatChartPrice(0.00001235, 8)).toBe("0.00001235");
  });

  it("degrades to a dash rather than NaN", () => {
    expect(formatChartPrice(NaN, 2)).toBe("—");
    expect(formatChartPrice(undefined, 2)).toBe("—");
  });
});

describe("formatQty", () => {
  it("widens precision as the quantity shrinks", () => {
    expect(formatQty(0)).toBe("0");
    expect(formatQty(1.5)).toBe("1.5");
    expect(formatQty(0.005)).toBe("0.005");
    expect(formatQty(0.0005)).toBe("0.0005");
  });
});

describe("formatCompactNum", () => {
  it("scales without a currency symbol", () => {
    expect(formatCompactNum(1500)).toBe("1.50K");
    expect(formatCompactNum(-1500)).toBe("-1.50K");
    expect(formatCompactNum(2.5e6)).toBe("2.50M");
  });
});

describe("timeAgo", () => {
  const at = Date.UTC(2024, 0, 15, 12, 0, 0);

  const ago = (seconds: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(at);
    return timeAgo(at - seconds * 1000);
  };

  it("steps through s, m, h, d at the right boundaries", () => {
    expect(ago(30)).toBe("30s");
    expect(ago(59)).toBe("59s");
    expect(ago(60)).toBe("1m");
    expect(ago(3599)).toBe("59m");
    expect(ago(3600)).toBe("1h");
    expect(ago(86399)).toBe("23h");
    expect(ago(86400)).toBe("1d");
  });

  it("clamps future timestamps to 0s instead of going negative", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at);
    expect(timeAgo(at + 5000)).toBe("0s");
  });
});

describe("formatTime", () => {
  it("renders a month/day + 24h clock", () => {
    // Mid-day UTC so no timezone can shift the calendar day.
    expect(formatTime(Date.UTC(2024, 0, 15, 12, 0, 0))).toMatch(/Jan 15/);
  });
});

describe("shortAddr", () => {
  it("truncates long addresses to 6…4", () => {
    expect(shortAddr("0x1234567890abcdef")).toBe("0x1234…cdef");
  });

  it("leaves short strings untouched", () => {
    expect(shortAddr("0x1234")).toBe("0x1234");
  });

  it("handles empty input", () => {
    expect(shortAddr("")).toBe("");
  });
});

describe("formatTokenAmount", () => {
  // ERC-20 amounts arrive as base-unit integers. Above 2^53 the Number path
  // silently rounds, which is the whole reason this helper exists.
  it("converts base units exactly for 18-decimal tokens", () => {
    expect(formatTokenAmount("1000000000000000000", 18)).toBe("1");
    expect(formatTokenAmount("1500000000000000000", 18)).toBe("1.5");
    expect(formatTokenAmount("1", 18)).toBe("0.000000000000000001");
    expect(formatTokenAmount("0", 18)).toBe("0");
  });

  it("handles 6- and 8-decimal tokens", () => {
    expect(formatTokenAmount("1500000", 6)).toBe("1.5");
    expect(formatTokenAmount("1", 6)).toBe("0.000001");
    expect(formatTokenAmount("100000000", 8)).toBe("1"); // WBTC
    expect(formatTokenAmount("123456789", 8)).toBe("1.23456789");
  });

  it("stays exact where Number() would round", () => {
    // 123.456789012345678901 tokens, the kind of value a large LINK transfer
    // carries. Number() cannot represent this: it rounds to 123.45678901234568.
    const raw = "123456789012345678901"; // 21 digits, > 2^53
    expect(formatTokenAmount(raw, 18)).toBe("123.456789012345678901");
    expect(String(Number(raw) / 10 ** 18)).toBe("123.45678901234568"); // the old path

    // Well past the safe integer range entirely.
    const huge = "123456789123456789123456789";
    expect(formatTokenAmount(huge, 18)).toBe("123456789.123456789123456789");
  });

  it("trims trailing fractional zeros but keeps a trailing integer zero", () => {
    expect(formatTokenAmount("10000000", 6)).toBe("10");
    expect(formatTokenAmount("1230000", 6)).toBe("1.23");
    expect(formatTokenAmount("100", 0)).toBe("100");
  });

  it("does not break when decimals is 0", () => {
    // padStart(decimals + 1) then slicing by explicit index, rather than
    // slice(0, -decimals) which is slice(0, 0) when decimals is 0.
    expect(formatTokenAmount("42", 0)).toBe("42");
    expect(formatTokenAmount("0", 0)).toBe("0");
    expect(formatTokenAmount("007", 0)).toBe("7");
  });

  it("accepts bigint and normalises leading zeros", () => {
    expect(formatTokenAmount(1500000000000000000n, 18)).toBe("1.5");
    expect(formatTokenAmount("0001500000", 6)).toBe("1.5");
  });

  it("never emits exponent notation", () => {
    // A 1-wei USDC transfer must not render as "1e-6".
    for (const s of [formatTokenAmount("1", 6), formatTokenAmount("1", 18)]) {
      expect(s).not.toMatch(/e/i);
      expect(s).toMatch(/^0\.0*\d+$/);
    }
  });

  it("returns a dash for junk instead of NaN leaking into the UI", () => {
    expect(formatTokenAmount("0x1f", 18)).toBe("—");
    expect(formatTokenAmount("", 18)).toBe("—");
    expect(formatTokenAmount("1.5", 18)).toBe("—");
    expect(formatTokenAmount("abc", 18)).toBe("—");
    expect(formatTokenAmount("1", -1)).toBe("—");
    expect(formatTokenAmount("1", 1.5)).toBe("—");
  });

  it("round-trips integers back to themselves at their own scale", () => {
    const raw = 123456789012345678901n;
    const shown = formatTokenAmount(raw, 18);
    expect(BigInt(shown.replace(".", ""))).toBe(raw);
  });
});
