# TradeOps — Project Memory

> Project-specific state. Our shared "us" story lives in `~/.pi/agent/MEMORY.md`.
> This file holds what TradeOps is, what's built, what's broke, and what's next.

## Mission

Free, open-source on-chain analytics + paper-trading terminal. Rebuild the
professional experience (Chainalysis / Nansen / TradingView) without the
paywalls. No API keys, no accounts, no bullshit.

## Current State (v0.8.x — launch-ready)

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
- **Multi-chart layouts (2026-09-18).** 1 / 2 / 4 charts in `src/lib/layout.ts`
  + `src/store/layout.ts`, each chart keeping its own pair and timeframe. The
  chart you click is the one the toolbar, search, watchlist and order ticket act
  on; collapsing 4 → 1 → 4 returns the charts it hid, because the state always
  holds `SLOT_COUNT` slots whether or not they are on screen. Cost: the venue
  fan-out is the only request that is not per-chart, so it belongs to the
  focused chart, and the others refresh history at `EXTRA_PANE_MS` (120s) and
  say where the table went instead of showing it. Four charts come to 6,480
  requests/day, **under** the 13,680 single-chart ceiling. `tradeops-layout-v1`
  joined `BROWSER_STORAGE_KEYS`, and the privacy page's hard-coded "two things"
  became a sentence with no count in it — the list below it is the list.
- **Market view (2026-09-20).** Every market on one chart, which is the one
  question a multi-chart layout cannot answer: two charts have two price axes.
  `src/lib/overview.ts` rebases each series to percent change from the window's
  first close — the first point is exactly 0 by construction, and the vertical
  axis stops being price and becomes "how far from where this window started".
  The legend is ordered best-first and doubles as a heat strip: a swatch for
  identity, a bar whose side and length is the move on one shared scale, and the
  number printed beside it, so a reader who cannot separate the colours still
  gets every figure. Above it sits the market's breadth — how many up, how many
  down, the median, the leader, the laggard. Windows are 1D (96 × 15m), 1W
  (168 × 1h) and 1M (30 × 1d); the watchlist is the default set and "All
  markets" draws all 55 pairs. Candle history is read by the browser straight
  from `data-api.binance.vision` (`fetchOverviewCandles` in `api.ts`), because
  one page view of twenty-four markets would otherwise be twenty-four
  subrequests on the tightest limit there is — so the view spends **zero Worker
  requests**. `OVERVIEW_MS` (300s) lives in `polling.ts` and is deliberately
  *not* in `POLL_MS`; `polling.test.ts` asserts that exclusion, so the cost of
  one chart cannot quietly absorb a request nothing ever sends. `view:
  "charts" | "market"` joined the persisted layout state under the same
  `tradeops-layout-v1` key, sanitized like every other stored field (unknown or
  missing opens on charts, and a stored layout that is intact survives
  round-trip — including its view). A market whose read fails keeps the previous
  series and is reported `stale`; one that has never answered is `missing`, is
  excluded from the counts, and is named in the footer rather than drawn as
  flat. The privacy page's "the one connection your browser makes directly"
  became two, because that is what is true now.
- **Hosted-deploy truth fixes (2026-09-18, `7568187`).** Binance.US joins as a
  venue row *and* a candle provider, because Cloudflare's egress gets 403/451 from
  Binance and 403 from Bybit; hard refusals are remembered per host for ten
  minutes so dead round trips are not repaid on every cache miss. BlockScout
  holders are now fetched by *the browser* (its limit is per IP; a Worker's egress
  is shared and permanently 429), with `/api/holders` as fallback answering 503 +
  `Retry-After`. Chart price-axis digits now follow the visible range (PEPE read
  `0.00`, DOGE could not be labelled finer than a cent). Link previews are real
  (`og.png` + `metadataBase`). Two silent bugs fixed: **UNI's contract address was
  one character off** — not a contract at all, 404 from BlockScout and zero
  `eth_getLogs` results — and the token list moved to `src/lib/tokens.ts` so the
  browser can use it without pulling in the market layer.
