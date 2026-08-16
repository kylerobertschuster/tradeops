"use client";

import { useMemo, useState } from "react";
import OrderTicket from "./OrderTicket";
import { usePaperStore, STARTING_BALANCE } from "@/store/paperTrading";
import { findSymbol } from "@/lib/symbols";
import type { Ticker } from "@/lib/types";
import { formatUsd, formatPrice, formatQty, formatPct, formatTime } from "@/lib/format";

type Props = {
  symbol: string;
  ticker?: Ticker;
  tickers: Record<string, Ticker>;
};

type Tab = "trade" | "positions" | "orders";

export default function RightPanel({ symbol, ticker, tickers }: Props) {
  const [tab, setTab] = useState<Tab>("trade");
  const cash = usePaperStore((s) => s.cash);
  const positions = usePaperStore((s) => s.positions);
  const orders = usePaperStore((s) => s.orders);
  const closePosition = usePaperStore((s) => s.closePosition);
  const reset = usePaperStore((s) => s.reset);

  const positionList = useMemo(() => Object.values(positions), [positions]);

  const { equity, pnl, pnlPct, unrealized } = useMemo(() => {
    let equity = cash;
    for (const p of positionList) {
      const mark = tickers[p.symbol]?.price ?? p.avgPrice;
      equity += p.qty * mark;
    }
    const pnl = equity - STARTING_BALANCE;
    return { equity, pnl, pnlPct: (pnl / STARTING_BALANCE) * 100, unrealized: equity - cash };
  }, [cash, positionList, tickers]);

  const up = pnl >= 0;
  const info = findSymbol(symbol);
  const selectedPrice = ticker?.price;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-tv-border bg-tv-panel">
      {/* Account summary */}
      <div className="border-b border-tv-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-tv-muted">
            Paper Account
          </span>
          <button
            onClick={() => {
              if (confirm("Reset your paper trading account to $100,000?")) reset();
            }}
            className="text-[11px] text-tv-muted underline-offset-2 hover:text-tv-text hover:underline"
          >
            Reset
          </button>
        </div>
        <div className="mt-2 text-[26px] font-semibold tabular-nums leading-none text-tv-text">
          {formatUsd(equity)}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[12px]">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold tabular-nums ${
              up ? "bg-tv-up/15 text-tv-up" : "bg-tv-down/15 text-tv-down"
            }`}
          >
            {formatUsd(pnl)} ({formatPct(pnlPct)})
          </span>
          <span className="text-tv-muted">P&L</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded bg-tv-bg p-2">
            <div className="text-tv-muted">Buying power</div>
            <div className="mt-0.5 font-medium tabular-nums text-tv-text">{formatUsd(cash)}</div>
          </div>
          <div className="rounded bg-tv-bg p-2">
            <div className="text-tv-muted">Open positions</div>
            <div
              className={`mt-0.5 font-medium tabular-nums ${
                unrealized >= 0 ? "text-tv-up" : "text-tv-down"
              }`}
            >
              {formatUsd(unrealized)}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-tv-border">
        {(["trade", "positions", "orders"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 border-b-2 px-2 py-2 text-[12px] font-medium capitalize transition-colors ${
              tab === t
                ? "border-tv-accent text-tv-text"
                : "border-transparent text-tv-muted hover:text-tv-text"
            }`}
          >
            {t === "positions" ? `Positions (${positionList.length})` : t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "trade" && (
          <OrderTicket symbol={symbol} base={info.base} price={selectedPrice} />
        )}

        {tab === "positions" &&
          (positionList.length === 0 ? (
            <EmptyState text="No open positions. Place a trade to get started." />
          ) : (
            <div className="space-y-2">
              {positionList.map((p) => {
                const mark = tickers[p.symbol]?.price ?? p.avgPrice;
                const value = p.qty * mark;
                const cost = p.qty * p.avgPrice;
                const pnl = value - cost;
                return (
                  <div key={p.symbol} className="rounded-md border border-tv-border bg-tv-bg p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-tv-text">{p.base}/USDT</span>
                      <button
                        onClick={() => closePosition(p.symbol, mark)}
                        className="rounded bg-tv-down/15 px-2 py-0.5 text-[11px] font-medium text-tv-down hover:bg-tv-down/30"
                      >
                        Close
                      </button>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] tabular-nums">
                      <Row label="Size" value={`${formatQty(p.qty)} ${p.base}`} />
                      <Row label="Avg price" value={formatPrice(p.avgPrice)} />
                      <Row label="Mark" value={formatPrice(mark)} />
                      <Row label="Value" value={formatUsd(value)} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between border-t border-tv-border pt-1.5 text-[12px]">
                      <span className="text-tv-muted">Unrealized P&L</span>
                      <span
                        className={`font-semibold tabular-nums ${
                          pnl >= 0 ? "text-tv-up" : "text-tv-down"
                        }`}
                      >
                        {formatUsd(pnl)} ({formatPct((pnl / cost) * 100)})
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

        {tab === "orders" &&
          (orders.length === 0 ? (
            <EmptyState text="No orders yet." />
          ) : (
            <div className="space-y-1.5">
              {orders.slice(0, 100).map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between rounded-md border border-tv-border bg-tv-bg px-2.5 py-2 text-[12px]"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-10 rounded px-1 py-0.5 text-center text-[10px] font-bold uppercase ${
                        o.side === "buy" ? "bg-tv-up/15 text-tv-up" : "bg-tv-down/15 text-tv-down"
                      }`}
                    >
                      {o.side}
                    </span>
                    <div>
                      <div className="font-semibold text-tv-text">{o.base}/USDT</div>
                      <div className="text-[10px] text-tv-muted">{formatTime(o.time)}</div>
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-tv-text">{formatQty(o.qty)}</div>
                    <div className="text-[10px] text-tv-muted">
                      @ {formatPrice(o.price)} · {formatUsd(o.notional)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-tv-muted">{label}</span>
      <span className="text-right text-tv-text">{value}</span>
    </>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-tv-muted/60">
        <rect x="4" y="10" width="3" height="7" rx="1" fill="currentColor" />
        <rect x="10" y="6" width="3" height="11" rx="1" fill="currentColor" />
        <rect x="16" y="8" width="3" height="9" rx="1" fill="currentColor" />
      </svg>
      <p className="max-w-[200px] text-[12px] text-tv-muted">{text}</p>
    </div>
  );
}
