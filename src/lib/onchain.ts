import { fetchTickers, fetchKlines } from "./market";
import { fetchWithTimeout, budgetMs } from "./http";
import { formatTokenAmount } from "./format";
import type { Candle } from "./types";

/**
 * On-chain analytics (Ethereum/EVM) using public JSON-RPC endpoints.
 * No API key required — falls back across providers.
 */

/**
 * Public Ethereum JSON-RPC endpoints, used only by the on-chain panels.
 *
 * These are free, community- and company-run nodes. They are fine for a local
 * run or a light public instance — this app makes a handful of calls a minute,
 * never indexes, and keeps no archive — but they are not a data source to build
 * traffic on, and each operator sets their own terms (see /legal/sources).
 *
 * Point `ETH_RPC_URLS` at your own node before running real traffic: Alchemy,
 * Infura, QuickNode, or `geth`/`reth` on your own hardware. Override with a
 * comma-separated list, tried in order:
 *
 *   ETH_RPC_URLS=https://my-node.example.com,https://backup.example.com
 */
const DEFAULT_RPC_URLS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://1rpc.io/eth",
  "https://rpc.flashbots.net",
];

/**
 * The RPC endpoints to try, most-preferred first.
 *
 * Read on every call rather than captured in a module constant: the value comes
 * from the Worker environment, and a constant would freeze whichever value
 * happened to be present when the isolate was first evaluated.
 *
 * An empty or unusable value falls back to the defaults so a typo cannot leave
 * the chain with nothing to try — but an explicit `off` returns an empty list,
 * which is the one way to stop the app leaning on somebody else's node. The
 * on-chain panels then report themselves unavailable, which is the truth.
 */
export function rpcUrls(): string[] {
  const raw = process.env.ETH_RPC_URLS?.trim();
  if (!raw) return DEFAULT_RPC_URLS;
  if (/^(off|none|false|0)$/i.test(raw)) return [];
  const urls = Array.from(
    new Set(
      raw
        .split(",")
        .map((u) => u.trim())
        // Only absolute HTTP(S): a bare host would be passed to `fetch` as a
        // relative path and fail in a way that looks like the node being down.
        .filter((u) => /^https?:\/\//i.test(u)),
    ),
  );
  return urls.length > 0 ? urls : DEFAULT_RPC_URLS;
}

const TRANSFER_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type RpcLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
};

export type TrackedToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  fixedPrice?: number;
  priceSymbol?: string;
};

export const TRACKED_TOKENS: TrackedToken[] = [
  { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, fixedPrice: 1 },
  { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, fixedPrice: 1 },
  { symbol: "DAI", name: "Dai Stablecoin", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, fixedPrice: 1 },
  { symbol: "WETH", name: "Wrapped Ether", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, priceSymbol: "ETHUSDT" },
  { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, priceSymbol: "BTCUSDT" },
  { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, priceSymbol: "LINKUSDT" },
  { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85c5aF5bf1D1762F925BDADdC4201F984", decimals: 18, priceSymbol: "UNIUSDT" },
  { symbol: "AAVE", name: "Aave", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18, priceSymbol: "AAVEUSDT" },
];

export type WhaleTransfer = {
  symbol: string;
  name: string;
  /**
   * Exact token amount as a decimal string, converted from base units without
   * going through `Number`. Kept lossless because 18-decimal amounts exceed
   * `Number.MAX_SAFE_INTEGER` (0.01 of such a token is already 10^16 base
   * units). Narrow it at the point of display, never before.
   */
  amount: string;
  usd: number;
  from: string;
  to: string;
  txHash: string;
  block: number;
  time: number;
};

/** Per-attempt deadline for a single public RPC node. */
const RPC_ATTEMPT_TIMEOUT_MS = 5_000;

/** Overall budget across all RPC fallbacks before we give up. */
const RPC_CHAIN_BUDGET_MS = 12_000;

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const deadline = Date.now() + RPC_CHAIN_BUDGET_MS;
  let lastErr: unknown;
  for (const url of rpcUrls()) {
    // Stop before starting an attempt we cannot finish within the budget.
    const timeoutMs = budgetMs(deadline, RPC_ATTEMPT_TIMEOUT_MS);
    if (timeoutMs <= 0) break;
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
          cache: "no-store",
        },
        timeoutMs,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { error?: { message?: string }; result?: unknown };
      if (data.error) throw new Error(data.error.message ?? "rpc error");
      return data.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All RPC endpoints failed");
}

