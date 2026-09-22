import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LINK_ONLY_HOSTS, SOURCES } from "./legal";

/**
 * `connect-src` is the one directive in the policy that is enforced by the
 * browser and by nothing else. An origin missing from it produces a console
 * error in the visitor's browser, no server-side symptom, no failing request
 * anyone can see from here — so it went unnoticed twice: the market view's
 * candle host, and BlockScout, which hid behind a server-side fallback for two
 * days before anyone noticed the browser was never the one asking.
 *
 * The fix is not a comment saying "remember to update connect-src". It is this
 * file, which reads the policy out of `next.config.ts`, works out which modules
 * the browser actually bundles, and fails the build when an origin the client
 * can reach is not allowed to connect.
 *
 * What it checks, and why in this order:
 *
 *   1. The policy is well formed and actually attached to responses.
 *   2. The modules the client can reach are the ones we think they are. A scan
 *      that silently finds nothing passes every assertion after it, so the
 *      graph is asserted non-empty and asserted to contain the modules that
 *      carry the browser's own requests.
 *   3. Every `export const NAME = "<origin>"` reachable from the client has its
 *      origin in `connect-src` — unless it is a link, which is never a
 *      connection.
 *   4. Every origin reachable from a call site in that same graph is allowed —
 *      not just the one in `fetch(...)`, but the one passed *into* the fetch
 *      helper, which is how BlockScout reaches the browser.
 *   5. Nothing in `connect-src` is dead: an origin the client can no longer
 *      reach is an allowance kept for nobody.
 *
 * The scan is textual and deliberately simple, in the same spirit as
 * `legal.test.ts`. It is not trying to prove the absence of a bug — it cannot —
 * but to make the next one loud. The two files divide the work: this one owns
 * *may this be connected to*, `legal.test.ts` owns *is this disclosed*. An
 * origin smuggled in through an object literal rather than a URL constant slips
 * past step 3 here and is caught there, which is why both exist.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = fileURLToPath(new URL("../", import.meta.url));
const CONFIG_PATH = join(ROOT, "next.config.ts");

/**
 * The modules that carry the browser's own requests, asserted to be present in
 * the reachable graph below.
 *
 * This is the anti-vacuity guard. Every check in this file is "for each X in
 * the graph, assert Y" — and `for each` over an empty set is true. Renaming
 * `api.ts`, or moving the websocket out of `live.ts`, would quietly reduce the
 * scan to nothing and leave a green build behind. Naming them here means the
 * scan has to be able to see the code it is about.
 */
const MUST_BE_REACHABLE = [
  "lib/api.ts",
  "lib/live.ts",
  "lib/holders.ts",
  "lib/overview.ts",
];

/* ------------------------------------------------------------------ *
 * Reading the policy
 * ------------------------------------------------------------------ */

/** The directive list, pulled out of the `CSP` array literal. */
function connectSrcOf(configText: string): string[] {
  const found = [...configText.matchAll(/"connect-src\s+([^"]*)"/g)];
  // Exactly one, because two would mean the later silently wins and the scan
  // below would be validating a policy that is not the one served.
  if (found.length !== 1) return [];
  return found[0][1].split(/\s+/).filter(Boolean);
}

/**
 * Origins in a directive list, minus the `'self'` keyword.
 *
 * `'self'` is the app's own origin and covers every `/api/...` route, so it is
 * never something to check against the source: a same-origin fetch has no
 * origin literal to find.
 */
function originsOf(tokens: string[]): string[] {
  return tokens.filter((t) => t !== "'self'").map((t) => t.toLowerCase());
}

/* ------------------------------------------------------------------ *
 * Which modules the browser bundles
 * ------------------------------------------------------------------ */

type File = { path: string; text: string };

