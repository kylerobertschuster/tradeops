# TradeOps — Project Memory

> Project-specific state. Our shared "us" story lives in `~/.pi/agent/MEMORY.md`.
> This file holds what TradeOps is, what's built, what's broke, and what's next.

## Mission

Free, open-source on-chain analytics + paper-trading terminal. Rebuild the
professional experience (Chainalysis / Nansen / TradingView) without the
paywalls. No API keys, no accounts, no bullshit.

## Current State (v0.5 — launch-ready hardening)

Done:

- TradingView Lightweight Charts (candles, volume, overlays)
- Indicators: Volume, SMA 20/50, EMA 20/50, Bollinger Bands (20, 2),
  RSI 14, MACD (12, 26, 9), VWAP
- 7 timeframes (`1m` → `1w`)
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
  - **83 Vitest tests** on the pure logic (`indicators`, `format`, `ratelimit`,
    `symbols`) — hand-verified against Wilder's canonical RSI series rather
    than snapshotted from our own output.
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
polling entirely, and the cadences are 15s/30s/30s/120s. Measured in a real
browser: 3 requests per 36 s in a foreground tab, **0 while hidden**, and one
refresh per endpoint on return. That is ~12,200/day worst case (~8,600 for the
default view), so roughly eight always-open tabs on the free tier.
`polling.test.ts` fails if the cadences are shortened past that budget.

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
- **P2:** deploy guide — Cloudflare Workers done, Docker/self-host still to do;
  ToS + attribution page, error reporting, shared-store rate limiting, honest
  labelling of client-side P&L. (BigInt-safe token math and honest transfer
  timestamps are done.)
- More indicators: Fibonacci, Ichimoku, order-flow heatmaps.
- Accounts & cloud sync (optional login) — sync portfolios, labels, watchlists.
- Alerts & price notifications.
