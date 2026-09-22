import type { NextConfig } from "next";

/**
 * Content-Security-Policy notes.
 *
 * `script-src` needs `'unsafe-inline'` because Next.js emits an inline
 * bootstrap/hydration script. Removing it requires nonce-based CSP (issued per
 * request from `proxy.ts`), which forces dynamic rendering for every page —
 * not worth trading away static generation for this app yet.
 *
 * Even with that allowance the policy earns its keep: it pins `connect-src` to
 * our own origin plus the hosts the browser is told to call, and blocks plugin
 * content, base-tag hijacking, and framing.
 *
 * That allowlist is the one directive that is easy to get wrong, because it is
 * *enforced by the browser* and not by any code path we can see: a fetch to an
 * origin missing here fails at runtime with a console error and nothing else.
 * It happened twice — the market view's candle host and BlockScout both went
 * missing, and the latter hid behind a server fallback for two days. So
 * `src/lib/csp.test.ts` now reads this policy and asserts it allows every
 * origin the client modules call, which is the version of this comment that
 * fails a build instead of a page.
 */
const isDev = process.env.NODE_ENV !== "production";

/**
 * React calls `eval()` in development to reconstruct callstacks across
 * environments, and refuses to start without it — so a policy that omits
 * `'unsafe-eval'` silently prevents hydration in `next dev`, leaving a page
 * that renders from the server and then does nothing. Production never uses
 * `eval()`, so this allowance is scoped to development only.
 */
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const CSP = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  // next/font self-hosts its files, so no external font origins are needed.
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  // Our own API routes, plus every origin the browser calls itself. Live prices
  // and candles stream from the exchange straight to the browser, so they cost
  // nothing against the Worker's request quota — and the market view reads its
  // twenty-four markets from the REST host for the same reason. Without an
  // origin here the fetch is refused and whatever asked for it degrades
  // silently, so `src/lib/csp.test.ts` pins this list against the constants the
  // client modules export.
  "connect-src 'self' wss://data-stream.binance.vision https://data-api.binance.vision https://eth.blockscout.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  // Ignored by browsers over plain HTTP, so this is safe in local dev too.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
