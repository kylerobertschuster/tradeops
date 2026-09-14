"use client";

import { useEffect, useRef, useState } from "react";
import { fetchVenues } from "./api";
import { POLL_MS, startVisiblePolling } from "./polling";
import type { Interval } from "./types";
import type { VenuesResponse } from "./venues";

export type VenueState = {
  data: VenuesResponse | null;
  /** True only for the very first load, so the strip can say "loading" once. */
  loading: boolean;
  /** True when the whole fan-out failed; per-venue faults travel in `data`. */
  error: string | null;
};

/**
 * Polls `/api/venues` for the selected symbol.
 *
 * The strip is always on screen, so this always polls — at `POLL_MS.venues`
 * (60s), the slowest cadence in the app. That is a deliberate budget decision:
 * this route is the most expensive thing here, one inbound request fanning out
 * to 12 upstream ones, and the primary venue already ticks over the websocket
 * at no Worker cost. See the note on `POLL_MS.venues`.
 *
 * Same visibility-gated schedule as every other fetch here
 * (`startVisiblePolling`): a background tab stops asking.
 */
export function useVenues(symbol: string, interval: Interval): VenueState {
  const [data, setData] = useState<VenuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Guards against a slow response for a previous symbol landing last. */
  const keyRef = useRef("");

  useEffect(() => {
    const key = `${symbol}:${interval}`;
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
        if (alive && keyRef.current === key) setLoading(false);
      }
    }

    const stop = startVisiblePolling(load, POLL_MS.venues);
    return () => {
      alive = false;
      stop();
    };
  }, [symbol, interval]);

  return { data, loading, error };
}
