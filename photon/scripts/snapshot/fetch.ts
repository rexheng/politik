// Loads the text of one candidate's source document: the raw-download cache first, then a plain fetch,
// then (for blocked sites, when a key is set) a Browserbase browser session.
// Node-only build code: never import this from photon/src.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Candidate } from "./candidates.ts";
import { htmlToText, pdfToText } from "./extract.ts";
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
  | { ok: false; reason: string };

/** Returns the rendered HTML of a page, fetched through a Browserbase browser session. */
export type BrowserReader = (url: string, apiKey: string) => Promise<string>;

export interface LoadSourceOptions {
  rawDir: string;
  fetchImpl?: typeof fetch;
  browserbaseKey?: string;
  /** Replaces the Browserbase session, for tests. */
  browserReader?: BrowserReader;
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

function decodeText(bytes: Uint8Array, contentType: string): string {
  const label = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(label ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Extracts text from raw bytes of the given kind. */
async function extract(kind: "html" | "pdf", bytes: Uint8Array, contentType = ""): Promise<string> {
  return kind === "pdf" ? pdfToText(bytes) : htmlToText(decodeText(bytes, contentType));
}

async function writeCache(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.part`;
  await writeFile(tmp, data);
  await rename(tmp, path); // so an interrupted run never leaves a truncated file for the next run to trust
}

const tooLittle = (text: string): boolean => wordCount(text) < MIN_WORDS;

async function readCache(rawDir: string, id: string): Promise<LoadResult | undefined> {
  for (const ext of CACHE_EXTENSIONS) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(rawDir, `${id}.${ext}`));
    } catch {
      continue; // not cached under this extension
    }
    try {
      const text = ext === "txt" || ext === "md" ? bytes.toString("utf8") : await extract(ext, bytes);
      return tooLittle(text) ? { ok: false, reason: "too little text" } : { ok: true, text, via: "cache" };
    } catch (e) {
      return { ok: false, reason: `cached ${id}.${ext} unreadable: ${errorMessage(e)}` };
    }
  }
  return undefined;
}

type Download =
  | { ok: true; bytes: Uint8Array; contentType: string }
  /** `blocked` marks the failures a browser session may get past: HTTP 403/429 and network errors. */
  | { ok: false; reason: string; blocked: boolean };

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
    return { ok: false, reason: `network error: ${errorMessage(e)}`, blocked: true };
  }
}

/**
 * Returns the text of a candidate's source document.
 * The cache is read first (`${rawDir}/${id}.txt|.md|.html|.pdf`). Otherwise the URL is fetched, the raw bytes are cached,
 * and the text is extracted. On HTTP 403/429 or a network error, a Browserbase key (if given) retries in a browser session
 * and caches the resulting text as `${id}.txt`. A result under 150 words is a failure with reason "too little text" and
 * is not cached, so a transient error page is retried on the next run.
 */
export async function loadSource(c: Candidate, opts: LoadSourceOptions): Promise<LoadResult> {
  if (!SAFE_ID.test(c.id)) return { ok: false, reason: `unsafe id "${c.id}" for a cache file name` };

  const cached = await readCache(opts.rawDir, c.id);
  if (cached) return cached;

  const got = await download(c.url, opts.fetchImpl ?? fetch);

  if (got.ok) {
    const isPdfResponse = /pdf/i.test(got.contentType) || isPdf(got.bytes);
    const isTextResponse = got.contentType === "" || /html|xml|text\//i.test(got.contentType);
    if (!isPdfResponse && !isTextResponse) return { ok: false, reason: `unsupported content-type ${got.contentType}` };

    const type = isPdfResponse ? "pdf" : "html";
    let text: string;
    try {
      text = await extract(type, got.bytes, got.contentType);
    } catch (e) {
      return { ok: false, reason: `${type} extraction failed: ${errorMessage(e)}` };
    }
    if (tooLittle(text)) return { ok: false, reason: "too little text" };
    await mkdir(opts.rawDir, { recursive: true });
    await writeCache(join(opts.rawDir, `${c.id}.${type}`), got.bytes);
    return { ok: true, text, via: "fetch" };
  }

  // Blocked or unreachable: only a Browserbase key can still get the page.
  const key = opts.browserbaseKey?.trim();
  if (!got.blocked || !key) return { ok: false, reason: got.reason };
  let html: string;
  try {
    html = await (opts.browserReader ?? readWithBrowserbase)(c.url, key);
  } catch (e) {
    return { ok: false, reason: `${got.reason}; browserbase failed: ${errorMessage(e)}` };
  }
  const text = htmlToText(html);
  if (tooLittle(text)) return { ok: false, reason: "too little text" };
  await mkdir(opts.rawDir, { recursive: true });
  await writeCache(join(opts.rawDir, `${c.id}.txt`), text);
  return { ok: true, text, via: "browserbase" };
}
