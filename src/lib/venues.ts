import type { Candle, Interval } from "./types";
import { fetchWithTimeout, UpstreamTimeoutError } from "./http";
import { toSeconds } from "./time";

/**
 * Multi-venue market data.
 *
 * This module is the deliberate opposite of `market.ts`. `market.ts` runs a
 * *failover chain*: it asks providers in turn and returns the first answer, so
 * the user sees one price with the disagreement between venues hidden. This
 * module *fans out*: every venue is asked in parallel and each one reports its
 * own numbers, including its own failure. Nothing is averaged, blended, or
 * picked as "the" price — because a mean of six order books is a number that
 * nobody could have traded at.
 *
 * Two consequences worth stating up front, because they shape every caller:
 *
 *  1. **Partial success is the normal case.** A geo-blocked, delisted, or
 *     slow venue must not fail the request. Every function here resolves to a
 *     result object carrying either data or a `fault`, and never throws for a
 *     per-venue problem.
 *  2. **Venues are not interchangeable.** They disagree about which symbols
 *     exist, which intervals exist, how much history they will return, and
 *     even which asset is being quoted (BTC/USD is not BTC/USDT). The
 *     capability tables below are consulted *before* a request is made, so an
 *     impossible interval is reported as unsupported rather than silently
 *     served as a different interval.
 */

export type VenueId = "binance" | "bybit" | "okx" | "coinbase" | "kraken" | "cryptocom";

export type VenueMeta = {
  id: VenueId;
  label: string;
  /** Compact form for the chart legend and narrow table columns. */
  short: string;
  /**
   * Chart line colour. Chosen for distinguishability against the dark chart
   * background and against each other — not for brand accuracy. Coinbase and
   * Crypto.com are both blue brands, so one of them had to move.
   */
  color: string;
  /**
   * The asset this venue's price actually denominates. Our catalog quotes
   * everything in USDT, but Coinbase and Kraken only publish USD pairs. Those
   * are different assets differing by a few basis points, which is the same
   * order of magnitude as the venue spread we are trying to display — so it is
   * carried into the UI instead of being rounded away.
   */
  quote: "USDT" | "USD";
  /**
   * Largest candle count the venue will return for one request. Used to clamp
   * the comparison window so every venue covers the *same* time range: an
   * overlay where one line covers 250 hours and another covers 75 hours is not
   * a comparison.
   */
  barCap: number;
  /**
   * True when the browser holds a direct websocket to this venue, so its row
   * can tick live while the others are polled. Only Binance today; see
   * `live.ts`.
   */
  streaming: boolean;
};

export const VENUES: readonly VenueMeta[] = [
  { id: "binance", label: "Binance", short: "BIN", color: "#f0b90b", quote: "USDT", barCap: 1000, streaming: true },
  { id: "coinbase", label: "Coinbase", short: "CB", color: "#3b6cff", quote: "USD", barCap: 350, streaming: false },
  { id: "kraken", label: "Kraken", short: "KRK", color: "#a06cff", quote: "USD", barCap: 720, streaming: false },
  { id: "okx", label: "OKX", short: "OKX", color: "#d8dee9", quote: "USDT", barCap: 300, streaming: false },
  { id: "cryptocom", label: "Crypto.com", short: "CDC", color: "#00c9a7", quote: "USDT", barCap: 300, streaming: false },
  { id: "bybit", label: "Bybit", short: "BYB", color: "#ff8a3d", quote: "USDT", barCap: 1000, streaming: false },
] as const;

export const VENUE_MAP: Record<VenueId, VenueMeta> = Object.fromEntries(
  VENUES.map((v) => [v.id, v]),
) as Record<VenueId, VenueMeta>;

/**
 * Why a venue has no data. Kept as a closed set so the UI can render a
 * specific, truthful reason instead of a generic "error" — "not listed here"
 * and "we could not reach this venue" are very different statements, and
 * `MKRUSDT` genuinely is not listed on some venues.
 */
