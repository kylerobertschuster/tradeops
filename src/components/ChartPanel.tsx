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
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchKlines } from "@/lib/api";
import { sma, ema, bollinger } from "@/lib/indicators";
import { findSymbol } from "@/lib/symbols";
import { formatPrice, formatPct, formatCompact } from "@/lib/format";
import type { Candle, Interval, Ticker } from "@/lib/types";

type IndKey = "volume" | "sma20" | "sma50" | "ema20" | "ema50" | "bb";

const IND_LABELS: Record<IndKey, string> = {
  volume: "Volume",
  sma20: "SMA 20",
  sma50: "SMA 50",
  ema20: "EMA 20",
  ema50: "EMA 50",
  bb: "Bollinger Bands (20, 2)",
};

const OVERLAY_COLORS: Partial<Record<IndKey, string>> = {
  sma20: "#2962ff",
  sma50: "#ff9800",
  ema20: "#26a69a",
  ema50: "#ab47bc",
};

const INTERVAL_LABEL: Record<Interval, string> = {
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
  const seriesRef = useRef<Record<string, ISeriesApi<any>>>({});
  const fitKeyRef = useRef<string>("");

  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inds, setInds] = useState<Record<IndKey, boolean>>({
    volume: true,
    sma20: false,
    sma50: false,
    ema20: true,
    ema50: false,
    bb: false,
  });

  const info = findSymbol(symbol);

  // Fetch candles (poll for live updates)
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    async function load() {
      try {
        const data = await fetchKlines(symbol, interval);
        if (!alive) return;
        setCandles(data);
        setError(null);
      } catch {
        if (alive) setError("Unable to load market data. Please try again shortly.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    setLoading(true);
    load();
    timer = setInterval(load, 15000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
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
        scaleMargins: { top: 0.08, bottom: 0.22 },
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
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
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

  // Sync indicator series
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;

    const times = candles.map((c) => c.time as UTCTimestamp);

    const remove = (key: string) => {
      const s = seriesRef.current[key];
      if (s) {
        chart.removeSeries(s);
        delete seriesRef.current[key];
      }
    };

    const ensureLine = (key: string, color: string, lineWidth: 1 | 2 | 3 | 4 = 2, dashed = false) => {
      let s = seriesRef.current[key] as ISeriesApi<"Line"> | undefined;
      if (!s) {
        s = chart.addSeries(LineSeries, {
          color,
          lineWidth,
          lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        }) as ISeriesApi<"Line">;
        seriesRef.current[key] = s;
      }
      return s;
    };

    const setLineData = (key: string, color: string, values: (number | null)[], dashed = false) => {
      if (!inds[key as IndKey]) {
        remove(key);
        return;
      }
      const s = ensureLine(key, color, dashed ? 1 : 2, dashed);
      s.setData(
        values
          .map((v, i) => ({ time: times[i], value: v }))
          .filter((p) => p.value != null) as { time: UTCTimestamp; value: number }[],
      );
    };

    // Volume (separate scale)
    if (inds.volume) {
      let v = seriesRef.current["volume"] as ISeriesApi<"Histogram"> | undefined;
      if (!v) {
        v = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
        }) as ISeriesApi<"Histogram">;
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
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

    const closes = candles.map((c) => c.close);
    setLineData("sma20", OVERLAY_COLORS.sma20!, sma(closes, 20));
    setLineData("sma50", OVERLAY_COLORS.sma50!, sma(closes, 50));
    setLineData("ema20", OVERLAY_COLORS.ema20!, ema(closes, 20));
    setLineData("ema50", OVERLAY_COLORS.ema50!, ema(closes, 50));

    if (inds.bb) {
      const bb = bollinger(closes, 20, 2);
      setLineData("bb_up", "#787b86", bb.map((b) => (b ? b.upper : null)), true);
      setLineData("bb_mid", "#787b86", bb.map((b) => (b ? b.middle : null)), true);
      setLineData("bb_low", "#787b86", bb.map((b) => (b ? b.lower : null)), true);
    } else {
      remove("bb_up");
      remove("bb_mid");
      remove("bb_low");
    }
  }, [candles, inds]);

  const last = candles[candles.length - 1];
  const price = ticker?.price ?? last?.close;
  const change = ticker?.change24h ?? 0;
  const up = change >= 0;

  const toggleInd = (key: IndKey) => setInds((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-tv-border px-4">
        <div className="flex items-baseline gap-2.5">
          <span className="text-lg font-bold tracking-tight text-tv-text">{info.base}/USDT</span>
          <span className="text-[12px] text-tv-muted">{info.name}</span>
          <span className="rounded bg-tv-panel2 px-1.5 py-0.5 text-[10px] font-medium text-tv-muted">
            {INTERVAL_LABEL[interval]}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={`text-xl font-semibold tabular-nums ${up ? "text-tv-up" : "text-tv-down"}`}>
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
              Indicators
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-tv-border bg-tv-panel2 py-1 shadow-xl">
                {Object.keys(IND_LABELS).map((key) => {
                  const k = key as IndKey;
                  return (
                    <button
                      key={k}
                      onClick={() => toggleInd(k)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-tv-text hover:bg-tv-accent/15"
                    >
                      <span
                        className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${
                          inds[k] ? "border-tv-accent bg-tv-accent" : "border-tv-border bg-tv-bg"
                        }`}
                      >
                        {inds[k] && (
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                            <path d="M4 12l5 5L20 6" stroke="white" strokeWidth="3" strokeLinecap="round" />
                          </svg>
                        )}
                      </span>
                      {IND_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* OHLC stats */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-0.5 border-b border-tv-border px-4 py-1.5 text-[11px] tabular-nums">
        <Stat label="Open" value={last ? formatPrice(last.open) : "—"} />
        <Stat label="High" value={ticker?.high24h ? formatPrice(ticker.high24h) : last ? formatPrice(last.high) : "—"} />
        <Stat label="Low" value={ticker?.low24h ? formatPrice(ticker.low24h) : last ? formatPrice(last.low) : "—"} />
        <Stat label="Close" value={last ? formatPrice(last.close) : "—"} />
        <Stat label="24h Vol" value={ticker?.quoteVolume ? formatCompact(ticker.quoteVolume) : "—"} />
      </div>

      {/* Chart */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {loading && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-tv-bg">
            <div className="flex items-center gap-2 text-[13px] text-tv-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-tv-border border-t-tv-accent" />
              Loading {info.base}/USDT…
            </div>
          </div>
        )}
        {error && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-tv-bg">
            <p className="max-w-xs text-center text-[13px] text-tv-down">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-tv-muted">{label}</span>
      <span className="font-medium text-tv-text">{value}</span>
    </span>
  );
}
