"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { formatPct, formatTime } from "@/lib/format";
import {
  ALL_MARKETS,
  DEFAULT_WINDOW,
  OVERVIEW_SYMBOLS,
  OVERVIEW_WINDOWS,
  colorForSymbol,
  marketStats,
  rankByChange,
  type OverviewWindow,
} from "@/lib/overview";
import { findSymbol } from "@/lib/symbols";
import { useOverview } from "@/lib/useOverview";

type Props = {
  /** Open one market in the chart view, with its own axes and indicators. */
  onOpen: (symbol: string) => void;
};

/** The palette's line width. One pixel, because twenty-four of them share a scale. */
const LINE_WIDTH = 1;
/** Widest a heat bar can get, in pixels. Half the strip is zero. */
const BAR_PX = 52;

export default function MarketOverview({ onOpen }: Props) {
  const [window, setWindow] = useState<OverviewWindow>(DEFAULT_WINDOW);
  const [everything, setEverything] = useState(false);
  /** Markets switched off in the legend. Empty means all of them are drawn. */
  const [hidden, setHidden] = useState<readonly string[]>([]);

  const universe = everything ? ALL_MARKETS : OVERVIEW_SYMBOLS;
  /**
   * The fetch covers the whole universe, not the drawn subset.
   *
   * Hiding a line is a decision about the picture, not about the data, and it
   * must not cost twenty-four requests to un-hide. So the request key is the
   * universe and the window, and the legend filters what is already here.
   */
  const { series, missing, stale, loading, at, error } = useOverview(universe, window);

  const ranked = useMemo(() => rankByChange(series), [series]);
  const drawn = useMemo(
    () => ranked.filter((s) => !hidden.includes(s.symbol)),
    [ranked, hidden],
  );
  const stats = useMemo(() => marketStats(drawn), [drawn]);
  /** Shared by every heat bar, so equal lengths mean equal moves. */
  const biggestMove = useMemo(
    () => Math.max(1, ...drawn.map((s) => Math.abs(s.change ?? 0))),
    [drawn],
  );

  const holder = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const linesRef = useRef(new Map<string, ISeriesApi<"Line">>());
  /** The dashed zero line, which is a series so that it shares the scale. */
  const baselineRef = useRef<ISeriesApi<"Line"> | null>(null);
  /** What the last fit was for, so a poll cannot move the view under a reader. */
  const fitRef = useRef("");

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#787b86",
        fontSize: 11,
        fontFamily: "'Geist', system-ui, sans-serif",
        /**
         * Off for the same reason it is off on the charts: the licence's link
         * requirement is met by `CHART_LIBRARY` on /legal/sources, one click
         * from here. Removing the mark without that notice would be removing
         * the attribution.
         */
        attributionLogo: false,
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
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: { borderColor: "#2a2e39", timeVisible: true, secondsVisible: false },
      /**
       * Normal mode with a `%` suffix, not `PriceScaleMode.Percentage`.
       *
       * Percentage mode rebases whatever it is given by the price scale's first
       * visible value ("The first visible value is 0% in this mode"). Our lines
       * have already been rebased — every one of them starts at exactly zero —
       * so handing that to the library would divide by zero and draw a scale of
       * infinities. The percentage is ours, computed in `normalizeToPercent`;
       * the library only needs to print it.
       */
      localization: {
        priceFormatter: (price: number) => `${price > 0 ? "+" : ""}${price.toFixed(2)}%`,
      },
    });

    const baseline = chart.addSeries(LineSeries, {
      color: "#4a4f5c",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: true,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    baselineRef.current = baseline;
    chartRef.current = chart;
    // Read once, for the cleanup below: the lint rule is right that a ref can
    // point somewhere else by the time a cleanup runs, and React's development
    // double-mount is exactly when it would — a second chart instance must not
    // be handed the first one's series.
    const lines = linesRef.current;

    return () => {
      chart.remove();
      chartRef.current = null;
      baselineRef.current = null;
      lines.clear();
      fitRef.current = "";
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Series for markets that are no longer drawn come out first, so the chart
    // never accumulates invisible lines left over from a previous selection.
    const wanted = new Set(drawn.map((s) => s.symbol));
    for (const [symbol, line] of linesRef.current) {
      if (wanted.has(symbol)) continue;
      chart.removeSeries(line);
      linesRef.current.delete(symbol);
    }

    for (const s of drawn) {
      let line = linesRef.current.get(s.symbol);
      if (!line) {
        line = chart.addSeries(LineSeries, {
          color: colorForSymbol(s.symbol),
          lineWidth: LINE_WIDTH,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        linesRef.current.set(s.symbol, line);
      }
      line.setData(s.points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    }

    const first = drawn[0]?.points[0];
    const last = drawn[0]?.points[drawn[0].points.length - 1];
    baselineRef.current?.setData(
      first && last
        ? [
            { time: first.time as UTCTimestamp, value: 0 },
            { time: last.time as UTCTimestamp, value: 0 },
          ]
        : [],
    );

    /**
     * Fit when the picture changes — a different window, or different markets —
     * and not when it refreshes.
     *
     * A poll returns the same bars with a new one appended, so refitting every
     * few minutes would slide the whole chart under someone who was reading it.
     */
    const shape = `${window.label}|${drawn.map((s) => s.symbol).join(",")}`;
    if (fitRef.current !== shape) {
      fitRef.current = shape;
      chart.timeScale().fitContent();
    }
  }, [drawn, window.label]);

  const toggle = (symbol: string) =>
    setHidden((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    );

  const name = (symbol: string) => findSymbol(symbol).base;
  const allHidden = drawn.length === 0 && series.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Which window, which universe, and what the whole picture says. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-tv-border px-3 py-1.5 text-[11px] text-tv-muted">
        <nav className="flex items-center gap-0.5 rounded border border-tv-border p-0.5" aria-label="Market window">
          {OVERVIEW_WINDOWS.map((w) => (
            <button
              key={w.label}
              onClick={() => setWindow(w)}
              aria-pressed={window.label === w.label}
              title={`The last ${w.span}, ${w.bars} bars of ${w.interval}`}
              className={`rounded px-2 py-0.5 tabular-nums transition-colors ${
                window.label === w.label
                  ? "bg-tv-accent text-white"
                  : "text-tv-muted hover:bg-tv-panel2 hover:text-tv-text"
              }`}
            >
              {w.label}
            </button>
          ))}
        </nav>

        <nav className="flex items-center gap-0.5 rounded border border-tv-border p-0.5" aria-label="Markets shown">
          {[
            { label: "Watchlist", value: false, count: OVERVIEW_SYMBOLS.length },
            { label: "All markets", value: true, count: ALL_MARKETS.length },
          ].map((option) => (
            <button
              key={option.label}
              onClick={() => setEverything(option.value)}
              aria-pressed={everything === option.value}
              className={`rounded px-2 py-0.5 transition-colors ${
                everything === option.value
                  ? "bg-tv-accent text-white"
                  : "text-tv-muted hover:bg-tv-panel2 hover:text-tv-text"
              }`}
            >
              {option.label} <span className="tabular-nums opacity-70">{option.count}</span>
            </button>
          ))}
        </nav>

        {stats.counted > 0 && (
          <span className="truncate">
            <span className="text-tv-up">{stats.up} up</span>
            {" · "}
            <span className="text-tv-down">{stats.down} down</span>
            {stats.flat > 0 && ` · ${stats.flat} flat`}
            {" · median "}
            <span className="tabular-nums text-tv-text">{formatPct(stats.median)}</span>
            {stats.best && (
              <>
                {" · best "}
                <span className="text-tv-text">
                  {name(stats.best.symbol)} {formatPct(stats.best.change)}
                </span>
              </>
            )}
            {stats.worst && (
              <>
                {" · worst "}
                <span className="text-tv-text">
                  {name(stats.worst.symbol)} {formatPct(stats.worst.change)}
                </span>
              </>
            )}
          </span>
        )}

        <span className="ml-auto shrink-0 tabular-nums">
          {/* `formatTime` reads milliseconds; `at` is Unix seconds, like every
              other timestamp in this app. */}
          {at === null ? "reading…" : `updated ${formatTime(at * 1000)}`}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Always mounted: the chart is created once, against this element. */}
        <div className="relative h-[55vh] min-h-0 lg:h-auto lg:flex-1">
          <div ref={holder} className="absolute inset-0" />
          {(loading || error || allHidden) && (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-[12px]">
              {error ? (
                <p className="text-tv-down">
                  {error} The data host refused every request — this view reads the venue directly
                  from your browser, so a network that blocks it shows nothing here. The charts
                  still work: they go through this deployment&apos;s own route.
                </p>
              ) : allHidden ? (
                <p className="text-tv-muted">Every market is switched off. Tap a swatch to bring one back.</p>
              ) : (
                <p className="text-tv-muted">
                  Reading {universe.length} markets over {window.span}…
                </p>
              )}
            </div>
          )}
        </div>

        {/*
         * The legend is also the heat strip: each row carries the identity
         * swatch (so a line can be found), a bar whose side and length is the
         * move, and the number itself. The bars share one scale, so a bar twice
         * as long is twice the move — and a reader who cannot separate the
         * colours still gets every figure.
         */}
        <div className="min-h-0 shrink-0 overflow-y-auto border-t border-tv-border lg:w-72 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide text-tv-muted">
            <span>Best first</span>
            <span className="tabular-nums normal-case">{drawn.length} of {ranked.length} drawn</span>
          </div>
          {ranked.map((s) => {
            const off = hidden.includes(s.symbol);
            const behind = stale.includes(s.symbol);
            const color = colorForSymbol(s.symbol);
            const change = s.change ?? 0;
            const width = Math.min(50, (Math.abs(change) / biggestMove) * 50);
            return (
              <div
                key={s.symbol}
                className={`flex items-center gap-2 px-2 py-1 ${off ? "opacity-45" : ""} hover:bg-tv-panel2/60`}
              >
                <button
                  onClick={() => toggle(s.symbol)}
                  aria-pressed={!off}
                  aria-label={`${off ? "Draw" : "Hide"} ${s.symbol}`}
                  title={off ? `Draw ${s.symbol}` : `Hide ${s.symbol}`}
                  className="h-2.5 w-2.5 shrink-0 rounded-sm border"
                  style={{ background: off ? "transparent" : color, borderColor: color }}
                />
                <button
                  onClick={() => onOpen(s.symbol)}
                  title={`Open ${s.symbol} in the charts`}
                  className="min-w-0 flex-1 truncate text-left text-[11px] text-tv-text hover:text-tv-accent"
                >
                  {name(s.symbol)}
                  <span className="ml-1 text-[10px] text-tv-muted">{findSymbol(s.symbol).name}</span>
                </button>
                <span
                  className="relative flex h-1.5 shrink-0 items-center rounded-sm bg-tv-panel2"
                  style={{ width: BAR_PX }}
                  aria-hidden="true"
                >
                  <span className="absolute left-1/2 top-0 h-full w-px bg-tv-border" />
                  <span
                    className={`absolute h-full rounded-sm ${change >= 0 ? "bg-tv-up/70" : "bg-tv-down/70"}`}
                    style={
                      change >= 0
                        ? { left: "50%", width: `${width}%` }
                        : { right: "50%", width: `${width}%` }
                    }
                  />
                </span>
                <span
                  className={`w-14 shrink-0 text-right text-[11px] tabular-nums ${
                    off
                      ? "text-tv-muted"
                      : behind
                        ? "text-tv-muted"
                        : change >= 0
                          ? "text-tv-up"
                          : "text-tv-down"
                  }`}
                  title={behind ? "The last refresh missed this market — showing the previous one." : undefined}
                >
                  {s.change === null ? "—" : formatPct(s.change)}
                  {behind && "*"}
                </span>
              </div>
            );
          })}
          {ranked.length === 0 && !loading && (
            <p className="px-2 py-3 text-[11px] text-tv-muted">Nothing to rank yet.</p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-tv-border px-3 py-1 text-[10px] leading-tight text-tv-muted">
        <p>
          Every line is rebased to zero at the start of the window, so the chart compares markets
          rather than prices. Candles are read by your browser directly from{" "}
          <span className="text-tv-text">data-api.binance.vision</span> — no request of this
          deployment is spent on this view, and no price is smoothed or averaged.
          {" · "}
          Click a name to open it in the charts; click a swatch to hide its line.
        </p>
        {(missing.length > 0 || stale.length > 0) && (
          <p className="mt-0.5">
            {missing.length > 0 && (
              <>
                No history for {missing.map(name).join(", ")}, so they are not drawn or counted.{" "}
              </>
            )}
            {stale.length > 0 && (
              <>
                * {stale.map(name).join(", ")} came back empty on the last read, so the previous
                answer is still on screen.
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