export type VenueFault =
  /** The venue is not documented to serve this interval at all. */
  | "unsupported-interval"
  /** The venue answered, and the pair does not exist there. Not a failure. */
  | "unlisted"
  /**
   * The pair exists but is no longer tradable, so there is no current market
   * data for it. Distinct from `unlisted` because Coinbase still serves
   * historical candles for a delisted product — `MKR-USD` returns 300 candles
   * and simultaneously answers `/stats` with 400 "Not allowed for delisted
   * products". Calling that "not listed" next to a full set of candles would
   * look like a bug; "delisted" explains both facts at once.
   */
  | "delisted"
  /** Region-blocked (Bybit answers 403 from US egress). */
  | "blocked"
  | "rate-limited"
  | "timeout"
  /** Reached the venue and got an answer we cannot use. */
  | "unreachable"
  /** HTTP 200 with zero rows. */
  | "empty";

export type VenueSeries = {
  id: VenueId;
  /** The venue's own ticker string, so the UI can show what was requested. */
  sourceSymbol: string;
  candles: Candle[];
  fault: VenueFault | null;
};

export type VenueTicker = {
  id: VenueId;
  sourceSymbol: string;
  price: number | null;
  /**
   * Null has two meanings, disambiguated by `fault`: either the venue failed
   * (`fault` set), or the venue answered but does not publish this field
   * (`fault` null). Kraken's public ticker has no 24h open price, so it
   * genuinely cannot report a 24h change — it is not a bug to paper over with
   * today's open, which measures a different period.
   */
  change24h: number | null;
  high24h: number | null;
  low24h: number | null;
  /** Quote-currency volume where the venue publishes it, else a close estimate. */
  quoteVolume: number | null;
  fault: VenueFault | null;
};

export type VenuesResponse = {
  symbol: string;
  interval: Interval;
  /** Candle count actually requested from each venue (identical across venues). */
  bars: number;
  series: VenueSeries[];
  tickers: VenueTicker[];
};

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * Per-venue interval codes. `null` means the venue has no such interval, and a
 * request for it is refused locally rather than translated to the nearest thing
 * it does have — quietly answering a 1s chart with 1m candles is the kind of
 * bug that looks like working software.
 *
 * Verified live: Binance is the only venue here with sub-minute candles;
 * Crypto.com has no weekly timeframe (`40003 Invalid request`); Coinbase's
 * `granularity` whitelist is 60/300/900/3600/21600/86400 seconds, so it has
 * **no 4h** (it offers 6h instead) and no weekly — it answers
 * `400 Unsupported granularity` for both, which initially arrived here
 * mislabelled as a connection problem.
 */
