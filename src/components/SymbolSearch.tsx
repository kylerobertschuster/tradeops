"use client";

import { useEffect, useRef, useState } from "react";
import { searchSymbols } from "@/lib/api";
import type { SymbolInfo } from "@/lib/types";

type Props = { onSelect: (symbol: string) => void };

export default function SymbolSearch({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const q = query.trim();
      if (!q) {
        setResults([]);
        setOpen(false);
        return;
      }
      const r = await searchSymbols(q);
      setResults(r);
      setActive(0);
      setOpen(true);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pick = (s: SymbolInfo) => {
    onSelect(s.symbol);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 rounded-md border border-tv-border bg-tv-bg px-2.5 py-1.5 focus-within:border-tv-accent">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-tv-muted">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && results[active]) pick(results[active]);
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search markets…"
          className="w-full bg-transparent text-[13px] text-tv-text outline-none placeholder:text-tv-muted"
        />
      </div>

      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-md border border-tv-border bg-tv-panel2 py-1 shadow-xl">
          {results.map((s, i) => (
            <li key={s.symbol}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] ${
                  i === active ? "bg-tv-accent/20 text-tv-text" : "text-tv-text"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{s.base}</span>
                  <span className="text-tv-muted">{s.name}</span>
                </span>
                <span className="text-[11px] text-tv-muted">{s.symbol}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
