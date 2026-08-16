"use client";

import SymbolSearch from "./SymbolSearch";
import type { Interval } from "@/lib/types";
import { INTERVALS } from "@/lib/types";
import { formatUsd, formatPct } from "@/lib/format";

const LABELS: Record<Interval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};

type Props = {
  interval: Interval;
  onInterval: (i: Interval) => void;
  equity: number;
  pnl: number;
  pnlPct: number;
  onSelectSymbol: (symbol: string) => void;
};

export default function TopBar({ interval, onInterval, equity, pnl, pnlPct, onSelectSymbol }: Props) {
  const up = pnl >= 0;
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-tv-border bg-tv-panel px-3">
      {/* Logo */}
      <div className="flex items-center gap-2 pr-1">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="4" y="9" width="3" height="9" rx="1" fill="#089981" />
          <rect x="9" y="5" width="3" height="13" rx="1" fill="#089981" />
          <rect x="14" y="7" width="3" height="11" rx="1" fill="#f23645" />
          <rect x="18" y="3" width="2" height="15" rx="1" fill="#f23645" />
        </svg>
        <span className="text-[15px] font-bold tracking-tight text-tv-text">
          Trade<span className="text-tv-accent">Ops</span>
        </span>
      </div>

      {/* Search */}
      <div className="w-64">
        <SymbolSearch onSelect={onSelectSymbol} />
      </div>

      {/* Timeframes */}
      <nav className="ml-2 flex items-center gap-0.5">
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            onClick={() => onInterval(iv)}
            className={`rounded px-2.5 py-1 text-[12px] font-medium transition-colors ${
              interval === iv
                ? "bg-tv-accent text-white"
                : "text-tv-muted hover:bg-tv-panel2 hover:text-tv-text"
            }`}
          >
            {LABELS[iv]}
          </button>
        ))}
      </nav>

      <div className="flex-1" />

      {/* Account chip */}
      <div className="flex items-center gap-3 text-right">
        <div className="leading-tight">
          <div className="text-[10px] uppercase tracking-wide text-tv-muted">Equity</div>
          <div className="text-[13px] font-semibold tabular-nums text-tv-text">{formatUsd(equity)}</div>
        </div>
        <div className="leading-tight">
          <div className="text-[10px] uppercase tracking-wide text-tv-muted">P&L</div>
          <div
            className={`rounded px-1.5 py-0.5 text-[13px] font-semibold tabular-nums ${
              up ? "bg-tv-up/15 text-tv-up" : "bg-tv-down/15 text-tv-down"
            }`}
          >
            {formatUsd(pnl)} ({formatPct(pnlPct)})
          </div>
        </div>
      </div>
    </header>
  );
}