const VENUE_IV: Record<VenueId, Record<Interval, string | null>> = {
  binance: { "1s": "1s", "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w" },
  bybit: { "1s": null, "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D", "1w": "W" },
  okx: { "1s": null, "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W" },
  // Coinbase's `granularity` is a number of seconds, not a code.
  coinbase: { "1s": null, "1m": "60", "5m": "300", "15m": "900", "1h": "3600", "4h": null, "1d": "86400", "1w": null },
  kraken: { "1s": null, "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "1440", "1w": "10080" },
  cryptocom: { "1s": null, "1m": "M1", "5m": "M5", "15m": "M15", "1h": "H1", "4h": "H4", "1d": "D1", "1w": null },
};

/** The venue's own code for `interval`, or null when it cannot serve it. */
export function venueIntervalCode(id: VenueId, interval: Interval): string | null {
  return VENUE_IV[id][interval];
}

/** Venues that can serve `interval`, in registry order. */
export function capableVenues(interval: Interval): VenueMeta[] {
  return VENUES.filter((v) => venueIntervalCode(v.id, interval) !== null);
}

/**
 * Candle count to request so that every capable venue covers the same window:
 * the requested count clamped to the *smallest* cap in play.
 *
 * Without this the overlay is misleading — Binance would draw 1000 bars while
 * Coinbase drew 300, and the two lines would appear to start at different
 * times even though both are correct.
 */
export function commonBarCount(interval: Interval, requested: number): number {
  const caps = capableVenues(interval).map((v) => v.barCap);
  if (caps.length === 0) return 0;
  return Math.max(50, Math.min(requested, ...caps));
}

/**
 * Our canonical symbol (`BTCUSDT`) in the venue's own notation.
 *
 * Returns null for any symbol not quoted in USDT: the whole catalog is, but a
 * silent mistranslation of a future `BTCUSDC` into `BTC-USD` would be a wrong
 * price rather than a missing one.
 */
export function venueSymbol(id: VenueId, symbol: string): string | null {
  if (!symbol.endsWith("USDT")) return null;
  const base = symbol.slice(0, -"USDT".length);
  if (base.length === 0) return null;
  switch (id) {
    case "binance":
    case "bybit":
      return `${base}USDT`;
    case "okx":
      return `${base}-USDT`;
    case "coinbase":
      return `${base}-USD`;
    case "kraken":
      return `${base}USD`;
    case "cryptocom":
      return `${base}_USDT`;
  }
}

// ---------------------------------------------------------------------------
// Upstream plumbing
// ---------------------------------------------------------------------------

const HOSTS: Record<VenueId, string> = {
  binance: "https://data-api.binance.vision",
  bybit: "https://api.bybit.com",
  okx: "https://www.okx.com",
  coinbase: "https://api.exchange.coinbase.com",
  kraken: "https://api.kraken.com",
  cryptocom: "https://api.crypto.com",
};

const SUCCESS_TTL_MS = 5_000;
/**
 * Faults are cached too, and for longer. A region-blocked venue (Bybit from US
 * egress) answers 403 every single time, and the strip would otherwise re-probe
 * it on every poll — burning a subrequest to relearn a fact that will not
 * change for the lifetime of the deployment.
 */
const FAULT_TTL_MS = 30_000;

type Cached = { t: number; status: number; body: unknown; fault: VenueFault | null };

const cache = new Map<string, Cached>();

/** Exported for tests: module-scope cache would otherwise leak between cases. */
export function clearVenueCache(): void {
  cache.clear();
}

function classifyStatus(status: number, body: unknown): VenueFault | null {
  if (status === 404) return "unlisted";
  if (status === 403 || status === 451) return "blocked";
  if (status === 429) return "rate-limited";
  if (status >= 400) {
    const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
    // Binance signals "no such symbol" as 400 `{"code":-1121}`; the whole
    // batch fails, so this is a property of the symbol, not of the venue.
    if (text.includes("-1121") || /invalid symbol/i.test(text)) return "unlisted";
    // Coinbase answers a pair that has been removed with 400 "Not allowed for
    // delisted products".
    if (/delisted|not allowed for/i.test(text)) return "delisted";
    // Coinbase answers an interval outside its whitelist with 400 "Unsupported
    // granularity". The capability table should have caught this before the
    // request was made, so reaching here means the table is wrong — and the
    // truth is still "this venue has no such interval", not "the venue is
    // down". Labeling it by the message keeps the table's mistakes from
    // masquerading as an outage.
    if (/unsupported granularity|invalid granularity|invalid interval/i.test(text)) return "unsupported-interval";
    return "unreachable";
  }
  return null;
}

/**
 * GET `url` as JSON, cached, with the outcome — success or fault — memoized.
 *
 * Never throws. A vendored fan-out cannot afford one venue's exception to
 * cancel the others, and the fault has to travel with the result so the UI can
 * name it.
 */
async function venueJson(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown; fault: VenueFault | null }> {
  const hit = cache.get(url);
  if (hit) {
    const ttl = hit.fault ? FAULT_TTL_MS : SUCCESS_TTL_MS;
    if (Date.now() - hit.t < ttl) {
      return { status: hit.status, body: hit.body, fault: hit.fault };
    }
  }

  let out: { status: number; body: unknown; fault: VenueFault | null };
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { accept: "application/json" }, cache: "no-store" },
      timeoutMs,
    );
    // Read as text first: error bodies are sometimes not JSON, and a parse
    // failure must not be reported as a network failure.
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep the raw text so `classifyStatus` can still inspect it */
    }
    out = { status: res.status, body, fault: classifyStatus(res.status, body) };
  } catch (e) {
    const fault: VenueFault = e instanceof UpstreamTimeoutError ? "timeout" : "unreachable";
    out = { status: 0, body: null, fault };
  }

  cache.set(url, { t: Date.now(), ...out });
  if (cache.size > 400) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------

