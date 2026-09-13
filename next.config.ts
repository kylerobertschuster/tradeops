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
 * our own origin plus the one websocket host, and blocks plugin content,
 * base-tag hijacking, and framing.
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
  // Our own API routes, plus Binance's public market-data websocket. Live
  // prices and candles stream from the exchange straight to the browser, so
  // they cost nothing against the Worker's request quota. Without this origin
  // in the allowlist the socket is refused and the app silently falls back to
  // REST polling.
  "connect-src 'self' wss://data-stream.binance.vision",
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
