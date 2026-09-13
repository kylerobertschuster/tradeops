"use client";

import { useMemo, useState } from "react";
import { usePaperStore, FEE_RATE } from "@/store/paperTrading";
import { maxNotional } from "@/lib/portfolio";
import { formatPrice, formatUsd, formatQty } from "@/lib/format";

type Props = {
  symbol: string;
  base: string;
  price?: number;
};

export default function OrderTicket({ symbol, base, price }: Props) {
  const cash = usePaperStore((s) => s.cash);
  const position = usePaperStore((s) => s.positions[symbol]);
  const marketBuy = usePaperStore((s) => s.marketBuy);
  const marketSell = usePaperStore((s) => s.marketSell);

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const mark = price ?? position?.avgPrice ?? 0;
  const notional = parseFloat(amount) || 0;
  const qty = mark > 0 ? notional / mark : 0;
  const fee = notional * FEE_RATE;

  // Buying power is the balance *less the taker fee*, because the fee is
  // charged on top of the order. Sizing a 100% buy off raw cash produces an
  // order whose total is cash x 1.001, which is rejected as insufficient — so
  // the Max button could never succeed.
  const available =
    side === "buy" ? cash / (1 + FEE_RATE) : (position?.qty ?? 0) * mark;

  const pctOptions = useMemo(() => [0.25, 0.5, 0.75, 1], []);

  const setPct = (p: number) => {
    if (!available || available <= 0) return;
    // 100% means exactly that. Rounding the notional to cents would leave dust
    // in a position sold in full (or push a buy past the balance), so the full
    // size uses the exact figure and the rest round *down* rather than to
    // nearest, which is the direction that cannot overshoot.
    if (p === 1) {
      setAmount(String(available));
      return;
    }
    setAmount((Math.floor(available * p * 100) / 100).toFixed(2));
  };

  const submit = () => {
    if (!mark || mark <= 0) {
      setError("Waiting for market price…");
      return;
    }
    const err =
      side === "buy"
        ? marketBuy(symbol, base, notional, mark)
        : marketSell(symbol, base, notional, mark);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFlash(`${side === "buy" ? "Bought" : "Sold"} ${formatQty(qty)} ${base}`);
    setAmount("");
    setTimeout(() => setFlash(null), 2000);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-1 rounded-md bg-tv-bg p-1">
        <button
          onClick={() => {
            setSide("buy");
            setError(null);
          }}
          className={`rounded py-1.5 text-[13px] font-semibold transition-colors ${
            side === "buy" ? "bg-tv-up text-white" : "text-tv-muted hover:text-tv-text"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => {
            setSide("sell");
            setError(null);
          }}
          className={`rounded py-1.5 text-[13px] font-semibold transition-colors ${
            side === "sell" ? "bg-tv-down text-white" : "text-tv-muted hover:text-tv-text"
          }`}
        >
          Sell
        </button>
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-tv-muted">Available</span>
        <span className="font-medium tabular-nums text-tv-text">
          {side === "buy" ? formatUsd(available) : `${formatQty(position?.qty ?? 0)} ${base}`}
        </span>
      </div>

      {/* Amount */}
      <div className="flex items-center gap-1 rounded-md border border-tv-border bg-tv-bg px-2.5 py-2 focus-within:border-tv-accent">
        <span className="text-[13px] text-tv-muted">$</span>
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-transparent text-[15px] font-medium tabular-nums text-tv-text outline-none placeholder:text-tv-muted"
        />
        <span className="text-[12px] text-tv-muted">USD</span>
      </div>

      {/* Quick % */}
      <div className="grid grid-cols-4 gap-1">
        {pctOptions.map((p) => (
          <button
            key={p}
            onClick={() => setPct(p)}
            className="rounded border border-tv-border bg-tv-bg py-1 text-[11px] font-medium text-tv-muted transition-colors hover:border-tv-accent hover:text-tv-text"
          >
            {p === 1 ? "Max" : `${p * 100}%`}
          </button>
        ))}
      </div>

      {/* Estimate */}
      <div className="space-y-1 rounded-md border border-tv-border bg-tv-bg p-2.5 text-[12px]">
        <div className="flex justify-between">
          <span className="text-tv-muted">Market price</span>
          <span className="tabular-nums text-tv-text">{mark ? formatPrice(mark) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-tv-muted">Est. quantity</span>
          <span className="tabular-nums text-tv-text">{notional ? formatQty(qty) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-tv-muted">Fee (0.1%)</span>
          <span className="tabular-nums text-tv-text">{notional ? formatUsd(fee) : "—"}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-tv-down/40 bg-tv-down/10 px-2.5 py-1.5 text-[12px] text-tv-down">
          {error}
        </div>
      )}
      {flash && (
        <div className="rounded-md border border-tv-up/40 bg-tv-up/10 px-2.5 py-1.5 text-[12px] text-tv-up">
          {flash}
        </div>
      )}

      <button
        onClick={submit}
        disabled={!mark}
        className={`w-full rounded-md py-2.5 text-[13px] font-semibold text-white transition-opacity disabled:opacity-50 ${
          side === "buy" ? "bg-tv-up hover:opacity-90" : "bg-tv-down hover:opacity-90"
        }`}
      >
        {side === "buy" ? `Buy ${base}` : `Sell ${base}`}
      </button>

      <p className="text-center text-[10px] leading-relaxed text-tv-muted">
        Simulated paper trading. No real funds are used.
      </p>
    </div>
  );
}
