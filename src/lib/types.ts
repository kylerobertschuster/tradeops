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
   * 24h range, or null when the provider does not supply it. CoinGecko's free
   * tier ignores `include_24hr_high_low` and returns neither field, so the
   * previous `?? usd` fallback set both to the *current price* — producing a
   * zero-width "range" that reads as a remarkable fact rather than as missing
   * data. Null is the honest value, and consumers must handle it.
   */
  high24h: number | null;
  low24h: number | null;
  quoteVolume: number;
};
export type SymbolInfo = {
  symbol: string; // e.g. BTCUSDT
  base: string; // e.g. BTC
  name: string; // e.g. Bitcoin
  cgId?: string; // CoinGecko id (for fallback data)
};

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
