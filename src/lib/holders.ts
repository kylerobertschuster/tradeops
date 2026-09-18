import { TRACKED_TOKENS } from "./tokens";
import { fetchWithTimeout } from "./http";

/**
 * Holder analytics via BlockScout's public, keyless Ethereum API.
 * Returns top holders + concentration metrics for a tracked token.
 *
 * BlockScout rate-limits by caller IP (180 requests a minute, per its own
 * `x-ratelimit-limit` header) and answers `429 Too many requests` once that
 * budget is gone. That matters for where this runs: a Cloudflare Worker's
 * egress address is shared with every other Worker on the edge, so the hosted
 * deploy has no budget of its own and gets a 429 even on a first, uncached
 * request. `BLOCKSCOUT_BASE` is therefore also called from the browser, where
 * the visitor's own IP brings its own allowance — see `fetchHolders` in api.ts.
 */

export const BLOCKSCOUT_BASE = "https://eth.blockscout.com/api/v2";

type BlockscoutTag = { name: string; tagType: string };

type BlockscoutAddress = {
  hash: string;
  ens_domain_name?: string | null;
  name?: string | null;
  is_contract?: boolean;
  metadata?: { tags?: BlockscoutTag[] };
};

type BlockscoutHolderItem = {
  address: BlockscoutAddress;
  value: string;
};

type BlockscoutToken = {
  symbol: string;
  name: string;
  decimals: string;
  total_supply: string;
  holders_count: string;
  circulating_market_cap: string | null;
  exchange_rate: string | null;
};

export type Holder = {
  address: string;
  balance: number;
  usd: number | null;
  share: number; // percent of total supply
  label?: string; // known entity: ENS / verified name / public tag
  isContract: boolean;
};

export type HolderStats = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  totalSupply: number;
  holderCount: number;
  price: number | null;
  marketCap: number | null;
  top10Share: number;
  top50Share: number;
  holders: Holder[];
};

const cache = new Map<string, { t: number; data: HolderStats }>();

async function getJson(path: string, baseUrl: string): Promise<unknown> {
  const res = await fetchWithTimeout(`${baseUrl}${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    // 429 deserves its own message: it means the caller's IP has spent
    // BlockScout's budget, which is a different situation from a broken
    // endpoint and is the one a visitor is most likely to meet.
    throw new Error(
      res.status === 429 ? "BlockScout rate limit reached" : `BlockScout HTTP ${res.status}`,
    );
  }
  return res.json();
}

function knownLabel(a: BlockscoutAddress): string | undefined {
  if (a.ens_domain_name) return a.ens_domain_name;
  if (a.name) return a.name;
  const tag = a.metadata?.tags?.find((t) => t.tagType === "name");
  return tag?.name;
}

/**
 * The token's name, supply, holder count and top holders.
 *
 * `baseUrl` is a parameter rather than a constant because the browser calls
 * BlockScout directly: rate limits are per IP, and the Worker's IP is a
 * shared, permanently-exhausted one.
 */
export async function fetchHolderStats(
  symbol: string,
  baseUrl: string = BLOCKSCOUT_BASE,
): Promise<HolderStats> {
  const token = TRACKED_TOKENS.find((t) => t.symbol === symbol.toUpperCase());
  if (!token) throw new Error(`Untracked token: ${symbol}`);

  const hit = cache.get(token.address);
  if (hit && Date.now() - hit.t < 60_000) return hit.data;

  const [info, page] = await Promise.all([
    getJson(`/tokens/${token.address}`, baseUrl) as Promise<BlockscoutToken>,
    getJson(`/tokens/${token.address}/holders`, baseUrl) as Promise<{ items: BlockscoutHolderItem[] }>,
  ]);

  const decimals = Number(info.decimals);
  const totalSupply = Number(info.total_supply) / 10 ** decimals;
  const price = info.exchange_rate != null ? Number(info.exchange_rate) : null;

  const holders: Holder[] = page.items.map((it) => {
    const balance = Number(it.value) / 10 ** decimals;
    const share = totalSupply > 0 ? (balance / totalSupply) * 100 : 0;
    return {
      address: it.address.hash.toLowerCase(),
      balance,
      usd: price != null ? balance * price : null,
      share,
      label: knownLabel(it.address),
      isContract: it.address.is_contract ?? false,
    };
  });

  const top10Share = holders.slice(0, 10).reduce((s, h) => s + h.share, 0);
  const top50Share = holders.reduce((s, h) => s + h.share, 0);

  const data: HolderStats = {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    decimals,
    totalSupply,
    holderCount: Number(info.holders_count),
    price,
    marketCap: info.circulating_market_cap != null ? Number(info.circulating_market_cap) : null,
    top10Share,
    top50Share,
    holders,
  };

  cache.set(token.address, { t: Date.now(), data });
  if (cache.size > 20) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return data;
}
