import Link from "next/link";
import type { Metadata } from "next";
import { BROWSER_STORAGE_KEYS, ISSUES_URL, LAST_UPDATED, SUPPORT_LINKS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy — TradeOps",
  description:
    "tradeOPs has no accounts, no cookies, no analytics and no server-side database. What that means in practice, stated completely.",
};

export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-[19px] font-semibold text-tv-text">Privacy</h1>
      <p className="text-tv-muted">Effective {LAST_UPDATED}.</p>

      <div className="legal-callout">
        <p className="font-semibold text-tv-text">In short</p>
        <ul>
          <li>
            No account, no sign-up, no email, no password, no payment details.
            {SUPPORT_LINKS.length > 0 &&
              " If you donate, the payment platform handles it on their own site, never this one."}
          </li>
          <li>
            The app stores nothing about you on the server, because there is no database and nothing
            to store it in. Your watchlist, labels and paper account live in your own browser.
          </li>
          <li>No cookies, no analytics, no tracking pixels, no advertising, no data sales.</li>
          <li>
            One connection is made straight from your browser to Binance, for the live price stream.
            Details below — it is the only one.
          </li>
        </ul>
      </div>

      <h2>1. What is not collected</h2>
      <p>
        tradeOPs has no accounts, so it does not have, and cannot have, your name, email address,
        password, phone number, billing details, wallet address, seed phrase, exchange API key or
        anything else that identifies you. There are no forms to fill in and no field to submit. You
        are never asked to sign in, because there is nothing to sign in to.
      </p>
      {SUPPORT_LINKS.length > 0 && (
        <p>
          Donations are the one place money is ever involved, and even then it is not this app that
          touches it. A donation happens entirely on the payment platform&rsquo;s own site, under
          that platform&rsquo;s own privacy policy, and what you give them — a name, an email
          address, card or bank details — never reaches here. There is no webhook, no callback and
          no code path in this repository that receives payment details or even learns that a payment
          happened. The link sends your browser to them, and that is the whole of it.
        </p>
      )}

      <h2>2. What the server handles, and for how long</h2>
      <p>
        A web request has to arrive somewhere. When you load the page or the app fetches fresh
        prices, that request reaches the server, and like any web host ours processes standard
        connection metadata — IP address, user agent, requested path, timestamp.
      </p>
      <ul>
        <li>
          <strong>Nothing is written to a database or a data store of ours.</strong> This app has no
          server-side storage at all — no users table, no sessions, no analytics store.
        </li>
        <li>
          <strong>The app writes no log lines.</strong> There is no logging call anywhere in the
          source, so no IP address or request detail is recorded by the application. Our hosting
          provider still processes traffic at the network edge under its own privacy policy, as any
          host does.
        </li>
        <li>
          <strong>Rate limiting uses the IP address, in memory only.</strong> To stop one client
          from getting the deployment blocked by an upstream provider, the server counts requests
          per client per minute. Those counters are a number and a timestamp held in the running
          process; they are never written to disk, never shared, never used to build a profile, and
          they disappear when the process restarts.
        </li>
        <li>
          <strong>Nothing is sold, rented or shared</strong> for advertising, profiling or any other
          purpose.
        </li>
      </ul>

      <h2>3. What is stored in your browser</h2>
      <p>
        Two things are saved in your browser&rsquo;s local storage so the app still looks the way you
        left it. They stay on your device. There is no code that uploads them, and the server never
        sees them:
      </p>
      <ul>
        {BROWSER_STORAGE_KEYS.map((entry) => (
          <li key={entry.key}>
            <code>{entry.key}</code> — {entry.holds}
          </li>
        ))}
      </ul>
      <p>
        This is why the paper-trading P&amp;L shown here is yours alone and cannot be checked against
        anything: nobody else can see it, including us.
      </p>

      <h2>4. The one connection your browser makes directly</h2>
      <p>
        Live prices arrive over a WebSocket that your browser opens directly to{" "}
        <code>wss://data-stream.binance.vision</code>. That is deliberate — it is what makes prices
        tick without spending a server request for every update — but it means{" "}
        <strong>Binance sees your IP address</strong> for as long as the stream is open, along with
        the list of symbols you are watching. Binance&rsquo;s own privacy policy, not this one,
        governs that connection. It is the only third party that receives your IP from this app.
      </p>
      <p>
        Everything else — candles, 24-hour stats, on-chain data — is fetched by the server on your
        behalf, so the exchanges and node operators see the server&rsquo;s address rather than yours.
        It also means they never learn which symbols a particular person is looking at.
      </p>

      <h2>5. No cookies, no analytics, no trackers</h2>
      <p>
        The app sets no cookies of its own, which is why there is no consent banner: there is nothing
        to consent to. There is no Google Analytics, no tag manager, no heatmap recorder, no session
        replay, no A/B testing service, no error reporter, no social pixel and no advertising
        network. No third-party script is loaded from anywhere.
      </p>
      <p>
        The fonts are downloaded when the site is built and served from this site, so loading a page
        makes no request to Google or to any font service. The only third-party request your browser
        makes is the price stream described above.
      </p>

      <h2>6. Deleting it all</h2>
      <p>
        Because everything personal lives in your browser, clearing this site&rsquo;s data clears all
        of it: your paper account, your positions, your trade history and your address labels are
        gone, immediately and permanently, with no copy anywhere else and no way to recover them.
        There is nothing to request from us, and nothing for us to delete.
      </p>

      <h2>7. Your rights</h2>
      <p>
        If you are in a jurisdiction with data protection rights — the GDPR, the CCPA, and the like —
        you have rights of access, correction, deletion, portability and objection over personal data
        held about you. We do not hold any. We cannot look you up, identify you, or produce a record
        of your activity, and that is a property of the design rather than a policy we might change
        later. The rights you can exercise, you exercise directly: your data is on your device, in
        the two keys listed above.
      </p>
      <p>
        One exception is worth stating plainly: if you open or comment on an issue on the{" "}
        <a href={ISSUES_URL} target="_blank" rel="noreferrer noopener">issue tracker</a>, that
        happens on GitHub. What you write there is public, visible to everyone, and held by GitHub
        under GitHub&rsquo;s privacy policy — so please do not put anything private in it.
      </p>

      <h2>8. If you are running your own copy</h2>
      <p>
        This page describes the hosted instance at the project&rsquo;s own deployment. If you run
        your own copy of tradeOPs, you are the operator and this policy is not yours to inherit: you
        are responsible for your own hosting privacy obligations, including anything your host,
        your configuration or any change you make to the code collects.
      </p>

      <h2>9. Changes</h2>
      <p>
        If this policy changes, the date above changes with it. The most likely change is a new
        sentence rather than a new practice, because adding tracking to this app would mean deleting
        a test that is designed to fail when anyone adds it — anything that collects or transmits
        personal data has to be a deliberate, visible decision, not an accident.
      </p>

      <h2>10. How the claims above are kept honest</h2>
      <p className="text-tv-muted">
        These are not aspirations. The privacy claims and the{" "}
        <Link href="/legal/sources">data source list</Link> are checked by tests in the repository,
        which fail if a tracking script, a cookie write, a new browser storage key or a new
        third-party hostname turns up in the code without the pages being updated to match. If you
        find something below that contradicts what you see the app doing, that is a bug, and the{" "}
        <a href={ISSUES_URL} target="_blank" rel="noreferrer noopener">issue tracker</a> is the right
        place to report it.
      </p>
    </>
  );
}
