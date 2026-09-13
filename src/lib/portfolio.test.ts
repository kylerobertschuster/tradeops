import { describe, expect, it } from "vitest";
import { FEE_RATE, STARTING_BALANCE, type Position } from "@/store/paperTrading";
import { maxNotional, portfolioValue } from "./portfolio";
import type { Ticker } from "./types";

function ticker(symbol: string, price: number): Ticker {
  return {
    symbol,
    base: symbol.replace(/USDT$/, ""),
    price,
    change24h: 0,
    high24h: price,
    low24h: price,
    quoteVolume: 0,
  };
}

function position(symbol: string, qty: number, avgPrice: number): Position {
  return { symbol, base: symbol.replace(/USDT$/, ""), qty, avgPrice };
}

describe("portfolioValue", () => {
  it("reports cash alone when nothing is open", () => {
    const p = portfolioValue(STARTING_BALANCE, {}, {});
    expect(p.equity).toBe(STARTING_BALANCE);
    expect(p.pnl).toBe(0);
    expect(p.unrealized).toBe(0);
    expect(p.priced).toBe(true);
    expect(p.unpriced).toEqual([]);
  });

  it("marks open positions to the live price", () => {
    const p = portfolioValue(
      90_000,
      { BTCUSDT: position("BTCUSDT", 0.1, 90_000) },
      { BTCUSDT: ticker("BTCUSDT", 100_000) },
    );
    expect(p.equity).toBe(100_000);
    expect(p.unrealized).toBe(10_000);
    expect(p.pnl).toBe(0);
    expect(p.priced).toBe(true);
  });

  it("flags the totals as approximate when a position cannot be priced", () => {
    const p = portfolioValue(
      90_000,
      {
        BTCUSDT: position("BTCUSDT", 0.1, 90_000),
        // No ticker for this one — e.g. a delisted symbol.
        MKRUSDT: position("MKRUSDT", 1, 1_000),
      },
      { BTCUSDT: ticker("BTCUSDT", 100_000) },
    );

    expect(p.priced).toBe(false);
    expect(p.unpriced).toEqual(["MKRUSDT"]);
    // It still contributes, at cost, so the total does not silently drop.
    expect(p.equity).toBe(101_000);
  });

  it("does not report a fabricated zero P&L for an unpriced position", () => {
    // The old behaviour valued the position at its own cost basis, which made
    // P&L read as a confident $0.00 — "no change" — rather than "unknown".
    // The number looks identical here, so the flag is the whole point.
    const p = portfolioValue(
      0,
      { BTCUSDT: position("BTCUSDT", 1, 50_000) },
      {},
    );
    expect(p.pnl).toBe(-50_000);
    expect(p.priced).toBe(false);
    expect(p.unpriced).toContain("BTCUSDT");
  });
});

describe("maxNotional", () => {
  it("caps a buy below cash so the taker fee still fits", () => {
    const notional = maxNotional("buy", 100_000, 0, 77_000);
    const total = notional + notional * FEE_RATE;

    expect(notional).toBeLessThan(100_000);
    // The whole point: taking the max must not exceed the balance.
    expect(total).toBeLessThanOrEqual(100_000);
  });

  it("would fail if it were sized off raw cash", () => {
    // Regression guard for the Max button, which always errored with
    // "Insufficient buying power" because the fee was charged on top.
    const naive = 100_000;
    expect(naive + naive * FEE_RATE).toBeGreaterThan(100_000);

    const fixed = maxNotional("buy", 100_000, 0, 77_000);
    expect(fixed + fixed * FEE_RATE).toBeLessThanOrEqual(100_000);
  });

  it("lets a sell cover the whole position", () => {
    expect(maxNotional("sell", 12_345, 0.5, 77_250)).toBeCloseTo(38_625, 6);
  });

  it("returns zero rather than a nonsense size for an empty account", () => {
    expect(maxNotional("buy", 0, 0, 77_000)).toBe(0);
    expect(maxNotional("sell", 0, 0, 0)).toBe(0);
  });
});