/**
 * Venues whose candle rows arrive newest-first and must be reversed.
 *
 * Every one of these was checked against the live API rather than assumed,
 * because the assumption is invisible when it is wrong: a reversed series
 * still contains every correct price, so a table built from it looks fine and
 * only the chart breaks. Two of the six were the opposite of what was expected
 * — Binance and Crypto.com both answer oldest-first, and reversing them turned
 * a working fetch into an unplottable series.
 *
 * Bybit is listed as newest-first per its own documentation, but it is
 * unverifiable from here: Cloudflare answers 403 for US egress. It is the one
 * entry below that has never been confirmed against a live response.
 */
const NEWEST_FIRST: ReadonlySet<VenueId> = new Set<VenueId>(["coinbase", "okx", "bybit"]);

/**
 * Turn a venue's raw rows into `Candle[]`, or describe why we cannot.
 *
 * Rows are normalized to oldest-first, and note that the venues disagree about
 * column order — Coinbase is `[time, low, high, open, close, volume]`, not the
 * OHLC order everyone else uses. Reading it as OHLC puts Coinbase's high and
 * low in the wrong fields, which produces candles whose high is below their
 * low: wrong in a way that looks plausible in a table.
 */
function parseRows(
  id: VenueId,
  raw: unknown,
): { candles: Candle[]; fault: VenueFault | null } {
  const rows = Array.isArray(raw) ? raw : [];
  const candles: Candle[] = [];

  for (const row of rows) {
    let time: number, open: number, high: number, low: number, close: number, volume: number;

    if (id === "coinbase") {
      const r = row as number[];
      time = toSeconds(r[0]);
      [low, high, open, close, volume] = [r[1], r[2], r[3], r[4], r[5] ?? 0];
    } else if (id === "kraken") {
      const r = row as Array<number | string>;
      time = toSeconds(Number(r[0]));
      open = Number(r[1]);
      high = Number(r[2]);
      low = Number(r[3]);
      close = Number(r[4]);
      volume = Number(r[6] ?? 0);
    } else {
      // Binance / Bybit / OKX: [time, open, high, low, close, volume, ...].
      const r = row as Array<number | string>;
      time = toSeconds(Number(r[0]));
      open = Number(r[1]);
      high = Number(r[2]);
      low = Number(r[3]);
      close = Number(r[4]);
      volume = Number(r[5] ?? 0);
    }

    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    candles.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }

  if (candles.length === 0) return { candles, fault: "empty" };
  if (NEWEST_FIRST.has(id)) candles.reverse();
  return { candles, fault: null };
}

/** Kraken wraps candles in `result[somePairKey]`, and the key is not
 *  predictable from the request: asking for `BTCUSD` answers under `XXBTZUSD`.
 *  The pair key is whatever non-`last` property exists. */
