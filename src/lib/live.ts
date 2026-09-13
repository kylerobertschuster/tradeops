import type { Candle, Interval, Ticker } from "./types";

/**
 * Binance's public market-data websocket.
 *
 * Streaming runs from the browser straight to the exchange, which has two
 * consequences worth stating plainly: updates arrive sub-second rather than on
 * a poll interval, and the traffic never reaches our Worker — so it costs
 * nothing against the 100,000 requests/day free tier. That second property is
 * what makes a 1-second chart affordable at all; polling at 1s would be 86,400
 * requests/day per open tab.
 *
 * `stream.binance.com` geo-blocks US clients (a 451 on the REST host and a
 * socket error here). The `.vision` mirror serves the same public streams and
 * does not. If it is ever unreachable, the feed reports `offline` and the app
 * falls back to REST polling, so a blocked socket degrades instead of breaking.
 */
export const LIVE_WS_BASE = "wss://data-stream.binance.vision";

/** The websocket closes if nothing arrives for a while; miniTicker ticks every second. */
const SILENCE_TIMEOUT_MS = 45_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export type LiveStatus = "connecting" | "live" | "offline";

/** Payload shapes, narrowed to the fields this app reads. */
type MiniTickerMsg = {
  e?: string;
  s?: string;
  c?: string;
  o?: string;
  h?: string;
  l?: string;
  q?: string;
};

