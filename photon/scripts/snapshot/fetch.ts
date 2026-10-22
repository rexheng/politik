// Loads the text of one candidate's source document: the raw-download cache first, then a plain fetch,
// then (for blocked sites, when a key is set) a Browserbase browser session. A California bill on
// leginfo.legislature.ca.gov (a URL with a `bill_id`) is not fetched at all, because that site answers every automated
// request with 403: its text is read from the Legislature's official bulk download instead (see leginfo.ts).
//
// The raw cache is `${rawDir}/${id}.txt|.md|.html|.pdf`. Every file this module downloads comes with a sidecar,
// `${rawDir}/${id}.source.json`, holding `{ "url": "<the candidate's url>", "fetchedAt": "<ISO time>" }`. The sidecar says
// which URL the cached files came from: if the candidate's url has changed since, the cache is ignored and the page is
// fetched again, so a corrected URL never keeps serving the old document. A hand-placed .txt with no sidecar is trusted
// whatever the url; to make the cache check the url of such a file, write the sidecar next to it. A hand-placed .md (a
// Firecrawl capture) is a fallback, not an override (R33): the live page is tried first, and the capture stands in when the page
// cannot be read (the capture is kept when the page is cached beside it). A capture of a leginfo or Statutes Online page, which
// are not read by a plain fetch, is used as it is. Where there is a sidecar, it covers every cached file of that id.
// `refresh` ignores the cache: "downloads" the files that have a sidecar (an earlier run's downloads), "all" every file.
// A leginfo bill is cached as `${id}.txt` (a header naming the bill, its digest, its legislative history and current
// status, then its sections) and its sidecar also says `"via": "leginfo-bulk"`, the `"versionId"` of the bill version the
// text came from and the `"layout"` of the text (see LEGINFO_TEXT_LAYOUT); a download in another layout is read again. The bulk
// download's version index, archive directory and bill histories for each session are kept in `${rawDir}/leginfo/`,
// and `refresh` reads them again too.
//
// A Singapore Statutes Online page (sso.agc.gov.sg) is not fetched with one request: the site loads most of an Act by
// script, so the Act is assembled from the page and its lazy-loaded parts (see sso.ts) and cached whole as `${id}.html`,
// with `"via": "sso-lazyload"` in its sidecar. A capture assembled by hand in the same form is read as any other cache hit.
//
// What comes back with the text (see LoadResult): the `format` of the source ("html", "pdf" or "text") and, for an HTML page, its
// decoded raw HTML, because the record extractors read a page's meta tags and a few site-specific elements from it. The text of
// an HTML page is the sections that make facts outside its visible body citable (`pageBlocks`: the meta description and, for a
// Statutes Online Act, the table of contents) in front of the page's own text (see meta.ts). The 150-word gate counts the page's
// own text only. A page from a site built with Next.js (imda.gov.sg, pdpc.gov.sg) keeps its text in a script payload, which meta.ts
// decodes. A page read through a Browserbase session is cached as `${id}.html` (an older `${id}.txt` is still read, as "text"),
// and a Statutes Online Act never goes through the browser: a blocked or partial Act ends as "loading failed".
//
// Why a load fails is returned as a short, fixed `reason` (it goes into the committed manifest) and, for the console only,
// the raw `detail`.
// Node-only build code: never import this from photon/src.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Candidate } from "./candidates.ts";
import { markdownToText, pdfToText } from "./extract.ts";
import { LEGINFO_TEXT_LAYOUT, leginfoBillText, parseLeginfoBillId } from "./leginfo.ts";
import { htmlPageText } from "./meta.ts";
import { wordCount } from "./passages.ts";
import { fetchSsoAct, isSsoUrl, ssoHasUnloadedParts, type SsoOptions } from "./sso.ts";

/** A page with fewer words than this is a login wall, an error page or an empty shell, not a document. */
export const MIN_WORDS = 150;
const FETCH_TIMEOUT_MS = 60_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
/** Cache file extensions. A hand-placed .txt overrides a downloaded page; a hand-placed .md (a capture) is the last resort (R33). */
const CACHE_EXTENSIONS = ["txt", "md", "html", "pdf"] as const;
const READ_ORDER = ["txt", "html", "pdf"] as const;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;