/** Every `.ts`/`.tsx` file under `src/`, minus the tests themselves. */
function sourceFiles(): File[] {
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

type Import = { specifier: string; typeOnly: boolean };

/**
 * Whether an import clause carries no runtime binding.
 *
 * This is the hinge the whole check turns on. `import type { MarketSource }
 * from "./market"` is erased at build time, so `market.ts` never reaches the
 * client — which is exactly why the seven venue endpoints in it are not in
 * `connect-src` and do not need to be. `import { BLOCKSCOUT_BASE } from
 * "./holders"` is a value import, so `holders.ts` does reach the client, and
 * the origin it exports does need to be allowed.
 *
 * Written as "every named binding is prefixed `type`" rather than "the clause
 * starts with `type`", because `import { type A, b }` is a value import.
 */
function isTypeOnly(clause: string): boolean {
  const trimmed = clause.trim();
  if (/^type\b/.test(trimmed)) return true;
  const braces = /\{([^}]*)\}/.exec(trimmed);
  if (!braces) return false;
  const names = braces[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((n) => /^type\s/.test(n));
}

function importsIn(text: string): Import[] {
  const out: Import[] = [];
  for (const match of text.matchAll(/import\s+([^;]*?)\s+from\s*["']([^"']+)["']/g)) {
    out.push({ specifier: match[2], typeOnly: isTypeOnly(match[1]) });
  }
  // `export ... from` creates a module dependency too.
  for (const match of text.matchAll(/export\s+([^;]*?)\s+from\s*["']([^"']+)["']/g)) {
    out.push({ specifier: match[2], typeOnly: isTypeOnly(match[1]) });
  }
  return out;
}

/** `@/x` → `src/x`, `./x` → relative to the importer, a bare name → a package. */
function resolveModule(files: File[], from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(SRC, dirname(from), specifier);
  else return null;
  for (const candidate of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const full = base + candidate;
    if (files.some((f) => join(SRC, f.path) === full)) return relative(SRC, full);
  }
  return null;
}

/**
 * The modules the browser can execute: everything a `"use client"` module
 * pulls in through a value import, transitively.
 *
 * `"use client"` marks the entry points — the components and hooks the client
 * bundle is built from. Following value imports from there is an over-approximation
 * on purpose: a module that is reachable but whose fetching functions are never
 * called by the browser (VenueStrip uses `venueSymbol` from `venues.ts` and
 * never its endpoints) is still scanned, which can only ever report too much,
 * never too little.
 */
function clientReachable(files: File[]): Set<string> {
  const seeds = files.filter((f) => /["']use client["']/.test(f.text)).map((f) => f.path);
  const seen = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const file = files.find((f) => f.path === current);
    if (!file) continue;
    for (const imported of importsIn(file.text)) {
      if (imported.typeOnly) continue;
      const resolved = resolveModule(files, current, imported.specifier);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

/* ------------------------------------------------------------------ *
 * Origins the client can reach
 * ------------------------------------------------------------------ */

const URL_LITERAL = /(?:https?|wss?):\/\/[a-zA-Z0-9._-]+/i;

/**
 * Comments out, so prose about a host is not mistaken for a call to it.
 *
 * Both the module docs in this directory and the audit trail in `legal.ts`
 * quote URLs at length. `//` is only stripped when a colon does not precede
 * it, because the two slashes in `https://` are not a comment.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Scheme and host, lowercased: `https://a.b/c/d` → `https://a.b`. */
function originOf(url: string): string {
  const match = /^([a-z]+):\/\/([^/\s]+)/i.exec(url);
  return match ? `${match[1].toLowerCase()}://${match[2].toLowerCase()}` : url.toLowerCase();
}

function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

/**
 * `export const NAME = "<url>"` — the shape an origin takes when a module means
 * to hand it to a caller.
 *
 * Only works on a bare string literal, which is the point: the venue endpoints
 * in `venues.ts` live inside an object literal and are never exported
 * individually, so they are correctly invisible here. An origin has to be
 * *offered* before it can be reached.
 */
function exportedOrigins(files: File[], reachable: Set<string>) {
  const out: { file: string; name: string; origin: string }[] = [];
  for (const file of files) {
    if (!reachable.has(file.path)) continue;
    for (const match of file.text.matchAll(
      /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*["']((?:https?|wss?):\/\/[^"']+)["']/g,
    )) {
      out.push({ file: file.path, name: match[1], origin: originOf(match[2]) });
    }
  }
  return out;
}

/** The text of a call's arguments, from `(` to its matching `)`. */
function callArguments(text: string, openParen: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParen; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth === 0) return text.slice(openParen + 1, i);
    }
  }
  return text.slice(openParen + 1);
}

/**
 * Every origin that reaches a call site, following the indirection.
 *
 * `fetch("https://x")` is the easy case. The two that matter are:
 *
 *   const url = `${BINANCE_DIRECT}/api/v3/klines?...`; fetch(url, ...)
 *   fetchHolderStats(symbol, BLOCKSCOUT_BASE)
 *
 * In neither is the origin written in the call. In the first it is behind a
 * local binding; in the second it is an argument to a helper whose own `fetch`
 * only ever sees a parameter, which is why BlockScout reached the browser for
 * two days without this being visible anywhere near the fetch. So identifiers
 * in an argument are resolved through the file's `const` bindings and then the
 * module-scoped exports, and *every* call is inspected rather than only the
 * network verbs: the browser origin is whatever the client hands to whatever it
 * calls, and the only honest way to bound that is to look at all of it.
 *
 * The bound is deliberately loose in one direction and strict in the other. A
 * URL passed to a function that does nothing with it is reported anyway — cheap
 * to explain, and the exemption for link-only hosts means a `href` handed to a
 * render helper stays quiet. A URL that reaches the network without passing
 * through either a literal or a named constant is the only thing this cannot
 * see, and that shape does not exist here.
 */
function originsAtCallSites(
  files: File[],
  reachable: Set<string>,
  exported: Map<string, string>,
): { file: string; origin: string }[] {
  // `if (`, `for (`, `catch (` and friends are followed by parens too, and are
  // not calls; without this their whole body would be read as an argument list.
  const NOT_A_CALL = new Set([
    "if", "for", "while", "switch", "catch", "return", "typeof", "function",
    "await", "new", "do", "else", "in", "of", "delete", "void", "case", "yield",
  ]);
  const out: { file: string; origin: string }[] = [];

  for (const file of files) {
    if (!reachable.has(file.path)) continue;
    const text = stripComments(file.text);

    // String and template bindings, collected separately so that no regex here
    // has to hold a quote inside a character class.
    const binding = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/;
    const doubleQuoted = new RegExp(binding.source + '"([^"\n]*)"', "g");
    const singleQuoted = new RegExp(binding.source + "'([^'\\n]*)'", "g");
    const templated = new RegExp(binding.source + "`([^`]*)`", "g");
    const local = new Map<string, string>();
    for (const pattern of [doubleQuoted, singleQuoted, templated]) {
      for (const match of text.matchAll(pattern)) local.set(match[1], match[2]);
    }

    // A URL argument is reported under every name it resolves through, so a
    // chain that names two constants reports both rather than only the last.
    const collect = (expression: string, depth = 0): void => {
      const literal = URL_LITERAL.exec(expression);
      if (literal) out.push({ file: file.path, origin: originOf(literal[0]) });
      if (depth >= 3) return;
      for (const identifier of expression.matchAll(/[A-Za-z_$][\w$]*/g)) {
        const bound = local.get(identifier[0]) ?? exported.get(identifier[0]);
        if (bound && bound !== expression) collect(bound, depth + 1);
      }
    };

    for (const call of text.matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)) {
      const callee = call[1].split(".").pop() as string;
      if (NOT_A_CALL.has(callee)) continue;
      collect(callArguments(text, call.index + call[0].length - 1));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Fixtures, read once
 * ------------------------------------------------------------------ */

const FILES = sourceFiles();
const REACHABLE = clientReachable(FILES);
const EXPORTED = new Map(
  exportedOrigins(FILES, REACHABLE).map((entry) => [entry.name, entry.origin]),
);

/** Hosts that are links we never fetch — the same set `legal.test.ts` uses. */
const LINK_ONLY = new Set(
  [
    ...LINK_ONLY_HOSTS,
    ...SOURCES.flatMap((source) => [
      hostOf(source.site),
      ...(source.terms ? [hostOf(source.terms)] : []),
    ]),
  ].map((host) => host.toLowerCase()),
);

/* ------------------------------------------------------------------ *
 * The checks
 * ------------------------------------------------------------------ */

describe("the policy is well formed and actually served", () => {
  it("reads a connect-src out of next.config.ts", () => {
    expect(
      existsSync(CONFIG_PATH),
      "next.config.ts is missing, so the policy cannot be read. Every check in this " +
        "file would pass vacuously against a file that is not there.",
    ).toBe(true);

    const tokens = connectSrcOf(readFileSync(CONFIG_PATH, "utf8"));
    expect(
      tokens.length,
      "next.config.ts must declare exactly one connect-src. None means the policy " +
        "cannot be checked; more than one means the last silently wins and this test " +
        "would be validating a policy that is not the one served.",
    ).toBeGreaterThan(0);
    expect(tokens).toContain("'self'");
  });

  it("attaches the policy to responses", () => {
    const config = readFileSync(CONFIG_PATH, "utf8");
    expect(
      /key:\s*"Content-Security-Policy"\s*,\s*value:\s*CSP/.test(config),
      "The CSP constant is no longer wired into SECURITY_HEADERS, so the app ships " +
        "no Content-Security-Policy at all and every origin assertion below is about " +
        "a string nobody receives.",
    ).toBe(true);
  });

  it("keeps default-src locked down", () => {
    const config = readFileSync(CONFIG_PATH, "utf8");
    expect(config).toContain("\"default-src 'self'\"");
    expect(config).toContain("\"object-src 'none'\"");
    expect(config).toContain("\"frame-ancestors 'none'\"");
  });
});

describe("the client's module graph is the one we think it is", () => {
  it("found the client entry points", () => {
    const seeds = FILES.filter((f) => /["']use client["']/.test(f.text));
    expect(
      seeds.length,
      "No \"use client\" module was found. Either the directive moved, or sourceFiles() " +
        "is walking the wrong directory — and a graph with no seeds makes every " +
        "assertion below trivially true.",
    ).toBeGreaterThan(0);
  });

  it("reaches the modules that carry the browser's own requests", () => {
    const missing = MUST_BE_REACHABLE.filter((module) => !REACHABLE.has(module));
    expect(
      missing,
      "These modules must be reachable from a \"use client\" entry point, and are " +
        "not. If a file was renamed or moved, update MUST_BE_REACHABLE — but check " +
        "first that the browser's requests did not move with it, because that is the " +
        "change this test exists to make loud.",
    ).toEqual([]);
  });

  it("keeps server-only data modules out of the client bundle", () => {
    // The complement of the assertion above, and the reason connect-src is as
    // short as it is. If either of these ever becomes reachable through a value
    // import, the browser gains a way to talk to seven venues and four public
    // RPC endpoints, and the origin assertions below will say so.
    const shouldBeServerOnly = ["lib/market.ts", "lib/onchain.ts", "lib/venues.ts"];
    // `venues.ts` is reachable for its pure helpers — `venueSymbol`,
    // `deviationFromMedian`, the `VENUES` catalogue. That is known and accepted;
    // what matters is that it exports no URL constant, which the next describe
    // block proves.
    const leaks = shouldBeServerOnly.filter(
      (module) => module !== "lib/venues.ts" && REACHABLE.has(module),
    );
    expect(leaks, "These modules must not be value-imported by client code").toEqual([]);
  });
});

describe("every origin the client can reach is allowed to connect", () => {
  it("allows every exported URL constant in the client graph", () => {
    const allowed = new Set(originsOf(connectSrcOf(readFileSync(CONFIG_PATH, "utf8"))));
    const offenders = exportedOrigins(FILES, REACHABLE)
      .filter((entry) => !allowed.has(entry.origin))
      .filter((entry) => !LINK_ONLY.has(hostOf(entry.origin)))
      .map((entry) => `${entry.file}  exports ${entry.name} = ${entry.origin}`);
    expect(
      offenders,
      "A module the browser bundles exports a URL it is not allowed to connect to. " +
        "Add the origin to connect-src in next.config.ts, or — if this constant is a " +
        "link a reader follows rather than something we fetch — add its host to " +
        "LINK_ONLY_HOSTS in src/lib/legal.ts.",
    ).toEqual([]);
  });

  it("allows every origin at a client call site", () => {
    const allowed = new Set(originsOf(connectSrcOf(readFileSync(CONFIG_PATH, "utf8"))));
    const offenders = originsAtCallSites(FILES, REACHABLE, EXPORTED)
      .filter((site) => !allowed.has(site.origin))
      .map((site) => `${site.file}  calls ${site.origin}`);
    expect(
      [...new Set(offenders)],
      "The browser fetches an origin that connect-src does not allow. It will fail in " +
        "the visitor's console and nowhere else, which is how both previous outages " +
        "happened. Add the origin to connect-src in next.config.ts.",
    ).toEqual([]);
  });

  it("finds the browser's own request hosts in the first place", () => {
    // Guards the two assertions above: if the resolver stops recognising call
    // sites it reports nothing, and "nothing" is indistinguishable from "clean".
    const found = new Set(
      originsAtCallSites(FILES, REACHABLE, EXPORTED).map((site) => site.origin),
    );
    expect(
      [...found],
      "The call-site scan found no browser origins at all, which cannot be right — " +
        "live.ts opens a websocket and api.ts reads BlockScout directly.",
    ).not.toHaveLength(0);
    expect(found.has("wss://data-stream.binance.vision")).toBe(true);
    expect(found.has("https://eth.blockscout.com")).toBe(true);
  });
});

describe("connect-src carries no dead allowances", () => {
  it("has no origin the client can no longer reach", () => {
    const allowed = originsOf(connectSrcOf(readFileSync(CONFIG_PATH, "utf8")));
    const reachableOrigins = new Set([
      ...exportedOrigins(FILES, REACHABLE).map((entry) => entry.origin),
      ...originsAtCallSites(FILES, REACHABLE, EXPORTED).map((site) => site.origin),
    ]);
    const dead = allowed.filter((origin) => !reachableOrigins.has(origin));
    expect(
      dead,
      "connect-src allows an origin the client no longer reaches. An allowance kept " +
        "for nobody is a standing permission the app cannot justify, so removing the " +
        "feature should remove the entry.",
    ).toEqual([]);
  });
});

describe("the scan can fail", () => {
  const synthetic: File[] = [
    { path: "lib/fake-client.ts", text: '"use client";\nexport const NEW_HOST = "https://evil.example.net";' },
    { path: "lib/fake-wrapper.ts", text: 'export const WRAPPED = "https://wrapped.example.net";' },
    {
      path: "lib/fake-fetch.ts",
      text: '"use client";\nimport { WRAPPED } from "./fake-wrapper";\nconst url = `${WRAPPED}/v1/thing`;\nconst r = await fetch(url);',
    },
  ];
  const reachable = clientReachable(synthetic);
  const exported = new Map(
    exportedOrigins(synthetic, reachable).map((entry) => [entry.name, entry.origin]),
  );
  const origins = [
    ...exportedOrigins(synthetic, reachable).map((entry) => entry.origin),
    ...originsAtCallSites(synthetic, reachable, exported).map((site) => site.origin),
  ];

  it("sees an exported origin a client module would reach", () => {
    expect(reachable.has("lib/fake-client.ts")).toBe(true);
    expect(origins).toContain("https://evil.example.net");
  });

  it("follows an origin through a binding and an import", () => {
    // The `const url = \`${BINANCE_DIRECT}/...\`; fetch(url)` shape in api.ts.
    expect(reachable.has("lib/fake-wrapper.ts")).toBe(true);
    expect(origins).toContain("https://wrapped.example.net");
  });

  it("does not reach through a type-only import", () => {
    const typed: File[] = [
      { path: "lib/fake-view.ts", text: '"use client";\nimport type { T } from "./fake-server";\nconst x: T = 1;' },
      { path: "lib/fake-server.ts", text: 'export const SECRET = "https://server-only.example.net";\nexport type T = number;' },
    ];
    expect(clientReachable(typed).has("lib/fake-server.ts")).toBe(false);
  });

  it("rejects a policy that declares connect-src twice", () => {
    expect(connectSrcOf('"connect-src \'self\'"; "connect-src \'self\' https://x.example.net"')).toEqual([]);
  });
});
