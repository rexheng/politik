// Loads the text of one candidate's source document: the raw-download cache first, then a plain fetch,
// then (for blocked sites, when a key is set) a Browserbase browser session.
//
// The raw cache is `${rawDir}/${id}.txt|.md|.html|.pdf`. Every file this module downloads comes with a sidecar,
// `${rawDir}/${id}.source.json`, holding `{ "url": "<the candidate's url>", "fetchedAt": "<ISO time>" }`. The sidecar says
// which URL the cached files came from: if the candidate's url has changed since, the cache is ignored and the page is
// fetched again, so a corrected URL never keeps serving the old document. A hand-placed .txt or .md with no sidecar is
// trusted whatever the url (so is a Firecrawl capture the operator writes without one); to make the cache check the url
// of such a file, write the sidecar next to it. Where there is a sidecar, it covers every cached file of that id.
// `refresh` ignores the cache: "downloads" the files that have a sidecar (an earlier run's downloads), "all" every file.
//
// Why a load fails is returned as a short, fixed `reason` (it goes into the committed manifest) and, for the console only,
// the raw `detail`.
// Node-only build code: never import this from photon/src.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Candidate } from "./candidates.ts";
import { htmlToText, markdownToText, pdfToText } from "./extract.ts";
import { wordCount } from "./passages.ts";

/** A page with fewer words than this is a login wall, an error page or an empty shell, not a document. */
export const MIN_WORDS = 150;
const FETCH_TIMEOUT_MS = 60_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
/** Cache file extensions, in the order they are looked up. A hand-placed .txt or .md overrides a downloaded page. */
const CACHE_EXTENSIONS = ["txt", "md", "html", "pdf"] as const;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;

export type LoadResult =
  | { ok: true; text: string; via: "cache" | "fetch" | "browserbase" }
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

/** Extracts text from raw bytes of the given kind. A cached file has no header, so only the bytes can decide its charset. */
async function extract(kind: "html" | "pdf", bytes: Uint8Array, contentType = ""): Promise<string> {
  return kind === "pdf" ? pdfToText(bytes) : htmlToText(decodeHtml(bytes, headerCharset(contentType)));
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
async function readSidecar(rawDir: string, id: string): Promise<{ url: string } | null | undefined> {
  let raw: string;
  try {
    raw = await readFile(sidecarPath(rawDir, id), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const url = (parsed as { url?: unknown } | null)?.url;
    return typeof url === "string" ? { url } : null;
  } catch {
    return null;
  }
}

/**
 * Stores a download: first removes the cached files of other kinds for this id (an old .html would otherwise be read
 * before a new .pdf, and a hand-placed .txt before either), then writes the file, then the sidecar.
 */
async function storeDownload(opts: LoadSourceOptions, c: Candidate, ext: (typeof CACHE_EXTENSIONS)[number], data: Uint8Array | string): Promise<void> {
  await mkdir(opts.rawDir, { recursive: true });
  for (const other of CACHE_EXTENSIONS) if (other !== ext) await rm(join(opts.rawDir, `${c.id}.${other}`), { force: true });
  await writeCache(join(opts.rawDir, `${c.id}.${ext}`), data);
  const fetchedAt = (opts.now ?? (() => new Date()))().toISOString();
  await writeCache(sidecarPath(opts.rawDir, c.id), `${JSON.stringify({ url: c.url, fetchedAt }, null, 2)}\n`);
}

/** A hand-placed .txt or .md, or an earlier download, as text. The byte-order mark Windows editors add is dropped. */
const plainText = (ext: "txt" | "md", bytes: Buffer): string => {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  return ext === "md" ? markdownToText(text) : text;
};

async function readCache(opts: LoadSourceOptions, c: Candidate): Promise<LoadResult | undefined> {
  const sidecar = await readSidecar(opts.rawDir, c.id);
  if (sidecar !== undefined) {
    // An earlier run's download. It is only good for the url it came from, and not at all when a refresh is asked for.
    if (sidecar === null || sidecar.url !== c.url || opts.refresh) return undefined;
  } else if (opts.refresh === "all") {
    return undefined;
  }

  for (const ext of CACHE_EXTENSIONS) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(opts.rawDir, `${c.id}.${ext}`));
    } catch {
      continue; // not cached under this extension
    }
    try {
      const text = ext === "txt" || ext === "md" ? plainText(ext, bytes) : await extract(ext, bytes);
      return tooLittle(text) ? { ok: false, reason: "too little text" } : { ok: true, text, via: "cache" };
    } catch (e) {
      return { ok: false, reason: ext === "pdf" ? "pdf extraction failed" : "loading failed", detail: `cached ${c.id}.${ext} unreadable: ${errorMessage(e)}` };
    }
  }
  return undefined;
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

/**
 * Returns the text of a candidate's source document.
 * The cache is read first (see the header: `${rawDir}/${id}.txt|.md|.html|.pdf`, with a sidecar for downloads). Otherwise
 * the URL is fetched, the raw bytes are cached (an HTML page whose charset only the HTTP header states is cached as UTF-8,
 * so a cache hit decodes like the fetch did), and the text is extracted. On HTTP 403/429 or a network error, a Browserbase
 * key (if given) retries in a browser session and caches the resulting text as `${id}.txt`. A result under 150 words is a
 * failure with reason "too little text" and is not cached, so a transient error page is retried on the next run.
 */
export async function loadSource(c: Candidate, opts: LoadSourceOptions): Promise<LoadResult> {
  if (!SAFE_ID.test(c.id)) return { ok: false, reason: "loading failed", detail: `unsafe id "${c.id}" for a cache file name` };

  const cached = await readCache(opts, c);
  if (cached) return cached;

  const got = await download(c.url, opts.fetchImpl ?? fetch);

  if (got.ok) {
    const isPdfResponse = /pdf/i.test(got.contentType) || isPdf(got.bytes);
    const isTextResponse = got.contentType === "" || /html|xml|text\//i.test(got.contentType);
    if (!isPdfResponse && !isTextResponse) return { ok: false, reason: "loading failed", detail: `unsupported content-type ${got.contentType}` };

    const type = isPdfResponse ? "pdf" : "html";
    let text: string;
    try {
      text = await extract(type, got.bytes, got.contentType);
    } catch (e) {
      return { ok: false, reason: type === "pdf" ? "pdf extraction failed" : "loading failed", detail: `${type} extraction failed: ${errorMessage(e)}` };
    }
    if (tooLittle(text)) return { ok: false, reason: "too little text" };
    await storeDownload(opts, c, type, type === "html" ? htmlCacheBytes(got.bytes, got.contentType) : got.bytes);
    return { ok: true, text, via: "fetch" };
  }

  // Blocked or unreachable: only a Browserbase key can still get the page.
  const key = opts.browserbaseKey?.trim();
  if (!got.blocked || !key) return { ok: false, reason: got.reason, ...(got.detail ? { detail: got.detail } : {}) };
  let html: string;
  try {
    html = await (opts.browserReader ?? readWithBrowserbase)(c.url, key);
  } catch (e) {
    return { ok: false, reason: "browser fetch failed", detail: `${got.detail ?? got.reason}; browserbase failed: ${errorMessage(e)}` };
  }
  const text = htmlToText(html);
  if (tooLittle(text)) return { ok: false, reason: "too little text" };
  await storeDownload(opts, c, "txt", text);
  return { ok: true, text, via: "browserbase" };
}
