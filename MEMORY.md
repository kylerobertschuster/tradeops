# TradeOps — Project Memory

> Project-specific state. Our shared "us" story lives in `~/.pi/agent/MEMORY.md`.
> This file holds what TradeOps is, what's built, what's broke, and what's next.

## Mission

Free, open-source on-chain analytics + paper-trading terminal. Rebuild the
professional experience (Chainalysis / Nansen / TradingView) without the
paywalls. No API keys, no accounts, no bullshit.

## Current State (v0.6 — multi-venue comparison)

Done:

- **Multi-venue comparison (2026-09-14, tag `v0.6.0`).** All six venues' own
  numbers side by side, nothing averaged: a strip under the chart (pair, last,
  24h %, 24h range, 24h vol, deviation from median in bps, per-venue source
  status) plus a `Candles | Compare` toggle that overlays every venue's close
  rebased to percentage change via `PriceScaleMode.Percentage`. Spread is
  labelled **last-price spread**, never "arbitrage" — these are candle closes,
  not executable quotes. Binance · Coinbase · Kraken · OKX · Crypto.com report;
  Bybit renders as region-blocked (Cloudflare 403 from US egress, see below).
  One browser request (`/api/venues`) fans out to 12 subrequests in parallel at
  a 60s cadence, so the request budget is unchanged. `VenueFault` is a closed
  set — `unsupported-interval | unlisted | delisted | blocked | rate-limited |
  timeout | unreachable | empty` — because "not listed here" and "we could not
  reach this venue" are different claims.
- TradingView Lightweight Charts (candles, volume, overlays)
- Indicators: Volume, SMA 20/50, EMA 20/50, Bollinger Bands (20, 2),
  RSI 14, MACD (12, 26, 9), VWAP
- 8 timeframes (`1s` → `1w`)
- Multi-provider market data with failover: Binance → Bybit → Coinbase (candles),
  Binance → CoinGecko (tickers). No API keys.
- Watchlist + fuzzy symbol search
- Paper trading: virtual $100k, market orders, 0.1% taker fee, live P&L,
  positions, order history — persisted in-browser (Zustand)
- **On-chain tab in the right panel:** live whale feed (ERC-20 transfers
  ≥ $100K threshold filter), click-through address inspector (inflow/outflow/net
  - transfer history), wallet labeling (Exchange/Whale/VC/MEV/Exploiter/Contract,
    persisted), Etherscan deep links for tx + address
