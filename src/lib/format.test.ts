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
