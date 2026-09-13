import { FEE_RATE, STARTING_BALANCE, type Position } from "@/store/paperTrading";
import type { Ticker } from "./types";

export type Portfolio = {
  cash: number;
  /** Cash plus every position marked to market. */
  equity: number;
  pnl: number;
  pnlPct: number;
  /** Equity minus cash: the part of the total that is riding on open positions. */
  unrealized: number;
  /**
   * False when at least one position had no live price and was therefore valued
   * at its own cost basis. The totals are still shown, but flagged, because a
   * fabricated mark makes P&L read as a confident `$0.00` — "no change" —
   * rather than as unknown.
   */
  priced: boolean;
  /** Symbols that could not be marked to market. */
  unpriced: string[];
};

/**
 * Total account value and P&L.
 *
 * This is the single source of truth: the top bar and the trade panel each used
 * to compute it independently, which is how two views of the same account drift
 * apart. The `priced` flag exists so callers can say "this is approximate"
 * instead of presenting a number that cannot be trusted.
 */
export function portfolioValue(
  cash: number,
  positions: Record<string, Position>,
  tickers: Record<string, Ticker>,
): Portfolio {
  let equity = cash;
  const unpriced: string[] = [];

  for (const p of Object.values(positions)) {
    const live = tickers[p.symbol]?.price;
    if (live === undefined) {
      // Value it at cost so the totals still add up, but remember that we did.
      unpriced.push(p.symbol);
      equity += p.qty * p.avgPrice;
    } else {
      equity += p.qty * live;
    }
  }

  const pnl = equity - STARTING_BALANCE;
  return {
    cash,
    equity,
    pnl,
    pnlPct: (pnl / STARTING_BALANCE) * 100,
    unrealized: equity - cash,
    priced: unpriced.length === 0,
    unpriced,
  };
}

/**
 * Order notionals are floored to 8 decimal places, the way a venue floors an
 * order step.
 *
 * The flooring is not cosmetic. In real arithmetic `cash / (1 + FEE_RATE)` is
 * the exact largest notional, but the fee is then recomputed in floating
 * point, and the round trip does not land back on `cash`: for a $100,000
 * balance it lands on `100000.00000000001` — *over* the balance, so the order
 * is rejected. The Max button failed for the single most common account size.
 * Flooring one step below the exact answer restores the invariant without a
 * fudge factor.
 *
 * Divided by 1e8 rather than multiplied by 1e-8: 1e8 is exactly representable
 * as a double and 1e-8 is not, so this direction adds one rounding instead of
 * two.
 */
const NOTIONAL_PRECISION = 1e8;

/**
 * The largest notional the account can actually commit on one side.
 *
 * A buy is capped by cash *less the taker fee*, because the fee is charged on
 * top of the order rather than deducted from it. Sizing off raw cash produces a
 * total of `cash * (1 + FEE_RATE)`, which exceeds the balance and is rejected —
 * that is precisely why the Max button could never succeed.
 */
export function maxNotional(
  side: "buy" | "sell",
  cash: number,
  qty: number,
  mark: number,
): number {
  if (side === "buy") {
    const notional = cash / (1 + FEE_RATE);
    // Math.floor, never Math.round: rounding up can only reintroduce the
    // overflow this exists to prevent.
    return Math.floor(notional * NOTIONAL_PRECISION) / NOTIONAL_PRECISION;
  }
  return qty * mark;
}
