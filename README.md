# TradeOps

**Free & open-source on-chain analytics and paper-trading terminal** — a TradingView-style charting experience with a built-in simulated trading account, available to everyone at no cost.

**Live demo: [trade-ops.vanillalosangeles.workers.dev](https://trade-ops.vanillalosangeles.workers.dev)** — no signup, no API keys, nothing to install.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Why TradeOps?

Professional-grade market analytics (Chainalysis, TRM Labs, Nansen, TradingView) are locked behind expensive subscriptions or enterprise contracts. TradeOps rebuilds the core experience — professional charting and hands-on paper trading — as a free, self-hostable, open-source product. No API keys, no accounts, no paywall.

## Features

- **TradingView-style charting** — powered by TradingView's own open-source [Lightweight Charts](https://github.com/tradingview/lightweight-charts). Candlesticks, volume, and overlay indicators.
- **Indicators** — Volume, SMA 20/50, EMA 20/50, Bollinger Bands (20, 2), RSI 14, MACD (12, 26, 9), and VWAP, with 7 timeframes (`1m` → `1w`).
- **Multi-chart layouts** — one chart, two side by side, or four in a 2×2 grid. Each chart keeps its own pair and timeframe, the one you click is the one the toolbar and watchlist act on, and switching layouts never loses the charts it hides. Extra charts refresh at a slower cadence and leave the venue table to the focused chart, so four charts stay inside the request budget one chart already fits in (see [Fitting inside the free tier](#fitting-inside-the-free-tier)).
- **Live market data** — multi-provider with automatic failover: **Binance → Binance.US → Bybit → Coinbase** for candles and **Binance → OKX → Crypto.com → Coinbase** for 24h stats. A host that refuses this network (HTTP 403/451, which is what Binance and Bybit answer a datacenter IP) is remembered for ten minutes instead of being retried on every request. **No API key required.**
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

## Deployment

### Cloudflare Workers (recommended)

TradeOps deploys to Cloudflare Workers through
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare), which runs the
Next.js server itself on Workers. Commercial use is permitted on both the Free
and Paid plans — unlike some hobby tiers, which restrict free usage to
non-commercial projects.

```bash
npx wrangler login   # once
npm run preview      # build + serve locally under workerd
npm run deploy       # build + publish
```

The Worker is named in `wrangler.jsonc`. If you rename it, update the
`WORKER_SELF_REFERENCE` service binding to match.

`GET /api/health` returns `{ ok: true }` for uptime monitors. It is exempt from
rate limiting so a monitor cannot report a `429` as an outage, and it does no
upstream work so it never spends the request budget below.

#### Fitting inside the free tier

Workers Free allows **100,000 requests/day**, and **a cache hit still counts as
a request** — Cloudflare spares cache hits the CPU time, not the request. Edge
caching therefore cannot buy back any of that budget, so the only lever is how
many requests the browser makes. TradeOps keeps that low deliberately:

| Rule | Effect |
| ---- | ------ |
| Prices stream over a websocket (`src/lib/live.ts`) | Live prices cost **zero** Worker requests |
| REST polling is only a fallback | Ticker polling is skipped entirely while streaming |
| Background tabs stop polling (`src/lib/polling.ts`) | A hidden tab costs nothing |
| Cadences of 15s / 30s / 30s / 120s (fallback only) | Bounds the cost when streaming is unavailable |
| Extra charts refresh history at 120s and skip the venue table | Four charts cost 6,480 requests/day, **less** than one chart's 13,680 ceiling |

The watchlist and the chart connect straight to Binance's public market-data
websocket from the browser. That traffic never reaches the Worker, so it is
free — and it is what makes a **1-second chart** affordable, since polling at
1s would be 86,400 requests/day per open tab.

What remains is the chart's candle history, which is re-fetched every 30s to
recompute indicators. That is roughly **2,900 requests/day** for the default
market/chart view, rising to about **5,800/day** with the on-chain tab open
(`RightPanel` only mounts `OnchainPanel` when that tab is active). A hidden tab
costs nothing.

So the free tier covers on the order of **17 always-open foreground tabs**, or
**34** on the default view — far more when tabs are hidden for part of the day,
as they usually are.

`src/lib/polling.test.ts` fails if a future change shortens these cadences past
that budget, so the hosting arithmetic cannot silently regress.

Beyond that, Workers Paid is **$5/month** including 10M requests and 30M
CPU-milliseconds, then $0.30 per additional million requests — around 27
always-open tabs before any overage.

#### Caveats worth knowing

- **Node.js middleware is experimental on Workers.** The adapter prints a
  warning at build time, and the rate limiter in `src/proxy.ts` runs on that
  path. It works — verified under `wrangler dev`, 30 requests then `429` — but it
  is not a supported code path, so treat it as best-effort rather than a
  security boundary.
- **The rate limiter is per-process**, which on Workers means per-isolate, so
  the effective limit is `isolates × limit`. Durable limiting needs a shared
  store such as Durable Objects or KV.
- **Two venues refuse a datacenter IP, and the venue table says so per row.**
  From Cloudflare's egress, `api.binance.com` answers `451` (restricted
  location) and `data-api.binance.vision` answers `403`; Bybit answers `403`
  from CloudFront. This is a property of the IP range, not of the app — those
  candles load normally from a home connection. Binance.US serves the same USDT
  markets and is reachable, so on the live demo it is the Binance-family row
  carrying data. The alternative, quietly falling back to another exchange
  under a "Binance" label, would misreport which order book the prices came
  from.
- **BlockScout rate-limits by caller IP, and a Worker shares its IP with every
  other Worker.** Holder analytics are therefore fetched by *your browser*
  straight to BlockScout — 180 requests/minute for your own connection — with
  the same-origin `/api/holders` route kept as a fallback for networks
  BlockScout refuses. When the Worker does run out of budget it answers `503`
  with `Retry-After` instead of passing the upstream's error text through.
- `@opennextjs/cloudflare` imports `esbuild` without declaring it as a
  dependency, so it only resolves when npm happens to hoist it to the root.
  `wrangler` and `@opennextjs/aws` pin different esbuild versions, npm declines
  to hoist, and the build dies with `Cannot find package 'esbuild'`. `esbuild`
  is pinned as a devDependency for that reason; drop it once the adapter
  declares its own dependency.

### Any Node host

`npm run build && npm start` serves the standard Next.js server anywhere Node
20.9+ runs. The rate limiter and the upstream caches are in-process, so a single
always-on instance behaves better than a serverless or multi-instance
deployment: limits are enforced exactly, and cached upstream responses survive
between requests instead of dying with each cold start.

## Tech stack

| Layer     | Technology                                              |
| --------- | ------------------------------------------------------- |
| Framework | Next.js 16 (App Router, TypeScript)                     |
| UI        | Tailwind CSS v4                                         |
| Charts    | TradingView Lightweight Charts                          |
| State     | Zustand (persisted paper account)                       |
| Data      | Binance, Binance.US, Bybit, OKX, Kraken, Coinbase, Crypto.com (market data); BlockScout and public Ethereum RPCs (on-chain) — all keyless |

Every upstream the app contacts — what is fetched from it, from where, and under which
terms — is listed at [`/legal/sources`](https://trade-ops.vanillalosangeles.workers.dev/legal/sources),
rendered from `src/lib/legal.ts`. A test fails the build if any hostname appears in `src/`
that is not on that page, so the list cannot quietly fall out of date.

## Roadmap

- **More indicators** — Fibonacci retracement, Ichimoku, order-flow heatmaps.
- **Bar replay & backtesting** — step through history bar by bar, and run a signal against the paper engine over the candles already on screen.
- **Accounts & cloud sync** — optional login to sync paper portfolios, labels, and watchlists.
- **Alerts & price notifications** — client-side first, then a scheduled Worker so they fire without a tab open.

## Support

TradeOps is free and stays free — no ads, no paid tier, no accounts. If you want to fund the
hosted demo anyway, the links live at
[`/legal#support`](https://trade-ops.vanillalosangeles.workers.dev/legal#support):
[GitHub Sponsors](https://github.com/sponsors/kylerobertschuster) and
[Buy Me a Coffee](https://buymeacoffee.com/kylerobertschuster). A donation buys nothing — not a
feature, not priority, not a support promise.

Running your own instance? Funding belongs to the operator, so it is a constant rather than
hard-coded UI: set `SUPPORT_LINKS` in [`src/lib/legal.ts`](./src/lib/legal.ts) and the links appear
in the legal pages' footer and in the terminal's top bar. Keep the list short — it is meant to be
something a reader can find, not something they trip over. Clear it, and nothing renders: no
placeholder, no dead link, and the terms page changes to say the deployment accepts no donations.
This repository ships with the maintainer's own two links set; a fork should replace them.

## Disclaimer

TradeOps is for **education and research only**. Market data is provided by third-party public APIs and may be delayed or inaccurate. Paper trading uses simulated funds — nothing here is financial advice, and no real assets are involved.

## License

MIT — free to use, modify, and self-host. See [LICENSE](./LICENSE).
