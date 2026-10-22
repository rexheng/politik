// Assembles a whole Act from Singapore Statutes Online (sso.agc.gov.sg), which loads most of an Act by script.
//
// What the site does (checked against the live PDPA 2012 page, 2026-10-15). `https://sso.agc.gov.sg/Act/PDPA2012?WholeDoc=1`
// answers with the page chrome, the table of contents and the first part of the Act (about 3,000 of its 31,700 words). The
// rest of the Act is left as empty placeholders, `<div class="dms" data-field="seriesId" data-term="<uuid>"></div>`, one per
// later part (27 for the PDPA), and the page's own script (/bundles/legis, function g) fills them in one at a time:
//   GET /Details/GetLazyLoadContent?<lazyLoadFilter fields>&SeriesId=<uuid>&FragSysId=<..>&_=<..>
// with the header `X-Requested-With: XMLHttpRequest`, where `lazyLoadFilter`, `lazyLoadContentUrl` and `fragments` come
// from the JSON in the page's `<div class="global-vars" data-json='...'>` block (the second one: the first holds the
// masthead's variables). A null filter field is sent as an empty string, `fragments[<uuid>]` gives `Item1` (FragSysId)
// and `Item2` (the `_` stamp), and the answer is the HTML of that part, which replaces the placeholder. The `XmlTag`
// response header says where the script puts a part: "derivations" and "toBeTabled" are appended to a table of their own
// and anything else (usually "part") replaces the placeholder. A part may hold placeholders of its own: the script loops
// until the page has none, and so does this module. A part can be empty on purpose: the last placeholder of the OCHA 2023
// page, tagged `legislativeHistory`, answers HTTP 200 with no body.
//
// The site sits behind an AWS WAF. After a burst of requests it answers HTTP 202 with a small JavaScript page that sets
// `window.gokuProps` (a challenge for a browser to solve) instead of the content, and now and then a part answers HTTP 404
// with `{"Status":"ERROR","Message":"Sorry, an error has occurred..."}` that clears by itself. So the parts are fetched one
// at a time with a pause between them; a challenge or a service error is waited out and asked for again, and an Act
// that still has a part missing at the end is a failure: a partial Act is never returned (or cached) as if it were whole.
//
// Nothing here ever says "blocked" (R28): a browser session reads a page at its load event, before the page's script has
// fetched the other parts, so it would return the first part alone, which passes the 150-word gate and looks like an Act.
// Every failure of this module is therefore final ("HTTP n", "unreachable" or "loading failed"), and a whole Act has a
// deadline (10 minutes by default), so one Act cannot hold up a build for ever behind the WAF.
//
// This is the same assembly that was done by hand for the first build (Task 7b), so the two give the same text.
// Node-only build code: never import this from photon/src.

export const SSO_HOST = "sso.agc.gov.sg";

/** True for a page on Singapore Statutes Online. */
export function isSsoUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === SSO_HOST;
  } catch {
    return false;
  }
}

export interface SsoConfig {
  lazyLoadFilter: Record<string, unknown>;
  lazyLoadContentUrl: string;
  /** For each placeholder's uuid, the fragment id and the cache stamp the page gives it. The page's script uses it only if the page has it. */
  fragments?: Record<string, { Item1?: unknown; Item2?: unknown }> | null;
}

/** An attribute value as the browser reads it: character references decoded. */
const decodeAttribute = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replace(/&#0*39;|&#x27;|&apos;/gi, "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/** The lazy-load settings from the page's `global-vars` block that has them, or undefined if there is none or its JSON is broken. */
export function parseSsoConfig(html: string): SsoConfig | undefined {
  for (const m of html.matchAll(/<div\b(?=[^>]*\bclass="global-vars")[^>]*?\bdata-json=(?:'([^']*)'|"([^"]*)")/g)) {
    try {
      const json = JSON.parse(decodeAttribute(m[1] ?? m[2] ?? "")) as Partial<SsoConfig> | null;
      if (json && typeof json.lazyLoadFilter === "object" && json.lazyLoadFilter !== null && typeof json.lazyLoadContentUrl === "string") return json as SsoConfig;
    } catch {
      // not this block, or not JSON: try the next
    }
  }
  return undefined;
}

/** A placeholder, whatever the order of its attributes: an empty `dms` div with a seriesId data-field. Capture 1 is its uuid. */
const PLACEHOLDER = /<div\b(?=[^>]*\bclass="(?:[^"]*\s)?dms(?:\s[^"]*)?")(?=[^>]*\bdata-field="seriesId")(?=[^>]*\bdata-term="([^"]+)")[^>]*>\s*<\/div>/g;