- **Holder analytics (same tab, "Holders" view):** top-50 holders per tracked
  token (USDC/USDT/DAI/WETH/WBTC/LINK/UNI/AAVE) via BlockScout's keyless API —
  concentration bar (top-10 / #11–50 / rest), share %, known-entity names
  (ENS / verified name / public tag), total supply, holder count, market cap,
  price. Click a holder → same address inspector.
- Dark professional UI (TradingView palette)
- **P0 market-readiness hardening (2026-09-12):** Next 16.3.1 → 16.3.5 (patched
  two unauthenticated RCEs; `npm audit` now 0 vulns), all lint errors cleared,
  every third-party fetch bounded by a deadline + shared chain budget
  (`lib/http.ts`), and API routes rate limited via `src/proxy.ts`
  (Next 16's `middleware.ts` replacement) backed by `lib/ratelimit.ts`.
- **P1 launch hardening (2026-09-12):**
  - **Security headers** in `next.config.ts` — CSP, HSTS, X-Frame-Options,
    nosniff, Referrer-Policy, Permissions-Policy.
  - **186 Vitest tests** on the pure logic (`indicators`, `format`, `ratelimit`,
    `symbols`, `venues`, `polling`) — hand-verified against Wilder's canonical
    RSI series rather than snapshotted from our own output.
  - **CI** (`.github/workflows/ci.yml`): lint + `tsc` + test + build on every
    push, plus a blocking `npm audit --audit-level=high` job.
  - **Responsive layout.** One DOM tree; below `lg` the three columns become
    mutually exclusive panes behind a bottom tab bar, at `lg`+ the desktop
    three-column terminal is unchanged. Verified in headless Chromium under
    mobile emulation at 320/390/414/768/1440px across every pane and every
    right-panel sub-tab.
  - `package.json` 0.1.0 → 0.4.0, `engines.node >= 20.9.0`, `.nvmrc` = 22.

Stack: Next.js 16 (App Router, TS) · Tailwind v4 · Lightweight Charts ·
Zustand · public keyless market data APIs + public Ethereum RPC.

## Hosting

Deploys to **Cloudflare Workers** through `@opennextjs/cloudflare`
(`npm run deploy`). Chosen because commercial use is allowed on both the Free
and Paid plans, unlike Vercel Hobby, which is non-commercial only — and because
Workers Paid is $5/mo against Vercel Pro's $20. Netlify's free tier does permit
commercial use, but its adapter does not yet confirm Next 16 support.

Verified under `wrangler dev`, not assumed:

- `opennextjs-cloudflare build` succeeds on Next 16.3.5. The adapter requires
  `next >=16.3.3`, which is the real reason the earlier 16.3.1 → 16.3.5 bump
  mattered.
- The CSP and other security headers from `next.config.ts` survive intact.
- The `proxy.ts` rate limiter works on Workers even though middleware is an
  experimental path: 30 requests, then `429`.
- `/api/klines`, `/api/whales`, `/api/holders`, `/api/symbols` all return live
  data under workerd, so `AbortSignal.any` and `nodejs_compat` are fine.
- The bundle is 14.5 MB uncompressed against a 64 MiB limit; Cloudflare no
  longer imposes a compressed-size limit.

Request volume, not CPU, is the binding constraint. Workers Free allows 100,000
requests/day and **counts cache hits as requests** — Cloudflare spares them only
the CPU time — so edge caching cannot buy back quota. The only lever is how many
requests the browser makes, hence `src/lib/polling.ts`: a hidden tab stops
polling entirely, and the cadences are 15s/30s/30s/120s/60s. Measured in a real
browser: 3 requests per 36 s in a foreground tab, **0 while hidden**, and one
refresh per endpoint on return. Derived worst case, with every endpoint polled
over REST, is 13,680/day — about seven always-open tabs; while the websocket is
live it is ~4,300/day for the default view (`/api/klines` 30s +
`/api/venues` 60s). `polling.test.ts` pins the cost per tab (≤ 14,000/day) and a
floor of six concurrent tabs.

That guard used to assert `>= 8` tabs, and it was fooling us: the budget covers
8.17 tabs with no venue endpoint at all, so it passed by 2% and any fifth polled
endpoint was going to break it. No cadence choice could have saved it — the
venue fan-out on a 3-minute poll still only reaches 7.86. Hence pinning
cost-per-tab, which is the contract that actually matters, instead of a
tab count that was never true.

`/api/venues` is one inbound request fanning out to 12 upstream subrequests in
parallel. Those are billed as subrequests, not as Worker requests, so the
browser-facing budget is unaffected. Cloudflare's documented subrequest cap is
at least 50 even on the Free plan, so 12 has room, but no Workerd invocation
limit has been measured yet — that is the next thing to check, together with the
Free plan's per-invocation CPU budget, since parsing several hundred JSON bars
per venue is the real CPU load in this app.

Two caveats worth remembering. Workers middleware is documented as experimental
and unofficially maintained, so the rate limiter there is best-effort rather
than a security boundary. And `@opennextjs/cloudflare` imports `esbuild`
without declaring it as a dependency, which breaks the build whenever npm
declines to hoist it — which is exactly what happens here, since `wrangler` and
`@opennextjs/aws` pin different esbuild versions. `esbuild` is pinned as a
devDependency as a workaround.

## Known Issues / What's Broke

Nothing currently failing: `tsc`, `eslint` and `next build` are all clean.

Still-open **readiness gaps** (audited 2026-09-12, none of these block local
development):

- **Wrong numbers on-chain.** `onchain.ts` prices a ~15-block-old transfer at the
  *current* ticker price, infers `time` from `Date.now() - (latest-block)*12000`,
  and uses `Number(value) / 10 ** decimals` (loses precision on 18-decimal
  tokens; needs BigInt/string math). Arguably the most user-visible remaining
  defect — the app is confident and wrong.
- **Rate limiting is per-process.** Effective limit is `instances × limit` on a
  multi-instance deploy; a durable limit needs a shared store (Upstash/Redis)
  behind the existing `checkRateLimit` interface. In-memory caches
  (`feedCache`, holders `cache`) have the same per-instance caveat, so real
  upstream load is higher than anything we have tested.
- **No observability** — no error reporting, analytics, or health check.
- **No deploy guide, ToS/privacy, or upstream data attribution** despite
  "self-hostable" being the pitch and Binance/CoinGecko/BlockScout having
  attribution + rate terms. The public RPCs in `onchain.ts` explicitly forbid
  production/high-volume use.
- Paper trading is localStorage-only and trivially forgeable; P&L is client-side.
- Missing OSS hygiene: CONTRIBUTING, CODE_OF_CONDUCT, issue templates,
  sitemap/robots/OG image.

Note on the remaining CSP weakness: `script-src` still allows `'unsafe-inline'`,
required by Next's inline bootstrap/hydration scripts. A nonce-based policy would
force dynamic rendering on every page. The policy still pins `connect-src` to
`'self'` and blocks object/base/frame abuse.

## Roadmap

Launch readiness first, then features:

- **P0 — done:** patched deps, lint, fetch deadlines, rate limiting.
- **P1 — done:** security headers, Vitest + CI, mobile layout.
- **P2 — done:** multi-venue comparison (v0.6.0).
- **P3:** deploy guide — Cloudflare Workers done, Docker/self-host still to do;
  ToS + attribution page, error reporting, shared-store rate limiting, honest
  labelling of client-side P&L. (BigInt-safe token math and honest transfer
  timestamps are done.)
- **Next features, in the order they were chosen:**
  1. Multi-chart layouts (2×2 panes) + unlimited indicators per chart.
  2. Bar replay + backtest against the existing paper engine.
  3. Alerts — client-side first, then Workers Cron + KV so they fire with no
     tab open, and that is the single upgrade TradingView charges $59.95/mo for.
  4. History depth: 500 → 5,000 bars via Binance pagination.
- `FEATURES.md`: the honest "the $59.95/month feature list, free" page, linked
  from the README. TradingView's own pricing page is the source for their limits
  (Basic: 1 chart/tab, 2 indicators, 5,000 bars, 3 alerts expiring ~30 days,
  ads). Keep the "what they still do better" column — we cannot do equities or
  options real-time, have no community scripts or screeners, and no
  desktop/mobile apps. Note that 110+ drawing tools and Pine Script **are** free
  on their Basic plan, so those are parity work, not a wedge.
- Also open: measure the Workerd subrequest and CPU budgets (above), and an
  upstream attribution/ToS page — Binance, CoinGecko, Coinbase, Kraken, OKX and
  Crypto.com all have attribution or rate terms and the public RPCs forbid
  production use. This is the biggest unaddressed risk to a public launch.
- More indicators: Fibonacci, Ichimoku, order-flow heatmaps.
- Accounts & cloud sync (optional login) — sync portfolios, labels, watchlists.
