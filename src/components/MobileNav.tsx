"use client";

/**
 * The three top-level panels. On desktop they are all visible at once; below
 * the `lg` breakpoint they become mutually exclusive panes selected here.
 */
export type Pane = "markets" | "chart" | "trade";

type Props = {
  pane: Pane;
  onPane: (pane: Pane) => void;
};

const TABS: { key: Pane; label: string; icon: React.ReactNode }[] = [
  {
    key: "markets",
    label: "Markets",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M4 6h16M4 12h16M4 18h16"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    key: "chart",
    label: "Chart",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M7 4v3m0 10v3M7 7h0a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm10-3v2m0 12v2m0-14h0a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    key: "trade",
    label: "Trade",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect
          x="3"
          y="6"
          width="18"
          height="13"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path d="M3 10.5h18" stroke="currentColor" strokeWidth="1.7" />
        <path d="M7 15h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
];

/**
 * Bottom pane switcher, shown only below `lg`.
 *
 * It sits in normal flow rather than floating over the chart so the chart's
 * measured height is already correct — a fixed overlay would leave the chart
 * sized underneath it and the last few candles hidden behind the bar.
 */
export default function MobileNav({ pane, onPane }: Props) {
  return (
    <nav
      aria-label="Panels"
      // Respects the iPhone home-indicator inset.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      className="flex shrink-0 border-t border-tv-border bg-tv-panel lg:hidden"
    >
      {TABS.map((tab) => {
        const active = pane === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onPane(tab.key)}
            aria-current={active ? "true" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
              active ? "text-tv-accent" : "text-tv-muted"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
