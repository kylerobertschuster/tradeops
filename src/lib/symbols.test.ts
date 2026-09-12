import { describe, expect, it } from "vitest";
import { CURATED, ALL_SYMBOLS, SYMBOL_MAP, findSymbol, searchSymbols } from "./symbols";

describe("catalog integrity", () => {
  it("has a unique symbol per entry", () => {
    const symbols = ALL_SYMBOLS.map((s) => s.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("quotes every symbol against USDT so /api/klines accepts it", () => {
    // The route validates against /^[A-Z0-9]{2,20}USDT$/; a typo here would
    // 400 at runtime instead of failing the build.
    for (const s of ALL_SYMBOLS) {
      expect(s.symbol).toMatch(/^[A-Z0-9]{2,20}USDT$/);
      expect(s.symbol).toBe(`${s.base}USDT`);
    }
  });

  it("resolves every catalog entry through SYMBOL_MAP", () => {
    for (const s of ALL_SYMBOLS) expect(SYMBOL_MAP[s.symbol]).toBe(s);
  });

  it("keeps the watchlist fully searchable", () => {
    for (const s of CURATED) {
      expect(searchSymbols(s.base)).toContain(s);
    }
  });
});

describe("findSymbol", () => {
  it("returns the catalog entry when known", () => {
    expect(findSymbol("BTCUSDT").name).toBe("Bitcoin");
  });

  it("synthesises a fallback for an unknown symbol", () => {
    expect(findSymbol("FOOUSDT")).toEqual({
      symbol: "FOOUSDT",
      base: "FOO",
      name: "FOO",
    });
  });

  it("only strips a trailing USDT, not an embedded one", () => {
    expect(findSymbol("USDTUSDT").base).toBe("USDT");
  });
});

describe("searchSymbols", () => {
  it("returns the watchlist head for an empty query", () => {
    expect(searchSymbols("")).toEqual(CURATED.slice(0, 8));
    expect(searchSymbols("   ")).toEqual(CURATED.slice(0, 8));
  });

  it("is case insensitive", () => {
    expect(searchSymbols("btc")).toEqual(searchSymbols("BTC"));
  });

  it("ranks an exact base match first", () => {
    // "BTC" also substring-matches "Bitcoin Cash"'s name; the exact hit must win.
    expect(searchSymbols("BTC")[0].base).toBe("BTC");
  });

  it("matches on the full symbol too", () => {
    expect(searchSymbols("SOLUSDT")[0].base).toBe("SOL");
  });

  it("matches on the project name", () => {
    expect(searchSymbols("chainlink").map((s) => s.base)).toContain("LINK");
  });

  it("caps the result set", () => {
    expect(searchSymbols("a").length).toBeLessThanOrEqual(10);
  });

  it("returns nothing for a query that matches no asset", () => {
    expect(searchSymbols("ZZZZZZ")).toEqual([]);
  });
});
