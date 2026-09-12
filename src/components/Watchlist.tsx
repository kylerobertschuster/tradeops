"use client";

import { CURATED } from "@/lib/symbols";
import type { Ticker } from "@/lib/types";
import { formatPrice, formatPct } from "@/lib/format";

type Props = {
  tickers: Record<string, Ticker>;
  selected: string;
  onSelect: (symbol: string) => void;
};

export default function Watchlist({ tickers, selected, onSelect }: Props) {
  return (
    // `w-full` rather than a fixed rail: whoever mounts this decides the
    // width (a fixed rail beside the chart on desktop, a full-screen pane on
    // mobile), and the border only makes sense when it sits next to the chart.
    <aside className="flex w-full min-h-0 flex-col bg-tv-panel lg:border-r lg:border-tv-border">
      <div className="flex h-9 items-center justify-between border-b border-tv-border px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-tv-muted">
          Watchlist
        </span>
        <span className="text-[11px] text-tv-muted">{CURATED.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {CURATED.map((s) => {
          const t = tickers[s.symbol];
          const up = (t?.change24h ?? 0) >= 0;
          const isSel = selected === s.symbol;
          return (
            <button
              key={s.symbol}
              onClick={() => onSelect(s.symbol)}
              className={`flex w-full items-center justify-between gap-2 border-l-2 px-3 py-2 text-left transition-colors ${
                isSel
                  ? "border-tv-accent bg-tv-accent/10"
                  : "border-transparent hover:bg-tv-panel2"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-tv-text">{s.base}</span>
                  <span className="truncate text-[11px] text-tv-muted">/USDT</span>
                </div>
                <div className="truncate text-[11px] text-tv-muted">{s.name}</div>
              </div>
              <div className="text-right">
                <div className="text-[12px] font-medium tabular-nums text-tv-text">
                  {t ? formatPrice(t.price) : "—"}
                </div>
                <div
                  className={`text-[11px] font-medium tabular-nums ${
                    t ? (up ? "text-tv-up" : "text-tv-down") : "text-tv-muted"
                  }`}
                >
                  {t ? formatPct(t.change24h) : "—"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
