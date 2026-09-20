import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  EXTRA_PANE_MS,
  OVERVIEW_MS,
  POLL_MS,
  WORKERS_FREE_REQUESTS_PER_DAY,
  candlePollMs,
  requestsPerDay,
  requestsPerDayPanes,
  startVisiblePolling,
} from "./polling";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Minimal stand-in for `document`, recording visibility listeners. */
function fakeDocument() {
  const listeners: Array<() => void> = [];
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.push(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  const fire = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    for (const listener of [...listeners]) listener();
  };
  return { doc, fire, listenerCount: () => listeners.length };
}

describe("poll cadences", () => {
  it("keeps one foreground tab well inside the Workers free tier", () => {
    const perTab = requestsPerDay();
    expect(perTab).toBeLessThanOrEqual(WORKERS_FREE_REQUESTS_PER_DAY / 4);
  });

  it("keeps the per-tab cost under a stated ceiling", () => {
    // The real contract is cost per tab, not a tab count, so that is what is
    // pinned. Before `/api/venues` this was 12,240 requests/day; at its 60s
    // cadence the venue fan-out adds 1,440, giving 13,680. The ceiling is
    // deliberately tight — there is room for about one more endpoint on a
    // 10-minute cadence — so the next thing added has to argue for its cadence
    // rather than quietly ride along on the existing slack.
    expect(requestsPerDay()).toBeLessThanOrEqual(14_000);
  });

  it("leaves room for several simultaneous open tabs", () => {
    // This asserted `>= 8` until `/api/venues` was added, and that number was
    // an illusion: the budget covers 8.17 tabs before the venue endpoint exists
    // at all, so the assertion passed by 2% and *any* fifth polled endpoint was
    // going to break it. Even a 3-minute venue cadence only reaches 7.86 tabs,
    // so no cadence choice could have preserved it.
    //
    // Six is the honest floor: 100,000 / 13,680 = 7.31, leaving ~18,000
    // requests/day of daylight for everything outside the poll loops — page
    // loads, symbol search, the health check.
    const tabs = WORKERS_FREE_REQUESTS_PER_DAY / requestsPerDay();
    expect(tabs).toBeGreaterThanOrEqual(6);
  });

  it("converts a cadence into a daily request count", () => {
    // Once per minute for a day.
    expect(requestsPerDay({ only: 60_000 })).toBe(1440);
    // Twice per minute.
    expect(requestsPerDay({ only: 30_000 })).toBe(2880);
  });

  it("keeps a four-chart layout inside the one-chart ceiling", () => {
    // Two requests a minute for candle history plus one for the venue fan-out,
    // then half a request a minute for each extra chart (120s each).
    expect(requestsPerDayPanes(1)).toBe(4320);
    expect(requestsPerDayPanes(4)).toBe(6480);
    expect(requestsPerDayPanes(4)).toBeLessThanOrEqual(requestsPerDay());
  });

  it("writes down the one case that costs more than the ceiling", () => {
    // Four charts with every socket down: the all-REST single-chart figure plus
    // three slow refreshes. Above the 14,000 ceiling on purpose — see the note
    // on `requestsPerDayPanes` — and pinned here so it cannot drift without
    // somebody deciding it should.
    expect(requestsPerDayPanes(4, false)).toBe(15_840);
  });

  it("does not poll faster than the slowest sensible dashboard cadence", () => {
    for (const ms of Object.values(POLL_MS)) {
      expect(ms).toBeGreaterThanOrEqual(15_000);
    }
  });
});

describe("startVisiblePolling", () => {
  it("runs once immediately, then once per interval while visible", () => {
    vi.useFakeTimers();
    const { doc } = fakeDocument();
    vi.stubGlobal("document", doc);
    const task = vi.fn();

    const stop = startVisiblePolling(task, 1000);
    expect(task).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    expect(task).toHaveBeenCalledTimes(4);

    stop();
  });

  it("stops while hidden and refreshes immediately on becoming visible", () => {
    vi.useFakeTimers();
    const { doc, fire } = fakeDocument();
    vi.stubGlobal("document", doc);
    const task = vi.fn();

    const stop = startVisiblePolling(task, 1000);
    expect(task).toHaveBeenCalledTimes(1);

    fire("hidden");
    vi.advanceTimersByTime(5000);
    expect(task).toHaveBeenCalledTimes(1);

    fire("visible");
    expect(task).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2000);
    expect(task).toHaveBeenCalledTimes(4);

    stop();
  });

  it("makes no request at all in a document that starts hidden", () => {
    vi.useFakeTimers();
    const { doc } = fakeDocument();
    doc.visibilityState = "hidden";
    vi.stubGlobal("document", doc);
    const task = vi.fn();

    const stop = startVisiblePolling(task, 1000);
    vi.advanceTimersByTime(10_000);
    expect(task).not.toHaveBeenCalled();

    stop();
  });

  it("unregisters its visibility listener on cleanup", () => {
    const { doc, listenerCount } = fakeDocument();
    vi.stubGlobal("document", doc);

    const stop = startVisiblePolling(vi.fn(), 1000);
    expect(listenerCount()).toBe(1);

    stop();
    expect(listenerCount()).toBe(0);
  });
});

