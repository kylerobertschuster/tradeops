import Link from "next/link";
import type { Metadata } from "next";
import { GOVERNING_LAW, ISSUES_URL, LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Use — TradeOps",
  description:
    "Terms of use for tradeOPs: paper trading only, no financial advice, third-party market data provided as-is.",
};

export default function TermsPage() {
  return (
    <>
      <h1 className="text-[19px] font-semibold text-tv-text">Terms of Use</h1>
      <p className="text-tv-muted">
        Effective {LAST_UPDATED}. By using this site or the software behind it, you agree to what
        follows. If you do not agree, do not use it.
      </p>

      <div className="legal-callout">
        <p className="font-semibold text-tv-text">In short</p>
        <ul>
          <li>It is free software for looking at market data and practising trades.</li>
          <li>
            <strong>No money is involved and no orders are placed.</strong> The trading account is
            simulated and stored in your browser.
          </li>
          <li>
            <strong>Nothing here is financial advice,</strong> and it is not a recommendation to buy
            or sell anything.
          </li>
          <li>
            The data is somebody else&rsquo;s, provided as-is, and may be delayed, wrong or missing.
          </li>
          <li>You use it at your own risk, and we are not liable for your losses.</li>
        </ul>
      </div>

      <h2>1. What tradeOPs is</h2>
      <p>
        tradeOPs is a free, open-source terminal for reading public cryptocurrency market data,
        inspecting on-chain activity, drawing charts, and practising trades against a simulated
        account. The source is published under the MIT License, and anyone may run their own copy.
      </p>
      <p>
        tradeOPs is <strong>not</strong> a broker, dealer, exchange, trading venue, custodian,
        investment adviser, portfolio manager or financial institution. It is not registered or
        licensed as any of those, in any jurisdiction. It has no ability to place, route, settle or
        cancel an order on any market, and it holds no funds, no balances and no assets on your
        behalf or anyone else&rsquo;s.
      </p>

      <h2>2. Not financial advice</h2>
      <p>
        Everything on this site is general information about publicly observable markets. It is not
        advice, a recommendation, a solicitation, or an offer to buy or sell any asset, and it is not
        tailored to you, your circumstances, your objectives or your risk tolerance. We do not know
        your financial position, and nothing here is a substitute for it.
      </p>
      <p>
        Indicators, spread tables and whale lists are arithmetic performed on data other people
        published. They are not predictions, signals to act on, or statements that any asset is
        suitable for anyone. If you want advice, talk to somebody licensed to give it. If you want to
        trade, use a regulated venue and read its terms.
      </p>

      <h2>3. No real trading</h2>
      <p>
        The order ticket is a simulator. It records a fill in your own browser so you can see what a
        position would have done. It does not transmit anything anywhere, and there is no code path
        in the app that could send an order to an exchange, because tradeOPs has no API keys, no
        exchange accounts and no credentials of any kind.
      </p>
      <p>
        You are never asked for an exchange API key, a wallet private key, a seed phrase, a card
        number or a password. <strong>If anything claiming to be tradeOPs asks you for one of
        those, it is not tradeOPs.</strong> No hosted version of this project should ever ask for
        them, and anyone who modifies a copy to do so is running something else.
      </p>

      <h2>4. Market data is third-party and comes as-is</h2>
      <p>
        Prices, candles, 24-hour statistics, order-flow summaries, token transfers and holder counts
        are fetched live from the third parties listed on the{" "}
        <Link href="/legal/sources">data sources</Link> page. We do not generate, audit, correct or
        verify any of it.
      </p>
      <p>Specifically, and without limiting the rest of this document:</p>
      <ul>
        <li>
          Data may be <strong>delayed, incomplete, mislabelled, stale or simply wrong</strong>. A
          free public endpoint is not a market data feed, and it is not obliged to be accurate.
        </li>
        <li>
          Where the app shows several venues side by side, they will often disagree. That is the
          point of the feature — the disagreements are real, and they are not resolved, smoothed or
          averaged away. Every figure is one venue&rsquo;s own quote.
        </li>
        <li>
          Quotes shown from candles are <strong>not executable prices</strong>. No bid, no ask, no
          depth and no fees are represented. The gap between two venues&rsquo; last traded prices is
          not a profit you could capture.
        </li>
        <li>
          A venue may be unreachable, rate-limited, or unavailable in your region, and the app will
          say so rather than invent a number. Where a source has no value for a symbol, the app
          shows nothing instead of a placeholder.
        </li>
        <li>
          Nothing here is a record of execution. For the authoritative record of any trade, consult
          the venue where it happened.
        </li>
      </ul>

      <h2>5. No warranty</h2>
      <p>
        The software and the hosted instance are provided <strong>&ldquo;as is&rdquo;, without
        warranty of any kind</strong>, whether express, implied or statutory, including without
        limitation the implied warranties of merchantability, fitness for a particular purpose,
        title, accuracy and non-infringement. The MIT License that governs the software says the
        same thing and applies in full.
      </p>
      <p>
        No promise is made that the service will be available, uninterrupted, timely, secure or free
        of error, that defects will be corrected, or that the data is accurate. The hosted instance
        may change, break, or be withdrawn at any time without notice.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, the authors, contributors and operators of tradeOPs
        are <strong>not liable for any loss or damage of any kind</strong> arising out of or in
        connection with your use of, or inability to use, this software or the data it shows. This
        includes, without limitation:
      </p>
      <ul>
        <li>trading losses of any kind, including those resulting from a price shown here by mistake;</li>
        <li>loss arising from data that was delayed, unavailable, mislabelled or wrong;</li>
        <li>loss of profits, opportunity, goodwill, data or savings, or any indirect, incidental, special, consequential or punitive damage;</li>
        <li>loss arising from an interruption, a bug, a rate limit, a host outage, or a third party changing or withdrawing its data.</li>
      </ul>
      <p>
        This applies regardless of the legal theory — contract, tort, negligence, strict liability or
        otherwise — and even if the possibility of such loss was known. Where a jurisdiction does
        not allow a complete exclusion of liability, the exclusion applies to the greatest extent it
        allows, and where a limit must be stated rather than excluded, that limit is{" "}
        <strong>the amount you have paid to use tradeOPs, which is zero</strong>.
      </p>
      <p>
        Some jurisdictions do not allow the exclusion of certain warranties or liabilities. Nothing
        in these terms excludes any liability that cannot lawfully be excluded, including liability
        for fraud or for death or personal injury caused by negligence, where that is not permitted.
      </p>

      <h2>7. Your risk</h2>
      <p>
        Cryptocurrency markets are volatile, trade continuously, and can move further and faster than
        any chart or indicator can show. Assets can lose most or all of their value. Venues can go
        down, halt, or fail. On-chain transactions are irreversible, and public addresses are public
        — whatever you do with the information here, you do on your own judgement and at your own
        risk.
      </p>

      <h2>8. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          <strong>Redistribute the data as a feed.</strong> The numbers here belong to the venues
          and providers that publish them, and each of them has its own terms about reuse. Do not
          treat this app — or an instance you modify — as a market data source you can resell, mirror
          in bulk, or feed into another product.
        </li>
        <li>
          <strong>Hammer it.</strong> Requests are rate-limited, and the limits exist to keep one
          client from getting the deployment egress-blocked by an upstream, which would take the
          site down for everyone. Do not attempt to defeat or evade the limiter.
        </li>
        <li>
          <strong>Use it to dodge a regional restriction.</strong> If a venue is not available where
          you are, it is blocked here too, for everyone, and proxying through this app to work around
          that is not what it is for.
        </li>
        <li>
          <strong>Imply an endorsement.</strong> Do not present tradeOPs as affiliated with,
          approved by or sponsored by any exchange, data provider or node operator, or use their
          names or logos in a way that suggests it.
        </li>
        <li>
          <strong>Break the law</strong>, or use the app to facilitate market manipulation, money
          laundering, sanctions evasion, or anything else unlawful.
        </li>
      </ul>
      <p>
        Access may be limited or blocked, with or without notice, for conduct that abuses the service
        or its upstream providers.
      </p>

      <h2>9. Third-party data and third-party terms</h2>
      <p>
        Your use of each source&rsquo;s data is also subject to that source&rsquo;s own terms of use,
        and those terms are between you and them. The{" "}
        <Link href="/legal/sources">data sources</Link> page names every provider and what is taken
        from each. Some terms could not be retrieved automatically and are marked as unverified
        there rather than guessed at.
      </p>
      <p>
        Providing a link to a third party is not an endorsement of them, and we are not responsible
        for their content, their availability or their conduct.
      </p>

      <h2>10. The software, and running your own copy</h2>
      <p>
        The source code is available under the MIT License, which permits you to use, copy, modify
        and redistribute it. The licence text governs the software and is not replaced by this page.
      </p>
      <p>
        If you run your own instance, <strong>you become the operator</strong>. These terms describe
        the hosted instance, not yours. You are responsible for your own upstream agreements, your
        own privacy obligations to your users, your own disclaimers, and your own compliance with
        whatever applies where you are. Deleting or rewriting these pages for your deployment does
        not transfer any of it back to us.
      </p>

      <h2>11. Changes to these terms</h2>
      <p>
        These terms may be revised as the app changes, and the effective date above will move when
        they are. Continuing to use tradeOPs after a change means you accept the revised version.
      </p>

      <h2>12. Governing law</h2>
      {GOVERNING_LAW ? (
        <p>
          These terms are governed by the laws of {GOVERNING_LAW}, and the courts there have
          exclusive jurisdiction over any dispute arising from them or from your use of tradeOPs.
        </p>
      ) : (
        <div className="legal-callout is-warning">
          <p className="font-semibold text-tv-text">Not configured yet</p>
          <p className="text-tv-muted">
            This deployment has not named a governing jurisdiction, and no place is invented here on
            purpose: choosing one is a statement about who the operator is and where they can be
            sued, which only the operator can make. It is a one-line change in{" "}
            <code>src/lib/legal.ts</code> (set <code>GOVERNING_LAW</code>), and it should be set
            before this deployment is promoted publicly.
          </p>
        </div>
      )}
      <p className="text-tv-muted">
        If a part of these terms is found unenforceable, that part is severed and the rest continues
        to apply.
      </p>

      <h2>13. Questions and corrections</h2>
      <p>
        Use the <a href={ISSUES_URL} target="_blank" rel="noreferrer noopener">public issue tracker</a>.
        Disagreements about the data itself are best taken to the venue that published it — this app
        can only report what it was given.
      </p>

      <h2>14. How this document was written</h2>
      <p className="text-tv-muted">
        Plainly, because it matters: tradeOPs is a free project and this page was written by the
        people who wrote the software, not by a lawyer. It is an honest, specific attempt to state
        the deal and disclaim what needs disclaiming, and it is not legal advice to you or to anyone
        else. If you are relying on this to protect something meaningful — a company, revenue, real
        money, a jurisdiction with unusual rules — that is exactly the situation worth paying a
        lawyer for a few hours. These pages are a good first draft and a bad final opinion.
      </p>
    </>
  );
}
