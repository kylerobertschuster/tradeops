import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  candleFromKline,
  createLiveFeed,
  klineStream,
  miniTickerStream,
  tickerFromMiniTicker,
} from "./live";

/** Minimal stand-in for the browser WebSocket, driven by the test. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Simulate the handshake completing. */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Simulate the server dropping the connection. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** Subscription params the feed has asked for, in order. */
  subscriptionParams() {
    return this.sent
      .map((raw) => JSON.parse(raw) as { method: string; params: string[] })
      .filter((m) => m.method === "SUBSCRIBE")
      .flatMap((m) => m.params);
  }

  unsubscriptionParams() {
    return this.sent
      .map((raw) => JSON.parse(raw) as { method: string; params: string[] })
      .filter((m) => m.method === "UNSUBSCRIBE")
      .flatMap((m) => m.params);
  }
}

const last = () => FakeSocket.instances[FakeSocket.instances.length - 1];

function handlers() {
  return {
    onTicker: vi.fn(),
    onKline: vi.fn(),
    onStatus: vi.fn(),
  };
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("live message parsing", () => {
  it("maps a miniTicker payload onto Ticker", () => {
    const t = tickerFromMiniTicker({
      e: "24hrMiniTicker",
      s: "BTCUSDT",
      c: "77308.01000000",
      o: "77143.26000000",
      h: "77413.52000000",
      l: "76500.00000000",
      q: "542320537.35949200",
    });

    expect(t).not.toBeNull();
    expect(t!.symbol).toBe("BTCUSDT");
    expect(t!.base).toBe("BTC");
    expect(t!.price).toBe(77308.01);
    expect(t!.high24h).toBe(77413.52);
    expect(t!.low24h).toBe(76500);
    expect(t!.quoteVolume).toBeCloseTo(542320537.36, 1);
    // The stream sends no percentage, so it must be derived from the 24h open.
    expect(t!.change24h).toBeCloseTo(0.2136, 3);
  });

  it("rejects a miniTicker payload with no usable price", () => {
    expect(tickerFromMiniTicker({ e: "24hrMiniTicker", s: "BTCUSDT" })).toBeNull();
    expect(tickerFromMiniTicker({ e: "24hrMiniTicker", c: "1" })).toBeNull();
  });

  it("converts kline times from milliseconds to unix seconds", () => {
    const parsed = candleFromKline({
      e: "kline",
      s: "ETHUSDT",
      k: {
        t: 1789326825000,
        o: "2510.32",
        h: "2511.00",
        l: "2509.10",
        c: "2510.50",
        v: "12.5",
        x: false,
      },
    });

    expect(parsed).not.toBeNull();
    // The chart's time scale is built on seconds; passing ms would place the
    // candle roughly 56,000 years into the future.
    expect(parsed!.candle.time).toBe(1789326825);
    expect(parsed!.candle.close).toBe(2510.5);
    expect(parsed!.candle.volume).toBe(12.5);
    expect(parsed!.closed).toBe(false);
  });

  it("reports a kline as closed when the exchange says so", () => {
    const parsed = candleFromKline({
      e: "kline",
      k: { t: 1000, o: "1", h: "1", l: "1", c: "1", x: true },
    });
    expect(parsed!.closed).toBe(true);
  });

  it("rejects a malformed kline instead of emitting NaN into the chart", () => {
    expect(candleFromKline({ e: "kline", k: { t: 1000, o: "1" } })).toBeNull();
    expect(candleFromKline({ e: "kline" })).toBeNull();
  });

  it("lower-cases stream names, which is what the wire expects", () => {
    expect(miniTickerStream("BTCUSDT")).toBe("btcusdt@miniTicker");
    expect(klineStream("ETHUSDT", "1s")).toBe("ethusdt@kline_1s");
  });
});

describe("createLiveFeed", () => {
  it("subscribes to every wanted stream once the socket is open", () => {
    const h = handlers();
    const feed = createLiveFeed(h);
    feed.setTickerSymbols(["BTCUSDT", "ETHUSDT"]);
    feed.setChart("SOLUSDT", "1s");

    // Nothing may be sent before the handshake completes.
    expect(last().sent).toEqual([]);
    last().open();

    expect(last().subscriptionParams().sort()).toEqual([
      "btcusdt@miniTicker",
      "ethusdt@miniTicker",
      "solusdt@kline_1s",
    ]);
    expect(h.onStatus).toHaveBeenLastCalledWith("live");
    feed.close();
  });

  it("re-subscribes over the open socket instead of reconnecting", () => {
    const feed = createLiveFeed(handlers());
    feed.setTickerSymbols(["BTCUSDT"]);
    last().open();
    const socket = last();

    feed.setTickerSymbols(["SOLUSDT"]);
    feed.setChart("ETHUSDT", "1m");

    // A symbol change must not drop the connection: one socket, one redial.
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.subscriptionParams()).toContain("solusdt@miniTicker");
    expect(socket.subscriptionParams()).toContain("ethusdt@kline_1m");
    expect(socket.unsubscriptionParams()).toEqual(["btcusdt@miniTicker"]);
    feed.close();
  });

  it("routes combined-stream payloads to their handlers", () => {
    const h = handlers();
    const feed = createLiveFeed(h);
    feed.setTickerSymbols(["BTCUSDT"]);
    feed.setChart("BTCUSDT", "1s");
    last().open();

    last().emit({
      stream: "btcusdt@miniTicker",
      data: { e: "24hrMiniTicker", s: "BTCUSDT", c: "100", o: "90" },
    });
    last().emit({
      stream: "btcusdt@kline_1s",
      data: { e: "kline", s: "BTCUSDT", k: { t: 5000, o: "1", h: "2", l: "1", c: "2" } },
    });

    expect(h.onTicker).toHaveBeenCalledTimes(1);
    expect(h.onTicker.mock.calls[0][0]).toBe("BTCUSDT");
    expect(h.onTicker.mock.calls[0][1].price).toBe(100);
    expect(h.onKline).toHaveBeenCalledTimes(1);
    expect(h.onKline.mock.calls[0][1].time).toBe(5);
    feed.close();
  });

  it("ignores malformed frames rather than throwing on the socket thread", () => {
    const h = handlers();
    const feed = createLiveFeed(h);
    feed.setTickerSymbols(["BTCUSDT"]);
    last().open();

    expect(() => last().onmessage?.({ data: "not json" })).not.toThrow();
    expect(() => last().emit({ stream: "x", data: { e: "unknown" } })).not.toThrow();
    expect(h.onTicker).not.toHaveBeenCalled();
    feed.close();
  });

  it("reports offline and redials after the socket drops", () => {
    vi.useFakeTimers();
    const h = handlers();
    const feed = createLiveFeed(h);
    feed.setTickerSymbols(["BTCUSDT"]);
    last().open();

    last().drop();
    expect(h.onStatus).toHaveBeenLastCalledWith("offline");
    expect(FakeSocket.instances).toHaveLength(1);

    // Backoff is deliberate, so the redial must not be immediate…
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);
    // …but it must happen.
    vi.advanceTimersByTime(2);
    expect(FakeSocket.instances).toHaveLength(2);
    // The replacement re-subscribes from scratch.
    last().open();
    expect(last().subscriptionParams()).toEqual(["btcusdt@miniTicker"]);
    feed.close();
  });

  it("stops redialing once closed", () => {
    vi.useFakeTimers();
    const feed = createLiveFeed(handlers());
    feed.setTickerSymbols(["BTCUSDT"]);
    last().open();
    last().drop();

    feed.close();
    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances).toHaveLength(1);
  });
});
