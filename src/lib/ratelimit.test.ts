import { describe, expect, it } from "vitest";
import { checkRateLimit, clientIp, limitForPath } from "./ratelimit";

const W = 60_000;
/** Align to a window boundary so the arithmetic below is exact. */
const T = Math.floor(1_800_000_000_000 / W) * W;

describe("limitForPath", () => {
  it("applies the strict on-chain budgets", () => {
    expect(limitForPath("/api/whales")).toBe(30);
    expect(limitForPath("/api/transfers")).toBe(30);
    expect(limitForPath("/api/holders")).toBe(20);
  });

  it("matches nested paths under a route", () => {
    expect(limitForPath("/api/whales/0xabc")).toBe(30);
  });

  it("does not match a route that merely shares a prefix", () => {
    // "/api/whalesomething" must not inherit the whales budget.
    expect(limitForPath("/api/whalesomething")).toBe(120);
  });

  it("falls back to the default for market data", () => {
    expect(limitForPath("/api/klines")).toBe(120);
    expect(limitForPath("/api/tickers")).toBe(120);
  });

  it("gives the cache-only search route a generous budget", () => {
    expect(limitForPath("/api/symbols")).toBe(300);
  });
});

describe("checkRateLimit", () => {
  it("allows exactly `limit` requests, then rejects", () => {
    const key = "test-exact-limit";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, T).ok).toBe(true);
    }
    const blocked = checkRateLimit(key, 5, T);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.limit).toBe(5);
  });

  it("reports a retry-after inside the window", () => {
    const key = "test-retry-after";
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, T);
    const blocked = checkRateLimit(key, 3, T + 15_000);
    expect(blocked.ok).toBe(false);
    // 45s left in the window.
    expect(blocked.retryAfterSec).toBe(45);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("counts down `remaining`", () => {
    const key = "test-remaining";
    expect(checkRateLimit(key, 4, T).remaining).toBe(3);
    expect(checkRateLimit(key, 4, T).remaining).toBe(2);
    expect(checkRateLimit(key, 4, T).remaining).toBe(1);
    expect(checkRateLimit(key, 4, T).remaining).toBe(0);
  });

  it("keeps separate budgets per key", () => {
    const a = "test-isolation-a";
    const b = "test-isolation-b";
    for (let i = 0; i < 2; i++) checkRateLimit(a, 2, T);
    expect(checkRateLimit(a, 2, T).ok).toBe(false);
    // b must be unaffected by a being exhausted.
    expect(checkRateLimit(b, 2, T).ok).toBe(true);
  });

  it("throttles the start of the next window (anti-burst smoothing)", () => {
    const key = "test-anti-burst";
    for (let i = 0; i < 10; i++) checkRateLimit(key, 10, T);
    // A naive fixed window would let all 10 through again here.
    expect(checkRateLimit(key, 10, T + W).ok).toBe(false);
  });

  it("lets traffic resume as the previous window's weight decays", () => {
    const key = "test-decay";
    for (let i = 0; i < 10; i++) checkRateLimit(key, 10, T);
    // Halfway into window 2 the carry-over is weighted at 0.5, so 5 of the 10
    // headroom is back.
    expect(checkRateLimit(key, 10, T + W + W / 2).ok).toBe(true);
    // By the final millisecond of window 2 the weight is ~0 and the budget has
    // fully recovered.
    expect(checkRateLimit(key, 10, T + 2 * W - 1).ok).toBe(true);
  });

  it("stays blocked for the whole of the window that follows a full one", () => {
    const key = "test-decay-boundary";
    for (let i = 0; i < 10; i++) checkRateLimit(key, 10, T);
    // T + W - 1 is still the last millisecond of the *first* window, and
    // T + W is the first of the second: both must reject.
    expect(checkRateLimit(key, 10, T + W - 1).ok).toBe(false);
    expect(checkRateLimit(key, 10, T + W).ok).toBe(false);
  });

  it("forgets history when the client has been idle for a full window", () => {
    const key = "test-idle";
    for (let i = 0; i < 10; i++) checkRateLimit(key, 10, T);
    // Jumping two windows ahead means the old count must not be carried over.
    expect(checkRateLimit(key, 10, T + 3 * W).ok).toBe(true);
  });

  it("honours an injected clock rather than wall time", () => {
    const key = "test-injected-clock";
    for (let i = 0; i < 2; i++) checkRateLimit(key, 2, T);
    expect(checkRateLimit(key, 2, T).ok).toBe(false);
    expect(checkRateLimit(key, 2, T + W).ok).toBe(false);
    expect(checkRateLimit(key, 2, T + 2 * W).ok).toBe(true);
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://example.com/api/whales", { headers });

  it("uses the right-most x-forwarded-for hop, not the client-supplied first", () => {
    // An attacker prefixing a fake IP must not be able to rotate their bucket.
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("accepts a single x-forwarded-for value", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("prefers proxy-set headers over x-forwarded-for", () => {
    const headers = { "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.5.5.5" };
    expect(clientIp(req(headers))).toBe("5.5.5.5");
  });

  it("tolerates whitespace around hops", () => {
    expect(clientIp(req({ "x-forwarded-for": "  1.1.1.1 ,  2.2.2.2  " }))).toBe("2.2.2.2");
  });

  it("falls back to a shared bucket when no header is present", () => {
    expect(clientIp(req({}))).toBe("unknown");
  });
});
