# TradeOps

**Free & open-source on-chain analytics and paper-trading terminal** — a TradingView-style charting experience with a built-in simulated trading account, available to everyone at no cost.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Why TradeOps?

Professional-grade market analytics (Chainalysis, TRM Labs, Nansen, TradingView) are locked behind expensive subscriptions or enterprise contracts. TradeOps rebuilds the core experience — professional charting and hands-on paper trading — as a free, self-hostable, open-source product. No API keys, no accounts, no paywall.

## Features

- **TradingView-style charting** — powered by TradingView's own open-source [Lightweight Charts](https://github.com/tradingview/lightweight-charts). Candlesticks, volume, and overlay indicators.
- **Indicators** — Volume, SMA 20/50, EMA 20/50, Bollinger Bands (20, 2), RSI 14, MACD (12, 26, 9), and VWAP, with 7 timeframes (`1m` → `1w`).
- **Live market data** — multi-provider with automatic failover: Binance → Bybit → Coinbase (candles) and Binance → CoinGecko (tickers). **No API key required.**
- **On-chain analytics** — live whale feed (ERC-20 transfers with an adjustable **≥ $100K / $1M / $5M / $10M** threshold, defaulting to ≥ $1M, across USDC/USDT/DAI/WETH/WBTC/LINK/UNI/AAVE via public RPC, no API key), click-to-inspect any address (inflow/outflow/net + full transfer history), **holder analytics** (top-50 holders per token, concentration share, known-entity names via ENS/verified/tags, total supply, holder count, market cap), and **wallet labeling** (tag addresses as Exchange / Whale / VC / MEV / Exploiter / Contract, persisted locally). One click through to Etherscan for any tx or address.
- **Watchlist & search** — curated top assets in the sidebar plus fuzzy symbol search.
- **Paper trading** — start with a virtual **$100,000**, trade at market with realistic 0.1% taker fees, and track live P&L, open positions, and order history. Persisted locally in your browser.
- **Dark, professional UI** — modeled on TradingView's exact palette.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production build:

```bash
npm run build
npm start
```

### Rate limits

API routes are rate limited per client to protect the free upstream providers
they depend on (see `src/lib/ratelimit.ts`). Responses carry
`X-RateLimit-Limit` / `X-RateLimit-Remaining` headers, and a throttled request
returns `429` with `Retry-After`. Limits are tracked per process, so a
multi-instance deployment effectively enforces `instances × limit`.

## Tech stack

| Layer     | Technology                                              |
| --------- | ------------------------------------------------------- |
| Framework | Next.js 16 (App Router, TypeScript)                     |
| UI        | Tailwind CSS v4                                         |
| Charts    | TradingView Lightweight Charts                          |
| State     | Zustand (persisted paper account)                       |
| Data      | Binance, Bybit, Coinbase, CoinGecko (public, keyless)   |

## Roadmap

- **More indicators** — Fibonacci retracement, Ichimoku, order-flow heatmaps.
- **Accounts & cloud sync** — optional login to sync paper portfolios, labels, and watchlists.
- **Alerts & price notifications.**

## Disclaimer

TradeOps is for **education and research only**. Market data is provided by third-party public APIs and may be delayed or inaccurate. Paper trading uses simulated funds — nothing here is financial advice, and no real assets are involved.

## License

MIT — free to use, modify, and self-host. See [LICENSE](./LICENSE).