function unwrap(id: VenueId, body: unknown): { raw: unknown; fault: VenueFault | null } {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return { raw: null, fault: "unreachable" };

  if (id === "kraken") {
    const errs = b.error as string[] | undefined;
    if (Array.isArray(errs) && errs.length > 0) {
      const joined = errs.join(" ");
      // Kraken reports a pair it does not have as HTTP 200 with an `error`
      // array. It uses two different strings for this — "EQuery:Unknown asset
      // pair" and "EQuery:Invalid asset pair" — so matching either exact
      // phrase is a trap; match the shared words. `MKRUSD` answers "Invalid",
      // which the first version of this missed and reported as an outage.
      const fault: VenueFault = /asset pair|unknown asset/i.test(joined) ? "unlisted" : "unreachable";
      return { raw: null, fault };
    }
    const result = b.result as Record<string, unknown> | undefined;
    const key = Object.keys(result ?? {}).find((k) => k !== "last");
    if (!key) return { raw: null, fault: "empty" };
    return { raw: (result as Record<string, unknown>)[key], fault: null };
  }

  if (id === "okx") {
    if (b.code !== "0") {
      const msg = String(b.msg ?? "");
      // OKX reports a missing instrument with code 51001.
      return { raw: null, fault: b.code === "51001" || /does not exist/i.test(msg) ? "unlisted" : "unreachable" };
    }
    return { raw: b.data, fault: null };
  }

  if (id === "bybit") {
    if (b.retCode !== 0) {
      const msg = String(b.retMsg ?? "");
      return { raw: null, fault: /not exist|invalid symbol/i.test(msg) ? "unlisted" : "unreachable" };
    }
    const result = b.result as Record<string, unknown> | undefined;
    return { raw: result?.list, fault: null };
  }

  if (id === "cryptocom") {
    const code = b.code;
    if (code !== 0 && code !== "0") {
      return { raw: null, fault: "unreachable" };
    }
    const result = b.result as Record<string, unknown> | undefined;
    return { raw: result?.data, fault: null };
  }

  // Binance: a bare array, or `{code, msg}` on error (already classified).
  if (Array.isArray(b)) return { raw: b, fault: null };
  const code = b.code;
  if (code !== undefined) {
    return { raw: null, fault: Number(code) === -1121 ? "unlisted" : "unreachable" };
  }
  return { raw: null, fault: "unreachable" };
}

/** Crypto.com candles arrive as objects, unlike every other venue's arrays. */
function cryptocomRows(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((r) => {
    const o = r as Record<string, unknown>;
    return [o.t, o.o, o.h, o.l, o.c, o.v];
  });
}

function candleUrl(id: VenueId, sourceSymbol: string, interval: Interval, bars: number): string {
  const code = venueIntervalCode(id, interval) ?? "";
  switch (id) {
    case "binance":
      return `${HOSTS.binance}/api/v3/klines?symbol=${sourceSymbol}&interval=${code}&limit=${bars}`;
    case "bybit":
      return `${HOSTS.bybit}/v5/market/kline?category=spot&symbol=${sourceSymbol}&interval=${code}&limit=${bars}`;
    case "okx":
      return `${HOSTS.okx}/api/v5/market/candles?instId=${sourceSymbol}&bar=${code}&limit=${bars}`;
    case "coinbase":
      // Coinbase takes no count parameter — it returns its cap for the granularity.
      return `${HOSTS.coinbase}/products/${sourceSymbol}/candles?granularity=${code}`;
    case "kraken":
      return `${HOSTS.kraken}/0/public/OHLC?pair=${sourceSymbol}&interval=${code}`;
    case "cryptocom":
      return `${HOSTS.cryptocom}/exchange/v1/public/get-candlestick?instrument_name=${sourceSymbol}&timeframe=${code}&count=${bars}`;
  }
}

/**
 * How specific a fault is about *why* there is no data.
 *
 * Two probes describe every venue — candles and a ticker — and they can
 * disagree. The usual cause is a venue that answers "no such pair" to one and
 * an empty list to the other: Crypto.com returns `200 {data: []}` for a pair it
 * does not list, which is indistinguishable from a pair that simply had no
 * trades, while its instrument list settles the question outright.
 *
 * So the less informative fault loses. "Empty response" would send the user
 * looking for a problem on our end when the answer is that the venue does not
 * carry the coin.
 */
