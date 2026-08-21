"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar from "@/components/TopBar";
import Watchlist from "@/components/Watchlist";
import ChartPanel from "@/components/ChartPanel";
import RightPanel from "@/components/RightPanel";
import { fetchTickers } from "@/lib/api";
import { CURATED } from "@/lib/symbols";
import { usePaperStore, STARTING_BALANCE } from "@/store/paperTrading";
import { useLabelsStore } from "@/store/labels";
import type { Interval, Ticker } from "@/lib/types";

export default function Home() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setIntervalState] = useState<Interval>("15m");
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});

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

    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
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

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-tv-bg text-tv-text">
      <TopBar
        interval={interval}
        onInterval={setIntervalState}
        equity={equity}
        pnl={pnl}
        pnlPct={pnlPct}
        onSelectSymbol={setSymbol}
      />
      <div className="flex min-h-0 flex-1">
        <Watchlist tickers={tickers} selected={symbol} onSelect={setSymbol} />
        <main className="flex min-w-0 flex-1 flex-col">
          <ChartPanel symbol={symbol} interval={interval} ticker={tickers[symbol]} />
        </main>
        <RightPanel symbol={symbol} ticker={tickers[symbol]} tickers={tickers} />
      </div>
    </div>
  );
}
