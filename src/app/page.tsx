"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar from "@/components/TopBar";
import Watchlist from "@/components/Watchlist";
import ChartPanel from "@/components/ChartPanel";
import RightPanel from "@/components/RightPanel";
import MobileNav, { type Pane } from "@/components/MobileNav";
import { fetchTickers } from "@/lib/api";
import { POLL_MS, startVisiblePolling } from "@/lib/polling";
import { CURATED } from "@/lib/symbols";
import { usePaperStore, STARTING_BALANCE } from "@/store/paperTrading";
import { useLabelsStore } from "@/store/labels";
import type { Interval, Ticker } from "@/lib/types";

export default function Home() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setIntervalState] = useState<Interval>("15m");
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  /** Only meaningful below `lg`; on desktop all three panels are shown. */
  const [pane, setPane] = useState<Pane>("chart");

  const cash = usePaperStore((s) => s.cash);
  const positions = usePaperStore((s) => s.positions);

  // Rehydrate persisted stores (skipHydration avoids SSR mismatch)
  useEffect(() => {
    void usePaperStore.persist.rehydrate();
    void useLabelsStore.persist.rehydrate();
  }, []);

  const symbolsKey = useMemo(() => {
    const set = new Set<string>(CURATED.map((s) => s.symbol));
    set.add(symbol);
    for (const p of Object.keys(positions)) set.add(p);
    return Array.from(set).sort().join(",");
  }, [symbol, positions]);

  useEffect(() => {
    const symbols = symbolsKey.split(",").filter(Boolean);
    let alive = true;

    async function load() {
      const t = await fetchTickers(symbols);
      if (alive) setTickers((prev) => ({ ...prev, ...t }));
    }

    const stopPolling = startVisiblePolling(load, POLL_MS.tickers);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [symbolsKey]);

  const { equity, pnl, pnlPct } = useMemo(() => {
    let equity = cash;
    for (const p of Object.values(positions)) {
      const mark = tickers[p.symbol]?.price ?? p.avgPrice;
      equity += p.qty * mark;
    }
    const pnl = equity - STARTING_BALANCE;
    return { equity, pnl, pnlPct: (pnl / STARTING_BALANCE) * 100 };
  }, [cash, positions, tickers]);

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
        equity={equity}
        pnl={pnl}
        pnlPct={pnlPct}
        onSelectSymbol={selectSymbol}
      />
      <div className="flex min-h-0 flex-1">
        <div
          className={`min-h-0 flex-1 flex-col lg:w-60 lg:flex-none ${paneClass("markets")}`}
        >
          <Watchlist tickers={tickers} selected={symbol} onSelect={selectSymbol} />
        </div>
        <main
          className={`min-h-0 min-w-0 flex-1 flex-col ${paneClass("chart")}`}
        >
          <ChartPanel symbol={symbol} interval={interval} ticker={tickers[symbol]} />
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
