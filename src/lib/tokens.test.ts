import { describe, expect, it } from "vitest";
import { TRACKED_TOKENS } from "./tokens";

/**
 * Why this file contains a Keccak implementation.
 *
 * The tracked-token list shipped for its first three weeks with one wrong
 * character in the Uniswap address (`…a85c5a…` for `…a85d5a…`). Nothing
 * noticed, because a wrong address does not throw: BlockScout answered 404 for
 * that token's holders, and `eth_getLogs` filtered on it returned 0 transfer
 * logs over a 300-block window where the real token returned 492. The token was
 * listed, priced, and permanently empty.
 *
 * A typo like that is caught by validating the address checksum, and the
 * checksum is EIP-55: it re-encodes the address with capitalisation derived
 * from `keccak256(lowercase_address)`. A single flipped character changes the
 * hash, so the published capitalisation no longer matches and the address is
 * rejected. The mistake survives `0x` + 40 hex digits, but not this.
 *
 * Keccak-256 is not in Node's `crypto` (that is SHA3-256, which differs only in
 * padding — the sort of difference that silently produces plausible wrong
 * digests), and this project has four runtime dependencies by design. So the
 * permutation lives here, in about sixty lines, pinned to published vectors.
 */
const MASK = (1n << 64n) - 1n;

/** Rotate a 64-bit lane left; `n = 0` is handled without a branch. */
function rotl64(v: bigint, n: bigint): bigint {
  return ((v << n) | (v >> (64n - n))) & MASK;
}

/** Round constants for the 24 rounds of Keccak-f[1600]'s iota step. */
const ROUND_CONSTANTS: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Rotation offsets and lane permutation, walked together (the rho and pi steps). */
const RHO: readonly bigint[] = [
  1n, 3n, 6n, 10n, 15n, 21n, 28n, 36n, 45n, 55n, 2n, 14n, 27n, 41n, 56n, 8n, 25n, 43n, 62n, 18n, 39n, 61n, 20n, 44n,
];
const PI: readonly number[] = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

/** The 25 lanes are addressed as `state[x + 5y]`, matching the spec's A[x, y]. */
function permute(state: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    // theta: each lane absorbs the parity of its column and its neighbour's.
    const column: bigint[] = [];
    for (let x = 0; x < 5; x++) {
      column[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const d = column[(x + 4) % 5] ^ rotl64(column[(x + 1) % 5], 1n);
      for (let base = 0; base < 25; base += 5) state[x + base] ^= d;
    }

    // rho and pi: rotate every lane and move it to its new position. Walking
    // one lane at a time is equivalent to the two steps separately, and avoids
    // materialising a second state array.
    let carry = state[1];
    for (let i = 0; i < 24; i++) {
      const next = PI[i];
      const displaced = state[next];
      state[next] = rotl64(carry, RHO[i]);
      carry = displaced;
    }

    // chi: the only non-linear step, and the reason the whole thing does not
    // collapse into a linear map over GF(2).
    for (let base = 0; base < 25; base += 5) {
      const row = [state[base], state[base + 1], state[base + 2], state[base + 3], state[base + 4]];
      for (let x = 0; x < 5; x++) {
        state[base + x] = row[x] ^ (~row[(x + 1) % 5] & MASK & row[(x + 2) % 5]);
      }
    }

    state[0] ^= ROUND_CONSTANTS[round];
  }
}

const RATE = 136; // 1088-bit rate for a 256-bit output: 200 - 2*32 bytes.

function keccak256(input: Uint8Array): Uint8Array {
  // Keccak's own padding is 0x01, not SHA-3's 0x06. This is the one place the
  // two algorithms differ, and the empty-input vector below pins it.
  const padded = new Uint8Array(Math.ceil((input.length + 1) / RATE) * RATE);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state: bigint[] = new Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE) {
    // Lanes are little-endian, as the spec requires.
    for (let lane = 0; lane < RATE / 8; lane++) {
      let word = 0n;
      for (let byte = 7; byte >= 0; byte--) {
        word = (word << 8n) | BigInt(padded[offset + lane * 8 + byte]);
      }
      state[lane] ^= word;
    }
    permute(state);
  }

  const digest = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane++) {
    let word = state[lane];
    for (let byte = 0; byte < 8; byte++) {
      digest[lane * 8 + byte] = Number(word & 0xffn);
      word >>= 8n;
    }
  }
  return digest;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * EIP-55: capitalise each letter of an address when the matching nibble of the
 * hash of its lowercase form is 8 or above. Digits have no case to set.
 */
