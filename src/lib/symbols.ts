import type { SymbolInfo } from "./types";

/** Curated watchlist — the assets shown in the left sidebar. */
export const CURATED: SymbolInfo[] = [
  { symbol: "BTCUSDT", base: "BTC", name: "Bitcoin", cgId: "bitcoin" },
  { symbol: "ETHUSDT", base: "ETH", name: "Ethereum", cgId: "ethereum" },
  { symbol: "SOLUSDT", base: "SOL", name: "Solana", cgId: "solana" },
  { symbol: "BNBUSDT", base: "BNB", name: "BNB", cgId: "binancecoin" },
  { symbol: "XRPUSDT", base: "XRP", name: "XRP", cgId: "ripple" },
  { symbol: "ADAUSDT", base: "ADA", name: "Cardano", cgId: "cardano" },
  { symbol: "DOGEUSDT", base: "DOGE", name: "Dogecoin", cgId: "dogecoin" },
  { symbol: "AVAXUSDT", base: "AVAX", name: "Avalanche", cgId: "avalanche-2" },
  { symbol: "LINKUSDT", base: "LINK", name: "Chainlink", cgId: "chainlink" },
  { symbol: "DOTUSDT", base: "DOT", name: "Polkadot", cgId: "polkadot" },
  { symbol: "LTCUSDT", base: "LTC", name: "Litecoin", cgId: "litecoin" },
  { symbol: "UNIUSDT", base: "UNI", name: "Uniswap", cgId: "uniswap" },
  { symbol: "ATOMUSDT", base: "ATOM", name: "Cosmos", cgId: "cosmos" },
  { symbol: "NEARUSDT", base: "NEAR", name: "NEAR Protocol", cgId: "near" },
  { symbol: "APTUSDT", base: "APT", name: "Aptos", cgId: "aptos" },
  { symbol: "ARBUSDT", base: "ARB", name: "Arbitrum", cgId: "arbitrum" },
  { symbol: "OPUSDT", base: "OP", name: "Optimism", cgId: "optimism" },
  { symbol: "SUIUSDT", base: "SUI", name: "Sui", cgId: "sui" },
  { symbol: "SEIUSDT", base: "SEI", name: "Sei", cgId: "sei-network" },
  { symbol: "INJUSDT", base: "INJ", name: "Injective", cgId: "injective-protocol" },
  { symbol: "TIAUSDT", base: "TIA", name: "Celestia", cgId: "celestia" },
  { symbol: "PEPEUSDT", base: "PEPE", name: "Pepe", cgId: "pepe" },
  { symbol: "SHIBUSDT", base: "SHIB", name: "Shiba Inu", cgId: "shiba-inu" },
  { symbol: "AAVEUSDT", base: "AAVE", name: "Aave", cgId: "aave" },
];

/** Additional searchable symbols (not in the default watchlist). */
export const EXTENDED: SymbolInfo[] = [
  { symbol: "BCHUSDT", base: "BCH", name: "Bitcoin Cash" },
  { symbol: "ETCUSDT", base: "ETC", name: "Ethereum Classic" },
  { symbol: "FILUSDT", base: "FIL", name: "Filecoin" },
  { symbol: "ICPUSDT", base: "ICP", name: "Internet Computer" },
  { symbol: "IMXUSDT", base: "IMX", name: "Immutable" },
  { symbol: "STXUSDT", base: "STX", name: "Stacks" },
  { symbol: "GRTUSDT", base: "GRT", name: "The Graph" },
  { symbol: "ALGOUSDT", base: "ALGO", name: "Algorand" },
  { symbol: "VETUSDT", base: "VET", name: "VeChain" },
  { symbol: "HBARUSDT", base: "HBAR", name: "Hedera" },
  { symbol: "MKRUSDT", base: "MKR", name: "Maker" },
  { symbol: "LDOUSDT", base: "LDO", name: "Lido DAO" },
  { symbol: "ENAUSDT", base: "ENA", name: "Ethena" },
  { symbol: "JUPUSDT", base: "JUP", name: "Jupiter" },
  { symbol: "PYTHUSDT", base: "PYTH", name: "Pyth Network" },
  { symbol: "WLDUSDT", base: "WLD", name: "Worldcoin" },
  { symbol: "TAOUSDT", base: "TAO", name: "Bittensor" },
  { symbol: "ONDOUSDT", base: "ONDO", name: "Ondo" },
  { symbol: "RUNEUSDT", base: "RUNE", name: "THORChain" },
  { symbol: "CRVUSDT", base: "CRV", name: "Curve DAO" },
  { symbol: "SANDUSDT", base: "SAND", name: "The Sandbox" },
  { symbol: "MANAUSDT", base: "MANA", name: "Decentraland" },
  { symbol: "GALAUSDT", base: "GALA", name: "Gala" },
  { symbol: "FLOWUSDT", base: "FLOW", name: "Flow" },
  { symbol: "WIFUSDT", base: "WIF", name: "dogwifhat" },
  { symbol: "RENDERUSDT", base: "RENDER", name: "Render" },
  { symbol: "FETUSDT", base: "FET", name: "Artificial Superintelligence" },
  { symbol: "FTMUSDT", base: "FTM", name: "Fantom" },
  { symbol: "XLMUSDT", base: "XLM", name: "Stellar" },
  { symbol: "XTZUSDT", base: "XTZ", name: "Tezos" },
];

export const ALL_SYMBOLS: SymbolInfo[] = [...CURATED, ...EXTENDED];

export const SYMBOL_MAP: Record<string, SymbolInfo> = Object.fromEntries(
  ALL_SYMBOLS.map((s) => [s.symbol, s]),
);

export function findSymbol(symbol: string): SymbolInfo {
  const base = symbol.replace(/USDT$/, "");
  return SYMBOL_MAP[symbol] ?? { symbol, base, name: base };
}

/** Ranked symbol search over the local catalog. */
export function searchSymbols(q: string): SymbolInfo[] {
  const query = q.trim().toUpperCase();
  if (!query) return CURATED.slice(0, 8);
  const starts: SymbolInfo[] = [];
  const includes: SymbolInfo[] = [];
  for (const s of ALL_SYMBOLS) {
    if (s.base === query || s.symbol === query) starts.unshift(s);
    else if (s.base.startsWith(query) || s.symbol.startsWith(query)) starts.push(s);
    else if (s.base.includes(query) || s.name.toUpperCase().includes(query)) includes.push(s);
  }
  return [...starts, ...includes].slice(0, 10);
}
