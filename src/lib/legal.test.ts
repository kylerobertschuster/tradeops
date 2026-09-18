import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BROWSER_STORAGE_KEYS, LINK_ONLY_HOSTS, SOURCES, SUPPORT_LINKS } from "./legal";
import { DEFAULT_SITE_URL, SITE_URL } from "./site";

/**
 * The `/legal` pages make three checkable promises:
 *
 *   1. The data sources page lists *every* third party the app talks to.
 *   2. The privacy page's "no cookies, no analytics, no trackers" is true.
 *   3. The privacy page lists exactly the things stored in the browser.
 *
 * Promises about software go stale the moment somebody adds a feature, and a
 * legal page that quietly became false is worse than one that never made the
 * claim. So each promise is a test: adding a tracker, a new upstream host or a
 * new storage key fails the build until the page is updated too.
 *
 * The scan is textual and deliberately simple. It is not trying to prove the
 * absence of something — it cannot — but to make the absence loud when it stops
 * being true, which is the failure mode that actually happens.
 */

const SRC = fileURLToPath(new URL("../", import.meta.url));

/** Every `.ts`/`.tsx` file under `src/`, minus the tests themselves. */
function sourceFiles(): { path: string; text: string }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(SRC);
  return files.map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));
}

const FILES = sourceFiles();

/** Absolute URL hostnames appearing anywhere in a file. */
function hostsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:https?|wss?):\/\/([a-zA-Z0-9._-]+)/g)) {
    found.push(match[1].toLowerCase());
  }
  return found;
}

function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

/**
 * RFC 2606 and RFC 6761 reserve these; they can never resolve to a real
 * upstream, so a documentation example using one cannot smuggle in a data
 * source. `ETH_RPC_URLS=https://my-node.example.com` in a docstring is the case
 * this exists for.
 */
const RESERVED_HOST = /(^|\.)(example|invalid|test|localhost|example\.(com|net|org))$/;

/**
 * Our own deployment is not a third party.
 *
 * `site.ts` holds this app's origin for `metadataBase`, which the scan below
 * would otherwise report as an unlisted upstream and demand a data-source row
 * for. Both the resolved origin and the compiled-in default are exempt, because
 * `NEXT_PUBLIC_SITE_URL` can replace one while the other literal stays in the
 * file. Everything else is still held to the same standard as before.
 */
const OWN_HOSTS = new Set([hostOf(SITE_URL), hostOf(DEFAULT_SITE_URL)]);

/** Hosts the sources page accounts for, whether as a fetch target or a link. */
const ACCOUNTED_FOR = new Set<string>([
  ...LINK_ONLY_HOSTS,
  ...SOURCES.flatMap((source) => [
    ...source.hosts,
    hostOf(source.site),
    ...(source.terms ? [hostOf(source.terms)] : []),
  ]),
].map((host) => host.toLowerCase()));

describe("the sources page accounts for every third-party host", () => {
  it("has no hostname in src/ that is missing from SOURCES", () => {
    const unaccounted = new Set<string>();
    for (const file of FILES) {
      for (const host of hostsIn(file.text)) {
        if (RESERVED_HOST.test(host)) continue;
        if (OWN_HOSTS.has(host)) continue;
        if (ACCOUNTED_FOR.has(host)) continue;
        unaccounted.add(`${host}  (${file.path})`);
      }
    }
    expect(
      [...unaccounted],
      "New third-party host(s) found. Every upstream has to appear on /legal/sources: " +
        "add an entry to SOURCES in src/lib/legal.ts (name, what we take, hosts, site, " +
        "and a terms URL only if you actually fetched it), or add the host to " +
        "LINK_ONLY_HOSTS if it is a link we never fetch.",
    ).toEqual([]);
  });

  it("catches a host that is genuinely absent from SOURCES", () => {
    // The guard above can only be trusted if it can fail, so this proves it
    // fires on a host that is not accounted for.
    expect(hostsIn('fetch("https://tracker.example.net/collect")')).toEqual([
      "tracker.example.net",
    ]);
    expect(ACCOUNTED_FOR.has("tracker.example.net")).toBe(false);
  });

  it("describes every source it lists, and only links to https", () => {
    for (const source of SOURCES) {
      expect(source.name, "every source needs a name").toBeTruthy();
      expect(source.purpose.length, `${source.name} needs a description`).toBeGreaterThan(20);
      expect(source.hosts.length, `${source.name} needs at least one host`).toBeGreaterThan(0);
      expect(source.site.startsWith("https://"), `${source.name} site must be https`).toBe(true);
      if (source.terms !== null) {
        // `null` means "could not confirm" — see the field's comment. A set
        // value has to be a real https address rather than a guess.
        expect(source.terms.startsWith("https://"), `${source.name} terms must be https`).toBe(
          true,
        );
      }
    }
  });
});

