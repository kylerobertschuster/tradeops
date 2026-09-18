export function formatPrice(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1000) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (n >= 1) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

export function formatUsd(n: number | undefined | null, cents = true): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

export function formatCompact(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatPct(n: number | undefined | null, signed = true): string {
  if (n == null || !isFinite(n)) return "—";
  const sign = signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Decimals for the chart's price axis, from the range that axis is showing.
 *
 * The charting library's default for a series is a fixed two decimals *and* a
 * one-cent floor on how closely ticks may be spaced (`precision: 2`,
 * `minMove: 0.01`, see `PriceTickSpanCalculator` in its source). That is wrong
 * at both ends of this app's symbol list: PEPE renders every tick, the crosshair
 * label and the last-price tag as `0.00`, and DOGE — under a dollar — cannot be
 * labelled finer than a whole cent, so a day of price action lands on two or
 * three ticks with nothing readable between them.
 *
 * The library already chooses tick *spacing* from the visible range; the digits
 * are the part that was fixed. So the fix is to feed both from the same place:
 * two significant digits for every power of ten on screen, which holds roughly
 * four significant figures at every zoom. BTC zoomed out reads `101,200`,
 * zoomed into a two-dollar window reads `101,234.25`, and PEPE reads
 * `0.00001234` instead of a column of zeros.
 *
 * The cap at 8 is the library's own limit on `minMove` before float error
 * creeps into tick placement, and the floor at 0 keeps a zoomed-out axis from
 * printing `.00` on the end of every price.
 */
export function chartPriceDecimals(range: number): number {
  if (!isFinite(range) || range <= 0) return 2;
  return Math.min(8, Math.max(0, 2 - Math.floor(Math.log10(range))));
}

/**
 * One price on the chart's axis: grouped, with exactly the digits the zoom
 * earned.
 *
 * Grouping is the reason this is not just `toFixed` — `101,200` is read at a
 * glance where `101200` has to be counted. The digits are passed in rather than
 * derived so that every label on an axis shares them; a column where one tick
 * says `0.084` and the next says `0.0842` reads as a mistake even when both are
 * right.
 */
export function formatChartPrice(n: number | undefined | null, decimals: number): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatQty(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (n >= 0.001) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

/**
 * Convert a raw base-unit token amount to an exact decimal string.
 *
 * ERC-20 `Transfer` logs carry the amount as an integer in the token's smallest
 * unit, and 18-decimal tokens routinely exceed `Number.MAX_SAFE_INTEGER`
 * (9_007_199_254_740_991) — a mere 0.01 of an 18-decimal token is 10^16 base
 * units. Going through `Number` silently rounds those, so this does the whole
 * conversion in string space and loses nothing.
 *
 * Returns the exact decimal (e.g. `"123.456789012345678901"`), with trailing
 * fractional zeros trimmed and no exponent notation. The result stays exact, so
 * callers that only need an approximate value (a USD estimate, a compact
 * display figure) can convert at the very end and be explicit about it.
 */
export function formatTokenAmount(raw: string | bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) return "—";

  const negative = typeof raw === "string" && raw.trim().startsWith("-");
  const digits = (negative ? raw.trim().slice(1) : raw.toString().trim());
  if (!/^\d+$/.test(digits)) return "—";

  // Strip insignificant leading zeros, keeping at least one digit.
  const int = (s: string) => s.replace(/^0+(?=\d)/, "");
  const sign = negative ? "-" : "";

  if (decimals === 0) return sign + int(digits);

  // NB: pad to decimals+1 and slice from the right by explicit index rather
  // than using -decimals. With decimals === 0, `slice(0, -0)` is `slice(0, 0)`
  // and yields an empty integer part.
  const padded = digits.padStart(decimals + 1, "0");
  const cut = padded.length - decimals;
  const integerPart = padded.slice(0, cut);
  const fraction = padded.slice(cut).replace(/0+$/, "");

  return sign + (fraction ? `${int(integerPart)}.${fraction}` : int(integerPart));
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function shortAddr(a: string): string {
  if (!a) return "";
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatCompactNum(n: number | string | undefined | null): string {
  // Accepts an exact decimal string so callers holding a lossless token amount
  // can pass it straight through; the compact form is 3 significant figures, so
  // the narrowing here is far coarser than the precision the string preserves.
  const v = typeof n === "string" ? Number(n) : n;
  if (v == null || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}
