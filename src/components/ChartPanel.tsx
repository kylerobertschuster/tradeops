"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchKlines } from "@/lib/api";
import { createLiveFeed, type LiveFeed, type LiveStatus } from "@/lib/live";
import { POLL_MS, startVisiblePolling } from "@/lib/polling";
import { sma, ema, bollinger, rsi, macd, vwap } from "@/lib/indicators";
import { findSymbol } from "@/lib/symbols";
import { formatPrice, formatPct, formatCompact } from "@/lib/format";
import { VENUES, VENUE_MAP, type VenueId } from "@/lib/venues";
import { useVenues } from "@/lib/useVenues";
import VenueStrip from "./VenueStrip";
import type { Candle, Interval, Ticker } from "@/lib/types";

/**
 * Every series that belongs to the single-venue candle view, and is therefore
 * hidden while the venue overlay is on. Listed once so that adding an indicator
 * cannot accidentally forget to hide itself in compare mode and draw a line
 * from one venue's candles over a chart of all of them.
 */
const CANDLE_VIEW_KEYS = [
  "candles",
  "volume",
  "sma20",
  "sma50",
  "ema20",
  "ema50",
  "vwap",
  "bb_up",
  "bb_mid",
  "bb_low",
  "rsi",
  "macd_line",
  "macd_signal",
  "macd_hist",
] as const;

function setCandleViewVisible(
  series: Record<string, ISeriesApi<SeriesType>>,
  visible: boolean,
): void {
  for (const key of CANDLE_VIEW_KEYS) series[key]?.applyOptions({ visible });
}

/** Series key for a venue's overlay line. */
const venueKey = (id: VenueId) => `venue:${id}`;

type IndKey = "volume" | "sma20" | "sma50" | "ema20" | "ema50" | "bb" | "vwap" | "rsi" | "macd";

const IND_MENU: { group: string; items: { key: IndKey; label: string }[] }[] = [
  {
    group: "Overlays",
    items: [
      { key: "sma20", label: "SMA 20" },
      { key: "sma50", label: "SMA 50" },
      { key: "ema20", label: "EMA 20" },
      { key: "ema50", label: "EMA 50" },
      { key: "vwap", label: "VWAP" },
      { key: "bb", label: "Bollinger Bands (20, 2)" },
    ],
  },
  {
    group: "Oscillators",
    items: [
      { key: "rsi", label: "RSI 14" },
      { key: "macd", label: "MACD (12, 26, 9)" },
    ],
  },
  {
    group: "Volume",
    items: [{ key: "volume", label: "Volume" }],
  },
];

const INTERVAL_LABEL: Record<Interval, string> = {
  "1s": "1S",
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};

type Props = {
  symbol: string;
  interval: Interval;
  ticker?: Ticker;
};

