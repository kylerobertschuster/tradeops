"use client";

import { useEffect, useRef, useState } from "react";
import { fetchVenues } from "./api";
import { POLL_MS, startVisiblePolling } from "./polling";
import type { Interval } from "./types";
import type { VenuesResponse } from "./venues";

export type VenueState = {
  data: VenuesResponse | null;
  /** True only while there is no data for the current symbol yet. */
  loading: boolean;
  /** True when the whole fan-out failed; per-venue faults travel in `data`. */
  error: string | null;
};

/**
 * Polls `/api/venues` for one chart's symbol.
 *
 * The strip is on screen whenever the chart is, so in a single-chart layout
 * this always polls — at `POLL_MS.venues` (60s), the slowest cadence in the app.
 * That is a deliberate budget decision: this route is the most expensive thing
 * here, one inbound request fanning out to 12 upstream ones, and the primary
 * venue already ticks over the websocket at no Worker cost. See the note on
 * `POLL_MS.venues`.
 *
 * `enabled` exists for multi-chart layouts. This is the one endpoint whose cost
 * is not per-chart, so it belongs to the focused chart: a four-chart tab that
 * polled it four times would quadruple the most expensive request in the app to
 * show the same table in four places. Disabling it releases the loop and keeps
 * whatever was already loaded, so a chart that loses focus does not blank its
 * table.
 *
 * Same visibility-gated schedule as every other fetch here
 * (`startVisiblePolling`): a background tab stops asking.
 */
export function useVenues(symbol: string, interval: Interval, enabled = true): VenueState {
  const [data, setData] = useState<VenuesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Key of the last symbol/interval that finished loading.
   *
   * `loading` is derived from it rather than set by hand, for two reasons: a
   * chart that is disabled is never "loading", and a chart that is re-enabled
   * with data already loaded refreshes in place instead of flashing a spinner
   * over a table it still has.
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  /** Guards against a slow response for a previous symbol landing last. */
  const keyRef = useRef("");

  const key = `${symbol}:${interval}`;
  const loading = enabled && loadedKey !== key;

  useEffect(() => {
    if (!enabled) return;
    keyRef.current = key;
    let alive = true;

    async function load() {
      try {
        const next = await fetchVenues(symbol, interval);
        if (!alive || keyRef.current !== key) return;
        setData(next);
        setError(null);
      } catch {
        // The venues themselves did not all fail — per-venue faults travel in
        // the payload. Reaching here means the Worker route never answered, so
        // the last good table stays on screen: stale and labelled beats blank.
        if (alive && keyRef.current === key) setError("Could not reach the venue comparison service.");
      } finally {
        if (alive && keyRef.current === key) setLoadedKey(key);
      }
    }

    const stop = startVisiblePolling(load, POLL_MS.venues);
    return () => {
      alive = false;
      stop();
    };
  }, [key, symbol, interval, enabled]);

  return { data, loading, error };
}