async function latestBlock(): Promise<number> {
  const r = (await rpc("eth_blockNumber", [])) as string;
  return parseInt(r, 16);
}

/**
 * Blocks per JSON-RPC batch. Public nodes commonly cap batch size, and a batch
 * that is too large fails outright rather than truncating, so this stays
 * conservative. 100 logged transfers therefore cost 2 round-trips. The
 * 800-block inspector window yields far fewer *unique* blocks than transfers,
 * so in practice it is 1-2 calls regardless.
 */
const RPC_BATCH_SIZE = 50;

/** Fallback transfer age when a block's real timestamp is unavailable. */
function inferredTimeMs(latest: number, block: number): number {
  return Date.now() - (latest - block) * 12_000;
}

/**
 * Resolve block numbers to unix-second timestamps, batched.
 *
 * `eth_getLogs` returns block numbers but never timestamps, so transfer ages
 * used to be *inferred* from an assumed 12s block time. Batching is what makes
 * the real values affordable: one round-trip per 50 blocks instead of one per
 * block.
 *
 * Responses are matched by their `id` and never by array position. JSON-RPC 2.0
 * states that a batch's responses "MAY be returned in any order", so positional
 * matching would silently assign one block's time to another — wrong data
 * rather than an error, which is the worst failure mode available to us.
 *
 * Unresolvable blocks are simply absent from the map and callers fall back to
 * inference, so a batch-hostile provider degrades to the previous behaviour
 * instead of breaking the endpoint.
 */
export async function getBlockTimestamps(blocks: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const unique = Array.from(new Set(blocks)).filter((b) => Number.isInteger(b) && b >= 0);
  if (unique.length === 0) return out;

  const deadline = Date.now() + RPC_CHAIN_BUDGET_MS;
  for (let i = 0; i < unique.length; i += RPC_BATCH_SIZE) {
    const chunk = unique.slice(i, i + RPC_BATCH_SIZE);
    for (const [block, secs] of await timestampBatch(chunk, deadline)) out.set(block, secs);
  }
  return out;
}

async function timestampBatch(blocks: number[], deadline: number): Promise<Map<number, number>> {
  // The block number doubles as the request id, which makes the mapping back
  // from a response unambiguous no matter how the provider orders the array.
  const body = blocks.map((b) => ({
    jsonrpc: "2.0",
    id: b,
    method: "eth_getBlockByNumber",
    params: ["0x" + b.toString(16), false],
  }));

  for (const url of rpcUrls()) {
    const timeoutMs = budgetMs(deadline, RPC_ATTEMPT_TIMEOUT_MS);
    if (timeoutMs <= 0) break;
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        },
        timeoutMs,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) throw new Error("batch response was not an array");

      const found = new Map<number, number>();
      for (const entry of data) {
        const r = entry as { id?: unknown; result?: { timestamp?: unknown } | null };
        const block = typeof r.id === "number" ? r.id : Number(r.id);
        const ts = r.result?.timestamp;
        if (!Number.isInteger(block) || typeof ts !== "string") continue;
        const secs = Number.parseInt(ts, 16);
        if (Number.isFinite(secs) && secs > 0) found.set(block, secs);
      }
      if (found.size > 0) return found;
    } catch {
      // try the next provider
    }
  }
  return new Map();
}