function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const digest = keccak256(new TextEncoder().encode(lower));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    // `i >> 1`, not `i / 2`: for odd `i` the division yields a fraction like
    // 16.5, `digest[16.5]` is `undefined`, and every odd-position letter then
    // came out lowercase — which is a valid-looking address with the wrong
    // capitalisation, exactly what this test exists to catch. The EIP-55
    // vectors below are what caught it.
    const nibble = i % 2 === 0 ? digest[i >> 1] >> 4 : digest[i >> 1] & 0x0f;
    const char = lower[i];
    out += nibble >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

describe("keccak256", () => {
  // Published digests. The third is the ERC-20 `Transfer` event signature that
  // `onchain.ts` hard-codes as a topic filter, so a passing test here also
  // confirms the filter that decides which logs count as transfers.
  it("matches published vectors", () => {
    expect(hex(keccak256(new TextEncoder().encode("")))).toBe(
      "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    expect(hex(keccak256(new TextEncoder().encode("abc")))).toBe(
      "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    );
    expect(hex(keccak256(new TextEncoder().encode("Transfer(address,address,uint256)")))).toBe(
      "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
  });

  // Crossed against @noble/hashes (present in node_modules as a transitive
  // dependency, deliberately not imported by this test) so the multi-block path
  // is pinned by an independent implementation rather than by my own.
  it("absorbs more than one rate block", () => {
    const long = "tradeops".repeat(40); // 320 bytes, three blocks with padding
    expect(long).toHaveLength(320);
    expect(hex(keccak256(new TextEncoder().encode(long)))).toBe(
      "6d04ccafbb6a5553c839c7eee70a0cbacf41d30b1bef08616b2536e66cd749dc",
    );
  });
});

describe("tracked token addresses", () => {
  // The eight addresses from the EIP-55 specification, all of which must
  // round-trip. Two of them are all-lowercase and all-uppercase forms of the
  // same address, which is what makes them worth keeping: a checksum function
  // that just returns its input would pass on the first and fail on the second.
  it("computes the checksums in the EIP-55 specification", () => {
    const vectors = [
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
      "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
      "0x52908400098527886E0F7030069857D2E4169EE7",
      "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
      "0xde709f2102306220921060314715629080e2fb77",
      "0x27b1fdb04752bbc536007a920d24acb045561c26",
    ];
    for (const address of vectors) {
      expect(toChecksumAddress(address), `${address} should already be checksummed`).toBe(address);
    }
  });

  it("has a valid checksum for every tracked token", () => {
    for (const token of TRACKED_TOKENS) {
      expect(toChecksumAddress(token.address), `${token.symbol} address is mistyped or mis-capitalised`).toBe(
        token.address,
      );
    }
  });

  it("lists each token once, with a usable shape", () => {
    const symbols = TRACKED_TOKENS.map((t) => t.symbol);
    const addresses = TRACKED_TOKENS.map((t) => t.address.toLowerCase());
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(new Set(addresses).size).toBe(addresses.length);

    for (const token of TRACKED_TOKENS) {
      expect(token.symbol, `${token.symbol} should be uppercase`).toBe(token.symbol.toUpperCase());
      expect(token.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 18).toBe(true);
      // A transfer is valued as `fixedPrice ?? the price of priceSymbol`, so a
      // token with neither would be summed as zero without anything failing.
      expect(
        token.fixedPrice != null || token.priceSymbol != null,
        `${token.symbol} has no way to be priced`,
      ).toBe(true);
      if (token.fixedPrice != null) {
        expect(Number.isFinite(token.fixedPrice) && token.fixedPrice > 0).toBe(true);
      }
    }
  });
});
