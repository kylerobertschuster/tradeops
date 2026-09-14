"use client";

import { useState } from "react";
import {
  VENUES,
  spread,
  deviationFromMedian,
  bestFault,
  venueSymbol,
  type VenueFault,
  type VenueSeries,
  type VenueTicker,
} from "@/lib/venues";
import { formatPrice, formatPct, formatCompact } from "@/lib/format";
import type { Interval } from "@/lib/types";

type Props = {
  series: VenueSeries[];
  tickers: VenueTicker[];
  symbol: string;
  interval: Interval;
  /** Compare overlay is on, so each row's swatch is meaningful. */
  compare: boolean;
  onCompare: (next: boolean) => void;
  loading: boolean;
  error: string | null;
};

const INTERVAL_LABEL: Record<Interval, string> = {
  "1s": "1s",
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
};

/**
 * Why a venue has no data, in the fewest words that are still true.
 *
 * `unlisted` matters most: a symbol that a venue does not carry is a fact about
 * that venue's listings, not a fault in this app, and rendering it as "error"
 * would teach the user to distrust the whole table. Likewise the interval case
 * must name the interval — "no data" would be read as a bug rather than as
 * "only Binance publishes 1-second candles".
 */
function faultLabel(fault: VenueFault, interval: Interval): string {
  switch (fault) {
    case "unsupported-interval":
      return `no ${INTERVAL_LABEL[interval]} bars`;
    case "unlisted":
      return "not listed";
    case "delisted":
      return "delisted";
    case "blocked":
      return "region blocked";
    case "rate-limited":
      return "rate limited";
    case "timeout":
      return "timed out";
    case "empty":
      return "empty response";
    case "unreachable":
      return "unreachable";
  }
}

/**
 * Every venue's own numbers for the selected symbol.
 *
 * Nothing here is averaged, blended, or chosen as "the" price. The row per
 * venue is the point of the feature: when Binance and Coinbase disagree, that
 * disagreement is the information, and a single consensus number would have
 * deleted it.
 *
 * The spread is labelled **last-price spread**, never "arbitrage". These are
 * candle closes and 24h tickers, not executable quotes, and no trade can be
 * done at them — presenting the gap as a profit opportunity would be a lie that
 * costs the user money.
 */
