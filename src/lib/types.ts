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
  high24h: number;
  low24h: number;
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
