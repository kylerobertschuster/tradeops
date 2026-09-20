import { CURATED, EXTENDED } from "./symbols";
import type { Candle, Interval } from "./types";

/**
 * The market overview: every market at once, on one chart.
 *
 * The multi-chart layouts answer "how is this market doing" several times over.
 * This answers a different question — which markets are moving together, and
 * which are not — and that question can only be answered on a single chart:
 * two charts have two price axes, and two price axes compare nothing. So each
 * series is rebased to percent change across the window, the same trick the
 * venue overlay uses. The vertical axis stops being price and becomes "how far
 * from where this window started".
 *
 * The rules live in this module rather than in the component for the reason the
 * polling cadences do: this file is pure, so a test can hold it, and a
 * component that needs a canvas cannot be tested at all.
 */

/** A window on the market: how far back, and at what resolution. */
export type OverviewWindow = {
  /** Button label. */
  label: string;
  /** Candle interval in this app's names — which are Binance's own codes. */
  interval: Interval;
  /** How many bars of that interval the window spans. */
  bars: number;
  /** The same window in words, for spacing the summary line. */
  span: string;
};

/**
 * Three windows, and no more.
 *
 * A market view is a glance, not a chart to study: a day to see what is moving
 * now, a week to see what is being accumulated, a month to see what survived.
 * `bars` is exactly what each request asks for — nothing is downsampled or
 * inferred, so a 1D window is 96 real fifteen-minute bars.
 */
export const OVERVIEW_WINDOWS: readonly OverviewWindow[] = [
  { label: "1D", interval: "15m", bars: 96, span: "24 hours" },
  { label: "1W", interval: "1h", bars: 168, span: "7 days" },
  { label: "1M", interval: "1d", bars: 30, span: "30 days" },
];

export const DEFAULT_WINDOW: OverviewWindow = OVERVIEW_WINDOWS[0];

/** What the view draws when nothing else is chosen: the sidebar's watchlist. */
export const OVERVIEW_SYMBOLS: readonly string[] = CURATED.map((s) => s.symbol);

/** Every market the app can chart, for the "all markets" switch. */
export const ALL_MARKETS: readonly string[] = [...CURATED, ...EXTENDED].map((s) => s.symbol);

/**
 * One colour per market, chosen to survive a one-pixel line on `#131722`.
 *
 * Hand-picked rather than generated from a hue formula, because the constraint
 * is perceptual: adjacent hues in a rotation are hard to tell apart at this
 * width, and these are not adjacent. None of them is the up or down green/red
 * (`#089981` / `#f23645`) — on this chart a colour means *which market*, never
 * *which direction*, and a line that happened to be the exact green of a rising
 * candle would say the wrong thing.
 *
 * Colour follows the market's position in the catalogue, not its rank, so a
 * line does not change colour when the ranking moves under it. With more
 * markets than entries the palette repeats; the legend is what identifies a
 * line, and it always has the swatch.
 */
const PALETTE = [
  "#f2b03d", // amber
  "#4d9dff", // blue
  "#c678dd", // violet
  "#2ec4b6", // teal
  "#ff8fab", // pink
  "#e8c547", // yellow
  "#8b9dff", // periwinkle
  "#f0874a", // orange
  "#8fd694", // sage
  "#b48ead", // mauve
  "#5bc0eb", // sky
  "#ff7b72", // coral
  "#c9a227", // brass
  "#9d8df1", // lavender
  "#66d9c8", // aqua
  "#e79fd5", // orchid
  "#a3b565", // olive
  "#7fa8f7", // steel
  "#d98cb3", // rose
  "#57c4e5", // cyan
  "#ef9f4b", // apricot
  "#a78bfa", // iris
  "#6ee7b7", // mint
  "#f0a3c0", // blush
];

/** The colour a market is drawn in, the same one every time it is asked. */
export function colorForSymbol(symbol: string): string {
  const known = ALL_MARKETS.indexOf(symbol);
  if (known >= 0) return PALETTE[known % PALETTE.length];
  // A market that is not in the catalogue — one opened from a search, or a
  // position someone typed in. Derived from the name so it is stable across
  // reloads without being stored anywhere.
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) hash = (hash * 31 + symbol.charCodeAt(i)) % 99_991;
  return PALETTE[hash % PALETTE.length];
}

export type Point = {
  /** Unix seconds. */
  time: number;
  /** Percent change from the window's first close. */
  value: number;
};

export type OverviewSeries = {
  symbol: string;
  /** Empty when the market had no usable history. */
  points: Point[];
  /** Last point's value, or null when there is nothing to compare. */
  change: number | null;
};

