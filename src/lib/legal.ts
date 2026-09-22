/**
 * The facts behind the `/legal` pages, in one place.
 *
 * Everything here is either (a) a claim the code can be checked against, or
 * (b) a detail that belongs to whoever runs the deployment rather than to the
 * template. Keeping them in a module rather than inline in the pages is what
 * lets `legal.test.ts` hold the pages to the code: the source list below is the
 * same list the tests use to decide whether some new third-party host is
 * allowed to exist in this codebase.
 *
 * Nothing here is legal advice, and this file is not a substitute for a lawyer.
 * See the closing section of the terms page.
 */

/** Where the project lives. Contact is deliberately the public issue tracker. */
export const REPO_URL = "https://github.com/kylerobertschuster/tradeops";
export const ISSUES_URL = `${REPO_URL}/issues`;

/**
 * Date the wording of the `/legal` pages last changed.
 *
 * The terms say that continued use after a change means acceptance, which is
 * only an honest sentence if this date moves when the wording does.
 */
export const LAST_UPDATED = "2026-09-18";

/**
 * The law the terms are read under.
 *
 * Deliberately unset, and deliberately visible. Choosing a jurisdiction is a
 * decision about who the operator is and where they can be sued; a template
 * cannot make it on their behalf, and an invented jurisdiction is worse than a
 * plainly missing one. While this is `null` the terms page says so instead of
 * bluffing.
 */
export const GOVERNING_LAW: string | null = null;

/**
 * Where someone who wants to fund the project can do it.
 *
 * A link is listed only after its page has been fetched and has answered,
 * because a link whose page does not exist is worse than no link at all:
 * listing an address nobody has published yet is the same class of lie as
 * inventing a jurisdiction. `npm run check:support` is the fetching half of that
 * rule — it probes this list and the addresses the deployment intends to use,
 * and prints a paste-ready array of the links that resolved.
 *
 * If this list is ever emptied, the site stays honest rather than gaping. The
 * support section of the legal index still renders, so a reader looking for a
 * way to give finds the answer instead of a hole: it says this deployment
 * accepts no donations, the same sentence section 8 of the terms uses in the
 * same state. The top bar's Support link is the one piece that does disappear,
 * because a link carried on every screen has to lead somewhere worth going.
 *
 * This repository is also a template that other people run, and a funding link
 * belongs to whoever pays the hosting bill rather than to the code: a fork
 * should replace these with its own handles rather than inherit someone else's.
 *
 * Two rules apply to anything added here, and `legal.test.ts` enforces both:
 * the address is https, and its host is in `LINK_ONLY_HOSTS` below, because a
 * reader follows this link and the app never fetches it. It should never point
 * at a route in this app: payment details are collected by the platform, on
 * the platform's own site, and no code in this repository receives them.
 */
export type SupportLink = {
  name: string;
  url: string;
  /** One line beside the link, so a reader knows what they are being asked for. */
  note: string;
};

export const SUPPORT_LINKS: readonly SupportLink[] = [
  {
    name: "Buy Me a Coffee",
    url: "https://buymeacoffee.com/kylerobertschuster",
    // "No account required" is Buy Me a Coffee's own published statement about
    // its one-time flow, not an assumption about it. Their knowledge base puts
    // it four ways: "Send one-time support with no sign-up required", "One-time
    // support can be sent without creating an account", "no account needed",
    // and "No login required for one-time support". An account is needed only to
    // join a membership — which is why the note says "one-off" rather than a
    // bare "no account", and why the claim survives a reader landing on a page
    // that also offers memberships. Checked against the live checkout 2026-09-22.
    note: "One-off, no account required.",
  },
];

/**
 * Everything this app persists in the user's browser, and nothing else.
 *
 * The privacy page renders this list and `legal.test.ts` checks it against the
 * zustand stores, so the page cannot claim a key that no longer exists or miss
 * one that was added. There is no server-side store at all.
 */
export const BROWSER_STORAGE_KEYS: readonly { key: string; holds: string }[] = [
  {
    key: "tradeops-paper-v1",
    holds: "Your paper-trading account — cash, positions and filled orders.",
  },
  {
    key: "tradeops-labels-v1",
    holds: "Names you have given to on-chain addresses, so they read as labels next time.",
  },
  {
    key: "tradeops-layout-v1",
    holds:
      "Your chart layout — how many charts you had open, and which pair and timeframe each one showed.",
  },
];

/** A third party whose data or pages this app puts in front of you. */
export type DataSource = {
  name: string;
  /** What we take from it, in one line, in plain words. */
  purpose: string;
  /**
   * Hosts this source is actually contacted at, as they appear in the code.
   *
   * These are fetch targets, not just links: `legal.test.ts` requires every
   * absolute URL hostname in `src/` to appear somewhere in this list, so a new
   * upstream cannot be added without showing up on the sources page.
   */
  hosts: readonly string[];
  /** Human-facing homepage. */
  site: string;
  /**
   * Terms of use, where we could confirm the URL resolves.
   *
   * `null` means exactly that: not confirmed. Binance and Coinbase both answer
   * automated requests with a bot challenge rather than the document, so the
   * URL could not be read and is not guessed at here. Their terms still apply —
   * this field records what we were able to check, not what governs.
   */
  terms: string | null;
  /** True when the user's browser contacts this source directly. */
  direct?: boolean;
};

/**
 * The complete upstream list.
 *
 * Ordered the way the app leans on them, not by importance — exchanges first,
 * then the on-chain side, then the nodes underneath it.
 */