type KlineMsg = {
  e?: string;
  s?: string;
  k?: {
    t?: number;
    o?: string;
    h?: string;
    l?: string;
    c?: string;
    v?: string;
    x?: boolean;
  };
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * `24hrMiniTicker` -> `Ticker`.
 *
 * These carry everything the watchlist needs — close, 24h open/high/low and
 * quote volume — so the whole board stays live off one socket. `change24h` is
 * derived from the 24h open because the stream does not send a percentage.
 */
export function tickerFromMiniTicker(m: MiniTickerMsg): Ticker | null {
  const symbol = m.s;
  const price = num(m.c);
  if (!symbol || price == null) return null;
  const open = num(m.o);
  return {
    symbol,
    base: symbol.replace(/USDT$/, ""),
    price,
    change24h: open ? ((price - open) / open) * 100 : 0,
    high24h: num(m.h),
    low24h: num(m.l),
    quoteVolume: num(m.q) ?? 0,
  };
}

/**
 * `kline` -> `Candle`.
 *
 * Binance reports kline times in milliseconds; `Candle.time` is unix seconds,
 * which is what the chart's time scale is built on.
 */
export function candleFromKline(m: KlineMsg): { candle: Candle; closed: boolean } | null {
  const k = m.k;
  if (!k) return null;
  const time = num(k.t);
  const open = num(k.o);
  const high = num(k.h);
  const low = num(k.l);
  const close = num(k.c);
  if (time == null || open == null || high == null || low == null || close == null) return null;
  return {
    candle: { time: Math.floor(time / 1000), open, high, low, close, volume: num(k.v) ?? 0 },
    closed: k.x === true,
  };
}

/** Stream name for a symbol's 24h mini ticker. Names are lower case on the wire. */
export function miniTickerStream(symbol: string): string {
  return `${symbol.toLowerCase()}@miniTicker`;
}

/** Stream name for one symbol's klines at `interval`. */
export function klineStream(symbol: string, interval: Interval): string {
  return `${symbol.toLowerCase()}@kline_${interval}`;
}

export type LiveFeedHandlers = {
  onTicker: (symbol: string, ticker: Ticker) => void;
  onKline: (symbol: string, candle: Candle, closed: boolean) => void;
  onStatus: (status: LiveStatus) => void;
};

export type LiveFeed = {
  /** Replace the set of symbols whose prices should stream. */
  setTickerSymbols: (symbols: string[]) => void;
  /** Set the one symbol whose candles should stream (the open chart). */
  setChart: (symbol: string, interval: Interval) => void;
  close: () => void;
};

type Envelope = { stream?: string; data?: unknown };

/**
 * Open one websocket that carries both the watchlist's prices and the chart's
 * candles, reconnecting on its own and reporting status so the caller can fall
 * back to polling.
 *
 * Streams are re-subscribed rather than reopening the socket, which is why the
 * wanted set is diffed here instead of being an effect dependency: changing
 * symbol or interval should not cost a reconnect.
 */
export function createLiveFeed(handlers: LiveFeedHandlers): LiveFeed {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let status: LiveStatus = "connecting";

  const tickerSymbols = new Set<string>();
  let chart: { symbol: string; interval: Interval } | null = null;
  /** Streams currently subscribed on the open socket. */
  const subscribed = new Set<string>();

  function wanted(): Set<string> {
    const out = new Set<string>();
    for (const s of tickerSymbols) out.add(miniTickerStream(s));
    if (chart) out.add(klineStream(chart.symbol, chart.interval));
    return out;
  }

  function setStatus(next: LiveStatus) {
    if (status === next) return;
    status = next;
    handlers.onStatus(next);
  }

  function send(method: "SUBSCRIBE" | "UNSUBSCRIBE", params: string[]): boolean {
    if (!ws || ws.readyState !== 1 || params.length === 0) return false;
    ws.send(JSON.stringify({ method, params, id: Date.now() }));
    return true;
  }

  /** Bring the socket's subscriptions in line with the wanted set. */
  function syncSubscriptions() {
    const want = wanted();
    const add = [...want].filter((s) => !subscribed.has(s));
    const remove = [...subscribed].filter((s) => !want.has(s));
    // Record the change only if it was actually sent. Before the handshake
    // completes there is no socket to send on, and marking streams as
    // subscribed then means `onopen` finds nothing left to do — the connection
    // opens, subscribes to nothing, and streams silence forever. That is a
    // silent failure with no error to notice, so the bookkeeping has to follow
    // the send rather than lead it.
    if (send("SUBSCRIBE", add)) for (const s of add) subscribed.add(s);
    if (send("UNSUBSCRIBE", remove)) for (const s of remove) subscribed.delete(s);
  }

  function armSilenceWatchdog() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      // A socket can stay open while the upstream goes quiet. Without this the
      // UI would sit on stale prices looking perfectly healthy.
      if (!closed) connect();
    }, SILENCE_TIMEOUT_MS);
  }

  function handleMessage(raw: string) {
    armSilenceWatchdog();
    let msg: Envelope | MiniTickerMsg | KlineMsg;
    try {
      msg = JSON.parse(raw) as Envelope | MiniTickerMsg | KlineMsg;
    } catch {
      return;
    }
    // Combined streams wrap the payload; a bare subscribe returns it directly.
    const data = (("data" in msg ? msg.data : msg) ?? {}) as MiniTickerMsg & KlineMsg;
    if (data.e === "24hrMiniTicker") {
      const t = tickerFromMiniTicker(data);
      if (t) handlers.onTicker(t.symbol, t);
    } else if (data.e === "kline") {
      const parsed = candleFromKline(data);
      if (parsed && data.s) handlers.onKline(data.s, parsed.candle, parsed.closed);
    }
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return;
    // Exponential backoff, so an outage does not turn into a reconnect storm.
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function teardown() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (ws) {
      // Detach first: closing triggers `onclose`, which would schedule a
      // reconnect for a socket we are deliberately replacing.
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        // Already closing; nothing to do.
      }
      ws = null;
    }
    subscribed.clear();
  }

  function connect() {
    if (closed) return;
    if (typeof WebSocket === "undefined") {
      setStatus("offline");
      return;
    }
    teardown();
    setStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${LIVE_WS_BASE}/stream`);
    } catch {
      setStatus("offline");
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      attempt = 0;
      setStatus("live");
      // The set was cleared by teardown, so this subscribes to everything.
      syncSubscriptions();
      armSilenceWatchdog();
    };
    socket.onmessage = (event) => handleMessage(String(event.data));
    socket.onerror = () => {
      // `onclose` always follows, which is where the reconnect is scheduled.
    };
    socket.onclose = () => {
      if (closed) return;
      setStatus("offline");
      scheduleReconnect();
    };
  }

  connect();

  return {
    setTickerSymbols(symbols) {
      tickerSymbols.clear();
      for (const s of symbols) tickerSymbols.add(s);
      syncSubscriptions();
    },
    setChart(symbol, interval) {
      chart = { symbol, interval };
      syncSubscriptions();
    },
    close() {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      teardown();
    },
  };
}
