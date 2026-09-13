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

  it("leaves room for several simultaneous open tabs", () => {
    const tabs = WORKERS_FREE_REQUESTS_PER_DAY / requestsPerDay();
    expect(tabs).toBeGreaterThanOrEqual(8);
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
