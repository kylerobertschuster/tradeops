import type { Metadata } from "next";
import Link from "next/link";
import { RPC_SOURCE_NAMES, SOURCES } from "@/lib/legal";

/**
 * The sources page, rendered from `SOURCES` in `src/lib/legal.ts`.
 *
 * VERIFICATION LEDGER — what was actually confirmed, and when (2026-09-14).
 * ---------------------------------------------------------------------------
 * Links below are only present if a direct request returned 200:
 *   kraken.com/legal                        200
 *   okx.com/help/terms-of-service           200
 *   crypto.com/us/legal                     200   (crypto.com/en/terms-and-conditions → 404)
 *   bybit.com/en/legal                      200
 *   allnodes.com/terms                      200
 *   flashbots.net/terms-of-service          200
 *   docs.blockscout.com                     200
 * Unreachable to an automated request, so absent or marked unverified:
 *   binance.com/en/terms            202  bot challenge, document not served
 *   coinbase.com/legal/user_agreement 403 Cloudflare challenge, document not served
 *   drpc.org/terms-of-service       404  (drpc.org root: 200)
 *   1rpc.io                         200  but no terms URL found to link
 * The terms still govern regardless. This ledger exists so nobody has to guess
 * which of these were read and which were only assumed — the distinction the
 * rest of this project insists on for market data applies to legal research
 * too. Re-check before citing any of it as current.
 */
export const metadata: Metadata = {
  title: "Data Sources — TradeOps",
  description:
    "Every third party the tradeOPs terminal reads from, what is taken from each, and which ones your browser connects to directly.",
};

export default function SourcesPage() {
  return (
    <>
      <h1 className="text-[19px] font-semibold text-tv-text">Data Sources</h1>
      <p className="text-tv-muted">
        Everything tradeOPs shows came from somebody else, and this is the complete list. It is
        short on purpose, and it is kept complete by a test: any new third-party hostname in the
        code fails the build until it is described on this page.
      </p>

      <div className="legal-callout">
        <p className="font-semibold text-tv-text">Where the numbers come from</p>
        <ul>
          <li>
            Prices and candles are each venue&rsquo;s <em>own</em> quote, fetched live and shown side
            by side. Nothing is averaged across venues, because the disagreement between them is
            information.
          </li>
          <li>Nothing is generated, filled in or estimated. Where a source has no value, you see a dash.</li>
          <li>Every source here is used without an account or an API key.</li>
        </ul>
      </div>

      <h2>Every source</h2>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>What we take from it</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>
          {SOURCES.map((source) => (
            <tr key={source.name}>
              <td>
                {source.name}
                {source.direct && (
                  <span className="block text-[10px] font-normal uppercase tracking-wide text-tv-muted">
                    your browser
                  </span>
                )}
              </td>
              <td>{source.purpose}</td>
              <td className="whitespace-nowrap">
                <a href={source.site} target="_blank" rel="noreferrer noopener">
                  site
                </a>
                {source.terms ? (
                  <>
                    {" · "}
                    <a href={source.terms} target="_blank" rel="noreferrer noopener">
                      terms
                    </a>
                  </>
                ) : (
                  // Not "no terms" — "we could not retrieve a link to check".
                  <span className="text-tv-muted"> · terms not verified</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>What the app does with it</h2>
      <ul>
        <li>
          <strong>Nothing is stored long-term.</strong> There is no archive, no historical database
          and no warehouse — this app has no server-side storage at all. Responses are held in a
          short-lived cache of a few seconds so that many readers can share one upstream request,
          which keeps tradeOPs a light consumer of services it does not pay for.
        </li>
        <li>
          <strong>Nothing is redistributed as a feed.</strong> No bulk downloads, no exported
          dataset, no API for reselling. The data is displayed to a person looking at a chart, which
          is what these providers publish it for.
        </li>
        <li>
          <strong>Requests are rate-limited per client</strong> for the reason above: an
          egress-blocked deployment helps nobody, including the providers. See the{" "}
          <Link href="/legal/terms">terms</Link>.
        </li>
        <li>
          <strong>No logos or marks are used.</strong> A venue appears as a name and a plain colour
          swatch. Nothing here claims to be affiliated with, endorsed by or sponsored by any exchange,
          provider or node operator, and none of them has reviewed or approved this app.
        </li>
      </ul>

      <h2>Exchange prices are not executable prices</h2>
      <p>
        A candle&rsquo;s closing price is the last trade that happened, not an offer anyone is
        obliged to honour. It carries no bid, no ask, no size, no depth and no fees. When two venues
        are shown apart, the difference between their last prices is a spread in the loose sense and
        not an opportunity: by the time you could act, the price has moved, and the costs of moving
        funds between venues would usually swallow any edge smaller than the gap itself. That is why
        the app labels this a spread and never an arbitrage.
      </p>

      <h2>The Ethereum nodes are replaceable</h2>
      <p>
        The last four rows above — {RPC_SOURCE_NAMES.join(", ")} — are public JSON-RPC endpoints
        belonging to four separate operators, tried in that order. They are the defaults, chosen so
        that a local run works with no configuration, and they are fine for that. They are not a
        data service to build traffic on, and each operator sets its own terms.
      </p>
      <p>
        Anyone running this app can point it at their own node instead, in one environment variable:
        <code>ETH_RPC_URLS</code> takes a comma-separated list, tried in order, or the value{" "}
        <code>off</code> to switch the on-chain panels off entirely rather than lean on somebody
        else&rsquo;s hardware. If you are deploying this seriously, do that first.
      </p>

      <h2>About the links on this page</h2>
      <p>
        A &ldquo;terms&rdquo; link is shown only where the address was actually fetched and returned
        the document. Two are missing because Binance and Coinbase answer automated requests with a
        bot challenge instead of the page, so the URL could not be read and is not guessed at here;
        their terms of use still apply to their data, and you will find them from their sites. The
        distinction matters, and it is the same one this project applies to market data: a missing
        value is reported as missing rather than filled in with something plausible.
      </p>
      <p>
        Linking to a source is not an endorsement of it, and tradeOPs is not responsible for a third
        party&rsquo;s content, availability or conduct.
      </p>
    </>
  );
}