/**
 * Rebases a candle series to percent change from its first close.
 *
 * The first point is always exactly 0 by construction, because that is what
 * "change across this window" means. A base of zero or a non-finite close
 * returns nothing rather than an infinity: a venue that publishes a zero price
 * has a data problem, and a chart is not the place to hide it.
 */
export function normalizeToPercent(candles: readonly Candle[]): Point[] {
  const base = candles[0]?.close;
  if (base === undefined || !Number.isFinite(base) || base === 0) return [];
  return candles.map((candle) => ({
    time: candle.time,
    value: ((candle.close - base) / base) * 100,
  }));
}

/**
 * A whole series, with its change figure.
 *
 * The change needs two bars: one closing price is a price, not a move, and
 * reporting it as 0% would put a market that did not trade in the same bucket
 * as one that traded flat.
 */
export function toSeries(symbol: string, candles: readonly Candle[]): OverviewSeries {
  const points = normalizeToPercent(candles);
  return {
    symbol,
    points,
    change: points.length > 1 ? points[points.length - 1].value : null,
  };
}

/** Best first, and markets with nothing to compare sit at the end. */
export function rankByChange(series: readonly OverviewSeries[]): OverviewSeries[] {
  return [...series].sort((a, b) => {
    if (a.change === null && b.change === null) return a.symbol.localeCompare(b.symbol);
    if (a.change === null) return 1;
    if (b.change === null) return -1;
    return b.change - a.change;
  });
}

export type MarketStats = {
  /** Markets with a change figure, so the other counts sum to this. */
  counted: number;
  up: number;
  down: number;
  /** Unchanged *to the precision shown*, which is all a legend can claim. */
  flat: number;
  median: number | null;
  best: { symbol: string; change: number } | null;
  worst: { symbol: string; change: number } | null;
};

/**
 * The breadth of the market, which is the number a wall of lines cannot give.
 *
 * Flat means "rounds to 0.00%" rather than "exactly zero" — an exact zero is
 * vanishingly rare, and the partition has to be a partition for `up + down +
 * flat` to equal `counted`, which is what the summary line prints.
 */
export function marketStats(series: readonly OverviewSeries[]): MarketStats {
  const moved = series
    .filter((s): s is OverviewSeries & { change: number } => s.change !== null)
    .map((s) => ({ symbol: s.symbol, change: s.change }));
  const changes = moved.map((m) => m.change).sort((a, b) => a - b);
  const mid = changes.length / 2;

  return {
    counted: moved.length,
    up: changes.filter((c) => c >= 0.005).length,
    down: changes.filter((c) => c <= -0.005).length,
    flat: changes.filter((c) => c > -0.005 && c < 0.005).length,
    median:
      changes.length === 0
        ? null
        : changes.length % 2 === 1
          ? changes[Math.floor(mid)]
          : (changes[mid - 1] + changes[mid]) / 2,
    best: moved.length === 0 ? null : moved.reduce((a, b) => (b.change > a.change ? b : a)),
    worst: moved.length === 0 ? null : moved.reduce((a, b) => (b.change < a.change ? b : a)),
  };
}

/**
 * The venue's public market-data host, called by the browser and not by us.
 *
 * It is the same host the price stream comes from (see `SOURCES` in
 * `src/lib/legal.ts`, which is what makes this call discloseable rather than a
 * third-party request nobody was told about). `data-api.binance.vision` serves
 * market data without an API key and with `access-control-allow-origin: *`, and
 * unlike `api.binance.com` it is not geo-blocked — which is why it, and not the
 * main API, is the one the overview reads.
 */
export const BINANCE_DIRECT = "https://data-api.binance.vision";

/**
 * Binance's kline payload, as candles.
 *
 * The venue sends `[openTime, open, high, low, close, volume, ...]` with every
 * number as a string, and timestamps in milliseconds while the rest of this app
 * counts seconds. A row that cannot be read is dropped rather than coerced: a
 * `NaN` close would rebase the whole series to `NaN` and draw nothing, which
 * looks exactly like a market with no data — the two must not be confused.
 */
export function parseBinanceCandles(data: unknown): Candle[] {
  if (!Array.isArray(data)) return [];
  const candles: Candle[] = [];

  for (const row of data) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [openTime, open, high, low, close, volume] = row as unknown[];
    const candle: Candle = {
      time: Math.floor(Number(openTime) / 1000),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
    if (Object.values(candle).every((n) => Number.isFinite(n))) candles.push(candle);
  }

  return candles;
}
