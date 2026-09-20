import { INTERVALS, type Interval } from "./types";

/**
 * Chart layouts, and the state each chart keeps.
 *
 * Panes are addressed by index and there are always `SLOT_COUNT` of them, even
 * while the layout shows fewer. A chart that is hidden therefore keeps its pair
 * and timeframe, so going 4 → 1 → 4 returns you to the four charts you had
 * rather than to a default. `panes` decides how many are on screen; nothing
 * else in the app ever shrinks the array.
 *
 * The counts are 1, 2 and 4 because those are the ones that tile a rectangle.
 * Three charts is a four-chart layout with a hole in it, and the hole is the
 * thing you would end up looking at.
 */
export const PANE_COUNTS = [1, 2, 4] as const;
export type PaneCount = (typeof PANE_COUNTS)[number];

/**
 * What the main area is showing: the charts, or every market at once.
 *
 * A view rather than another pane count, because it answers a different
 * question rather than more of the same one. The layout asks how much of *this*
 * market to show; the market view asks how the markets moved against each
 * other, which needs one axis and therefore one chart. Switching between them
 * leaves the layout untouched, so coming back returns to the charts you had.
 */
export const VIEWS = ["charts", "market"] as const;
export type View = (typeof VIEWS)[number];

/** How many charts the state holds, whether or not they are on screen. */
export const SLOT_COUNT = 4;

export type Slot = {
  symbol: string;
  interval: Interval;
};

/**
 * The pair a chart shows when nothing else is known.
 *
 * Only reachable before the stored layout rehydrates, or if a slot were ever
 * missing — the store is sanitized either way — but the read is during render,
 * so there has to be an answer that is not `undefined`.
 */
export const FALLBACK_SLOT: Slot = { symbol: "BTCUSDT", interval: "15m" };

/**
 * What a fresh visit shows, in the order the panes are laid out.
 *
 * Four *different* arrangements on purpose: the point of the layout is
 * comparison, and four copies of the same chart teach nobody anything. The top
 * row is the short horizon and the bottom row is the longer one, so switching
 * to 4 charts is immediately a different view of the market rather than the
 * same one again.
 */
export function defaultSlots(): Slot[] {
  return [
    { ...FALLBACK_SLOT },
    { symbol: "ETHUSDT", interval: "15m" },
    { symbol: "SOLUSDT", interval: "1h" },
    { symbol: "LINKUSDT", interval: "1h" },
  ];
}

/**
 * Keeps a focused index inside the charts a layout actually shows.
 *
 * Shrinking the layout is the case that matters: the focus can be sitting on
 * pane 3 when the layout drops to one chart, and every read of `slots[focus]`
 * has to be a pane that exists. Anything that is not a whole number is treated
 * as "no opinion" and resolves to the first chart, which is what a value from
 * an older stored layout or a corrupted one deserves.
 */
export function clampFocus(focus: number, panes: PaneCount): number {
  if (!Number.isInteger(focus)) return 0;
  return Math.min(Math.max(focus, 0), panes - 1);
}

/**
 * Rebuilds layout state from whatever was in storage.
 *
 * Stored state outlives the code that wrote it, and this is the one store whose
 * shape decides what gets rendered: a missing slot is `slots[focus].symbol` on
 * `undefined`, and an interval that is no longer in `INTERVALS` becomes a
 * request for a timeframe no venue publishes. So nothing saved is trusted —
 * every field is checked, and anything unrecognised falls back to the default
 * for that field alone rather than propagating into a render.
 */
export function sanitizeLayout(saved: unknown): {
  view: View;
  panes: PaneCount;
  focus: number;
  slots: Slot[];
} {
  const raw = (typeof saved === "object" && saved !== null ? saved : {}) as Record<string, unknown>;
  const slots = defaultSlots();

  if (Array.isArray(raw.slots)) {
    raw.slots.slice(0, SLOT_COUNT).forEach((entry, i) => {
      if (typeof entry !== "object" || entry === null) return;
      const slot = entry as Record<string, unknown>;
      const symbol = slot.symbol;
      if (typeof symbol !== "string" || symbol === "") return;
      const interval = INTERVALS.includes(slot.interval as Interval)
        ? (slot.interval as Interval)
        : slots[i].interval;
      slots[i] = { symbol, interval };
    });
  }

  const panes = PANE_COUNTS.includes(raw.panes as PaneCount)
    ? (raw.panes as PaneCount)
    : PANE_COUNTS[0];
  const focus = clampFocus(typeof raw.focus === "number" ? raw.focus : 0, panes);
  // Charts, not market: a stored layout predating the market view, or one
  // written by a build that knew a third view, opens on the thing this app is
  // for. A missing value is reported as missing, never guessed at.
  const view = VIEWS.includes(raw.view as View) ? (raw.view as View) : VIEWS[0];

  return { view, panes, focus, slots };
}
