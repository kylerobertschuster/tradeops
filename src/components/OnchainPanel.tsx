"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchWhales, fetchAddressTransfers, fetchHolders, type WhaleTransfer, type HolderStats } from "@/lib/api";
import { POLL_MS, startVisiblePolling } from "@/lib/polling";
import type { Holder } from "@/lib/holders";
import { useLabelsStore, type WalletLabel } from "@/store/labels";
import { formatCompact, formatCompactNum, shortAddr, timeAgo } from "@/lib/format";

const MIN_USD_OPTIONS = [
  { value: 100_000, label: "≥ $100K" },
  { value: 1_000_000, label: "≥ $1M" },
  { value: 5_000_000, label: "≥ $5M" },
  { value: 10_000_000, label: "≥ $10M" },
];

const HOLDER_TOKENS = [
  { symbol: "USDC", label: "USDC" },
  { symbol: "USDT", label: "USDT" },
  { symbol: "DAI", label: "DAI" },
  { symbol: "WETH", label: "WETH" },
  { symbol: "WBTC", label: "WBTC" },
  { symbol: "LINK", label: "LINK" },
  { symbol: "UNI", label: "UNI" },
  { symbol: "AAVE", label: "AAVE" },
];

const CATEGORIES = ["exchange", "whale", "vc", "mev", "hacker", "contract", "other"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  exchange: "Exchange",
  whale: "Whale",
  vc: "VC / Fund",
  mev: "MEV Bot",
  hacker: "Exploiter",
  contract: "Contract",
  other: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  exchange: "#2962ff",
  whale: "#089981",
  vc: "#7e57c2",
  mev: "#ff9800",
  hacker: "#f23645",
  contract: "#787b86",
  other: "#787b86",
};

const KNOWN_LABEL_COLOR = "#26a69a";

const clamp = (n: number) => Math.max(0, Math.min(100, n));

const etherscan = (kind: "tx" | "address", value: string) => `https://etherscan.io/${kind}/${value}`;

