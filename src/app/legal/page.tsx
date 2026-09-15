import Link from "next/link";
import type { Metadata } from "next";
import { LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Legal — TradeOps",
  description:
    "Terms, privacy and the list of data sources behind tradeOPs. No accounts, no cookies, no financial advice.",
};

const DOCS = [
  {
    href: "/legal/terms",
    label: "Terms of Use",
    blurb:
      "What tradeOPs is and is not, why nothing here is financial advice, and the limits of what we promise.",
  },
  {
    href: "/legal/privacy",
    label: "Privacy",
    blurb: "There are no accounts, no cookies and no analytics. Here is the complete picture anyway.",
  },
  {
    href: "/legal/sources",
    label: "Data Sources",
    blurb:
      "Every third party this app talks to, what is taken from each, and the ones your own browser connects to directly.",
  },
] as const;

export default function LegalIndex() {
  return (
    <>
      <h1 className="text-[19px] font-semibold text-tv-text">Legal</h1>
      <p className="text-tv-muted">
        Three short documents. They are written to be read rather than to be impressive, and none of
        them is legalese for its own sake.
      </p>

      <div className="legal-callout">
        <p className="font-semibold text-tv-text">The short version</p>
        <ul>
          <li>
            tradeOPs is free software for looking at public market data and practising trades. No
            account, no key, no money, nothing you can lose.
          </li>
          <li>
            It is not a broker, an exchange, a custodian or an adviser, and it never places an order
            anywhere.
          </li>
          <li>
            The prices come from exchanges and public nodes, arrive as-is, and can be late, wrong or
            missing. Check the venue before you act on any of it.
          </li>
          <li>
            Nothing here is financial advice, and we are not responsible for what you do with it.
          </li>
        </ul>
      </div>

      <h2>Documents</h2>
      <ul>
        {DOCS.map((doc) => (
          <li key={doc.href}>
            <Link href={doc.href}>{doc.label}</Link> — {doc.blurb}
          </li>
        ))}
      </ul>
      <p className="text-tv-muted">Last updated {LAST_UPDATED}.</p>
    </>
  );
}
