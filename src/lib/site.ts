/**
 * Where this deployment lives.
 *
 * Link previews need absolute URLs, so Next wants a `metadataBase`; that is
 * this. Two other places care about it: the legal test, which scans `src/` for
 * third-party hostnames and must not report our own origin as an unlisted
 * upstream, and the README, which prints the live URL.
 *
 * Self-hosting: set `NEXT_PUBLIC_SITE_URL` at build time, or edit the default.
 * `DEFAULT_SITE_URL` is kept separate because the literal stays in this file
 * either way, so the test has to exempt both.
 */
export const DEFAULT_SITE_URL = "https://trade-ops.vanillalosangeles.workers.dev";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL;
