"use client";

import Link from "next/link";
import SymbolSearch from "./SymbolSearch";
import type { Interval } from "@/lib/types";
import { INTERVALS } from "@/lib/types";
import { formatUsd, formatPct } from "@/lib/format";
import { PANE_COUNTS, type PaneCount, type View } from "@/lib/layout";
import { SUPPORT_LINKS } from "@/lib/legal";

const LABELS: Record<Interval, string> = {
  "1s": "1s",
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};

/** Spelled out rather than "2 charts", so all three read the same way. */
const PANE_LABELS: Record<PaneCount, string> = {
  1: "One chart",
  2: "Two charts",
  4: "Four charts",
};

type Props = {
  interval: Interval;
  onInterval: (i: Interval) => void;
  equity: number;
  pnl: number;
  pnlPct: number;
  /** False when some position had no live price and was valued at cost. */
  priced: boolean;
  /** How many charts the layout shows, and how to change that. */
  panes: PaneCount;
  onPanes: (panes: PaneCount) => void;
  /** Whether the charts or the market view is on screen, and how to switch. */
  view: View;
  onView: (view: View) => void;
  onSelectSymbol: (symbol: string) => void;
};

export default function TopBar({
  interval,
  onInterval,
  panes,
  onPanes,
  view,
  onView,
  equity,
  pnl,
  pnlPct,
  priced,
  onSelectSymbol,
}: Props) {
  const up = pnl >= 0;
  // A tilde marks totals that include a position valued at cost rather than at
  // market, so an approximate figure cannot pass for an exact one.
  const approx = priced ? "" : "~";
  const approxTitle = priced
    ? undefined
    : "Some positions have no live price and are valued at cost, so this is approximate.";
  return (
    // Wraps to two rows on narrow screens (brand + search + P&L, then the
    // timeframes) and collapses back to the original single row at `lg`. The
    // timeframes use `order-last w-full` to claim their own row when wrapped
    // and `lg:order-none lg:w-auto` to slot back inline on desktop, so the
    // desktop order is unchanged: brand, search, timeframes, account.
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-tv-border bg-tv-panel px-3 lg:h-12 lg:flex-nowrap">
      {/* Logo */}
      <div className="flex h-12 items-center gap-2 lg:h-auto">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="4" y="9" width="3" height="9" rx="1" fill="#089981" />
          <rect x="9" y="5" width="3" height="13" rx="1" fill="#089981" />
          <rect x="14" y="7" width="3" height="11" rx="1" fill="#f23645" />
          <rect x="18" y="3" width="2" height="15" rx="1" fill="#f23645" />
        </svg>
        <span className="hidden text-[15px] font-bold tracking-tight text-tv-text sm:inline">
          Trade<span className="text-tv-accent">Ops</span>
        </span>
      </div>

      {/* Search */}
      <div className="min-w-0 flex-1 lg:w-64 lg:flex-none">
        <SymbolSearch onSelect={onSelectSymbol} />
      </div>

      {/* Timeframes */}
      <nav className="order-last flex w-full items-center gap-0.5 overflow-x-auto pb-2 lg:order-none lg:ml-2 lg:w-auto lg:overflow-visible lg:pb-0">
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

      {/*
       * Layouts. The counts are 1, 2 and 4 — the ones that tile a rectangle —
       * and the control sits with the timeframes because it is the same kind of
       * choice: how much of the market you want on one screen. Switching keeps
       * every chart's pair and timeframe, so this is safe to press.
       */}
      <nav
        className="flex shrink-0 items-center gap-0.5 rounded border border-tv-border p-0.5"
        aria-label="Chart layout"
      >
        {PANE_COUNTS.map((count) => (
          <button
            key={count}
            onClick={() => onPanes(count)}
            aria-pressed={view === "charts" && panes === count}
            title={PANE_LABELS[count]}
            aria-label={PANE_LABELS[count]}
            className={`rounded p-1 transition-colors ${
              view === "charts" && panes === count
                ? "bg-tv-accent text-white"
                : "text-tv-muted hover:bg-tv-panel2 hover:text-tv-text"
            }`}
          >
            <LayoutIcon count={count} />
          </button>
        ))}
      </nav>

      {/*
       * The other answer to "how much market do you want on screen": every
       * market on one axis, rebased to percent change. A layout shows one
       * market up to four ways — which is why this is a button beside them and
       * not a fourth layout count.
       */}
      <button
        onClick={() => onView(view === "market" ? "charts" : "market")}
        aria-pressed={view === "market"}
        title="Every market on one chart, each rebased to percent change"
        className={`shrink-0 rounded border border-tv-border px-1.5 py-1 text-[11px] transition-colors ${
          view === "market"
            ? "bg-tv-accent text-white"
            : "text-tv-muted hover:bg-tv-panel2 hover:text-tv-text"
        }`}
      >
        Market
      </button>

      <div className="hidden lg:block lg:flex-1" />

      {/* Account chip */}
      <div className="flex shrink-0 items-center gap-2 text-right lg:gap-3">
        {/* Equity is the first thing to go when space is tight; P&L matters more. */}
        <div className="hidden leading-tight sm:block" title={approxTitle}>
          <div className="text-[10px] uppercase tracking-wide text-tv-muted">Equity</div>
          <div className="text-[13px] font-semibold tabular-nums text-tv-text">
            {approx}
            {formatUsd(equity)}
          </div>
        </div>
        <div className="leading-tight" title={approxTitle}>
          <div className="text-[10px] uppercase tracking-wide text-tv-muted">P&L</div>
          <div
            className={`rounded px-1.5 py-0.5 text-[13px] font-semibold tabular-nums ${
              up ? "bg-tv-up/15 text-tv-up" : "bg-tv-down/15 text-tv-down"
            }`}
          >
            {approx}
            {formatUsd(pnl)} ({formatPct(pnlPct)})
          </div>
        </div>
        {SUPPORT_LINKS.length > 0 && (
          <Link
            href="/legal#support"
            className="shrink-0 text-[11px] text-tv-muted transition-colors hover:text-tv-text"
          >
            Support
          </Link>
        )}
        {/*
         * The way into /legal from the terminal, which is otherwise a
         * full-height viewport with nowhere to put a footer. Kept to a word and
         * a muted tone: it needs to be findable, not to compete with the
         * prices. Footers on the legal pages link back here.
         *
         * "Support" above is the same idea one degree further: it points at the
         * explanation on /legal rather than at a payment page, so the one link
         * about money in the terminal chrome cannot read as a paywall. It
         * renders nothing at all when the operator has set no link, which is
         * the shipped state.
         */}
        <Link
          href="/legal"
          className="shrink-0 text-[11px] text-tv-muted transition-colors hover:text-tv-text"
        >
          Legal
        </Link>
      </div>
    </header>
  );
}

/**
 * A tiny diagram of the layout it selects.
 *
 * Four squares in a 2×2 say "four charts" faster than the word does, and inside
 * a fourteen-pixel box a label would be unreadable anyway.
 */
function LayoutIcon({ count }: { count: PaneCount }) {
  const cells: [number, number, number, number][] =
    count === 1
      ? [[1, 1, 12, 12]]
      : count === 2
        ? [
            [1, 1, 5.5, 12],
            [7.5, 1, 5.5, 12],
          ]
        : [
            [1, 1, 5.5, 5.5],
            [7.5, 1, 5.5, 5.5],
            [1, 7.5, 5.5, 5.5],
            [7.5, 7.5, 5.5, 5.5],
          ];

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      {cells.map(([x, y, w, h]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx="1.5" />
      ))}
    </svg>
  );
}