const FAULT_SPECIFICITY: Record<VenueFault, number> = {
  unlisted: 6,
  delisted: 5,
  blocked: 4,
  "unsupported-interval": 3,
  "rate-limited": 2,
  timeout: 2,
  unreachable: 1,
  empty: 0,
};

/** The most informative fault from two probes, or null if neither failed. */
export function bestFault(a: VenueFault | null, b: VenueFault | null): VenueFault | null {
  if (!a) return b;
  if (!b) return a;
  return FAULT_SPECIFICITY[a] >= FAULT_SPECIFICITY[b] ? a : b;
}

/**
 * Keep only the most recent `bars` candles.
 *
 * Venues do not all honour the count they are given. Kraken takes no count
 * parameter at all and always answers with its full 720-bar history; Coinbase
 * has no count parameter either and returns ~350. Left alone, one line on the
 * overlay would span 7.5 days while the others spanned 3, and the comparison
 * would silently be between different periods — a difference that looks exactly
 * like the venues disagreeing about the price.
 */
function trimToLast(candles: Candle[], bars: number): Candle[] {
  return candles.length <= bars ? candles : candles.slice(candles.length - bars);
}

/**
 * One venue's candles. Always resolves; a fault is a result, not an exception.
 */
export async function fetchVenueCandles(
  id: VenueId,
  symbol: string,
  interval: Interval,
  bars: number,
  timeoutMs: number,
): Promise<VenueSeries> {
  const sourceSymbol = venueSymbol(id, symbol) ?? "";
  const unsupported = (): VenueSeries => ({ id, sourceSymbol, candles: [], fault: "unsupported-interval" });

  if (!sourceSymbol) return unsupported();
  if (venueIntervalCode(id, interval) === null) return unsupported();

  const res = await venueJson(candleUrl(id, sourceSymbol, interval, bars), timeoutMs);
  if (res.fault) return { id, sourceSymbol, candles: [], fault: res.fault };

  const unwrapped = unwrap(id, res.body);
  if (unwrapped.fault) return { id, sourceSymbol, candles: [], fault: unwrapped.fault };

  const parsed = parseRows(id, id === "cryptocom" ? cryptocomRows(unwrapped.raw) : unwrapped.raw);
  return { id, sourceSymbol, candles: trimToLast(parsed.candles, bars), fault: parsed.fault };
}

// ---------------------------------------------------------------------------
// 24h tickers
// ---------------------------------------------------------------------------

/** Parse an optional provider number. Mirrors `market.ts::num`: `+""` is 0,
 *  not NaN, so a missing field would otherwise become a real-looking $0.00. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function tickerUrl(id: VenueId, sourceSymbol: string): string {
  switch (id) {
    case "binance":
      return `${HOSTS.binance}/api/v3/ticker/24hr?symbol=${sourceSymbol}`;
    case "bybit":
      return `${HOSTS.bybit}/v5/market/tickers?category=spot&symbol=${sourceSymbol}`;
    case "okx":
      return `${HOSTS.okx}/api/v5/market/ticker?instId=${sourceSymbol}`;
    case "coinbase":
      return `${HOSTS.coinbase}/products/${sourceSymbol}/stats`;
    case "kraken":
      return `${HOSTS.kraken}/0/public/Ticker?pair=${sourceSymbol}`;
    case "cryptocom":
      // No single-instrument form exists (`get-ticker` is 404); the bulk
      // endpoint returns ~960 rows, so it is cached like any other success.
      return `${HOSTS.cryptocom}/exchange/v1/public/get-tickers`;
  }
}

/** Every field absent — the base every early return in this section spreads over. */
function blankTicker(id: VenueId, sourceSymbol: string): VenueTicker {
  return {
    id,
    sourceSymbol,
    price: null,
    change24h: null,
    high24h: null,
    low24h: null,
    quoteVolume: null,
    fault: null,
  };
}