/**
 * Replace inferred transfer times with real block times, in place.
 * Transfers whose block the RPC could not resolve keep the inferred value.
 */
async function applyBlockTimestamps(transfers: WhaleTransfer[]): Promise<void> {
  if (transfers.length === 0) return;
  const times = await getBlockTimestamps(transfers.map((t) => t.block));
  if (times.size === 0) return;
  for (const t of transfers) {
    const real = times.get(t.block);
    if (real != null) t.time = real * 1000;
  }
}

/**
 * Close of the candle covering `t` (unix seconds), or `null` if `t` predates
 * the series. Binary search over candles that must be ascending by time, which
 * every provider guarantees after normalization.
 */
export function priceAtTime(candles: Candle[], t: number): number | null {
  let lo = 0;
  let hi = candles.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found === -1 ? null : candles[found].close;
}

/** 48 x 5m = 4h, comfortably covering the 800-block (~2.7h) inspector window. */
const HISTORICAL_CANDLES = 48;

/**
 * Close-price series for every token that needs a market price, keyed by ticker
 * symbol. Stablecoins are pinned to their peg and skipped. A symbol whose
 * klines cannot be fetched is absent rather than fatal, and the caller falls
 * back to spot for that token alone.
 */
async function historicalPriceSeries(): Promise<Record<string, Candle[]>> {
  const symbols = Array.from(
    new Set(TRACKED_TOKENS.filter((t) => t.priceSymbol).map((t) => t.priceSymbol!)),
  );
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return [symbol, await fetchKlines(symbol, "5m", HISTORICAL_CANDLES)] as const;
      } catch {
        return [symbol, null] as const;
      }
    }),
  );
  const out: Record<string, Candle[]> = {};
  for (const [symbol, candles] of results) {
    if (candles && candles.length > 0) out[symbol] = candles;
  }
  return out;
}

function topicToAddress(topic: string | undefined): string {
  if (!topic) return "0x0000000000000000000000000000000000000000";
  return "0x" + topic.slice(26).toLowerCase();
}

async function tokenPrices(): Promise<Record<string, number>> {
  const symbols = Array.from(
    new Set(TRACKED_TOKENS.filter((t) => t.priceSymbol).map((t) => t.priceSymbol!)),
  );
  const tickers = symbols.length ? await fetchTickers(symbols) : {};
  const out: Record<string, number> = {};
  for (const t of TRACKED_TOKENS) {
    if (t.fixedPrice != null) out[t.symbol] = t.fixedPrice;
    else if (t.priceSymbol && tickers[t.priceSymbol]) out[t.symbol] = tickers[t.priceSymbol].price;
  }
  return out;
}

const feedCache = new Map<string, { t: number; data: WhaleTransfer[] }>();

export async function fetchWhaleTransfers(minUsd: number, blocks = 15): Promise<WhaleTransfer[]> {
  const key = `${minUsd}:${blocks}`;
  const hit = feedCache.get(key);
  if (hit && Date.now() - hit.t < 15000) return hit.data;

  const latest = await latestBlock();
  const fromBlock = Math.max(0, latest - blocks);
  const prices = await tokenPrices();
  const all: WhaleTransfer[] = [];

  await Promise.all(
    TRACKED_TOKENS.map(async (token) => {
      try {
        const logs = (await rpc("eth_getLogs", [
          {
            fromBlock: "0x" + fromBlock.toString(16),
            toBlock: "latest",
            address: token.address,
            topics: [TRANSFER_SIG],
          },
        ])) as RpcLog[];
        for (const log of logs) {
          let value = 0n;
          try {
            value = BigInt(log.data || "0x0");
          } catch {
            continue;
          }
          if (value === 0n) continue;
          // Exact decimal string; only the USD estimate below narrows to a float.
          const amount = formatTokenAmount(value, token.decimals);
          const price = prices[token.symbol];
          if (price == null) continue;
          const usd = Number(amount) * price;
          if (usd < minUsd) continue;
          const block = parseInt(log.blockNumber, 16);
          all.push({
            symbol: token.symbol,
            name: token.name,
            amount,
            usd,
            from: topicToAddress(log.topics[1]),
            to: topicToAddress(log.topics[2]),
            txHash: log.transactionHash,
            block,
            time: inferredTimeMs(latest, block),
          });
        }
      } catch {
        // skip token on RPC error
      }
    }),
  );

  await applyBlockTimestamps(all);

  const sorted = all.sort((a, b) => b.usd - a.usd).slice(0, 100);
  feedCache.set(key, { t: Date.now(), data: sorted });
  return sorted;
}