export const SOURCES: readonly DataSource[] = [
  {
    name: "Binance",
    purpose:
      "Candlestick history (the market view reads this one from your browser), 24h stats, and the live price stream.",
    hosts: ["data-api.binance.vision", "api.binance.com", "data-stream.binance.vision"],
    site: "https://www.binance.com/",
    terms: null,
    direct: true,
  },
  {
    name: "Binance.US",
    // A separate entry from Binance because it is a separate order book, not a
    // mirror: the chart names whichever one served it and the venue table
    // gives each its own row, so a single merged listing would misdescribe
    // both. It is also the only Binance-family endpoint the hosted Cloudflare
    // Worker can reach — Binance answers its egress with 403 and 451 — so on
    // the live demo this is the Binance row that has data.
    purpose: "Candlestick history and 24h stats, from the US-regulated venue.",
    hosts: ["api.binance.us"],
    site: "https://www.binance.us/",
    // Verified reachable (200) for an automated request, unlike Binance's and
    // Coinbase's, which answer a bot challenge.
    terms: "https://www.binance.us/terms-of-use",
  },
  {
    name: "Bybit",
    purpose: "Candlestick history and 24h stats, where the region allows it.",
    hosts: ["api.bybit.com"],
    site: "https://www.bybit.com/",
    terms: "https://www.bybit.com/en/legal",
  },
  {
    name: "OKX",
    purpose: "Candlestick history and 24h stats.",
    hosts: ["www.okx.com"],
    site: "https://www.okx.com/",
    terms: "https://www.okx.com/help/terms-of-service",
  },
  {
    name: "Coinbase",
    purpose: "Candlestick history and 24h stats.",
    hosts: ["api.exchange.coinbase.com"],
    site: "https://www.coinbase.com/",
    terms: null,
  },
  {
    name: "Kraken",
    purpose: "Candlestick history and 24h stats.",
    hosts: ["api.kraken.com"],
    site: "https://www.kraken.com/",
    terms: "https://www.kraken.com/legal",
  },
  {
    name: "Crypto.com",
    purpose: "Candlestick history and 24h stats.",
    hosts: ["api.crypto.com"],
    site: "https://crypto.com/",
    terms: "https://crypto.com/us/legal",
  },
  {
    name: "BlockScout",
    purpose: "Ethereum token transfers, whale activity and holder counts.",
    hosts: ["eth.blockscout.com"],
    site: "https://eth.blockscout.com/",
    terms: "https://docs.blockscout.com/",
  },
  {
    name: "Etherscan",
    purpose:
      "Nothing is fetched from it — labelling a whale or a transaction links out to Etherscan so you can read the original record yourself.",
    hosts: ["etherscan.io"],
    site: "https://etherscan.io/",
    terms: null,
  },
  {
    name: "Allnodes — PublicNode",
    purpose: "Ethereum JSON-RPC: block timestamps and logs. The first node tried.",
    hosts: ["ethereum-rpc.publicnode.com"],
    site: "https://www.allnodes.com/",
    terms: "https://www.allnodes.com/terms",
  },
  {
    name: "dRPC",
    purpose: "Ethereum JSON-RPC. The second node tried.",
    hosts: ["eth.drpc.org"],
    site: "https://drpc.org/",
    terms: null,
  },
  {
    name: "1RPC",
    purpose: "Ethereum JSON-RPC. The third node tried.",
    hosts: ["1rpc.io"],
    site: "https://1rpc.io/",
    terms: null,
  },
  {
    name: "Flashbots",
    purpose: "Ethereum JSON-RPC. The fourth node tried, and the last.",
    hosts: ["rpc.flashbots.net"],
    site: "https://rpc.flashbots.net/",
    terms: "https://www.flashbots.net/terms-of-service",
  },
];

/**
 * The on-chain nodes as a group, so the sources page can say in one sentence
 * that all four are defaults which the operator can replace outright.
 */
export const RPC_SOURCE_NAMES: readonly string[] = [
  "Allnodes — PublicNode",
  "dRPC",
  "1RPC",
  "Flashbots",
];

/**
 * The charting library, and the attribution its licence asks for in return.
 *
 * Lightweight Charts is Apache-2.0 with one condition on top of it: the NOTICE
 * wording below is reproduced in the code, and a link to tradingview.com has to
 * reach the people using the page the charts are on. The library draws that
 * link itself as a mark in the corner of every chart, which is the option the
 * project turns off — a logo sitting on top of the candles is not attribution a
 * reader can act on, and it is the one place on the terminal that would claim a
 * relationship the rest of the app is careful not to claim.
 *
 * So the notice is served here instead, in full, one click from the chart
 * through "Sources & terms". Turning the mark off without this would move the
 * attribution out of the product while leaving it in the repository, which is
 * the version of the change that would actually be wrong.
 *
 * TradingView is not in `SOURCES`: nothing is fetched from them. This is a
 * library licence, not a data feed, and listing them as an upstream would make
 * the sources page less true rather than more.
 */
export const CHART_LIBRARY = {
  name: "TradingView Lightweight Charts™",
  /** The NOTICE file from the library, verbatim but for the copyright glyph. */
  notice: "Copyright (c) 2025 TradingView, Inc.",
  site: "https://www.tradingview.com/",
  source: "https://github.com/tradingview/lightweight-charts",
  licence: "Apache-2.0",
} as const;

/**
 * Hosts that are allowed to appear in `src/` without being a data source.
 *
 * The project's own site and store links, the charting library's, and the two
 * payment platforms a donation can go through — all of them links a reader can
 * follow, none of them fetched. Anything else has to be listed in `SOURCES` and
 * therefore described on the sources page.
 */
export const LINK_ONLY_HOSTS: readonly string[] = [
  "github.com",
  "www.tradingview.com",
  "buymeacoffee.com",
];
