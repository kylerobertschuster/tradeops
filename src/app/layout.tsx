import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Open-source on-chain analytics and charting. Whale tracking, token explorer, and TradingView-style charts.";

export const metadata: Metadata = {
  // Made link previews real. Without it Next emits a relative `og:image` path,
  // and every platform that unfurls a link — Slack, iMessage, Discord, X —
  // silently drops the image rather than resolving it, so a shared URL showed
  // up as a bare blue link.
  metadataBase: new URL(SITE_URL),
  title: "TradeOps — Open On-Chain Analytics",
  description: DESCRIPTION,
  // `title` and `description` are deliberately absent here: Next fills those
  // from whatever the page resolved, so /legal/privacy previews as the privacy
  // page instead of inheriting the home page's pitch, while the image and the
  // site name stay shared.
  openGraph: {
    type: "website",
    siteName: "TradeOps",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "TradeOps — open-source on-chain analytics, with a candlestick chart and a last-price marker",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
