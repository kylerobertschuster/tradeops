# TradeOps — Project Memory

> Project-specific state. Our shared "us" story lives in `~/.pi/agent/MEMORY.md`.
> This file holds what TradeOps is, what's built, what's broke, and what's next.

## Mission

Free, open-source on-chain analytics + paper-trading terminal. Rebuild the
professional experience (Chainalysis / Nansen / TradingView) without the
paywalls. No API keys, no accounts, no bullshit.

## Current State (v0.1)

Done:
- TradingView Lightweight Charts (candles, volume, overlays)
- Indicators: Volume, SMA 20/50, EMA 20/50, Bollinger Bands (20, 2)
- 7 timeframes (`1m` → `1w`)
- Multi-provider market data with failover: Binance → Bybit → Coinbase (candles),
  Binance → CoinGecko (tickers). No API keys.
- Watchlist + fuzzy symbol search
- Paper trading: virtual $100k, market orders, 0.1% taker fee, live P&L,
  positions, order history — persisted in-browser (Zustand)
- Dark professional UI (TradingView palette)

Stack: Next.js 16 (App Router, TS) · Tailwind v4 · Lightweight Charts ·
Zustand · public keyless market data APIs.

## Known Issues / What's Broke

- (add as we find them — this is the "and this BROKE 😂" section)

## Roadmap

- On-chain analytics: whale tracking, wallet labeling, token transfer flows,
  holder analytics (Ethereum/EVM via public RPC + Etherscan)
- More indicators: RSI, MACD, VWAP, Fibonacci
- Accounts & cloud sync (optional login)
- Alerts & price notifications