function AddressChip({
  address,
  label,
  onClick,
}: {
  address: string;
  label?: WalletLabel;
  onClick: () => void;
}) {
  const color = label ? CATEGORY_COLORS[label.category] ?? "#787b86" : undefined;
  return (
    <button
      onClick={onClick}
      title={address}
      className="inline-flex max-w-[45%] items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] hover:bg-tv-accent/15"
    >
      {label ? (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate" style={{ color }}>
            {label.name}
          </span>
        </>
      ) : (
        <span className="truncate text-tv-muted">{shortAddr(address)}</span>
      )}
    </button>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone: "up" | "down" | "muted" }) {
  const color = tone === "up" ? "text-tv-up" : tone === "down" ? "text-tv-down" : "text-tv-text";
  return (
    <div className="rounded-md border border-tv-border bg-tv-bg p-2">
      <div className="text-[10px] uppercase tracking-wide text-tv-muted">{label}</div>
      <div className={`mt-0.5 text-[12px] font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function LabelEditor({ address }: { address: string }) {
  const labels = useLabelsStore((s) => s.labels);
  const setLabel = useLabelsStore((s) => s.setLabel);
  const removeLabel = useLabelsStore((s) => s.removeLabel);

  const existing = labels[address.toLowerCase()];
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState(existing?.category ?? "other");

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLabel(address, trimmed, category);
  };

  return (
    <div className="mt-3 rounded-md border border-tv-border bg-tv-bg p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-tv-muted">Wallet label</div>
      <div className="mt-2 flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="e.g. Binance Hot Wallet"
          className="min-w-0 flex-1 rounded border border-tv-border bg-tv-panel px-2 py-1.5 text-[12px] text-tv-text placeholder:text-tv-muted focus:border-tv-accent focus:outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-tv-border bg-tv-panel px-1.5 py-1.5 text-[11px] text-tv-text focus:outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={save}
          disabled={!name.trim()}
          className="rounded bg-tv-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40"
        >
          Save label
        </button>
        {existing && (
          <button
            onClick={() => removeLabel(address)}
            className="rounded border border-tv-border px-2.5 py-1 text-[11px] text-tv-muted hover:text-tv-down"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export default function OnchainPanel() {
  const [mode, setMode] = useState<"whales" | "holders">("whales");
  const [minUsd, setMinUsd] = useState(1_000_000);
  const [whales, setWhales] = useState<WhaleTransfer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [addrData, setAddrData] = useState<{ address: string; transfers: WhaleTransfer[] } | null>(null);
  const [copied, setCopied] = useState(false);

  const [holderSymbol, setHolderSymbol] = useState("USDC");
  const [holderData, setHolderData] = useState<{ symbol: string; stats: HolderStats | null } | null>(null);

  const labels = useLabelsStore((s) => s.labels);

  // Poll the whale feed
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const t = await fetchWhales(minUsd, 15);
        if (!alive) return;
        setWhales(t);
        setError(null);
        setLoaded(true);
      } catch {
        if (alive) {
          setError("On-chain feed is unavailable right now.");
          setLoaded(true);
        }
      }
    }
    const stopPolling = startVisiblePolling(load, POLL_MS.whales);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [minUsd]);

  // Load a selected address's transfer history
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    fetchAddressTransfers(selected)
      .then((t) => {
        if (alive) setAddrData({ address: selected, transfers: t });
      })
      .catch(() => {
        if (alive) setAddrData({ address: selected, transfers: [] });
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  // Load holder analytics for the selected token
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const s = await fetchHolders(holderSymbol);
        if (alive) setHolderData({ symbol: holderSymbol, stats: s });
      } catch {
        if (alive) setHolderData({ symbol: holderSymbol, stats: null });
      }
    }
    const stopPolling = startVisiblePolling(load, POLL_MS.holders);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [holderSymbol]);

  const addrTransfers = useMemo(
    () => (addrData && addrData.address === selected ? addrData.transfers : []),
    [addrData, selected],
  );
  const addrLoading = !addrData || addrData.address !== selected;

  const curHolder = holderData && holderData.symbol === holderSymbol ? holderData : null;
  const holderStats = curHolder?.stats ?? null;
  const holderError = !!curHolder && !curHolder.stats;
  const holderLoading = !curHolder;

  const summary = useMemo(
    () => ({
      count: whales.length,
      total: whales.reduce((s, w) => s + w.usd, 0),
    }),
    [whales],
  );

  const stats = useMemo(() => {
    let inUsd = 0;
    let outUsd = 0;
    for (const t of addrTransfers) {
      if (t.from === selected) outUsd += t.usd;
      else inUsd += t.usd;
    }
    return { inUsd, outUsd, net: inUsd - outUsd };
  }, [addrTransfers, selected]);

  const holderName = (h: Holder) => {
    const user = labels[h.address];
    if (user) return { text: user.name, color: CATEGORY_COLORS[user.category] ?? "#787b86" };
    if (h.label) return { text: h.label, color: KNOWN_LABEL_COLOR };
    return { text: shortAddr(h.address), color: undefined };
  };

  const copyAddress = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  // ---- Address inspector view ----
  if (selected) {
    return (
      <div>
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-[12px] text-tv-muted hover:text-tv-text"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Back
        </button>

        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 truncate font-mono text-[12px] text-tv-text" title={selected}>
            {selected}
          </code>
          <button
            onClick={copyAddress}
            className="shrink-0 rounded border border-tv-border px-1.5 py-0.5 text-[10px] text-tv-muted hover:text-tv-text"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={etherscan("address", selected)}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[10px] text-tv-accent hover:underline"
          >
            Etherscan ↗
          </a>
        </div>

        <LabelEditor key={selected} address={selected} />

        <div className="mt-3 grid grid-cols-3 gap-2">
          <StatBox label="Inflow" value={formatCompact(stats.inUsd)} tone="up" />
          <StatBox label="Outflow" value={formatCompact(stats.outUsd)} tone="down" />
          <StatBox label="Net" value={formatCompact(stats.net)} tone={stats.net >= 0 ? "up" : "down"} />
        </div>
        {/* State the valuation basis rather than leaving it to be assumed. These
            are historical values, not today's price applied to old amounts. */}
        <p className="mt-1.5 text-[10px] leading-tight text-tv-muted">
          Valued at the price when each transfer was mined (±5 min), not today&rsquo;s price.
        </p>

        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-tv-muted">
            <span>Recent transfers</span>
            <span>{addrTransfers.length}</span>
          </div>
          {addrLoading && <p className="mt-2 text-[12px] text-tv-muted">Loading transfers…</p>}
          {!addrLoading && addrTransfers.length === 0 && (
            <p className="py-6 text-center text-[12px] text-tv-muted">
              No tracked-token transfers found in the recent window.
            </p>
          )}
          <div className="mt-1.5 space-y-1.5">
            {addrTransfers.map((t, i) => {
              const isOut = t.from === selected;
              const counterparty = isOut ? t.to : t.from;
              return (
                <div
                  key={`${t.txHash}-${i}`}
                  className="rounded-md border border-tv-border bg-tv-bg px-2.5 py-2"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] font-bold ${
                        isOut ? "bg-tv-down/15 text-tv-down" : "bg-tv-up/15 text-tv-up"
                      }`}
                    >
                      {isOut ? "OUT" : "IN"}
                    </span>
                    <span
                      className="text-[12px] font-medium tabular-nums text-tv-text"
                      title="USD value at the time of transfer"
                    >
                      {formatCompact(t.usd)}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-tv-text">
                    {formatCompactNum(t.amount)} <span className="text-tv-muted">{t.symbol}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[11px]">
                    <span className="text-tv-muted">{isOut ? "to" : "from"}</span>
                    <AddressChip
                      address={counterparty}
                      label={labels[counterparty]}
                      onClick={() => setSelected(counterparty)}
                    />
                    <span className="ml-auto shrink-0 text-tv-muted">{timeAgo(t.time)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---- Main views (Whales / Holders) ----
  return (
    <div>
      <div className="flex items-center gap-1 rounded-md border border-tv-border bg-tv-bg p-0.5">
        <button
          onClick={() => setMode("whales")}
          className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
            mode === "whales" ? "bg-tv-accent text-white" : "text-tv-muted hover:text-tv-text"
          }`}
        >
          Whales
        </button>
        <button
          onClick={() => setMode("holders")}
          className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
            mode === "holders" ? "bg-tv-accent text-white" : "text-tv-muted hover:text-tv-text"
          }`}
        >
          Holders
        </button>
      </div>

      {mode === "holders" ? (
        <div className="mt-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-tv-muted">Top holders</span>
            <select
              value={holderSymbol}
              onChange={(e) => setHolderSymbol(e.target.value)}
              className="rounded border border-tv-border bg-tv-bg px-1.5 py-1 text-[11px] text-tv-text focus:outline-none"
            >
              {HOLDER_TOKENS.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {holderLoading && <p className="py-6 text-center text-[12px] text-tv-muted">Loading holders…</p>}
          {holderError && (
            <p className="py-6 text-center text-[12px] text-tv-down">Holder data unavailable for {holderSymbol}.</p>
          )}

          {holderStats && (
            <>
              <div className="mt-2 rounded-md border border-tv-border bg-tv-bg p-2.5">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <div>
                    <span className="text-tv-muted">Total supply </span>
                    <span className="font-semibold tabular-nums text-tv-text">
                      {formatCompactNum(holderStats.totalSupply)} {holderStats.symbol}
                    </span>
                  </div>
                  <div>
                    <span className="text-tv-muted">Holders </span>
                    <span className="font-semibold tabular-nums text-tv-text">
                      {formatCompactNum(holderStats.holderCount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-tv-muted">Market cap </span>
                    <span className="font-semibold tabular-nums text-tv-text">
                      {holderStats.marketCap != null ? formatCompact(holderStats.marketCap) : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-tv-muted">Price </span>
                    <span className="font-semibold tabular-nums text-tv-text">
                      {holderStats.price != null ? formatCompact(holderStats.price) : "—"}
                    </span>
                  </div>
                </div>

                <div className="mt-2.5">
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-tv-panel2">
                    <div style={{ width: `${clamp(holderStats.top10Share)}%` }} className="bg-tv-up" />
                    <div
                      style={{ width: `${clamp(holderStats.top50Share - holderStats.top10Share)}%` }}
                      className="bg-tv-accent"
                    />
                    <div
                      style={{ width: `${clamp(100 - holderStats.top50Share)}%` }}
                      className="bg-tv-border"
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-tv-muted">
                    <span className="flex items-center gap-1">
                      <i className="h-1.5 w-1.5 rounded-full bg-tv-up" /> Top 10 {holderStats.top10Share.toFixed(1)}%
                    </span>
                    <span className="flex items-center gap-1">
                      <i className="h-1.5 w-1.5 rounded-full bg-tv-accent" /> #11–50{" "}
                      {Math.max(0, holderStats.top50Share - holderStats.top10Share).toFixed(1)}%
                    </span>
                    <span className="flex items-center gap-1">
                      <i className="h-1.5 w-1.5 rounded-full bg-tv-border" /> Rest{" "}
                      {Math.max(0, 100 - holderStats.top50Share).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-2 space-y-1.5">
                {holderStats.holders.map((h, i) => {
                  const nm = holderName(h);
                  return (
                    <div key={h.address} className="rounded-md border border-tv-border bg-tv-bg px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-tv-muted">{i + 1}</span>
                        <button
                          onClick={() => setSelected(h.address)}
                          title={h.address}
                          className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-tv-muted hover:text-tv-accent"
                          style={nm.color ? { color: nm.color } : undefined}
                        >
                          {nm.text}
                        </button>
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-tv-text">
                          {h.share.toFixed(2)}%
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between pl-8 text-[11px] text-tv-muted">
                        <span>
                          {formatCompactNum(h.balance)} {holderStats.symbol}
                        </span>
                        <span className="tabular-nums">{h.usd != null ? formatCompact(h.usd) : ""}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-tv-muted">Whale feed</span>
            <select
              value={minUsd}
              onChange={(e) => setMinUsd(Number(e.target.value))}
              className="rounded border border-tv-border bg-tv-bg px-1.5 py-1 text-[11px] text-tv-text focus:outline-none"
            >
              {MIN_USD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {loaded && !error && (
            <div
              className="mt-2 flex items-center gap-1.5 rounded-md border border-tv-border bg-tv-bg px-2.5 py-1.5 text-[11px]"
              title="Transfers from the last few minutes, valued at the current price"
            >
              <span className="text-tv-muted">Window volume</span>
              <span className="font-semibold tabular-nums text-tv-text">{formatCompact(summary.total)}</span>
              <span className="text-tv-muted">· {summary.count} transfers</span>
            </div>
          )}

          {!loaded && <p className="py-6 text-center text-[12px] text-tv-muted">Scanning the chain…</p>}
          {error && whales.length === 0 && <p className="py-6 text-center text-[12px] text-tv-down">{error}</p>}

          <div className="mt-2 space-y-1.5">
            {whales.map((w, i) => (
              <div
                key={`${w.txHash}-${i}`}
                className="rounded-md border border-tv-border bg-tv-bg px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-tv-text">
                    {formatCompactNum(w.amount)} <span className="text-tv-muted">{w.symbol}</span>
                  </span>
                  <span className="text-[12px] font-medium tabular-nums text-tv-text">
                    {formatCompact(w.usd)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1 text-[11px]">
                  <AddressChip address={w.from} label={labels[w.from]} onClick={() => setSelected(w.from)} />
                  <span className="shrink-0 text-tv-muted">→</span>
                  <AddressChip address={w.to} label={labels[w.to]} onClick={() => setSelected(w.to)} />
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-tv-muted">
                    {timeAgo(w.time)}
                    <a
                      href={etherscan("tx", w.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      title="View on Etherscan"
                      className="text-tv-accent hover:underline"
                    >
                      ↗
                    </a>
                  </span>
                </div>
              </div>
            ))}
            {loaded && whales.length === 0 && !error && (
              <p className="py-6 text-center text-[12px] text-tv-muted">
                No transfers above {formatCompact(minUsd)} in the last few blocks.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
