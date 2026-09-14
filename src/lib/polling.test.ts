import { describe, it, expect, vi, afterEach } from "vitest";
import {
  POLL_MS,
  WORKERS_FREE_REQUESTS_PER_DAY,
  requestsPerDay,
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
