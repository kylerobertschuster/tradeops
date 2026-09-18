#!/usr/bin/env node
/**
 * Do the funding links answer?
 *
 * `SUPPORT_LINKS` in `src/lib/legal.ts` is empty until an address has been
 * fetched and has answered, so that a funding link can never be a dead link.
 * This script is the fetching half of that rule: it reads the array, probes
 * every entry, and prints a paste-ready array of the links that resolved.
 *
 * It also probes the addresses this deployment intends to use, so the operator
 * can see the difference between "not configured" and "configured but dead"
 * while the accounts are still being set up.
 *
 * Usage:
 *   npm run check:support                 # report; always exits 0
 *   npm run check:support -- --strict     # exit 1 if a *configured* link is dead
 *
 * Deliberately not wired into `npm run deploy`. A deployment that refuses to
 * ship because a third party's page is down is a deployment you cannot trust to
 * ship, and the honest state — an empty list — is already the safe one.
 */
import { readFileSync } from "node:fs";

const LEGAL_TS = new URL("../src/lib/legal.ts", import.meta.url);

/**
 * The addresses intended for this deployment, probed even while unconfigured.
 *
 * These are the maintainer's handles, not a general truth about the project: a
 * fork should replace them with its own, which is exactly why funding lives in
 * a constant rather than in the code.
 */
const INTENDED = [
  {
    name: "GitHub Sponsors",
    url: "https://github.com/sponsors/kylerobertschuster",
    note: "One-off or monthly, handled by GitHub under GitHub's own terms.",
  },
  {
    name: "Buy Me a Coffee",
    url: "https://buymeacoffee.com/kylerobertschuster",
    note: "One-off, no account required.",
  },
];

const UA = "tradeOPs-support-link-check (+https://trade-ops.vanillalosangeles.workers.dev)";

/**
 * Read `SUPPORT_LINKS` out of the source as text.
 *
 * Parsing rather than importing, because importing a `.ts` module from a `.mjs`
 * script would need a build step for four fields. If the shape of the constant
 * changes enough to break this, it fails loudly instead of reporting an empty
 * list — a checker that silently finds nothing is worse than no checker.
 */
function configuredLinks() {
  const source = readFileSync(LEGAL_TS, "utf8");
  const block = source.match(/export const SUPPORT_LINKS[^=]*=\s*\[([\s\S]*?)\];/);

  if (!block) {
    console.error(
      "Could not find `export const SUPPORT_LINKS` in src/lib/legal.ts.\n" +
        "Read it by hand — this script will not guess.",
    );
    process.exit(2);
  }

  const entries = [
    ...block[1].matchAll(
      /name:\s*"([^"]+)"[\s\S]*?url:\s*"([^"]+)"[\s\S]*?note:\s*"([^"]*)"/g,
    ),
  ].map(([, name, url, note]) => ({ name, url, note }));

  return entries;
}

/** Follow redirects by hand, so a redirect that changes the page's meaning is visible. */
async function probe(url) {
  const hops = [];
  let current = url;

  for (let i = 0; i < 5; i += 1) {
    let response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "text/html" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const reason = error?.cause?.code ?? error?.name ?? String(error);
      return { reached: false, hops, why: `could not reach it (${reason})` };
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      hops.push(`${response.status} → ${current}`);
      continue;
    }

    // Refusing automated checks says nothing about whether a page exists, and
    // guessing would be the same failure this script exists to prevent.
    if (response.status === 403 || response.status === 429) {
      return { reached: true, hops, status: response.status, why: `${response.status}, which refuses automated checks — open it in a browser` };
    }

    if (response.ok) {
      // GitHub sends a Sponsors URL to the plain profile when Sponsors is off,
      // so a 200 is not enough: the destination has to still be the page asked for.
      if (/\/sponsors\//.test(url) && !/\/sponsors\//.test(new URL(current).pathname)) {
        return { reached: true, hops, status: response.status, why: `Sponsors is not enabled: it redirects to ${current}` };
      }
      return { reached: true, hops, status: response.status, why: "answered" };
    }

    return { reached: true, hops, status: response.status, why: `${response.status}` };
  }

  return { reached: true, hops, status: 0, why: "more than five redirects" };
}

/** Line up the name, the address and the verdict so a terminal scan is enough. */
function report(link, result) {
  const mark = result.why === "answered" ? "✓" : "✗";
  console.log(`\n  ${mark} ${link.name}`);
  console.log(`      ${link.url}`);
  for (const hop of result.hops) console.log(`      ${hop}`);
  console.log(`      ${result.why}`);
}

function pasteReady(links) {
  const rows = links
    .map(
      (link) => `  {
    name: ${JSON.stringify(link.name)},
    url: ${JSON.stringify(link.url)},
    note: ${JSON.stringify(link.note)},
  },`,
    )
    .join("\n");

  return `export const SUPPORT_LINKS: readonly SupportLink[] = [\n${rows}\n];`;
}

const strict = process.argv.includes("--strict");
const configured = configuredLinks();
const seen = new Set(configured.map((link) => link.url));
const intended = INTENDED.filter((link) => !seen.has(link.url));

console.log(
  `\nsupport links — configured: ${configured.length}, intended for this deployment: ${intended.length}`,
);

const answered = [];

for (const link of configured) {
  const result = await probe(link.url);
  report(link, result);
  if (result.why === "answered") answered.push(link);
}

for (const link of intended) {
  const result = await probe(link.url);
  report(link, result);
}

const dead = configured.filter((link) => !answered.some((ok) => ok.url === link.url));

console.log("");

if (answered.length > 0) {
  console.log("Paste-ready — only the links that answered:\n");
  console.log(pasteReady(answered));
  console.log("");
}

if (configured.length === 0) {
  console.log(
    "Nothing is configured, which is the safe default: the site says it accepts no donations\n" +
      "rather than offering a link that goes nowhere. Run this again once an account exists and\n" +
      "paste what it prints into SUPPORT_LINKS in src/lib/legal.ts.",
  );
} else if (dead.length > 0) {
  console.log(
    `Configured but unreachable, so currently a dead link on a live page: ${dead
      .map((link) => link.name)
      .join(", ")}.\nReplace them with what this script printed, or empty the list.`,
  );
} else {
  console.log("Every configured link answered.");
}

if (strict && dead.length > 0) {
  console.log("\n--strict: failing because a configured link is dead.");
  process.exit(1);
}
