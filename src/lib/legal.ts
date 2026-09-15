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
export const LAST_UPDATED = "2026-09-14";

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
    purpose: "Candlestick history, 24h stats, and the live price stream.",
    hosts: ["data-api.binance.vision", "api.binance.com", "data-stream.binance.vision"],
    site: "https://www.binance.com/",
    terms: null,
    direct: true,
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
 * Hosts that are allowed to appear in `src/` without being a data source.
 *
 * The project's own site and store links, which fetch nothing. Anything else
 * has to be listed in `SOURCES` and therefore described on the sources page.
 */
export const LINK_ONLY_HOSTS: readonly string[] = ["github.com"];