/**
 * One venue's 24h stats, parsed from a response body already in hand.
 *
 * Split out of `fetchVenueTicker` because the market-data failover chain needs
 * these same rows: Crypto.com's *bulk* `get-tickers` returns all ~960
 * instruments in a single subrequest, and those rows carry the same
 * fraction-not-percent `c` change and `vv` quote volume as the
 * single-instrument path. Decoding them in two places is how the copies drift.
 *
 * Pure and synchronous, so it can be tested against captured response bodies
 * without a network stub — and so `market.ts` can reuse it without importing
 * the fetch/retry machinery around it.
 */
export function venueTickerFromBody(
  id: VenueId,
  body: unknown,
  sourceSymbol: string,
): VenueTicker {
  const blank = blankTicker(id, sourceSymbol);
  const b = (body ?? {}) as Record<string, unknown>;

  switch (id) {
    case "binance": {
      if (num(b.lastPrice) == null) return { ...blank, fault: "unlisted" };
      return {
        ...blank,
        price: num(b.lastPrice),
        change24h: num(b.priceChangePercent),
        high24h: num(b.highPrice),
        low24h: num(b.lowPrice),
        quoteVolume: num(b.quoteVolume),
      };
    }
    case "bybit": {
      const row = ((b.result as Record<string, unknown>)?.list as Array<Record<string, unknown>>)?.[0];
      if (!row || num(row.lastPrice) == null) return { ...blank, fault: "unlisted" };
      const pct = num(row.price24hPcnt);
      return {
        ...blank,
        price: num(row.lastPrice),
        // Bybit reports the 24h change as a fraction (0.0169 = 1.69%).
        change24h: pct == null ? null : pct * 100,
        high24h: num(row.highPrice24h),
        low24h: num(row.lowPrice24h),
        quoteVolume: num(row.turnover24h),
      };
    }
    case "okx": {
      const row = (b.data as Array<Record<string, unknown>>)?.[0];
      if (!row || num(row.last) == null) return { ...blank, fault: "unlisted" };
      const price = num(row.last);
      const open = num(row.open24h);
      return {
        ...blank,
        price,
        // OKX publishes no change field; derive it from the 24h open.
        change24h: price != null && open ? ((price - open) / open) * 100 : null,
        high24h: num(row.high24h),
        low24h: num(row.low24h),
        quoteVolume: num(row.volCcy24h),
      };
    }
    case "coinbase": {
      const last = num(b.last);
      if (last == null) return { ...blank, fault: "unlisted" };
      const open = num(b.open);
      return {
        ...blank,
        price: last,
        change24h: open ? ((last - open) / open) * 100 : null,
        high24h: num(b.high),
        low24h: num(b.low),
        // Coinbase reports base volume; multiply by price for a quote estimate.
        quoteVolume: (num(b.volume) ?? 0) * last,
      };
    }
    case "kraken": {
      // Same unpredictable pair key as the OHLC endpoint.
      const result = b.result as Record<string, Record<string, unknown[]>> | undefined;
      const key = Object.keys(result ?? {})[0];
      const row = key ? result?.[key] : undefined;
      if (!row) return { ...blank, fault: "unlisted" };
      const price = num((row.c as unknown[])?.[0]);
      if (price == null) return { ...blank, fault: "unlisted" };
      const vol24 = num((row.v as unknown[])?.[1]);
      const vwap24 = num((row.p as unknown[])?.[1]);
      return {
        ...blank,
        price,
        // Kraken's public ticker has no 24h open — only "today's" open, which
        // spans a different period. Left null rather than mislabelled.
        change24h: null,
        high24h: num((row.h as unknown[])?.[1]),
        low24h: num((row.l as unknown[])?.[1]),
        // 24h base volume x 24h VWAP is a better quote estimate than x last.
        quoteVolume: vol24 != null && vwap24 != null ? vol24 * vwap24 : null,
      };
    }
    case "cryptocom": {
      const data = (b.result as Record<string, unknown>)?.data as Array<Record<string, unknown>> | undefined;
      const row = data?.find((r) => r.i === sourceSymbol);
      if (!row) return { ...blank, fault: "unlisted" };
      const last = num(row.a);
      if (last == null) return { ...blank, fault: "unlisted" };
      return {
        ...blank,
        price: last,
        // Crypto.com returns the 24h change as a fraction.
        change24h: num(row.c) == null ? null : (num(row.c) as number) * 100,
        high24h: num(row.h),
        low24h: num(row.l),
        quoteVolume: num(row.vv),
      };
    }
  }
}

