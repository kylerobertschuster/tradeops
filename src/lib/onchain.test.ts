import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBlockTimestamps, priceAtTime, rpcUrls } from "./onchain";
import type { Candle } from "./types";

type RpcRequest = { id: number; method: string; params: unknown[] };

/** Capture request bodies and answer them with a canned JSON-RPC batch. */
function mockRpc(answer: (body: RpcRequest[], url: string) => unknown) {
  const calls: RpcRequest[][] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as RpcRequest[];
    calls.push(body);
    return new Response(JSON.stringify(answer(body, String(url))), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return calls;
}

/** A well-formed batch answer that echoes ids in the order given. */
function echo(body: RpcRequest[]) {
  return body.map((r) => ({ id: r.id, result: { timestamp: "0x" + (1_800_000_000 + r.id).toString(16) } }));
}

// `rpcUrls()` reads the environment on every call, so a developer who has
// `ETH_RPC_URLS` exported would otherwise exercise their own node here and get
// different endpoints than CI does.
beforeEach(() => {
  delete process.env.ETH_RPC_URLS;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getBlockTimestamps", () => {
  it("maps responses by id, not by array position", () => {
    // JSON-RPC 2.0 says a batch's responses "MAY be returned in any order".
    // Positional matching would hand each block a different block's time —
    // silently wrong data, which is worse than an error.
    mockRpc((body) => echo(body).reverse());
    return getBlockTimestamps([10, 20, 30]).then((times) => {
      expect(times.get(10)).toBe(1_800_000_010);
      expect(times.get(20)).toBe(1_800_000_020);
      expect(times.get(30)).toBe(1_800_000_030);
    });
  });

  it("dedupes blocks and chunks requests to the batch size", async () => {
    const calls = mockRpc(echo);
    // 120 unique values out of 200 inputs, at 50 per batch -> 3 requests.
    const blocks = [...Array.from({ length: 120 }, (_, i) => i), ...Array.from({ length: 80 }, (_, i) => i)];
    const times = await getBlockTimestamps(blocks);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.length)).toEqual([50, 50, 20]);
    expect(times.size).toBe(120);
    // Block numbers travel as hex quantities, and full bodies are not requested.
    expect(calls[0][0].params).toEqual(["0x0", false]);
    expect(calls[0][0].method).toBe("eth_getBlockByNumber");
  });

  it("omits unresolvable blocks instead of inventing a time", async () => {
    mockRpc((body) =>
      body.map((r, i) => (i === 1 ? { id: r.id, result: null } : { id: r.id, result: { timestamp: "0x6b49d200" } })),
    );
    const times = await getBlockTimestamps([7, 8, 9]);
    expect(times.size).toBe(2);
    expect(times.has(8)).toBe(false);
    expect(times.get(7)).toBe(1_800_000_000);
  });

  it("fails over to the next provider", async () => {
    let seen = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen++;
      if (seen === 1) return new Response("nope", { status: 429 });
      const body = JSON.parse(String(init.body)) as RpcRequest[];
      expect(String(url)).toContain("drpc"); // second entry in the default list
      return new Response(JSON.stringify(echo(body)), { status: 200 });
    });
    const times = await getBlockTimestamps([5]);
    expect(times.get(5)).toBe(1_800_000_005);
  });

  it("degrades to an empty map rather than throwing", async () => {
    // A provider that rejects batches outright costs us real timestamps but
    // must not take the endpoint down; callers fall back to inference.
    vi.stubGlobal("fetch", async () => new Response("<html>batch not supported</html>", { status: 400 }));
    await expect(getBlockTimestamps([1, 2, 3])).resolves.toEqual(new Map());
  });

  it("returns early for empty or unusable input", async () => {
    const calls = mockRpc(echo);
    expect(await getBlockTimestamps([])).toEqual(new Map());
    expect(await getBlockTimestamps([-1, 1.5, NaN])).toEqual(new Map());
    expect(calls).toHaveLength(0);
  });
});

describe("priceAtTime", () => {
  const candles: Candle[] = [
    { time: 1000, open: 1, high: 9, low: 0.5, close: 2, volume: 10 },
    { time: 1300, open: 2, high: 9, low: 0.5, close: 3, volume: 10 },
    { time: 1600, open: 3, high: 9, low: 0.5, close: 4, volume: 10 },
  ];

  it("returns the close of the candle covering the instant", () => {
    expect(priceAtTime(candles, 1000)).toBe(2); // candle open, inclusive
    expect(priceAtTime(candles, 1299)).toBe(2); // anywhere inside
    expect(priceAtTime(candles, 1300)).toBe(3); // next candle begins
    expect(priceAtTime(candles, 1899)).toBe(4);
  });

  it("uses the close, not the open, high or low", () => {
    expect(priceAtTime(candles, 1750)).not.toBe(3); // open
    expect(priceAtTime(candles, 1750)).not.toBe(9); // high
    expect(priceAtTime(candles, 1750)).not.toBe(0.5); // low
  });

  it("returns null when the instant predates the series", () => {
    expect(priceAtTime(candles, 999)).toBeNull();
    expect(priceAtTime(candles, 0)).toBeNull();
    expect(priceAtTime([], 1000)).toBeNull();
  });

  it("clamps to the newest candle once past the end", () => {
    // Callers treat null as "no historical price" and fall back to spot, so
    // running past the end must not be mistaken for running before it.
    expect(priceAtTime(candles, 999_999)).toBe(4);
    expect(priceAtTime(candles, 1900)).toBe(4);
  });

  it("agrees with a linear scan over the whole series", () => {
    const many: Candle[] = Array.from({ length: 200 }, (_, i) => ({
      time: i * 300,
      open: i,
      high: i,
      low: i,
      close: i * 1.5,
      volume: 1,
    }));
    for (const t of [0, 1, 299, 300, 30_000, 59_700, 59_701, 100_000]) {
      const expected = many.filter((c) => c.time <= t).pop()?.close ?? null;
      expect(priceAtTime(many, t)).toBe(expected);
    }
  });
});

describe("rpcUrls", () => {
  it("defaults to the public endpoints, in a fixed order", () => {
    // Order is the failover order, so it is part of the contract.
    expect(rpcUrls()).toEqual([
      "https://ethereum-rpc.publicnode.com",
      "https://eth.drpc.org",
      "https://1rpc.io/eth",
      "https://rpc.flashbots.net",
    ]);
  });

  it("takes an override list, trimmed and de-duplicated, in the order given", () => {
    process.env.ETH_RPC_URLS =
      " https://a.example.com , https://b.example.com ,https://a.example.com";
    expect(rpcUrls()).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("drops entries that are not absolute http(s) URLs", () => {
    // A bare host reaches `fetch` as a relative path and fails in a way that
    // reads as the node being down, which is the wrong bug to go hunting for.
    process.env.ETH_RPC_URLS =
      "my-node.example.com,ws://node.example.com,https://good.example.com";
    expect(rpcUrls()).toEqual(["https://good.example.com"]);
  });

  it("falls back to the defaults rather than to nothing when the value is unusable", () => {
    // A typo must not silently switch the on-chain panels off.
    process.env.ETH_RPC_URLS = "   ";
    expect(rpcUrls()).toHaveLength(4);
    process.env.ETH_RPC_URLS = "not-a-url";
    expect(rpcUrls()).toHaveLength(4);
  });

  it("returns an empty list only when explicitly turned off", () => {
    // The one way to stop leaning on someone else's node entirely.
    process.env.ETH_RPC_URLS = "off";
    expect(rpcUrls()).toEqual([]);
  });
});