- **Legal pages, attribution, donations (2026-09-14/18, `6d48d70` + `33450ad`).**
  `/legal` with terms (15 sections), privacy (held to the code by tests) and a
  sources page rendered from `SOURCES`; a test fails the build if any hostname in
  `src/` is unaccounted for. Donations (Buy Me a Coffee + GitHub Sponsors) sit
  behind `SUPPORT_LINKS` in `src/lib/legal.ts` — **empty renders nothing anywhere**,
  and terms section 8 says "this deployment accepts no donations" in that state.
  Still unset: `GOVERNING_LAW` (the operator's one-liner, and the terms page says
  so) and the two donation accounts, neither of which exists yet.
- TradingView Lightweight Charts (candles, volume, overlays)
- Indicators: Volume, SMA 20/50, EMA 20/50, Bollinger Bands (20, 2),
  RSI 14, MACD (12, 26, 9), VWAP
- 8 timeframes (`1s` → `1w`)
- Multi-provider market data with failover: Binance → Binance.US → Bybit →
  Coinbase (candles), Binance → OKX → Crypto.com → Coinbase (24h stats). No API
  keys. **CoinGecko was removed** in the compliance sweep: strictest terms of any
  dependency (mandatory attribution, no redistribution, an indemnity clause) for
  the fourth-choice ticker fallback. Crypto.com's bulk endpoint replaced it in one
  subrequest and brings real 24h high/low, which CoinGecko's free tier omitted.
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
  error reporting, shared-store rate limiting, honest labelling of client-side
  P&L. **Legal + attribution pages are done** (2026-09-18), and CoinGecko — the
  strictest and least useful dependency — is gone. (BigInt-safe token math and
  honest transfer timestamps are done.)
- **Next features, in the order they were chosen:**
  1. Multi-chart layouts (2×2 panes) + unlimited indicators per chart. **Done
     2026-09-18** — the panes landed; unlimited indicators were already there
     (all nine toggles run at once).
  2. Market view — every market on one chart, rebased to percent change. **Done
     2026-09-20** (shipped with the layout work, since both are answers to "how
     much market do you want on screen"). Still to come on top of it, in the
     order the operator asked for them: a **colour-by-strength** mode that
     recolours the lines by their move against the median (identity moves to
     hover and legend order), then a **markets grid** — squares sorted by
     change, sized by volume — which is the real heatmap and needs no chart
     library.
  3. "Projected outcomes", in the only form that does not invent a number: base
     rates counted from the candles ("closed ≥ +2% within 24h on 9 of 30
     days"), scenario arithmetic ("+6.4% to the window high, −3.1% to the
     low"), and the position maths the paper engine already has every input for
     — distance to liquidation, break-even after fees. **No forecasts**: a
     prediction is not data, and this app prints nothing it cannot source. The
     path to real ones is to record what the app said and score it later, which
     needs the backtest first.
  4. Bar replay + backtest against the existing paper engine.
  5. Alerts — client-side first, then Workers Cron + KV so they fire with no
     tab open, and that is the single upgrade TradingView charges $59.95/mo for.
  6. History depth: 500 → 5,000 bars via Binance pagination.
- `FEATURES.md`: the honest "the $59.95/month feature list, free" page, linked
  from the README. TradingView's own pricing page is the source for their limits
  (Basic: 1 chart/tab, 2 indicators, 5,000 bars, 3 alerts expiring ~30 days,
  ads). Keep the "what they still do better" column — we cannot do equities or
  options real-time, have no community scripts or screeners, and no
  desktop/mobile apps. Note that 110+ drawing tools and Pine Script **are** free
  on their Basic plan, so those are parity work, not a wedge.
- Also open: measure the Workerd subrequest and CPU budgets (above). Every chart
  opens its own websocket to Binance — free in Worker terms, since it never
  reaches Cloudflare, but it is four sockets in a four-chart tab, so a shared
  per-tab feed is the obvious cleanup if that ever becomes the thing that hurts.
  The attribution/ToS page is done (`/legal/sources`), but **the upstream terms are
  still unread** for Binance (202 bot challenge), Coinbase (403) and Kraken
  (JS-rendered) — those clauses are unverified and must not be quoted as fact.
  Redistributing exchange market data is the biggest unaddressed launch risk; the
  realistic outcome of a complaint is an email or an IP block, not a court.
- More indicators: Fibonacci, Ichimoku, order-flow heatmaps.
- Accounts & cloud sync (optional login) — sync portfolios, labels, watchlists.