export type LoadResult =
  | {
      ok: true;
      text: string;
      via: "cache" | "fetch" | "browserbase" | "leginfo-bulk" | "sso-lazyload";
      /**
       * What the source was. "text" covers a hand-placed .txt or .md (such as a Firecrawl capture), a California bill, and anything
       * else cached as text.
       */
      format: "html" | "pdf" | "text";
      /** The page's decoded raw HTML, when the source was an HTML page (fetched, cached as .html, or read through a browser). */
      html?: string;
    }
  /** `reason` is one of: "HTTP <status>", "too little text", "unreachable", "pdf extraction failed", "browser fetch failed", "loading failed". */
  | { ok: false; reason: string; /** What actually went wrong, for the console only. */ detail?: string };

/** Returns the rendered HTML of a page, fetched through a Browserbase browser session. */
export type BrowserReader = (url: string, apiKey: string) => Promise<string>;

export interface LoadSourceOptions {
  rawDir: string;
  fetchImpl?: typeof fetch;
  browserbaseKey?: string;
  /** Replaces the Browserbase session, for tests. */
  browserReader?: BrowserReader;
  /** Ignore cached files and fetch again: "downloads" those with a sidecar, "all" every one (hand-placed files too). */
  refresh?: "downloads" | "all";
  /** The clock, for the sidecar's `fetchedAt`. */
  now?: () => Date;
  /**
   * The ids (such as `202520260SB53`) of every California bill the run will load. The legislative history of these bills
   * is kept together when a session's history tables are read, so they are read once per session, not once per bill.
   */
  leginfoBills?: readonly string[];
  /** Pacing and retry settings for Singapore Statutes Online, replaced in tests so that they need not wait. */
  sso?: Pick<SsoOptions, "pauseMs" | "sleep" | "challengeWaitMs" | "retryWaitMs" | "maxAttempts" | "deadlineMs" | "now" | "log">;
}

/**
 * Reads a page through a Browserbase browser session, the way photon/src/sources/browserbase.ts does, but takes the
 * page's own HTML instead of asking a model to extract it, so the text is the document's and not a paraphrase.
 */
export const readWithBrowserbase: BrowserReader = async (url, apiKey) => {
  const { browserbase } = await import("@browserbasehq/stagehand"); // loaded only when a blocked site needs it
  const browser = await browserbase.launch({ apiKey });
  try {
    const [page] = await browser.context.pages();
    if (!page) throw new Error("the browser session has no page");
    await page.goto(url, { waitUntil: "load", timeout: FETCH_TIMEOUT_MS });
    return await page.locator("html").innerHtml();
  } finally {
    try {
      await browser.close();
    } catch {
      /* ignore close errors */
    }
  }
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isPdf = (bytes: Uint8Array) => bytes.length >= 5 && new TextDecoder("latin1").decode(bytes.subarray(0, 5)) === "%PDF-";

/** The `charset=` label of a Content-Type header, if any. */
const headerCharset = (contentType: string) => /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];

function bomCharset(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return undefined;
}

/** A `<meta charset=...>` or `<meta http-equiv="Content-Type" content="...; charset=...">` near the top of the page. */
function metaCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  return /<meta\s[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1];
}

/** Decodes an HTML page. The charset comes from the HTTP header, else a byte-order mark, else a <meta> tag, else UTF-8. */
function decodeHtml(bytes: Uint8Array, header?: string): string {
  for (const label of [header, bomCharset(bytes), metaCharset(bytes)]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      /* not a charset this runtime knows: try the next source */
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Decodes an HTML page and reads its text (see `htmlPageText`); `body` is what the 150-word gate counts. */
function readHtml(bytes: Uint8Array, contentType = ""): { html: string; text: string; body: string } {
  const html = decodeHtml(bytes, headerCharset(contentType));
  return { html, ...htmlPageText(html) };
}

/**
 * The bytes to cache for a fetched page, chosen so that reading the cache later decodes to exactly the text the fetch did.
 * The raw bytes are kept when sniffing them alone gives the same text as the header-aware decode. When it would not
 * (the charset came only from the HTTP header, or the header overrides a conflicting <meta>), the page is stored as UTF-8
 * with a byte-order mark, which the sniffing reads first.
 */
function htmlCacheBytes(bytes: Uint8Array, contentType: string): Uint8Array {
  const html = decodeHtml(bytes, headerCharset(contentType));
  if (html === decodeHtml(bytes)) return bytes;
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(html, "utf8")]);
}

