import { fetchTickers } from "./market";

/**
 * On-chain analytics (Ethereum/EVM) using public JSON-RPC endpoints.
 * No API key required — falls back across providers.
 */

const RPC_URLS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://1rpc.io/eth",
  "https://rpc.flashbots.net",
];

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
  amount: number;
  usd: number;
  from: string;
  to: string;
  txHash: string;
  block: number;
  time: number;
};

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  let lastErr: unknown;
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        cache: "no-store",
      });
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
          const amount = Number(value) / 10 ** token.decimals;
          const price = prices[token.symbol];
          if (price == null) continue;
          const usd = amount * price;
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
            time: Date.now() - (latest - block) * 12000,
          });
        }
      } catch {
        // skip token on RPC error
      }
    }),
  );

  const sorted = all.sort((a, b) => b.usd - a.usd).slice(0, 100);
  feedCache.set(key, { t: Date.now(), data: sorted });
  return sorted;
}

export async function fetchAddressTransfers(address: string, blocks = 800): Promise<WhaleTransfer[]> {
  const latest = await latestBlock();
  const fromBlock = Math.max(0, latest - blocks);
  const prices = await tokenPrices();
  const addr = address.toLowerCase();
  const topic = "0x" + addr.slice(2).padStart(64, "0");
  const all: WhaleTransfer[] = [];

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
          const amount = Number(value) / 10 ** token.decimals;
          const price = prices[token.symbol];
          const usd = price != null ? amount * price : 0;
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
            time: Date.now() - (latest - block) * 12000,
          });
        }
      } catch {
        // skip token
      }
    }),
  );

  return all.sort((a, b) => b.block - a.block).slice(0, 100);
}
