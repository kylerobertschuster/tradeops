"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchWhales, fetchAddressTransfers, type WhaleTransfer } from "@/lib/api";
import { useLabelsStore, type WalletLabel } from "@/store/labels";
import { formatCompact, formatCompactNum, shortAddr, timeAgo } from "@/lib/format";

const MIN_USD_OPTIONS = [
  { value: 100_000, label: "≥ $100K" },
  { value: 1_000_000, label: "≥ $1M" },
  { value: 5_000_000, label: "≥ $5M" },
  { value: 10_000_000, label: "≥ $10M" },
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
  const [minUsd, setMinUsd] = useState(1_000_000);
  const [whales, setWhales] = useState<WhaleTransfer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [addrData, setAddrData] = useState<{ address: string; transfers: WhaleTransfer[] } | null>(null);
  const [copied, setCopied] = useState(false);

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
    load();
    const timer = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
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

  const addrTransfers = useMemo(
    () => (addrData && addrData.address === selected ? addrData.transfers : []),
    [addrData, selected],
  );
  const addrLoading = !addrData || addrData.address !== selected;

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
          Back to feed
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
                    <span className="text-[12px] font-medium tabular-nums text-tv-text">
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

  // ---- Whale feed view ----
  return (
    <div>
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
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-tv-border bg-tv-bg px-2.5 py-1.5 text-[11px]">
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
  );
}
