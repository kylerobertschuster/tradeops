/**
 * The tokens this app tracks on-chain.
 *
 * Kept in its own module rather than alongside the on-chain fetchers because
 * both sides of the app need it: the server prices transfers and looks up
 * holders, and the *browser* asks BlockScout for holders directly (its rate
 * limit is per IP, and the Worker's egress IP is shared with every other
 * Cloudflare Worker, so the visitor's own connection is the only budget that
 * is reliably free). Importing this list from the server module instead would
 * pull the whole market-data layer into the client bundle for eight constants.
 *
 * `fixedPrice` marks a token whose price is definitionally $1; `priceSymbol`
 * names the market symbol used to price the rest. USD-pegged and wrapped
 * assets are the point of the list: they are the tokens that move in size, and
 * a transfer of an unknown token cannot be valued.
 */

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
  // Verified against Uniswap's own token list (tokens.uniswap.org, chain 1).
  // The address this list shipped with until 2026-09-16 was one character off
  // (`…a85c5a…` for `…a85d5a…`), which is not a contract at all: BlockScout
  // answered 404 for its holders and `eth_getLogs` over the same 300 blocks
  // returned 0 transfer logs for the typo against 492 for the real token. The
  // token was on the list and produced nothing, silently.
  { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18, priceSymbol: "UNIUSDT" },
  { symbol: "AAVE", name: "Aave", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18, priceSymbol: "AAVEUSDT" },
];