/**
 * One venue's 24h stats for one symbol.
 *
 * Deliberately one subrequest per venue rather than a bulk sweep: the strip
 * only ever shows the selected symbol, and a bulk OKX/Crypto.com response is
 * thousands of rows to parse for a single row of output.
 */
export async function fetchVenueTicker(
  id: VenueId,
  symbol: string,
  timeoutMs: number,
): Promise<VenueTicker> {
  const sourceSymbol = venueSymbol(id, symbol) ?? "";
  if (!sourceSymbol) return { ...blankTicker(id, ""), fault: "unlisted" };

  const res = await venueJson(tickerUrl(id, sourceSymbol), timeoutMs);
  if (res.fault) return { ...blankTicker(id, sourceSymbol), fault: res.fault };

  return venueTickerFromBody(id, res.body, sourceSymbol);
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

/**
 * Every venue's candles and 24h stats for one symbol, in parallel.
 *
 * Costs `2 x VENUES.length` upstream requests (12 today) behind a *single*
 * browser request, which is the point: the client-side request budget is what
 * the app's polling schedule was designed around, and it is unchanged.
 *
 * Failures are per-venue; this function only rejects if `signal` aborts.
 */
export async function fetchAllVenues(
  symbol: string,
  interval: Interval,
  requestedBars: number,
  signal?: AbortSignal,
): Promise<VenuesResponse> {
  const bars = commonBarCount(interval, requestedBars);
  const timeoutMs = 8_000;

  const [series, tickers] = await Promise.all([
    Promise.all(
      VENUES.map((v) => fetchVenueCandles(v.id, symbol, interval, bars, timeoutMs)),
    ),
    Promise.all(VENUES.map((v) => fetchVenueTicker(v.id, symbol, timeoutMs))),
  ]);

  // `signal` is accepted for symmetry with the rest of the data layer; the
  // underlying fetches carry their own deadline, and a per-venue timeout is
  // already reported as a fault rather than a rejection.
  void signal;

  return { symbol, interval, bars, series, tickers };
}

// ---------------------------------------------------------------------------
// Derived comparison values (pure — used by the UI, tested directly)
// ---------------------------------------------------------------------------

export type Spread = {
  median: number | null;
  min: number | null;
  max: number | null;
  /** (max - min) / median, in basis points. */
  spreadBps: number | null;
  /** How many prices went into the figure. */
  count: number;
};

/**
 * Median and max-min spread across the venues that reported a price.
 *
 * Median rather than mean because one venue on a stale price or a different
 * quote asset (BTC/USD vs BTC/USDT) should not drag the middle of the
 * distribution. Labelled "last-price spread" wherever it is shown: these are
 * candle closes and tickers, not executable quotes, so it is not an arbitrage
 * opportunity and must never be presented as one.
 */
export function spread(prices: Array<number | null | undefined>): Spread {
  const xs = prices.filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0);
  if (xs.length === 0) return { median: null, min: null, max: null, spreadBps: null, count: 0 };

  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  return {
    median,
    min,
    max,
    spreadBps: median > 0 ? ((max - min) / median) * 10_000 : null,
    count: xs.length,
  };
}

/**
 * Percent change of each venue's price against the median, in basis points.
 * This is the column that makes the table worth reading: it says how far each
 * venue sits from the middle of the pack, in units where "0" means agreement.
 */
export function deviationFromMedian(price: number | null, median: number | null): number | null {
  if (price == null || median == null || median <= 0) return null;
  return ((price - median) / median) * 10_000;
}
