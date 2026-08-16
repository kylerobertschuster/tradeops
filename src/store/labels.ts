import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type WalletLabel = { name: string; category: string };

type LabelsState = {
  labels: Record<string, WalletLabel>;
  setLabel: (address: string, name: string, category: string) => void;
  removeLabel: (address: string) => void;
};

const safeStorage = () => {
  if (typeof window !== "undefined") return window.localStorage;
  return { getItem: () => null, setItem: () => {}, removeItem: () => {} } as unknown as Storage;
};

export const useLabelsStore = create<LabelsState>()(
  persist(
    (set) => ({
      labels: {},
      setLabel: (address, name, category) =>
        set((s) => ({
          labels: { ...s.labels, [address.toLowerCase()]: { name, category } },
        })),
      removeLabel: (address) =>
        set((s) => {
          const labels = { ...s.labels };
          delete labels[address.toLowerCase()];
          return { labels };
        }),
    }),
    { name: "tradeops-labels-v1", storage: createJSONStorage(safeStorage), skipHydration: true },
  ),
);