/**
 * The market view fetches from the browser, not from the Worker. That makes it
 * the one cadence that must *not* be in `POLL_MS`: the ceiling printed in the
 * README is the cost of the requests one tab sends here, and a browser-direct
 * fetch added to it would inflate the promise or, worse, hide a real cost the
 * other way. The test asserts the exclusion rather than the number.
 */
describe("the market overview's cadence", () => {
  it("stays out of the Worker's per-day arithmetic, because it sends no request to the Worker", () => {
    expect(Object.values(POLL_MS)).not.toContain(OVERVIEW_MS);
    expect(OVERVIEW_MS).toBeGreaterThan(EXTRA_PANE_MS);
  });

  it("cannot be cheaper than a chart's own history, or it would be the same request", () => {
    expect(OVERVIEW_MS).toBeGreaterThanOrEqual(POLL_MS.venues);
  });
});

/**
 * The cadence rule is a function so it can be tested here rather than only by a
 * component test that does not exist. These two tests are the reason it exists:
 * the first pins the rule, the second proves the hosting budget is that same
 * rule's arithmetic and not a copy of it.
 */
describe("a chart's polling cadence", () => {
  const perDay = (ms: number) => Math.round((60_000 / ms) * 60 * 24);

  it("is the focused cadence for the focused chart, and the slow one for the rest", () => {
    expect(candlePollMs(true)).toBe(POLL_MS.klines);
    expect(candlePollMs(false)).toBe(EXTRA_PANE_MS);
    expect(candlePollMs(false)).toBeGreaterThan(candlePollMs(true));
  });

  it("is the arithmetic the per-day budget is made of, so the two cannot disagree", () => {
    const focused = perDay(candlePollMs(true)) + perDay(POLL_MS.venues);
    const satellites = 3 * perDay(candlePollMs(false));

    // The numbers the README and `requestsPerDayPanes`'s own comment quote.
    expect(focused, "one chart, streaming").toBe(4_320);
    expect(satellites, "three satellite charts").toBe(2_160);
    expect(requestsPerDayPanes(4)).toBe(focused + satellites);
    expect(requestsPerDayPanes(4)).toBe(6_480);
  });
});

/**
 * Documentation drift is not caught by types or linters, and the free-tier
 * table is the one place in the README where a stale number is also a broken
 * promise about hosting. So the README is read as a fixture and its figures are
 * checked against the functions that compute them: change a cadence and this
 * fails with the number to go and update.
 */
describe("the README's hosting numbers are these functions' numbers", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const comma = (n: number) => n.toLocaleString("en-US");

  it("quotes every figure the free-tier section claims", () => {
    const claims: [string, number][] = [
      ["one chart with streaming up", requestsPerDayPanes(1)],
      ["four charts with streaming up", requestsPerDayPanes(4)],
      ["the single-chart REST ceiling", requestsPerDay()],
      ["four charts with streaming down", requestsPerDayPanes(4, false)],
    ];

    for (const [what, value] of claims) {
      expect(readme, `README should quote ${comma(value)} for ${what}`).toContain(comma(value));
    }
  });

  it("documents the all-REST four-chart case as being over the ceiling, not under it", () => {
    // Deliberate, and written down rather than hidden: see `requestsPerDayPanes`.
    expect(requestsPerDayPanes(4, false)).toBeGreaterThan(requestsPerDay());
    expect(requestsPerDayPanes(4)).toBeLessThan(requestsPerDay());
    expect(WORKERS_FREE_REQUESTS_PER_DAY).toBeGreaterThan(requestsPerDayPanes(4, false));
  });
});
