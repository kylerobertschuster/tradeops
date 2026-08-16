import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const STARTING_BALANCE = 100_000;
export const FEE_RATE = 0.001; // 0.1% taker fee, like major exchanges

export type Position = {
  symbol: string;
  base: string;
  qty: number;
  avgPrice: number;
};

export type Order = {
  id: string;
  symbol: string;
  base: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  notional: number;
  fee: number;
  time: number;
};

type PaperState = {
  cash: number;
  positions: Record<string, Position>;
  orders: Order[];
  marketBuy: (symbol: string, base: string, notional: number, price: number) => string | null;
  marketSell: (symbol: string, base: string, notional: number, price: number) => string | null;
  closePosition: (symbol: string, price: number) => void;
  reset: () => void;
};

function round(n: number, digits = 8): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

const safeStorage = () => {
  if (typeof window !== "undefined") return window.localStorage;
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  } as unknown as Storage;
};

export const usePaperStore = create<PaperState>()(
  persist(
    (set, get) => ({
      cash: STARTING_BALANCE,
      positions: {},
      orders: [],

      marketBuy: (symbol, base, notional, price) => {
        if (!price || price <= 0 || !isFinite(price)) return "No market price available";
        if (!notional || notional <= 0 || !isFinite(notional)) return "Enter a valid amount";
        const fee = notional * FEE_RATE;
        const total = notional + fee;
        const { cash, positions } = get();
        if (total > cash + 1e-6) return "Insufficient buying power";
        const qty = notional / price;
        const prev = positions[symbol];
        const newQty = (prev?.qty ?? 0) + qty;
        const newAvg = prev ? (prev.qty * prev.avgPrice + qty * price) / newQty : price;
        const order: Order = {
          id: crypto.randomUUID(),
          symbol,
          base,
          side: "buy",
          qty: round(qty),
          price,
          notional,
          fee,
          time: Date.now(),
        };
        set({
          cash: cash - total,
          positions: {
            ...positions,
            [symbol]: { symbol, base, qty: newQty, avgPrice: newAvg },
          },
          orders: [order, ...get().orders],
        });
        return null;
      },

      marketSell: (symbol, base, notional, price) => {
        if (!price || price <= 0 || !isFinite(price)) return "No market price available";
        if (!notional || notional <= 0 || !isFinite(notional)) return "Enter a valid amount";
        const pos = get().positions[symbol];
        if (!pos || pos.qty <= 0) return `No ${base} position to sell`;
        const qty = notional / price;
        if (qty > pos.qty + 1e-9) return `Insufficient ${base} balance`;
        const fee = notional * FEE_RATE;
        const proceeds = notional - fee;
        const remainingQty = Math.max(0, pos.qty - qty);
        const positions = { ...get().positions };
        if (remainingQty < 1e-12) delete positions[symbol];
        else positions[symbol] = { ...pos, qty: remainingQty };
        const order: Order = {
          id: crypto.randomUUID(),
          symbol,
          base,
          side: "sell",
          qty: round(qty),
          price,
          notional,
          fee,
          time: Date.now(),
        };
        set({
          cash: get().cash + proceeds,
          positions,
          orders: [order, ...get().orders],
        });
        return null;
      },

      closePosition: (symbol, price) => {
        const pos = get().positions[symbol];
        if (!pos || !price || price <= 0) return;
        get().marketSell(symbol, pos.base, pos.qty * price, price);
      },

      reset: () => {
        set({ cash: STARTING_BALANCE, positions: {}, orders: [] });
      },
    }),
    {
      name: "tradeops-paper-v1",
      storage: createJSONStorage(safeStorage),
      skipHydration: true,
    },
  ),
);
