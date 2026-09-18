import Link from "next/link";
import type { Metadata } from "next";
import { LAST_UPDATED, SUPPORT_LINKS } from "@/lib/legal";

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
            account, no key, no money required, nothing you can lose.
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
      {SUPPORT_LINKS.length > 0 && (
        <>
          <h2 id="support">Support</h2>
          <p>
            tradeOPs has no ads, no paid tier and no account, and it is not going to add them. If
            you want to put something back anyway, a donation is the only thing on offer, and it is
            optional to the point of being unnecessary: nothing about the app changes whether or not
            anyone ever uses one of these links.
          </p>
          <ul>
            {SUPPORT_LINKS.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noreferrer noopener">
                  {link.name}
                </a>{" "}
                — {link.note}
              </li>
            ))}
          </ul>
          <p className="text-tv-muted">
            A donation is a gift, not a purchase: it buys no feature, no support promise and no
            exemption from anything on the <Link href="/legal/terms">terms</Link> page, which says
            so in section 8. Each platform collects the payment details on its own site, under its
            own terms — this app never sees them, and has no way to connect a donation to you.
          </p>
        </>
      )}

      <p className="text-tv-muted">Last updated {LAST_UPDATED}.</p>
    </>
  );
}