/** Intermediate shape while logs are still being collected and priced. */
type RawTransfer = {
  token: TrackedToken;
  amount: string;
  from: string;
  to: string;
  txHash: string;
  block: number;
};

export async function fetchAddressTransfers(address: string, blocks = 800): Promise<WhaleTransfer[]> {
  const latest = await latestBlock();
  const fromBlock = Math.max(0, latest - blocks);
  const addr = address.toLowerCase();
  const topic = "0x" + addr.slice(2).padStart(64, "0");
  const raw: RawTransfer[] = [];

  await Promise.all(
    TRACKED_TOKENS.map(async (token) => {
      try {
        const [outLogs, inLogs] = await Promise.all([
          rpc("eth_getLogs", [
            {
              fromBlock: "0x" + fromBlock.toString(16),
              toBlock: "latest",
              address: token.address,
              topics: [TRANSFER_SIG, topic],
            },
          ]) as Promise<RpcLog[]>,
          rpc("eth_getLogs", [
            {
              fromBlock: "0x" + fromBlock.toString(16),
              toBlock: "latest",
              address: token.address,
              topics: [TRANSFER_SIG, null, topic],
            },
          ]) as Promise<RpcLog[]>,
        ]);
        for (const log of [...outLogs, ...inLogs]) {
          let value = 0n;
          try {
            value = BigInt(log.data || "0x0");
          } catch {
            continue;
          }
          raw.push({
            token,
            amount: formatTokenAmount(value, token.decimals),
            from: topicToAddress(log.topics[1]),
            to: topicToAddress(log.topics[2]),
            txHash: log.transactionHash,
            block: parseInt(log.blockNumber, 16),
          });
        }
      } catch {
        // skip token
      }
    }),
  );

  if (raw.length === 0) return [];

  // One batched timestamp call plus one kline series per priced token covers the
  // entire window, so network cost is flat in the number of transfers rather
  // than growing with them.
  const [timestamps, series, spot] = await Promise.all([
    getBlockTimestamps(raw.map((r) => r.block)),
    historicalPriceSeries(),
    tokenPrices(),
  ]);

  const all: WhaleTransfer[] = raw.map((r) => {
    const { token } = r;
    const realSecs = timestamps.get(r.block);
    const time = realSecs != null ? realSecs * 1000 : inferredTimeMs(latest, r.block);

    // Price each transfer at the candle it actually landed in rather than at
    // today's spot. Over the ~2.7h this window covers that difference is real,
    // and these values are summed into the panel's inflow/outflow/net headline,
    // so the error would otherwise compound into the panel's main conclusion.
    // Falls back to spot when the series is missing or predates the transfer.
    let price = token.fixedPrice ?? spot[token.symbol];
    if (token.priceSymbol) {
      const candles = series[token.priceSymbol];
      if (candles) price = priceAtTime(candles, Math.floor(time / 1000)) ?? price;
    }
    const usd = price != null ? Number(r.amount) * price : 0;

    return {
      symbol: token.symbol,
      name: token.name,
      amount: r.amount,
      usd,
      from: r.from,
      to: r.to,
      txHash: r.txHash,
      block: r.block,
      time,
    };
  });

  return all.sort((a, b) => b.block - a.block).slice(0, 100);
}
