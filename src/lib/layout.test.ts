import { describe, it, expect, afterEach } from "vitest";
import { clampFocus, defaultSlots, PANE_COUNTS, sanitizeLayout, SLOT_COUNT } from "./layout";
import { INTERVALS } from "./types";
import { findSymbol } from "./symbols";
import { useLayoutStore } from "@/store/layout";

/**
 * Layout state is stored, and stored state outlives the code that wrote it.
 *
 * So most of what matters here is the rebuilding: a saved layout from an older
 * version, a hand-edited value, or a slot written before an interval was
 * removed must all resolve to something the app can actually draw. The rest is
 * the rule that collapsing a layout must not throw away the charts it hides.
 */

afterEach(() => {
  useLayoutStore.setState({ panes: 1, focus: 0, slots: defaultSlots() });
});

describe("default layout", () => {
  it("fills every slot with a pair the app can render", () => {
    const slots = defaultSlots();
    expect(slots).toHaveLength(SLOT_COUNT);
    for (const slot of slots) {
      // A default pane naming a symbol that is not in the symbol list would
      // render "undefined/USDT" in the header rather than fail loudly.
      expect(findSymbol(slot.symbol).symbol).toBe(slot.symbol);
      expect(INTERVALS).toContain(slot.interval);
    }
  });

  it("does not open on four copies of the same chart", () => {
    const slots = defaultSlots();
    expect(new Set(slots.map((s) => s.symbol)).size).toBeGreaterThan(1);
  });

  it("offers only layouts that tile a rectangle", () => {
    expect([...PANE_COUNTS]).toEqual([1, 2, 4]);
  });
});

describe("clampFocus", () => {
  it("keeps the focus on a chart the layout shows", () => {
    // Collapsing to one chart with the focus on the fourth is the case that
    // would otherwise read `slots[3]` while only `slots[0]` is on screen.
    expect(clampFocus(3, 1)).toBe(0);
    expect(clampFocus(3, 2)).toBe(1);
    expect(clampFocus(2, 4)).toBe(2);
    expect(clampFocus(-1, 4)).toBe(0);
  });

  it("treats anything that is not a whole number as no opinion", () => {
    expect(clampFocus(1.5, 4)).toBe(0);
    expect(clampFocus(Number.NaN, 4)).toBe(0);
    expect(clampFocus(Number.POSITIVE_INFINITY, 4)).toBe(0);
  });
});

describe("sanitizeLayout", () => {
  it("falls back to the default layout for missing or unusable state", () => {
    for (const input of [undefined, null, 42, "layout", []]) {
      const state = sanitizeLayout(input);
      expect(state.panes).toBe(1);
      expect(state.focus).toBe(0);
      expect(state.slots).toEqual(defaultSlots());
    }
  });

  it("keeps a layout that is intact", () => {
    const saved = {
      panes: 4,
      focus: 2,
      slots: [
        { symbol: "XRPUSDT", interval: "5m" },
        { symbol: "ADAUSDT", interval: "1d" },
        { symbol: "DOGEUSDT", interval: "1s" },
        { symbol: "AVAXUSDT", interval: "1w" },
      ],
    };
    expect(sanitizeLayout(saved)).toEqual(saved);
  });

  it("refuses a pane count that is not one of the layouts", () => {
    for (const panes of [3, 8, 0, -1, "4", 2.5, null]) {
      expect(sanitizeLayout({ panes, focus: 0 }).panes).toBe(1);
    }
  });

  it("replaces an interval the app no longer offers, keeping the pair", () => {
    // Otherwise the pane asks every venue for a timeframe nobody publishes,
    // and the empty chart looks like a venue outage.
    const state = sanitizeLayout({ panes: 1, slots: [{ symbol: "XRPUSDT", interval: "3m" }] });
    expect(state.slots[0]).toEqual({ symbol: "XRPUSDT", interval: defaultSlots()[0].interval });
  });

  it("discards a slot with no usable symbol rather than half of one", () => {
    const state = sanitizeLayout({
      panes: 4,
      slots: [{ symbol: "" }, { symbol: 7 }, { interval: "1m" }, { symbol: "ADAUSDT", interval: "4h" }],
    });
    const defaults = defaultSlots();
    expect(state.slots[0]).toEqual(defaults[0]);
    expect(state.slots[1]).toEqual(defaults[1]);
    expect(state.slots[2]).toEqual(defaults[2]);
    // The one good entry survives, at its own index.
    expect(state.slots[3]).toEqual({ symbol: "ADAUSDT", interval: "4h" });
  });

  it("pads a short list and ignores entries past the last pane", () => {
    const state = sanitizeLayout({
      panes: 4,
      slots: [{ symbol: "XRPUSDT", interval: "1m" }, ...Array(6).fill({ symbol: "SEIUSDT" })],
    });
    expect(state.slots).toHaveLength(SLOT_COUNT);
    expect(state.slots[0]).toEqual({ symbol: "XRPUSDT", interval: "1m" });
    expect(state.slots[3].symbol).toBe("SEIUSDT");
  });

  it("clamps a saved focus that points past the saved layout", () => {
    expect(sanitizeLayout({ panes: 2, focus: 3 }).focus).toBe(1);
    expect(sanitizeLayout({ panes: 4, focus: "2" }).focus).toBe(0);
  });
});

describe("the layout store", () => {
  it("acts on the focused chart, not on all of them", () => {
    const store = useLayoutStore.getState();
    store.setPanes(4);
    useLayoutStore.getState().setFocus(2);
    useLayoutStore.getState().setSymbol("DOGEUSDT");
    useLayoutStore.getState().setInterval("1d");

    const slots = useLayoutStore.getState().slots;
    expect(slots[2]).toEqual({ symbol: "DOGEUSDT", interval: "1d" });
    // The other panes are untouched, which is the whole point of a focus.
    expect(slots[0]).toEqual(defaultSlots()[0]);
    expect(slots[1]).toEqual(defaultSlots()[1]);
    expect(slots[3]).toEqual(defaultSlots()[3]);
  });

  it("keeps hidden charts when the layout shrinks", () => {
    // 4 → 1 → 4 has to return the four charts you had, not four defaults, or
    // the layout switcher becomes destructive.
    useLayoutStore.getState().setPanes(4);
    useLayoutStore.getState().setFocus(3);
    useLayoutStore.getState().setSymbol("SHIBUSDT");
    useLayoutStore.getState().setPanes(1);

    const afterShrink = useLayoutStore.getState();
    expect(afterShrink.slots[3].symbol).toBe("SHIBUSDT");
    // The focus follows the layout down rather than pointing at nothing.
    expect(afterShrink.focus).toBe(0);

    afterShrink.setPanes(4);
    expect(useLayoutStore.getState().slots[3].symbol).toBe("SHIBUSDT");
  });

  it("refuses a focus outside the panes on screen", () => {
    useLayoutStore.getState().setPanes(2);
    useLayoutStore.getState().setFocus(3);
    expect(useLayoutStore.getState().focus).toBe(1);
  });
});