async function writeCache(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.part`;
  await writeFile(tmp, data);
  await rename(tmp, path); // so an interrupted run never leaves a truncated file for the next run to trust
}

const tooLittle = (text: string): boolean => wordCount(text) < MIN_WORDS;

/** The sidecar's name and content. `undefined` when there is none, `null` when it is there but not usable. */
const sidecarPath = (rawDir: string, id: string) => join(rawDir, `${id}.source.json`);
async function readSidecar(rawDir: string, id: string): Promise<{ url: string; via?: string; layout?: string } | null | undefined> {
  let raw: string;
  try {
    raw = await readFile(sidecarPath(rawDir, id), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { url?: unknown; via?: unknown; layout?: unknown } | null;
    const url = parsed?.url;
    if (typeof url !== "string") return null;
    return { url, ...(typeof parsed?.via === "string" ? { via: parsed.via } : {}), ...(typeof parsed?.layout === "string" ? { layout: parsed.layout } : {}) };
  } catch {
    return null;
  }
}

/**
 * Stores a download: first removes the cached files of other kinds for this id (an old .html would otherwise be read
 * before a new .pdf, and a hand-placed .txt before either), then writes the file, then the sidecar.
 */
async function storeDownload(
  opts: LoadSourceOptions,
  c: Candidate,
  ext: (typeof CACHE_EXTENSIONS)[number],
  data: Uint8Array | string,
  /** More fields for the sidecar, after `url` and `fetchedAt`. */
  extra: Record<string, string> = {},
): Promise<void> {
  await mkdir(opts.rawDir, { recursive: true });
  // A capture (.md) stays: it is the fallback for the day the live page cannot be read.
  for (const other of CACHE_EXTENSIONS) if (other !== ext && other !== "md") await rm(join(opts.rawDir, `${c.id}.${other}`), { force: true });
  await writeCache(join(opts.rawDir, `${c.id}.${ext}`), data);
  const fetchedAt = (opts.now ?? (() => new Date()))().toISOString();
  await writeCache(sidecarPath(opts.rawDir, c.id), `${JSON.stringify({ url: c.url, fetchedAt, ...extra }, null, 2)}\n`);
}

/** A hand-placed .txt or .md, or an earlier download, as text. The byte-order mark Windows editors add is dropped. */
const plainText = (ext: "txt" | "md", bytes: Buffer): string => {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  return ext === "md" ? markdownToText(text) : text;
};

/**
 * The cache hit for a candidate, if any. A hand-placed .md is not a hit but a `capture`: the caller tries the live page first
 * and falls back to it.
 */
async function readCache(opts: LoadSourceOptions, c: Candidate): Promise<{ hit?: LoadResult; capture?: LoadResult }> {
  const sidecar = await readSidecar(opts.rawDir, c.id);
  if (sidecar !== undefined) {
    // An earlier run's download. It is only good for the url it came from, and not at all when a refresh is asked for.
    if (sidecar === null || sidecar.url !== c.url || opts.refresh) return {};
    // A bill cached in an older text layout (7b's had the history first and no header) would keep the old order alive.
    if (sidecar.via === "leginfo-bulk" && sidecar.layout !== LEGINFO_TEXT_LAYOUT) return {};
  } else if (opts.refresh === "all") {
    return {};
  }

  for (const ext of [...READ_ORDER, "md"] as const) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(opts.rawDir, `${c.id}.${ext}`));
    } catch {
      continue; // not cached under this extension
    }
    try {
      if (ext === "txt" || ext === "md") {
        const text = plainText(ext, bytes);
        const result: LoadResult = tooLittle(text) ? { ok: false, reason: "too little text" } : { ok: true, text, via: "cache", format: "text" };
        return ext === "md" ? { capture: result } : { hit: result };
      }
      if (ext === "html") {
        const page = readHtml(bytes);
        return { hit: tooLittle(page.body) ? { ok: false, reason: "too little text" } : { ok: true, text: page.text, via: "cache", format: "html", html: page.html } };
      }
      const text = await pdfToText(bytes);
      return { hit: tooLittle(text) ? { ok: false, reason: "too little text" } : { ok: true, text, via: "cache", format: "pdf" } };
    } catch (e) {
      return { hit: { ok: false, reason: ext === "pdf" ? "pdf extraction failed" : "loading failed", detail: `cached ${c.id}.${ext} unreadable: ${errorMessage(e)}` } };
    }
  }
  return {};
}

type Download =
  | { ok: true; bytes: Uint8Array; contentType: string }
  /** `blocked` marks the failures a browser session may get past: HTTP 403/429 and network errors. */
  | { ok: false; reason: string; detail?: string; blocked: boolean };

async function download(url: string, fetchImpl: typeof fetch): Promise<Download> {
  try {
    const res = await fetchImpl(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, blocked: res.status === 403 || res.status === 429 };
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
  } catch (e) {
    return { ok: false, reason: "unreachable", detail: `network error: ${errorMessage(e)}`, blocked: true };
  }
}

/** A Statutes Online Act, assembled from its parts (see sso.ts), in the shape of a plain download. */
async function downloadSsoAct(url: string, opts: LoadSourceOptions): Promise<Download> {
  const got = await fetchSsoAct(url, {
    ...opts.sso,
    fetchImpl: opts.fetchImpl ?? fetch,
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  // `blocked` is false whatever the failure: the browser fallback reads a page at its load event, before the page's script has
  // fetched the other parts, so for an Act it returns the first part alone, which passes the 150-word gate (R28).
  if (!got.ok) return { ok: false, reason: got.reason, ...(got.detail ? { detail: got.detail } : {}), blocked: false };
  return { ok: true, bytes: new TextEncoder().encode(got.html), contentType: "text/html; charset=utf-8" };
}

/** The failure for a Statutes Online page that still has parts to load, or undefined if the page is whole (or is not an Act page). */
function partialSsoAct(url: string, html: string): LoadResult | undefined {
  return isSsoUrl(url) && ssoHasUnloadedParts(html)
    ? { ok: false, reason: "loading failed", detail: "the page still has lazy-load placeholders, so it is only the first part of the Act" }
    : undefined;
}

/**
 * A California bill: its newest text from the Legislature's bulk download, as a header naming the bill, its digest, its
 * legislative history and current status, then its sections (see leginfo.ts), cached as `${id}.txt` with the version it
 * came from. The 150-word gate counts the bill itself, so a long history cannot make a bill with no text pass.
 */
async function loadLeginfoBill(opts: LoadSourceOptions, c: Candidate): Promise<LoadResult> {
  const got = await leginfoBillText(c.url, { cacheDir: opts.rawDir, fetchImpl: opts.fetchImpl, refresh: Boolean(opts.refresh), historyBills: opts.leginfoBills });
  if (!got.ok) return got;
  if (tooLittle(got.billText)) return { ok: false, reason: "too little text" };
  await storeDownload(opts, c, "txt", got.text, { via: "leginfo-bulk", versionId: got.versionId, layout: LEGINFO_TEXT_LAYOUT });
  return { ok: true, text: got.text, via: "leginfo-bulk", format: "text" };
}

/**
 * Returns the text of a candidate's source document.
 * The cache is read first (see the header: `${rawDir}/${id}.txt|.html|.pdf`, with a sidecar for downloads; a `.md` capture
 * is the fallback if the live page cannot be read). Otherwise the URL is fetched, the raw bytes are cached (an HTML page whose charset only the HTTP header states is cached as UTF-8,
 * so a cache hit decodes like the fetch did), and the text is extracted. On HTTP 403/429 or a network error, a Browserbase
 * key (if given) retries in a browser session and caches the rendered page as `${id}.html`. A result under 150 words (an
 * HTML page's own text, not its added sections) is a failure with reason "too little text" and is not cached, so a transient
 * error page is retried on the next run.
 * A leginfo bill URL takes none of that path: see `loadLeginfoBill`. Its failures are "loading failed" with the cause in `detail`.
 * A Statutes Online URL is fetched as an Act with all its parts (see sso.ts); a part that cannot be fetched is "loading failed".
 */
export async function loadSource(c: Candidate, opts: LoadSourceOptions): Promise<LoadResult> {
  if (!SAFE_ID.test(c.id)) return { ok: false, reason: "loading failed", detail: `unsafe id "${c.id}" for a cache file name` };

  const { hit, capture } = await readCache(opts, c);
  if (hit) return hit;
  // A capture of a page that a plain fetch cannot read (leginfo, Statutes Online) is used as it is.
  if (capture && (parseLeginfoBillId(c.url) || isSsoUrl(c.url))) return capture;

  if (parseLeginfoBillId(c.url)) return loadLeginfoBill(opts, c);

  // A capture stands in for a live page that cannot be read (R33). It is itself a stand-in for a browser, so no browser is paid for.
  const live = await loadLive(c, opts, capture === undefined);
  return capture?.ok && !live.ok ? capture : live;
}

/** The live page: a plain fetch, then (with `browser`, a key, and a blocked page) a browser session. */
async function loadLive(c: Candidate, opts: LoadSourceOptions, browser: boolean): Promise<LoadResult> {
  const sso = isSsoUrl(c.url);
  const got = sso ? await downloadSsoAct(c.url, opts) : await download(c.url, opts.fetchImpl ?? fetch);

  if (got.ok) {
    const isPdfResponse = /pdf/i.test(got.contentType) || isPdf(got.bytes);
    const isTextResponse = got.contentType === "" || /html|xml|text\//i.test(got.contentType);
    if (!isPdfResponse && !isTextResponse) return { ok: false, reason: "loading failed", detail: `unsupported content-type ${got.contentType}` };

    const type = isPdfResponse ? "pdf" : "html";
    let text: string;
    let html: string | undefined;
    let gated: string; // the words the 150-word gate counts
    try {
      if (type === "pdf") {
        gated = text = await pdfToText(got.bytes);
      } else {
        const page = readHtml(got.bytes, got.contentType);
        ({ html, text } = page);
        gated = page.body;
      }
    } catch (e) {
      return { ok: false, reason: type === "pdf" ? "pdf extraction failed" : "loading failed", detail: `${type} extraction failed: ${errorMessage(e)}` };
    }
    if (tooLittle(gated)) return { ok: false, reason: "too little text" };
    if (html !== undefined) {
      const partial = partialSsoAct(c.url, html);
      if (partial) return partial;
    }
    await storeDownload(opts, c, type, type === "html" ? htmlCacheBytes(got.bytes, got.contentType) : got.bytes, sso ? { via: "sso-lazyload" } : {});
    return { ok: true, text, via: sso ? "sso-lazyload" : "fetch", format: type, ...(html !== undefined ? { html } : {}) };
  }

  // Blocked or unreachable: only a Browserbase key can still get the page.
  const key = browser ? opts.browserbaseKey?.trim() : undefined;
  if (!got.blocked || !key) return { ok: false, reason: got.reason, ...(got.detail ? { detail: got.detail } : {}) };
  return loadViaBrowser(c, opts, key, got.detail ?? got.reason);
}

/**
 * Reads the page in a Browserbase browser session, for a site that blocks plain requests (`why` says how the plain request
 * failed), and caches the rendered page as `${id}.html`, so that a cache hit still has the HTML. A Statutes Online page whose
 * result still has lazy-load placeholders is refused before anything is stored: a browser takes the page at its load event, so it
 * has the first part of the Act only, and storing it would delete the whole Act that may be cached beside it (R28). Exported for
 * tests; `loadSource` does not send Statutes Online pages here (see `downloadSsoAct`).
 */
export async function loadViaBrowser(c: Candidate, opts: LoadSourceOptions, key: string, why: string): Promise<LoadResult> {
  let rendered: string;
  try {
    rendered = await (opts.browserReader ?? readWithBrowserbase)(c.url, key);
  } catch (e) {
    return { ok: false, reason: "browser fetch failed", detail: `${why}; browserbase failed: ${errorMessage(e)}` };
  }
  const partial = partialSsoAct(c.url, rendered);
  if (partial) return partial;
  const page = htmlPageText(rendered);
  if (tooLittle(page.body)) return { ok: false, reason: "too little text" };
  // The string is already decoded: a byte-order mark makes the next read take it as UTF-8, whatever its <meta> says.
  await storeDownload(opts, c, "html", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(rendered, "utf8")]));
  return { ok: true, text: page.text, via: "browserbase", format: "html", html: rendered };
}