export default function VenueStrip({
  series,
  tickers,
  symbol,
  interval,
  compare,
  onCompare,
  loading,
  error,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  // One row per venue in the registry, always — not one row per venue that
  // answered. Two reasons: the venue names are then in the server-rendered
  // HTML instead of appearing a beat later, and a venue that failed keeps its
  // row and explains itself rather than vanishing. A table whose rows come and
  // go between polls cannot be read.
  const rows = VENUES.map((meta) => ({
    meta,
    series: series.find((s) => s.id === meta.id) ?? null,
    ticker: tickers.find((t) => t.id === meta.id) ?? null,
  }));

  const prices = rows.map((r) => r.ticker?.price ?? null);
  const stats = spread(prices);
  const reporting = stats.count;
  const total = rows.length;
  const base = symbol.replace(/USDT$/, "");

  if (collapsed) {
    return (
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-tv-border px-3 text-[11px]">
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1 text-tv-muted hover:text-tv-text"
          title="Show every venue's own data"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span className="font-semibold uppercase tracking-wider">Venues</span>
        </button>
        <span className="tabular-nums text-tv-muted">
          {summaryLine(reporting, total, stats.spreadBps)}
        </span>
        {compare && <span className="text-tv-accent">comparing</span>}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-tv-border">
      {/* Header: what this table is, and the one number that summarises it. */}
      <div className="flex h-7 items-center justify-between gap-2 px-3 text-[11px]">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={() => setCollapsed(true)}
            className="flex shrink-0 items-center gap-1 text-tv-muted hover:text-tv-text"
            title="Hide the venue table"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="font-semibold uppercase tracking-wider">Venues</span>
          </button>
          <span className="truncate tabular-nums text-tv-muted">
            {summaryLine(reporting, total, stats.spreadBps)}
          </span>
        </div>
        <button
          onClick={() => onCompare(!compare)}
          title={
            compare
              ? "Show candles for the selected venue only"
              : `Overlay every venue's ${base} close, rebased to percentage change`
          }
          className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            compare
              ? "border-tv-accent bg-tv-accent/15 text-tv-accent"
              : "border-tv-border text-tv-muted hover:border-tv-accent hover:text-tv-text"
          }`}
        >
          Compare
        </button>
      </div>

      {error && (
        <p className="px-3 pb-1 text-[11px] text-tv-down">{error}</p>
      )}

      {/* One row per venue. Horizontally scrollable rather than reflowed: the
          columns have to stay aligned across venues to be comparable at all. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[11px] tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-tv-muted">
              <th className="px-3 py-0.5 text-left font-medium">Venue</th>
              <th className="px-2 py-0.5 text-left font-medium">Pair</th>
              <th className="px-2 py-0.5 text-right font-medium">Last</th>
              <th className="px-2 py-0.5 text-right font-medium">24h</th>
              <th className="px-2 py-0.5 text-right font-medium">24h range</th>
              <th className="px-2 py-0.5 text-right font-medium">24h vol</th>
              <th className="px-2 py-0.5 text-right font-medium" title="Percent above or below the median of all venues reporting a price">
                vs median
              </th>
              <th className="px-3 py-0.5 text-right font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ meta, series: s, ticker: t }) => {
              // `bestFault` prefers whichever probe explains itself better, but
              // only once both have answered. While loading, neither has, and
              // reporting a fault would be inventing one.
              const fault = loading ? null : bestFault(s?.fault ?? null, t?.fault ?? null);
              const price = t?.price ?? null;
              const dev = deviationFromMedian(price, stats.median);
              const up = t?.change24h != null && t.change24h >= 0;
              const hasRange = t?.high24h != null && t?.low24h != null;

              return (
                <tr key={meta.id} className="border-t border-tv-border/50 hover:bg-tv-panel2/40">
                  <td className="whitespace-nowrap px-3 py-0.5 text-left">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-3.5 rounded-sm"
                        style={{ background: meta.color, opacity: compare || !fault ? 1 : 0.3 }}
                      />
                      <span className="text-tv-text">{meta.label}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-0.5 text-left text-[10px] text-tv-muted">
                    {/* The venue's own ticker string, shown because "Coinbase
                        quotes BTC-USD" is information the user needs to read
                        the Last column correctly. Derived from the registry
                        rather than read from the response, so it is on screen
                        before the fetch lands — it is what we are asking for. */}
                    {venueSymbol(meta.id, symbol) ?? "—"}
                    {/* Coinbase and Kraken quote USD, our catalog quotes USDT.
                        Different assets by a few basis points — the same order
                        of magnitude as the spread this table exists to show. */}
                    {meta.quote === "USD" && (
                      <span className="ml-1 rounded bg-tv-panel2 px-1 text-[9px]" title="This venue quotes USD, not USDT">
                        USD
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-0.5 text-right font-medium text-tv-text">
                    {price != null ? formatPrice(price) : <span className="text-tv-muted">—</span>}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${t?.change24h == null ? "text-tv-muted" : up ? "text-tv-up" : "text-tv-down"}`}>
                    {t?.change24h != null ? (
                      formatPct(t.change24h)
                    ) : (
                      <span
                        title={
                          fault
                            ? undefined
                            : "This venue's public API does not publish a 24h open price, so a 24h change cannot be computed without measuring a different period."
                        }
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-0.5 text-right text-tv-muted">
                    {hasRange ? `${formatPrice(t.low24h)} – ${formatPrice(t.high24h)}` : "—"}
                  </td>
                  <td className="px-2 py-0.5 text-right text-tv-muted">
                    {t?.quoteVolume != null ? formatCompact(t.quoteVolume) : "—"}
                  </td>
                  <td className="px-2 py-0.5 text-right">
                    {dev != null ? (
                      <span className={dev > 0 ? "text-tv-up" : dev < 0 ? "text-tv-down" : "text-tv-muted"}>
                        {dev > 0 ? "+" : ""}
                        {dev.toFixed(0)} bps
                      </span>
                    ) : (
                      <span className="text-tv-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-0.5 text-right">
                    <StatusCell
                      venue={meta.label}
                      streaming={meta.streaming}
                      fault={fault}
                      interval={interval}
                      loading={loading && (s?.candles.length ?? 0) === 0}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The per-row truth about where the numbers came from.
 *
 * `live` is only ever shown for a venue the browser is genuinely streaming.
 * Everything else says `polled`, because that is what it is — the two look
 * identical in a table otherwise, and the user deserves to know which price is
 * a second old and which is a minute old.
 */
function StatusCell({
  venue,
  streaming,
  fault,
  interval,
  loading,
}: {
  venue: string;
  streaming: boolean;
  fault: VenueFault | null;
  interval: Interval;
  loading: boolean;
}) {
  if (fault) {
    return (
      <span
        className="inline-flex items-center gap-1 text-tv-muted"
        title={`${venue}: ${faultLabel(fault, interval)}. Other venues are unaffected.`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-tv-muted/60" />
        {faultLabel(fault, interval)}
      </span>
    );
  }
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-tv-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-tv-muted" />
        loading
      </span>
    );
  }
  if (streaming) {
    return (
      <span className="inline-flex items-center gap-1 text-tv-up" title={`${venue}: streamed directly from the exchange over a websocket`}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-tv-up" />
        live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-tv-muted" title={`${venue}: polled — this venue has no client-side stream in this app`}>
      <span className="h-1.5 w-1.5 rounded-full bg-tv-accent/70" />
      polled
    </span>
  );
}

function summaryLine(reporting: number, total: number, spreadBps: number | null): string {
  if (reporting === 0) return `no venue reporting for this pair`;
  const coverage = reporting === total ? `${total} venues` : `${reporting} of ${total} venues`;
  if (spreadBps == null) return coverage;
  return `${coverage} · last-price spread ${formatBps(spreadBps)}`;
}

/** Sub-basis-point spreads are real, so they must not print as "0 bps". */
function formatBps(bps: number): string {
  if (bps < 1) return `${bps.toFixed(2)} bps`;
  if (bps < 10) return `${bps.toFixed(1)} bps`;
  return `${bps.toFixed(0)} bps`;
}
