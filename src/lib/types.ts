export type Candle = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Ticker = {
  symbol: string;
  base: string;
  price: number;
  change24h: number; // percent
  /**
   * 24h range, or null when the provider does not supply it.
   *
   * This was once coalesced to the current price, which produced a zero-width
   * "range" that read as a remarkable market fact rather than as missing data.
   * Null is the honest value and consumers must handle it. Binance and
   * Crypto.com both supply a real range today, so no provider currently
   * exercises the null path — which is exactly why it needs a test rather than
   * an assumption.
   */
  high24h: number | null;
  low24h: number | null;
  quoteVolume: number;
};
export type SymbolInfo = {
  symbol: string; // e.g. BTCUSDT
  base: string; // e.g. BTC
  name: string; // e.g. Bitcoin
};

export type Interval = "1s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export const INTERVALS: Interval[] = ["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"];
