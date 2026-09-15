import Link from "next/link";
import type { Metadata } from "next";
import { ISSUES_URL, LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "TradeOps — Legal",
};

const DOCS = [
  { href: "/legal/terms", label: "Terms of Use" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/sources", label: "Data Sources" },
] as const;

/**
 * Shell for the legal documents.
 *
 * A server component with no client JavaScript, because these pages are read
 * text and nothing else. The only interactive elements are links back to the
 * terminal, which is the one thing a reader arriving here from a chart is
 * likely to want.
 */
export default function LegalLayout({ children }: LayoutProps<"/legal">) {
  return (
    <div className="flex min-h-dvh flex-col bg-tv-bg text-tv-text">
      <header className="border-b border-tv-border bg-tv-panel">
        <div className="mx-auto flex w-full max-w-3xl items-baseline gap-3 px-5 pt-4">
          <Link href="/" className="text-[15px] font-bold tracking-tight">
            Trade<span className="text-tv-accent">Ops</span>
          </Link>
          <span className="text-[10px] uppercase tracking-[0.12em] text-tv-muted">Legal</span>
          <Link
            href="/"
            className="ml-auto text-[12px] text-tv-muted transition-colors hover:text-tv-text"
          >
            ← Back to terminal
          </Link>
        </div>
        <nav className="mx-auto flex w-full max-w-3xl items-center gap-1 overflow-x-auto px-4 pb-2 pt-2">
          {DOCS.map((doc) => (
            <Link
              key={doc.href}
              href={doc.href}
              className="shrink-0 rounded px-2.5 py-1 text-[12px] font-medium text-tv-muted transition-colors hover:bg-tv-panel2 hover:text-tv-text"
            >
              {doc.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        <article className="legal-prose">{children}</article>
      </main>

      <footer className="border-t border-tv-border bg-tv-panel px-5 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-2 text-[11px] leading-relaxed text-tv-muted">
          <p>
            TradeOps is free, open-source software released under the MIT License. It is not
            affiliated with, endorsed by, or sponsored by any exchange, data provider or node
            operator named on these pages, and it uses none of their logos or marks.
          </p>
          <p>
            Nothing here is financial advice. tradeOPs places no orders and holds no funds — the
            trading is simulated and the account lives in your own browser.
          </p>
          <p>
            Updated {LAST_UPDATED}. Questions, corrections and requests go to the{" "}
            <a
              href={ISSUES_URL}
              className="underline underline-offset-2 hover:text-tv-text"
              target="_blank"
              rel="noreferrer noopener"
            >
              public issue tracker
            </a>
            .
          </p>
        </div>
      </footer>
    </div>
  );
}