describe("support links are links, never upstreams", () => {
  it("lists only https links on hosts that are allowed to be links", () => {
    for (const link of SUPPORT_LINKS) {
      expect(link.name, "every support link needs a name").toBeTruthy();
      expect(link.note.length, `${link.name} needs a note`).toBeGreaterThan(10);
      expect(link.url.startsWith("https://"), `${link.name} must be https`).toBe(true);
      // Two things at once: the app must never fetch a payment page, and the
      // host scan above has to be able to account for the hostname. A support
      // link that is not a link-only host fails one of those.
      expect(LINK_ONLY_HOSTS, `${link.name} host must be link-only`).toContain(hostOf(link.url));
    }
  });
});

describe("the privacy page's claims are true of the code", () => {
  /**
   * Shapes that would each mean the privacy page is now lying.
   *
   * `googleapis` is in the list because the page promises fonts are self-hosted;
   * replacing `next/font` with a font CDN would otherwise be a silent change.
   */
  const FORBIDDEN = [
    "document.cookie",
    "navigator.sendBeacon",
    "google-analytics",
    "googletagmanager",
    "gtag(",
    "googleapis",
    "fonts.gstatic",
    "plausible.io",
    "posthog",
    "mixpanel",
    "amplitude",
    "hotjar",
    "sentry.io",
    "@sentry/",
    "segment.com",
    "doubleclick",
    "facebook.net",
  ];

  it("contains no cookies, analytics, trackers or error reporting", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const pattern of FORBIDDEN) {
        if (file.text.includes(pattern)) offenders.push(`${pattern}  (${file.path})`);
      }
    }
    expect(
      offenders,
      "Something was added that the privacy page says does not exist. Either remove it, " +
        "or update src/app/legal/privacy/page.tsx (and expect to explain the change to " +
        "readers, because the page currently promises there is nothing to consent to).",
    ).toEqual([]);
  });

  it("stores exactly the keys the privacy page lists, and no others", () => {
    // zustand persists by name; the number literal is inside `persist(...)`
    // options, so `name` next to `storage` is the stored key.
    const stored = new Set<string>();
    for (const file of FILES) {
      if (!file.path.startsWith("store/")) continue;
      for (const match of file.text.matchAll(/name:\s*"([^"]+)"[\s\S]{0,80}?storage:/g)) {
        stored.add(match[1]);
      }
    }
    expect(
      [...stored].sort(),
      "The persisted keys and the privacy page disagree. Update BROWSER_STORAGE_KEYS " +
        "in src/lib/legal.ts so the page describes what is actually saved.",
    ).toEqual(BROWSER_STORAGE_KEYS.map((entry) => entry.key).sort());
  });

  it("writes to browser storage only from the two documented stores", () => {
    // Belt and braces: the key list above is only complete if every writer is a
    // zustand store, so a direct `localStorage.setItem` elsewhere must fail.
    const offenders = FILES.filter(
      (file) =>
        !file.path.startsWith("store/") &&
        (file.text.includes("localStorage") || file.text.includes("sessionStorage")),
    ).map((file) => file.path);
    expect(offenders, "These files touch browser storage outside src/store/").toEqual([]);
  });
});
