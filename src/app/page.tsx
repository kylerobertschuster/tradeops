"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import Watchlist from "@/components/Watchlist";
import ChartPanel from "@/components/ChartPanel";
import RightPanel from "@/components/RightPanel";
import MobileNav, { type Pane } from "@/components/MobileNav";
import { fetchTickers } from "@/lib/api";
import { createLiveFeed, type LiveFeed } from "@/lib/live";
import { POLL_MS, startVisiblePolling } from "@/lib/polling";
import { CURATED } from "@/lib/symbols";
import { FALLBACK_SLOT, type PaneCount } from "@/lib/layout";
import { usePaperStore } from "@/store/paperTrading";
import { portfolioValue } from "@/lib/portfolio";
import { useLabelsStore } from "@/store/labels";
import { useLayoutStore } from "@/store/layout";
import type { Ticker } from "@/lib/types";

export default function Home() {
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  /** True while every provider is refusing, so the board may be stale. */
  const [stale, setStale] = useState(false);
  /** True while the websocket is delivering prices. */
  const [live, setLive] = useState(false);
  const feedRef = useRef<LiveFeed | null>(null);
  /** Only meaningful below `lg`; on desktop all three panels are shown. */
  const [pane, setPane] = useState<Pane>("chart");

  const panes = useLayoutStore((s) => s.panes);
  const focus = useLayoutStore((s) => s.focus);
  const slots = useLayoutStore((s) => s.slots);
  const setPanes = useLayoutStore((s) => s.setPanes);
  const setFocus = useLayoutStore((s) => s.setFocus);
  const setSymbol = useLayoutStore((s) => s.setSymbol);
  const setIntervalState = useLayoutStore((s) => s.setInterval);

  /**
   * The focused chart is what the toolbar, the search and the watchlist act on.
   *
   * In a single-chart layout, which is the default, that is the only chart
   * there is, so `symbol` and `interval` here mean exactly what they meant when
   * they were local state: the pair on screen. The fallback covers the first
   * render, before the stored layout has rehydrated.
   */
  const active = slots[focus] ?? FALLBACK_SLOT;
  const symbol = active.symbol;
  const interval = active.interval;
  /** The charts actually on screen — the rest keep their state while hidden. */
  const visible = slots.slice(0, panes);

  const cash = usePaperStore((s) => s.cash);
  const positions = usePaperStore((s) => s.positions);

  // Rehydrate persisted stores (skipHydration avoids SSR mismatch)
  useEffect(() => {
    void usePaperStore.persist.rehydrate();
    void useLabelsStore.persist.rehydrate();
    void useLayoutStore.persist.rehydrate();
  }, []);

  const symbolsKey = useMemo(() => {
    const set = new Set<string>(CURATED.map((s) => s.symbol));
    // Every chart on screen streams its own pair: a price that only moves in
    // the chart you are looking at is not a live price. One socket carries all
    // of them, so the fourth chart adds traffic to the connection that is
    // already open rather than a connection of its own.
    for (const slot of slots.slice(0, panes)) set.add(slot.symbol);
    for (const p of Object.keys(positions)) set.add(p);
    return Array.from(set).sort().join(",");
  }, [slots, panes, positions]);

  /**
   * One websocket for the whole session.
   *
   * It is created once rather than depending on the symbol list, because
   * changing symbols re-subscribes over the open socket — rebuilding the feed
   * would drop and redial the connection every time the selection changed.
   */
  useEffect(() => {
    const feed = createLiveFeed({
      onTicker: (sym, t) => setTickers((prev) => ({ ...prev, [sym]: t })),
      onKline: () => {},
      onStatus: (s) => {
        setLive(s === "live");
        // Prices are arriving again, so whatever was stale no longer is.
        if (s === "live") setStale(false);
      },
    });
    feedRef.current = feed;
    return () => {
      feed.close();
      feedRef.current = null;
    };
  }, []);

  useEffect(() => {
    feedRef.current?.setTickerSymbols(symbolsKey.split(",").filter(Boolean));
  }, [symbolsKey]);

  /**
   * REST polling is the fallback, not the default.
   *
   * While the socket is live this would be duplicate traffic that still costs
   * Worker requests — and requests are the binding constraint on the free
   * hosting tier (100,000/day). Polling only runs when streaming is down.
   */
  useEffect(() => {
    if (live) return;
    const symbols = symbolsKey.split(",").filter(Boolean);
    let alive = true;

    async function load() {
      try {
        const t = await fetchTickers(symbols);
        if (!alive) return;
        setTickers((prev) => ({ ...prev, ...t }));
        setStale(false);
      } catch {
        // Keep the last good prices rather than blanking the board. Stale and
        // labelled beats empty and silent, and the old prices are still the
        // best available estimate of the market.
        if (alive) setStale(true);
      }
    }

    const stopPolling = startVisiblePolling(load, POLL_MS.tickers);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [live, symbolsKey]);

  const { equity, pnl, pnlPct, priced } = useMemo(
    () => portfolioValue(cash, positions, tickers),
    [cash, positions, tickers],
  );

  /**
   * Panels below `lg` show one at a time; from `lg` up they are all visible.
   *
   * The inactive case is `hidden lg:flex` and the active case is `flex` — never
   * both `flex` and `hidden` unprefixed on one element, since Tailwind emits
   * `hidden` after `flex` and the class order in the attribute does not decide
   * it. The responsive variant sits in a later media query, so `lg:flex` still
   * wins over the bare `hidden` on desktop.
   */
  const paneClass = (name: Pane) => (pane === name ? "flex" : "hidden lg:flex");

  /**
   * The charts tile from `lg` up and stack below it.
   *
   * On a phone a 2×2 grid of 300-pixel charts is four unreadable charts, so the
   * layout becomes a vertical scroll of full-height ones instead — the same
   * charts, one screen at a time, which is what the single-pane mobile view
   * already does for the panels. Every visible chart stays mounted in both
   * cases: hiding one with CSS would leave its socket and its polling running,
   * which is the worst of both.
   *
   * The `gap-px` over a `bg-tv-border` parent draws the dividers, so there is no
   * border logic and no double lines where panes meet.
   */
  const gridClass: Record<PaneCount, string> = {
    1: "lg:grid-cols-1",
    // `grid-rows-1` rather than an implicit row: the chart canvas is absolutely
    // positioned, so it contributes no height of its own and an auto-sized row
    // would only be as tall as the header. The track has to be told to take the
    // space, which `minmax(0, 1fr)` does and `auto` does not.
    2: "lg:grid-cols-2 lg:grid-rows-1",
    4: "lg:grid-cols-2 lg:grid-rows-2",
  };

  /** Picking an asset on mobile should land you on it, not on the list. */
  const selectSymbol = (next: string) => {
    setSymbol(next);
    setPane("chart");
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-tv-bg text-tv-text">
      <TopBar
        interval={interval}
        onInterval={setIntervalState}
        panes={panes}
        onPanes={setPanes}
        equity={equity}
        pnl={pnl}
        pnlPct={pnlPct}
        priced={priced}
        onSelectSymbol={selectSymbol}
      />
      {stale && (
        <div className="shrink-0 border-b border-tv-down/40 bg-tv-down/10 px-3 py-1 text-[11px] text-tv-down">
          Live prices unavailable — every market data provider refused the request. Showing the last
          known values.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div
          className={`min-h-0 flex-1 flex-col lg:w-60 lg:flex-none ${paneClass("markets")}`}
        >
          <Watchlist tickers={tickers} selected={symbol} onSelect={selectSymbol} />
        </div>
        <main
          className={`min-h-0 min-w-0 flex-1 flex-col ${paneClass("chart")}`}
        >
          <div
            className={`flex min-h-0 flex-1 flex-col gap-px overflow-y-auto bg-tv-border lg:grid lg:overflow-hidden ${gridClass[panes]}`}
          >
            {visible.map((slot, i) => (
              <div key={i} className="flex h-[70vh] min-w-0 flex-col bg-tv-bg lg:h-auto lg:min-h-0">
                <ChartPanel
                  symbol={slot.symbol}
                  interval={slot.interval}
                  ticker={tickers[slot.symbol]}
                  focused={panes === 1 || i === focus}
                  framed={panes > 1}
                  onFocus={panes > 1 ? () => setFocus(i) : undefined}
                />
              </div>
            ))}
          </div>
        </main>
        <div
          className={`min-h-0 flex-1 flex-col lg:w-80 lg:flex-none ${paneClass("trade")}`}
        >
          <RightPanel symbol={symbol} ticker={tickers[symbol]} tickers={tickers} />
        </div>
      </div>
      <MobileNav pane={pane} onPane={setPane} />
    </div>
  );
}