/** The uuids of the page's placeholders, in document order. */
export function ssoPlaceholders(html: string): string[] {
  return [...html.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

/**
 * True if the HTML still has a part that the page's script would have loaded: any `div` with the class `dms` and a seriesId
 * data-field, however it is written (quotes, attribute order, case, something inside it). It is looser than `ssoPlaceholders`
 * on purpose: that finds what this module can fill in, this finds what would make an Act partial if left behind. A browser's
 * snapshot of the page taken at its load event has them all.
 */
export function ssoHasUnloadedParts(html: string): boolean {
  for (const tag of html.matchAll(/<div\b[^>]*>/gi)) {
    if (/\bclass\s*=\s*["']?(?:[^"'>]*\s)?dms(?:\s|["'>])/i.test(tag[0]) && /\bdata-field\s*=\s*["']?seriesId\b/i.test(tag[0])) return true;
  }
  return false;
}

export interface SsoOptions {
  fetchImpl?: typeof fetch;
  /** Headers for every request. The default is a desktop browser's. */
  headers?: Record<string, string>;
  /** Replaces the real wait, for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** The pause after each part, so that a whole Act is not a burst. Default 350. */
  pauseMs?: number;
  /** How long the first wait after an AWS WAF challenge is; it grows with each one. Default 15000. */
  challengeWaitMs?: number;
  /** How long the first wait after a service error, a network error or HTTP 429 is; it grows with each one. Default 1500. */
  retryWaitMs?: number;
  /**
   * Tries per request. Default 8: on the live site a challenge sometimes lasted through four waits (15, 30, 45 and 60 s)
   * before the next try got the content, and pacing the parts more slowly did not prevent it.
   */
  maxAttempts?: number;
  /** Per request, to the end of its body. Default 60000. */
  timeoutMs?: number;
  /** How long the whole Act may take, from its first request. Default 600000 (10 minutes). */
  deadlineMs?: number;
  /** The clock in milliseconds, for tests. Default `Date.now`. */
  now?: () => number;
  /** Gets one progress line per part fetched, such as `sso PDPA2012: part 3/27`. Default `console.log`. */
  log?: (line: string) => void;
}

export type SsoResult =
  | { ok: true; html: string; /** How many parts were fetched; 0 for an Act whose page held all of it. */ fragments: number }
  /** `reason` is one the loader uses ("HTTP <status>", "unreachable", "loading failed"). A failure is final: there is no "try a browser". */
  | { ok: false; reason: string; detail?: string };

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
const MAX_ROUNDS = 8;

/** The AWS WAF's challenge page: a script that sets `window.gokuProps`, sent with HTTP 202 (or, rarely, 200). */
const isChallenge = (status: number, body: string) => status === 202 || /gokuProps|awsWafIntegration|AwsWafIntegration/.test(body);
/** The service's own error answer, `{"Status":"ERROR",...}`, which also comes with HTTP 200 now and then. */
const isServiceError = (body: string) => /^\s*\{\s*"Status"\s*:\s*"ERROR"/.test(body);

type Got =
  | { ok: true; text: string; headers: Headers }
  | { ok: false; kind: "http" | "network" | "challenge" | "service-error" | "empty" | "deadline"; status?: number; detail: string };

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Run {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  challengeWaitMs: number;
  retryWaitMs: number;
  maxAttempts: number;
  timeoutMs: number;
  now: () => number;
  /** The time (on `now`'s clock) after which nothing more is tried. */
  deadlineAt: number;
  /** Words for the failure detail, such as "10 minutes". */
  deadlineText: string;
}

const deadlineGot = (o: Run): Extract<Got, { ok: false }> => ({ ok: false, kind: "deadline", detail: `the deadline of ${o.deadlineText} for the whole Act was exceeded` });

/**
 * One GET, tried up to `maxAttempts` times. A challenge waits `challengeWaitMs` x the attempt number; HTTP 429, 5xx, the
 * service's error (and, for a part, HTTP 404 and an empty answer) and network errors wait `retryWaitMs` x the attempt
 * number. HTTP 403 and other statuses are not retried. Nothing is tried, and no wait is taken, past the Act's deadline.
 */
async function getWithRetry(url: string, headers: Record<string, string>, o: Run, part: boolean): Promise<Got> {
  let last: Got = { ok: false, kind: "network", detail: "no attempt was made" };
  for (let attempt = 0; attempt < o.maxAttempts; attempt++) {
    if (o.deadlineAt - o.now() <= 0) return deadlineGot(o);
    /** False when the wait would reach the deadline, so the Act is out of time. */
    const wait = async (base: number): Promise<boolean> => {
      if (attempt >= o.maxAttempts - 1) return true; // the loop ends; nothing to wait for
      const ms = base * (attempt + 1);
      if (ms >= o.deadlineAt - o.now()) return false;
      await o.sleep(ms);
      return true;
    };
    let res: Response;
    let text: string;
    try {
      res = await o.fetchImpl(url, { headers, redirect: "follow", signal: AbortSignal.timeout(Math.max(1, Math.min(o.timeoutMs, o.deadlineAt - o.now()))) });
      text = await res.text();
    } catch (e) {
      last = { ok: false, kind: "network", detail: `network error: ${errorMessage(e)}` };
      if (!(await wait(o.retryWaitMs))) return deadlineGot(o);
      continue;
    }
    if (isChallenge(res.status, text)) {
      last = { ok: false, kind: "challenge", status: res.status, detail: `AWS WAF challenge (HTTP ${res.status}) instead of the content` };
      if (!(await wait(o.challengeWaitMs))) return deadlineGot(o);
      continue;
    }
    if (res.ok && isServiceError(text)) {
      last = { ok: false, kind: "service-error", status: res.status, detail: "the service answered with its error message" };
      if (!(await wait(o.retryWaitMs))) return deadlineGot(o);
      continue;
    }
    if (res.ok) {
      // An empty part is real when the service tagged it (the live OCHA 2023 page ends in a `legislativeHistory` part that is
      // empty); an untagged empty answer looks like a glitch of the service or a proxy, and is asked for again.
      if (part && !text.trim() && !res.headers.get("XmlTag")) {
        last = { ok: false, kind: "empty", status: res.status, detail: "the service answered with an empty part" };
        if (!(await wait(o.retryWaitMs))) return deadlineGot(o);
        continue;
      }
      return { ok: true, text, headers: res.headers };
    }
    last = { ok: false, kind: "http", status: res.status, detail: `HTTP ${res.status}` };
    if (res.status === 429 || res.status >= 500 || (part && res.status === 404)) {
      if (!(await wait(o.retryWaitMs))) return deadlineGot(o);
      continue;
    }
    return last;
  }
  return last;
}

/** "10 minutes", "1 minute" or "2.5 seconds". */
function durationText(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return ms === 60_000 ? "1 minute" : `${ms / 60_000} minutes`;
  return `${ms / 1000} seconds`;
}

/** The Act as the progress lines name it: the path without its first segment (`PDPA2012` for `/Act/PDPA2012`, `34-2024/Published/20241121` for `/Acts-Supp/34-2024/Published/20241121`). */
function actName(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    return segments.slice(1).join("/") || segments[0] || u.hostname;
  } catch {
    return url;
  }
}

/**
 * The whole Act at a Singapore Statutes Online URL (use the `?WholeDoc=1` form, so that the page lists every part), as one
 * HTML document: the page with each lazy-loaded part put where its placeholder stood. See the header for how.
 * A page that has no placeholders is returned as it is (`fragments: 0`). Any part that cannot be fetched fails the whole
 * Act, with the part's uuid and what went wrong in `detail`, and so does a page that still has lazy-load markers this
 * module cannot fill in, or a run that takes longer than `deadlineMs`. A failure is final: a browser is never an
 * alternative for an Act (see the header). One progress line per part goes to `log`.
 */
export async function fetchSsoAct(url: string, options: SsoOptions = {}): Promise<SsoResult> {
  const headers = options.headers ?? DEFAULT_HEADERS;
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? 600_000;
  const o: Run = {
    fetchImpl: options.fetchImpl ?? fetch,
    sleep: options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    challengeWaitMs: options.challengeWaitMs ?? 15_000,
    retryWaitMs: options.retryWaitMs ?? 1500,
    maxAttempts: Math.max(1, options.maxAttempts ?? 8),
    timeoutMs: options.timeoutMs ?? 60_000,
    now,
    deadlineAt: now() + deadlineMs,
    deadlineText: durationText(deadlineMs),
  };
  const pauseMs = options.pauseMs ?? 350;
  const log = options.log ?? ((line: string) => console.log(line));
  const name = actName(url);
  const failed = (detail: string): SsoResult => ({ ok: false, reason: "loading failed", detail });

  const first = await getWithRetry(url, headers, o, false);
  if (!first.ok) {
    if (first.kind === "http") return { ok: false, reason: `HTTP ${first.status}` };
    if (first.kind === "network") return { ok: false, reason: "unreachable", detail: first.detail };
    return failed(first.kind === "deadline" ? first.detail : `${first.detail}; it did not clear after ${o.maxAttempts} tries`);
  }

  let html = first.text;
  if (ssoPlaceholders(html).length === 0) {
    if (ssoHasUnloadedParts(html)) return failed("the page has lazy-load markers that this reader does not recognise (the site may have changed)");
    return { ok: true, html, fragments: 0 };
  }

  const config = parseSsoConfig(html);
  if (!config) return failed(`the page has ${ssoPlaceholders(html).length} parts to load but no lazy-load settings (the site may have changed)`);
  const endpoint = new URL(config.lazyLoadContentUrl, url);
  const partHeaders = { ...headers, "X-Requested-With": "XMLHttpRequest", Referer: url };

  let fetched = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const terms = [...new Set(ssoPlaceholders(html))];
    if (terms.length === 0) break;
    const total = fetched + terms.length;

    const parts = new Map<string, string>();
    for (const term of terms) {
      if (o.deadlineAt - o.now() <= 0) return failed(`before part ${term}: ${deadlineGot(o).detail}`);
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries({ ...config.lazyLoadFilter, SeriesId: term })) query.set(key, value == null ? "" : String(value));
      if (config.fragments) {
        const fragment = config.fragments[term];
        if (!fragment) return failed(`the page lists no fragment for part ${term}`);
        query.set("FragSysId", String(fragment.Item1 ?? ""));
        query.set("_", String(fragment.Item2 ?? ""));
      }
      const got = await getWithRetry(`${endpoint.origin}${endpoint.pathname}?${query}`, partHeaders, o, true);
      if (!got.ok) return failed(`part ${term}: ${got.detail}${got.kind === "http" || got.kind === "network" || got.kind === "deadline" ? "" : `, ${o.maxAttempts} tries`}`);
      parts.set(term, got.text);
      fetched++;
      log(`sso ${name}: part ${fetched}/${total}`);
      if (pauseMs > 0) await o.sleep(pauseMs);
    }
    // A function, not a string: a "$&" in a statute's text must not be read as a replacement pattern.
    html = html.replace(PLACEHOLDER, (_, term: string) => parts.get(term) ?? "");
  }

  if (ssoHasUnloadedParts(html)) return failed(`${ssoPlaceholders(html).length || "some"} parts were still not loaded after ${MAX_ROUNDS} rounds`);
  return { ok: true, html, fragments: fetched };
}
