"use client";

import { useEffect, useRef, useState } from "react";
import { fetchOverviewCandles } from "./api";
import { OVERVIEW_MS, startVisiblePolling } from "./polling";
import { toSeries, type OverviewSeries, type OverviewWindow } from "./overview";

export type OverviewState = {
  /** One entry per market that could be read, in no particular order. */
  series: OverviewSeries[];
  /** Markets with nothing to draw and no earlier answer to stand in. */
  missing: string[];
  /** Markets showing an earlier answer because this refresh missed them. */
  stale: string[];
  /** True until the first answer for the current window lands. */
  loading: boolean;
  /** When the last refresh finished, in Unix seconds — the view's own age. */
  at: number | null;
  /** Set when the first refresh produced nothing at all. */
  error: string | null;
};

/**
 * The market overview's data: every market's history, read directly.
 *
 * Nothing here goes through the Worker. Each market is its own upstream
 * request, and routing a fan-out that wide through our own route would spend
 * one subrequest per market on the tightest limit in the deployment — so the
 * browser asks the venue, and the Worker's request budget is untouched by
 * anything this hook does. What it costs instead is the visitor's bandwidth,
 * which is why the cadence is minutes rather than seconds.
 *
 * A market that fails is not dropped on the floor. If an earlier refresh had an
 * answer for it, that answer stays on the chart and the market is reported as
 * `stale`; only a market that has never answered is `missing`. The distinction
 * matters because the two look identical on a chart and mean opposite things:
 * one is "we last heard this on Tuesday", the other is "we have never heard
 * this at all".
 */
export function useOverview(
  symbols: readonly string[],
  window: OverviewWindow,
): OverviewState {
  const [series, setSeries] = useState<OverviewSeries[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [stale, setStale] = useState<string[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Last good series per market, and which window they were measured in. */
  const previous = useRef(new Map<string, OverviewSeries>());
  const windowRef = useRef(window.label);
  const keyRef = useRef("");

  const key = `${window.label}:${symbols.join(",")}`;
  const loading = loadedKey !== key;

  /**
   * A series measured in one window is not an answer for another: 24 hours of
   * fifteen-minute bars would draw a plausible-looking week. So the fallback
   * cache is emptied the moment the window changes, before the new fetch lands.
   */
  useEffect(() => {
    if (windowRef.current === window.label) return;
    windowRef.current = window.label;
    previous.current = new Map();
  }, [window.label]);

  useEffect(() => {
    keyRef.current = key;
    let alive = true;

    async function load() {
      const results = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const candles = await fetchOverviewCandles(symbol, window.interval, window.bars);
            return { symbol, candles };
          } catch {
            return { symbol, candles: null };
          }
        }),
      );
      // A late answer for a window or a symbol list that is no longer on screen
      // would overwrite the one that is.
      if (!alive || keyRef.current !== key) return;

      const next: OverviewSeries[] = [];
      const absent: string[] = [];
      const behind: string[] = [];

      for (const { symbol, candles } of results) {
        if (candles && candles.length > 1) {
          const fresh = toSeries(symbol, candles);
          next.push(fresh);
          previous.current.set(symbol, fresh);
          continue;
        }
        const older = previous.current.get(symbol);
        if (older) {
          next.push(older);
          behind.push(symbol);
        } else {
          absent.push(symbol);
        }
      }

      setSeries(next);
      setMissing(absent);
      setStale(behind);
      setError(next.length === 0 ? "No market history could be read." : null);
      setAt(Math.floor(Date.now() / 1000));
      setLoadedKey(key);
    }

    const stopPolling = startVisiblePolling(load, OVERVIEW_MS);
    return () => {
      // Both a refresh still in flight when this effect is replaced and the
      // polling itself: the first must not write state for a window that is no
      // longer on screen, and the second is a timer and a visibility listener
      // that would otherwise outlive the selection that started them.
      alive = false;
      stopPolling();
    };
  }, [key, symbols, window.interval, window.bars]);

  return { series, missing, stale, loading, at, error };
}