export default function ChartPanel({ symbol, interval, ticker }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Record<string, ISeriesApi<SeriesType>>>({});
  const fitKeyRef = useRef<string>("");
  /** Last symbol/interval the compare overlay was fitted for. */
  const fitCompareRef = useRef<string>("");

  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveStatus>("connecting");
  const feedRef = useRef<LiveFeed | null>(null);
  /** The symbol the chart is actually showing; guards against late messages. */
  const activeSymbolRef = useRef(symbol);
  // Key of the last symbol/interval that finished loading. `loading` is derived
  // from it so we never have to setState synchronously inside the fetch effect.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const fetchKey = `${symbol}:${interval}`;
  const loading = loadedKey !== fetchKey;
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * Single-venue candles, or every venue's closes rebased to percentage.
   *
   * Off by default: the candle view is the one people arrive for, and an
   * overlay of six near-identical lines is a worse first impression than a
   * candlestick chart. The venue table below is always visible either way, so
   * the comparison is never more than one click away.
   */
  const [compare, setCompare] = useState(false);
  const [inds, setInds] = useState<Record<IndKey, boolean>>({
    volume: true,
    sma20: false,
    sma50: false,
    ema20: true,
    ema50: false,
    bb: false,
    vwap: false,
    rsi: false,
    macd: false,
  });

  const info = findSymbol(symbol);

  const { data: venues, loading: venuesLoading, error: venuesError } = useVenues(symbol, interval);
  /** Venues that actually returned candles for this symbol and interval. */
  const venueLines = (venues?.series ?? []).filter((s) => s.candles.length > 0);
  const venueSeries = venues?.series ?? [];
  const venueTickers = venues?.tickers ?? [];

  // Fetch candles (poll for live updates)
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await fetchKlines(symbol, interval);
        if (!alive) return;
        setCandles(data);
        setError(null);
      } catch {
        if (alive) setError("Unable to load market data. Please try again shortly.");
      } finally {
        if (alive) setLoadedKey(`${symbol}:${interval}`);
      }
    }
    const stopPolling = startVisiblePolling(load, POLL_MS.klines);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [symbol, interval]);

  /**
   * Live candles, streamed straight from the exchange.
   *
   * `update()` amends or appends the newest bar, so the visible range and any
   * pan or zoom the user has done survive. `setData()` — used for the history
   * load — replaces the series wholesale and would fight the user every second.
   *
   * Indicators still recompute on the REST refresh rather than on every tick:
   * they are derived from the whole series, and until the candle closes the
   * only thing a per-second recompute changes is the last point of each line.
   */
  useEffect(() => {
    const feed = createLiveFeed({
      onTicker: () => {},
      onKline: (sym, candle) => {
        // A message already in flight when the user switches symbols would
        // otherwise draw the previous asset's candle onto this chart.
        if (sym !== activeSymbolRef.current) return;
        const series = seriesRef.current["candles"];
        if (!series) return;
        const time = candle.time as UTCTimestamp;
        series.update({
          time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });
        const volume = seriesRef.current["volume"] as ISeriesApi<"Histogram"> | undefined;
        if (volume) {
          volume.update({
            time,
            value: candle.volume,
            color:
              candle.close >= candle.open ? "rgba(8,153,129,0.45)" : "rgba(242,54,69,0.45)",
          });
        }
      },
      onStatus: setLive,
    });
    feedRef.current = feed;
    return () => {
      feed.close();
      feedRef.current = null;
    };
  }, []);

  // Switching symbol or interval re-subscribes over the open socket.
  useEffect(() => {
    activeSymbolRef.current = symbol;
    feedRef.current?.setChart(symbol, interval);
  }, [symbol, interval]);

  // Create chart once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#787b86",
        fontSize: 11,
        fontFamily: "'Geist', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "#1e222d" },
        horzLines: { color: "#1e222d" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#363a45", labelBackgroundColor: "#2962ff" },
        horzLine: { color: "#363a45", labelBackgroundColor: "#2962ff" },
      },
      rightPriceScale: {
        borderColor: "#2a2e39",
        scaleMargins: { top: 0.05, bottom: 0.215 },
      },
      timeScale: { borderColor: "#2a2e39", timeVisible: true, secondsVisible: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#089981",
      downColor: "#f23645",
      borderVisible: false,
      wickUpColor: "#089981",
      wickDownColor: "#f23645",
    });

    chartRef.current = chart;
    seriesRef.current = { candles: candleSeries };

    const onResize = () => {
      const el = containerRef.current;
      if (!el) return;
      const width = el.clientWidth;
      const height = el.clientHeight;
      // A pane that is currently hidden (mobile tab switching) measures 0x0.
      // Applying that would tear the chart down to nothing, so hold the last
      // good size until the pane is laid out again — the observer fires once
      // more when it is shown.
      if (width <= 0 || height <= 0) return;
      chart.applyOptions({ width, height });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = {};
    };
  }, []);

  // Set candle data
  useEffect(() => {
    const series = seriesRef.current["candles"];
    if (!series || candles.length === 0) return;
    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    const key = `${symbol}:${interval}`;
    if (fitKeyRef.current !== key) {
      fitKeyRef.current = key;
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles, symbol, interval]);

  /**
   * The venue comparison overlay.
   *
   * Lines are drawn in **percentage** mode rather than at absolute prices, and
   * that is not a stylistic choice. BTC on Binance and BTC on Kraken can differ
   * by more than a 15-minute candle's entire range, so plotting raw closes
   * scales the axis to the gap *between* venues and flattens the price action
   * everyone came to see — and on a narrow window most of the lines fall off
   * the chart entirely. `PriceScaleMode.Percentage` rebases each series to its
   * own first visible value, so the lines coincide where the venues agree and
   * separate where they do not. The absolute prices stay in the table below,
   * where they are readable.
   *
   * The candle view is hidden rather than destroyed (`visible: false`), so
   * leaving compare mode restores every series without rebuilding it.
   */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const removeLine = (id: VenueId) => {
      const s = seriesRef.current[venueKey(id)];
      if (s) {
        chart.removeSeries(s);
        delete seriesRef.current[venueKey(id)];
      }
    };

    setCandleViewVisible(seriesRef.current, !compare);

    if (!compare) {
      for (const v of VENUES) removeLine(v.id);
      chart.priceScale("right").applyOptions({ mode: PriceScaleMode.Normal });
      fitCompareRef.current = "";
      return;
    }

    const ids = new Set(venueLines.map((s) => s.id));
    for (const v of VENUES) if (!ids.has(v.id)) removeLine(v.id);
    if (venueLines.length === 0) return;

    for (const s of venueLines) {
      let line = seriesRef.current[venueKey(s.id)] as ISeriesApi<"Line"> | undefined;
      if (!line) {
        line = chart.addSeries(LineSeries, {
          color: VENUE_MAP[s.id].color,
          lineWidth: 2,
          priceLineVisible: false,
          crosshairMarkerRadius: 3,
        }) as ISeriesApi<"Line">;
        seriesRef.current[venueKey(s.id)] = line;
      }
      line.setData(
        s.candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })),
      );
    }

    chart.priceScale("right").applyOptions({ mode: PriceScaleMode.Percentage });

    // Fit once per symbol/interval. In percentage mode the baseline is the
    // first *visible* value, so refitting on every poll would keep sliding the
    // zero point while the user is reading it.
    const key = `${symbol}:${interval}`;
    if (fitCompareRef.current !== key) {
      fitCompareRef.current = key;
      chart.timeScale().fitContent();
    }
  }, [compare, venueLines, symbol, interval]);

  /**
   * Volume and the oscillators own their own price scales, so they are
   * unaffected by the overlay's swap to percentage mode on the right scale.
   */
  function applyLayout() {
    const chart = chartRef.current;
    if (!chart) return;

    const TOP_MARGIN = 0.05;
    const GAP = 0.015;

    // Stacked from the bottom up: volume is the bottom strip, oscillators sit above it.
    type Pane = { key: "volume" | "rsi" | "macd"; height: number };
    const bottomPanes: Pane[] = [];
    if (inds.volume && seriesRef.current["volume"]) bottomPanes.push({ key: "volume", height: 0.2 });
    if (inds.macd && seriesRef.current["macd_hist"]) bottomPanes.push({ key: "macd", height: 0.12 });
    if (inds.rsi && seriesRef.current["rsi"]) bottomPanes.push({ key: "rsi", height: 0.12 });

    const spans: Record<string, { start: number; end: number }> = {};
    let cursor = 1;
    for (const pane of bottomPanes) {
      const end = cursor;
      const start = end - pane.height;
      spans[pane.key] = { start, end };
      cursor = start - GAP;
    }

    chart.priceScale("right").applyOptions({
      scaleMargins: { top: TOP_MARGIN, bottom: 1 - cursor },
    });

    for (const pane of bottomPanes) {
      const span = spans[pane.key];
      chart.priceScale(pane.key).applyOptions({
        scaleMargins: { top: span.start, bottom: 1 - span.end },
      });
    }
  }

  // Sync indicators + layout
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;

    const times = candles.map((c) => c.time as UTCTimestamp);
    const closes = candles.map((c) => c.close);
    type LinePoint = { time: UTCTimestamp; value: number };
    const lineData = (values: (number | null)[]): LinePoint[] =>
      values
        .map((v, i) => ({ time: times[i], value: v }))
        .filter((p): p is LinePoint => p.value != null);

    const remove = (key: string) => {
      const s = seriesRef.current[key];
      if (s) {
        chart.removeSeries(s);
        delete seriesRef.current[key];
      }
    };

    const ensureLine = (
      key: string,
      color: string,
      opts: { lineWidth?: 1 | 2 | 3 | 4; dashed?: boolean; scaleId?: string } = {},
    ) => {
      let s = seriesRef.current[key] as ISeriesApi<"Line"> | undefined;
      if (!s) {
        s = chart.addSeries(LineSeries, {
          color,
          lineWidth: opts.lineWidth ?? 2,
          lineStyle: opts.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          ...(opts.scaleId ? { priceScaleId: opts.scaleId } : {}),
        }) as ISeriesApi<"Line">;
        seriesRef.current[key] = s;
      }
      return s;
    };

    const setOverlay = (key: string, color: string, values: (number | null)[], dashed = false) => {
      if (!inds[key as IndKey]) {
        remove(key);
        return;
      }
      ensureLine(key, color, { dashed }).setData(lineData(values));
    };

    // --- Price-scale overlays ---
    setOverlay("sma20", "#2962ff", sma(closes, 20));
    setOverlay("sma50", "#ff9800", sma(closes, 50));
    setOverlay("ema20", "#26a69a", ema(closes, 20));
    setOverlay("ema50", "#ab47bc", ema(closes, 50));
    setOverlay("vwap", "#ec407a", vwap(candles));

    if (inds.bb) {
      const bb = bollinger(closes, 20, 2);
      ensureLine("bb_up", "#787b86", { lineWidth: 1, dashed: true }).setData(
        lineData(bb.map((b) => (b ? b.upper : null))),
      );
      ensureLine("bb_mid", "#787b86", { lineWidth: 1, dashed: true }).setData(
        lineData(bb.map((b) => (b ? b.middle : null))),
      );
      ensureLine("bb_low", "#787b86", { lineWidth: 1, dashed: true }).setData(
        lineData(bb.map((b) => (b ? b.lower : null))),
      );
    } else {
      remove("bb_up");
      remove("bb_mid");
      remove("bb_low");
    }

    // --- Volume (separate scale) ---
    if (inds.volume) {
      let v = seriesRef.current["volume"] as ISeriesApi<"Histogram"> | undefined;
      if (!v) {
        v = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
        }) as ISeriesApi<"Histogram">;
        seriesRef.current["volume"] = v;
      }
      v.setData(
        candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? "rgba(8,153,129,0.45)" : "rgba(242,54,69,0.45)",
        })),
      );
    } else {
      remove("volume");
    }

    // --- RSI (separate scale) ---
    if (inds.rsi) {
      let s = seriesRef.current["rsi"] as ISeriesApi<"Line"> | undefined;
      if (!s) {
        s = chart.addSeries(LineSeries, {
          color: "#7e57c2",
          lineWidth: 1 as 1 | 2 | 3 | 4,
          priceScaleId: "rsi",
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        }) as ISeriesApi<"Line">;
        s.createPriceLine({ price: 70, color: "#f23645", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
        s.createPriceLine({ price: 30, color: "#089981", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
        seriesRef.current["rsi"] = s;
      }
      s.setData(lineData(rsi(closes, 14)));
    } else {
      remove("rsi");
    }

    // --- MACD (separate scale) ---
    if (inds.macd) {
      const m = macd(closes);
      ensureLine("macd_line", "#2962ff", { scaleId: "macd" }).setData(lineData(m.macd));
      ensureLine("macd_signal", "#ff9800", { scaleId: "macd" }).setData(lineData(m.signal));
      let h = seriesRef.current["macd_hist"] as ISeriesApi<"Histogram"> | undefined;
      if (!h) {
        h = chart.addSeries(HistogramSeries, {
          priceScaleId: "macd",
          priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
        }) as ISeriesApi<"Histogram">;
        seriesRef.current["macd_hist"] = h;
      }
      h.setData(
        m.histogram
          .map((v, i) => ({
            time: times[i],
            value: v,
            color: v != null && v >= 0 ? "rgba(8,153,129,0.6)" : "rgba(242,54,69,0.6)",
          }))
          .filter((p) => p.value != null) as { time: UTCTimestamp; value: number; color: string }[],
      );
    } else {
      remove("macd_line");
      remove("macd_signal");
      remove("macd_hist");
    }

    applyLayout();
    // A freshly created indicator series is visible by default, so compare mode
    // has to re-assert itself after every indicator rebuild — the candle
    // refresh runs every 30s and would otherwise pop a 20-bar SMA over the
    // venue overlay. `compare` is a dependency for exactly this reason.
    setCandleViewVisible(seriesRef.current, !compare);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, inds, compare]);

  const last = candles[candles.length - 1];

  /**
   * High/Low prefer the 24h range but fall back to the latest candle — the
   * same basis Open and Close already use. The 24h range is sometimes absent
   * (CoinGecko's free tier omits it), so say which quantity is on screen rather
   * than letting one label mean two different things silently.
   */
  const has24hRange = ticker?.high24h != null && ticker?.low24h != null;
  const highValue = ticker?.high24h != null ? formatPrice(ticker.high24h) : last ? formatPrice(last.high) : "—";
  const lowValue = ticker?.low24h != null ? formatPrice(ticker.low24h) : last ? formatPrice(last.low) : "—";
  const rangeTitle = has24hRange ? "24h high / low" : "High / low of the latest candle (24h range unavailable)";
  const price = ticker?.price ?? last?.close;
  const change = ticker?.change24h ?? 0;
  const up = change >= 0;

  const toggleInd = (key: IndKey) => setInds((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header — the asset name and the "Indicators" label are dropped on
          narrow screens; the symbol, price and interval are the essentials. */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-tv-border px-3 sm:px-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-base font-bold tracking-tight text-tv-text sm:text-lg">
            {info.base}/USDT
          </span>
          <span className="hidden truncate text-[12px] text-tv-muted sm:inline">{info.name}</span>
          <span className="shrink-0 rounded bg-tv-panel2 px-1.5 py-0.5 text-[10px] font-medium text-tv-muted">
            {INTERVAL_LABEL[interval]}
          </span>
          <span
            className="flex shrink-0 items-center gap-1.5 self-center rounded bg-tv-panel2 px-1.5 py-0.5 text-[10px] font-medium text-tv-muted"
            title={
              live === "live"
                ? "Streaming live from the exchange"
                : live === "connecting"
                  ? "Connecting to the live stream\u2026"
                  : "Live stream unavailable \u2014 polling instead"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                live === "live"
                  ? "animate-pulse bg-tv-up"
                  : live === "connecting"
                    ? "bg-tv-muted"
                    : "bg-tv-down"
              }`}
            />
            <span className="hidden sm:inline">
              {live === "live" ? "LIVE" : live === "connecting" ? "\u2026" : "POLL"}
            </span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="text-right">
            <div className={`text-base font-semibold tabular-nums sm:text-xl ${up ? "text-tv-up" : "text-tv-down"}`}>
              {price ? formatPrice(price) : "—"}
            </div>
            <div className={`text-[11px] font-medium tabular-nums ${up ? "text-tv-up" : "text-tv-down"}`}>
              {ticker ? formatPct(change) : "—"}
            </div>
          </div>

          {/* Indicators menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-md border border-tv-border bg-tv-bg px-2.5 py-1.5 text-[12px] font-medium text-tv-text hover:border-tv-accent"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="text-tv-muted">
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">Indicators</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-60 rounded-md border border-tv-border bg-tv-panel2 py-1 shadow-xl">
                {IND_MENU.map((group) => (
                  <div key={group.group}>
                    <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-tv-muted">
                      {group.group}
                    </div>
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => toggleInd(item.key)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-tv-text hover:bg-tv-accent/15"
                      >
                        <span
                          className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${
                            inds[item.key] ? "border-tv-accent bg-tv-accent" : "border-tv-border bg-tv-bg"
                          }`}
                        >
                          {inds[item.key] && (
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                              <path d="M4 12l5 5L20 6" stroke="white" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                          )}
                        </span>
                        {item.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* OHLC stats. Hidden in compare mode: these describe the selected
          venue's latest candle, which is not on screen, and an unlabelled
          Open/High/Low/Close above an overlay of six venues reads as though it
          described all of them. The strip's per-venue columns replace it. */}
      {!compare && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-0.5 border-b border-tv-border px-4 py-1.5 text-[11px] tabular-nums">
          <Stat label="Open" value={last ? formatPrice(last.open) : "—"} />
          <Stat label="High" value={highValue} title={rangeTitle} />
          <Stat label="Low" value={lowValue} title={rangeTitle} />
          <Stat label="Close" value={last ? formatPrice(last.close) : "—"} />
          <Stat label="24h Vol" value={ticker?.quoteVolume ? formatCompact(ticker.quoteVolume) : "—"} />
        </div>
      )}

      {/* Chart */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {!compare && loading && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-tv-bg">
            <div className="flex items-center gap-2 text-[13px] text-tv-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-tv-border border-t-tv-accent" />
              Loading {info.base}/USDT…
            </div>
          </div>
        )}
        {!compare && error && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-tv-bg">
            <p className="max-w-xs text-center text-[13px] text-tv-down">{error}</p>
          </div>
        )}
        {compare && venueLines.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-tv-bg">
            <p className="max-w-xs text-center text-[13px] text-tv-muted">
              {venuesLoading
                ? `Loading every venue's ${info.base} history…`
                : `No venue returned ${INTERVAL_LABEL[interval]} candles for ${info.base}/USDT. The table below says why for each one.`}
            </p>
          </div>
        )}
        {compare && venueLines.length > 0 && (
          <div className="pointer-events-none absolute left-3 top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded bg-tv-bg/80 px-2 py-1 text-[10px] backdrop-blur-sm">
            <span className="font-medium uppercase tracking-wider text-tv-muted">
              % change · {venues?.bars ?? 0} bars
            </span>
            {venueLines.map((s) => (
              <span key={s.id} className="flex items-center gap-1 tabular-nums text-tv-text">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: VENUE_MAP[s.id].color }}
                />
                {VENUE_MAP[s.id].label}
              </span>
            ))}
          </div>
        )}
      </div>

      <VenueStrip
        series={venueSeries}
        tickers={venueTickers}
        symbol={symbol}
        interval={interval}
        compare={compare}
        onCompare={setCompare}
        loading={venuesLoading}
        error={venuesError}
      />
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span className="flex items-center gap-1" title={title}>
      <span className="text-tv-muted">{label}</span>
      <span className="font-medium text-tv-text">{value}</span>
    </span>
  );
}
