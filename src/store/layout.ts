import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { clampFocus, defaultSlots, sanitizeLayout, type PaneCount, type Slot, type View } from "@/lib/layout";
import type { Interval } from "@/lib/types";

type LayoutState = {
  /** Which of the two things the main area is showing. */
  view: View;
  /** How many charts are on screen. Always one of `PANE_COUNTS`. */
  panes: PaneCount;
  /** Index of the chart the toolbar, search and watchlist act on. */
  focus: number;
  /** Always `SLOT_COUNT` long, including the charts that are not on screen. */
  slots: Slot[];
  setView: (view: View) => void;
  setPanes: (panes: PaneCount) => void;
  setFocus: (index: number) => void;
  /** Both of these act on the focused chart, not on the layout as a whole. */
  setSymbol: (symbol: string) => void;
  setInterval: (interval: Interval) => void;
};

const safeStorage = () => {
  if (typeof window !== "undefined") return window.localStorage;
  return { getItem: () => null, setItem: () => {}, removeItem: () => {} } as unknown as Storage;
};

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      view: "charts",
      panes: 1,
      focus: 0,
      slots: defaultSlots(),
      setView: (view) => set({ view }),
      setPanes: (panes) => set((s) => ({ panes, focus: clampFocus(s.focus, panes) })),
      setFocus: (index) => set((s) => ({ focus: clampFocus(index, s.panes) })),
      setSymbol: (symbol) =>
        set((s) => ({
          slots: s.slots.map((slot, i) => (i === s.focus ? { ...slot, symbol } : slot)),
        })),
      setInterval: (interval) =>
        set((s) => ({
          slots: s.slots.map((slot, i) => (i === s.focus ? { ...slot, interval } : slot)),
        })),
    }),
    {
      name: "tradeops-layout-v1",
      storage: createJSONStorage(safeStorage),
      skipHydration: true,
      /**
       * Rebuild rather than trust: see `sanitizeLayout`, which does the checking
       * and is tested directly, since stored state is the one input to this file
       * that can never be assumed to match the current shape.
       */
      merge: (persisted, current) => ({ ...current, ...sanitizeLayout(persisted) }),
    },
  ),
);
