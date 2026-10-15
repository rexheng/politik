import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { Candidate } from "../../photon/scripts/snapshot/candidates.ts";
import { markdownToText } from "../../photon/scripts/snapshot/extract.ts";
import { loadSource } from "../../photon/scripts/snapshot/fetch.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/sources/${name}`, import.meta.url));
const bill = fixture("bill.html");
const loginWall = fixture("login-wall.html");
const pdf = fixture("one-page.pdf");

const candidate = (id: string, url = "https://example.test/doc"): Candidate => ({
  include: true,
  id,
  jurisdiction: "US-CA",
  title: "A document",
  type: "bill",
  topics: ["ai-governance"],
  status: "enacted",
  landmark: false,
  url,
  urlConfidence: "seen",
  why: "Because",
});

const respond = (body: Uint8Array | string, init: { status?: number; type?: string } = {}) =>
  new Response(body as BodyInit, { status: init.status ?? 200, headers: init.type ? { "content-type": init.type } : {} });

type Call = { url: string; init?: RequestInit };
const fakeFetch = (make: (url: string) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return make(url);
  }) as typeof fetch;
  return { impl, calls };
};

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

let rawDir: string;
let n = 0;
const nextDir = async () => {
  const dir = join(rawDir, `case-${++n}`);
  await mkdir(dir, { recursive: true });
  return dir;
};
before(async () => {
  rawDir = await mkdtemp(join(tmpdir(), "politik-load-source-"));
});
after(async () => {
  await rm(rawDir, { recursive: true, force: true });
});

test("a cached .html returns via cache and never calls fetch", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "doc-a.html"), bill);
  const { impl, calls } = fakeFetch(() => respond("should not be fetched"));
  const result = await loadSource(candidate("doc-a"), { rawDir: dir, fetchImpl: impl });
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.via === "cache");
  assert.ok(result.ok && result.text.includes("# Part 1: Definitions and scope"));
  assert.ok(result.ok && !result.text.includes("NAVTOKEN"));
  assert.equal(calls.length, 0);
});

test("the cache is read in the order .txt, .md, .html, .pdf", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "doc-b.pdf"), pdf);
  await writeFile(join(dir, "doc-b.html"), bill);
  await writeFile(join(dir, "doc-b.md"), `# From markdown\n\n${words(200)}`);
  const { impl, calls } = fakeFetch(() => respond("no"));

  let result = await loadSource(candidate("doc-b"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "cache" && result.text.startsWith("# From markdown"));

  await writeFile(join(dir, "doc-b.txt"), words(160));
  result = await loadSource(candidate("doc-b"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.text.startsWith("word0 word1"));

  await rm(join(dir, "doc-b.txt"));
  await rm(join(dir, "doc-b.md"));
  result = await loadSource(candidate("doc-b"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.text.includes("# Part 1: Definitions and scope"));
  assert.equal(calls.length, 0);
});

test("a cached file with too little text is not usable", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "doc-c.txt"), words(40));
  const { impl, calls } = fakeFetch(() => respond("no"));
  const result = await loadSource(candidate("doc-c"), { rawDir: dir, fetchImpl: impl });
  assert.deepEqual(result, { ok: false, reason: "too little text" });
  assert.equal(calls.length, 0);
});

test("HTTP 403 with no browserbase key fails with the status", async () => {
  const dir = await nextDir();
  const { impl, calls } = fakeFetch(() => respond("Forbidden", { status: 403 }));
  const result = await loadSource(candidate("doc-d"), { rawDir: dir, fetchImpl: impl });
  assert.deepEqual(result, { ok: false, reason: "HTTP 403" });
  assert.equal(calls.length, 1);
  assert.equal(existsSync(join(dir, "doc-d.html")), false);
});

test("HTTP 429 and a network error also fail with their reason when there is no key", async () => {
  const dir = await nextDir();
  const tooMany = fakeFetch(() => respond("slow down", { status: 429 }));
  assert.deepEqual(await loadSource(candidate("doc-e"), { rawDir: dir, fetchImpl: tooMany.impl }), { ok: false, reason: "HTTP 429" });

  const boom = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const result = await loadSource(candidate("doc-e"), { rawDir: dir, fetchImpl: boom.impl });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "unreachable", JSON.stringify(result));
  assert.ok(!result.ok && /network error.*fetch failed/.test(result.detail ?? ""), "the raw error is kept as detail, for the console");
});

test("other HTTP errors fail with the status and do not use browserbase", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond("gone", { status: 404 }));
  let used = false;
  const result = await loadSource(candidate("doc-f"), {
    rawDir: dir,
    fetchImpl: impl,
    browserbaseKey: "key",
    browserReader: async () => {
      used = true;
      return words(200);
    },
  });
  assert.deepEqual(result, { ok: false, reason: "HTTP 404" });
  assert.equal(used, false);
});

test("a 200 login wall fails with too little text and is not cached", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond(loginWall, { type: "text/html; charset=utf-8" }));
  const result = await loadSource(candidate("doc-g"), { rawDir: dir, fetchImpl: impl });
  assert.deepEqual(result, { ok: false, reason: "too little text" });
  assert.equal(existsSync(join(dir, "doc-g.html")), false);
});

test("fetching the bill writes the raw bytes to the cache and returns via fetch", async () => {
  const dir = await nextDir();
  const { impl, calls } = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  const c = candidate("doc-h", "https://example.test/bills/h");
  const result = await loadSource(c, { rawDir: join(dir, "nested", "raw"), fetchImpl: impl });
  assert.ok(result.ok && result.via === "fetch");
  assert.ok(result.ok && result.text.includes("# Part 2: Duties of platform operators"));
  assert.ok(result.ok && !result.text.includes("NAVTOKEN"));
  assert.deepEqual(await readFile(join(dir, "nested", "raw", "doc-h.html")), bill);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://example.test/bills/h");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.match(headers.get("user-agent") ?? "", /Mozilla\/5\.0.*Chrome/);

  // The second call is served from the cache.
  const again = await loadSource(c, { rawDir: join(dir, "nested", "raw"), fetchImpl: impl });
  assert.ok(again.ok && again.via === "cache" && again.text === result.text);
  assert.equal(calls.length, 1);
});

/** A one-page text PDF holding `text`, wrapped at 10 words a line, built the same way as the one-page fixture. */
const makePdf = (text: string): Uint8Array => {
  const lines = text.match(/(?:\S+\s*){1,10}/g) ?? [];
  const stream = `BT /F1 10 Tf 20 750 Td 12 TL ${lines.map((l) => `(${l.trim()}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
};

test("a PDF response is extracted as a PDF and cached as .pdf", async () => {
  const dir = await nextDir();
  const longPdf = makePdf(words(200));
  const { impl } = fakeFetch(() => respond(longPdf, { type: "application/pdf" }));
  const result = await loadSource(candidate("doc-i"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "fetch");
  assert.ok(result.ok && result.text.includes("word0") && result.text.includes("word199"));
  assert.deepEqual(new Uint8Array(await readFile(join(dir, "doc-i.pdf"))), longPdf);

  // The cached PDF is read back as a PDF.
  const cached = await loadSource(candidate("doc-i"), { rawDir: dir, fetchImpl: impl });
  assert.ok(cached.ok && cached.via === "cache" && cached.text === result.text);
});

test("a PDF is recognised by its bytes when the content-type is generic", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond(makePdf(words(200)), { type: "application/octet-stream" }));
  const result = await loadSource(candidate("doc-j"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "fetch" && result.text.includes("word150"));
  assert.ok(existsSync(join(dir, "doc-j.pdf")));
});

test("a short PDF fails with too little text and a broken PDF fails with the extraction error", async () => {
  const dir = await nextDir();
  const short = fakeFetch(() => respond(pdf, { type: "application/pdf" }));
  assert.deepEqual(await loadSource(candidate("doc-j2"), { rawDir: dir, fetchImpl: short.impl }), { ok: false, reason: "too little text" });

  const broken = fakeFetch(() => respond("%PDF-1.4 this is not really a pdf", { type: "application/pdf" }));
  const result = await loadSource(candidate("doc-j3"), { rawDir: dir, fetchImpl: broken.impl });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "pdf extraction failed", JSON.stringify(result));
  assert.ok(!result.ok && (result.detail ?? "").length > 0, "what pdf.js said is kept as detail");
  assert.equal(existsSync(join(dir, "doc-j3.pdf")), false);
});

test("an unsupported content-type fails without being cached", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond("PNG...", { type: "image/png" }));
  const result = await loadSource(candidate("doc-k"), { rawDir: dir, fetchImpl: impl });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "loading failed", JSON.stringify(result));
  assert.ok(!result.ok && /content-type.*image\/png/.test(result.detail ?? ""), JSON.stringify(result));
});

test("a plain-text response is accepted", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond(words(200), { type: "text/plain" }));
  const result = await loadSource(candidate("doc-l"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "fetch");
});

/** A page of 200 words that begin "café0 café1 ...", encoded as windows-1252 (every character used is at most U+00FF). */
const cafePage = (head: string) =>
  Buffer.from(
    `<!doctype html><html><head>${head}</head><body><h1>Café</h1><p>${Array.from({ length: 200 }, (_, i) => `café${i}`).join(" ")}</p></body></html>`,
    "latin1",
  );

test("a windows-1252 page with the charset only in the HTTP header reads the same fresh and from the cache", async () => {
  const dir = await nextDir();
  const { impl, calls } = fakeFetch(() => respond(cafePage(""), { type: "text/html; charset=windows-1252" }));
  const c = candidate("doc-cs1");
  const fresh = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  const cached = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  assert.ok(fresh.ok && fresh.via === "fetch" && fresh.text.includes("café0 café1"), JSON.stringify(fresh).slice(0, 200));
  assert.ok(cached.ok && cached.via === "cache");
  assert.ok(fresh.ok && cached.ok && cached.text === fresh.text, "cache text differs from fetched text");
  assert.ok(cached.ok && !cached.text.includes("\ufffd"));
  assert.equal(calls.length, 1);
});

test("a windows-1252 page with the charset only in a <meta charset> tag reads the same fresh and from the cache", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond(cafePage('<meta charset="windows-1252">'), { type: "text/html" }));
  const c = candidate("doc-cs2");
  const fresh = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  const cached = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  assert.ok(fresh.ok && fresh.text.includes("café0 café1") && fresh.text.includes("# Café"));
  assert.ok(cached.ok && cached.via === "cache" && fresh.ok && cached.text === fresh.text);
});

test("an http-equiv content-type meta tag is read too", async () => {
  const dir = await nextDir();
  const head = '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">';
  const { impl } = fakeFetch(() => respond(cafePage(head)));
  const c = candidate("doc-cs3");
  const fresh = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  const cached = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  assert.ok(fresh.ok && fresh.text.includes("café0"));
  assert.ok(cached.ok && fresh.ok && cached.text === fresh.text);
});

test("the HTTP header charset wins over a conflicting <meta>, and the cache still agrees with the fetch", async () => {
  const dir = await nextDir();
  // Valid UTF-8 bytes served as UTF-8 by the header while the page body claims windows-1252.
  const utf8Page = Buffer.from(
    `<html><head><meta charset="windows-1252"></head><body><p>${Array.from({ length: 200 }, (_, i) => `café${i}`).join(" ")}</p></body></html>`,
    "utf8",
  );
  const { impl } = fakeFetch(() => respond(utf8Page, { type: "text/html; charset=utf-8" }));
  const c = candidate("doc-cs4");
  const fresh = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  const cached = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  assert.ok(fresh.ok && fresh.text.includes("café0 café1"), fresh.ok ? fresh.text.slice(0, 80) : fresh.reason);
  assert.ok(cached.ok && cached.via === "cache" && fresh.ok && cached.text === fresh.text);
});

test("an unknown charset label in the header falls back to the page's own declaration, then UTF-8", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond(cafePage('<meta charset="windows-1252">'), { type: "text/html; charset=x-no-such-charset" }));
  const fresh = await loadSource(candidate("doc-cs5"), { rawDir: dir, fetchImpl: impl });
  assert.ok(fresh.ok && fresh.text.includes("café0"));
});

test("a hand-placed windows-1252 .html in the cache is decoded from its <meta> tag", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "doc-cs6.html"), cafePage('<meta charset="windows-1252">'));
  const { impl, calls } = fakeFetch(() => respond("no"));
  const result = await loadSource(candidate("doc-cs6"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "cache" && result.text.includes("café0 café1"));
  assert.equal(calls.length, 0);
});

test("a UTF-8 page with a byte-order mark and no declared charset reads the same fresh and from the cache", async () => {
  const dir = await nextDir();
  const body = Buffer.from(`\ufeff<html><body><p>${Array.from({ length: 200 }, (_, i) => `café${i}`).join(" ")}</p></body></html>`, "utf8");
  const { impl } = fakeFetch(() => respond(body, { type: "text/html" }));
  const c = candidate("doc-cs7");
  const fresh = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  const cached = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  assert.ok(fresh.ok && fresh.text.startsWith("café0 café1") && !fresh.text.includes("\ufeff"));
  assert.ok(cached.ok && fresh.ok && cached.text === fresh.text);
});

test("403 with a browserbase key retries through the browser reader and caches its text as .txt", async () => {
  const dir = await nextDir();
  const { impl, calls } = fakeFetch(() => respond("Forbidden", { status: 403 }));
  const seen: { url: string; key: string }[] = [];
  const reader = async (url: string, key: string) => {
    seen.push({ url, key });
    return `<html><body><h1>Statute</h1><p>${words(200)}</p></body></html>`;
  };
  const c = candidate("doc-m", "https://sso.example.test/Act/X");
  const result = await loadSource(c, { rawDir: dir, fetchImpl: impl, browserbaseKey: "bb-key", browserReader: reader });
  assert.ok(result.ok && result.via === "browserbase");
  assert.ok(result.ok && result.text.startsWith("# Statute"));
  assert.deepEqual(seen, [{ url: "https://sso.example.test/Act/X", key: "bb-key" }]);
  assert.equal(calls.length, 1);
  assert.ok(existsSync(join(dir, "doc-m.txt")));

  const again = await loadSource(c, { rawDir: dir, fetchImpl: impl, browserbaseKey: "bb-key", browserReader: reader });
  assert.ok(again.ok && again.via === "cache");
  assert.equal(seen.length, 1);
});

test("a network error with a browserbase key retries through the browser reader", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const result = await loadSource(candidate("doc-n"), {
    rawDir: dir,
    fetchImpl: impl,
    browserbaseKey: "bb-key",
    browserReader: async () => `<p>${words(200)}</p>`,
  });
  assert.ok(result.ok && result.via === "browserbase");
});

test("a browser reader failure or thin page is reported, naming browserbase", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond("Forbidden", { status: 403 }));
  const failed = await loadSource(candidate("doc-o"), {
    rawDir: dir,
    fetchImpl: impl,
    browserbaseKey: "bb-key",
    browserReader: async () => {
      throw new Error("session limit");
    },
  });
  assert.equal(failed.ok, false);
  assert.ok(!failed.ok && failed.reason === "browser fetch failed", JSON.stringify(failed));
  assert.ok(!failed.ok && /HTTP 403/.test(failed.detail ?? "") && /browserbase.*session limit/.test(failed.detail ?? ""), JSON.stringify(failed));

  const thin = await loadSource(candidate("doc-o"), {
    rawDir: dir,
    fetchImpl: impl,
    browserbaseKey: "bb-key",
    browserReader: async () => "<p>Access denied</p>",
  });
  assert.deepEqual(thin, { ok: false, reason: "too little text" });
  assert.equal(existsSync(join(dir, "doc-o.txt")), false);
});

test("a blank browserbase key counts as no key", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond("Forbidden", { status: 403 }));
  const result = await loadSource(candidate("doc-p"), { rawDir: dir, fetchImpl: impl, browserbaseKey: "  " });
  assert.deepEqual(result, { ok: false, reason: "HTTP 403" });
});

test("a candidate id that could leave the cache directory is refused", async () => {
  const dir = await nextDir();
  const { impl, calls } = fakeFetch(() => respond(bill, { type: "text/html" }));
  const result = await loadSource(candidate("../evil"), { rawDir: dir, fetchImpl: impl });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "loading failed", "the id (a path) is not in the reason");
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// I4: the raw cache remembers which URL each download came from

const sidecarOf = async (dir: string, id: string) => JSON.parse(await readFile(join(dir, `${id}.source.json`), "utf8"));
const CLOCK = () => new Date("2026-10-15T09:00:00.000Z");

test("I4: every download writes <id>.source.json with its url and the time it was fetched", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  await loadSource(candidate("sc-html", "https://example.test/a"), { rawDir: dir, fetchImpl: impl, now: CLOCK });
  assert.deepEqual(await sidecarOf(dir, "sc-html"), { url: "https://example.test/a", fetchedAt: "2026-10-15T09:00:00.000Z" });

  const pdfFetch = fakeFetch(() => respond(makePdf(words(200)), { type: "application/pdf" }));
  await loadSource(candidate("sc-pdf", "https://example.test/b"), { rawDir: dir, fetchImpl: pdfFetch.impl, now: CLOCK });
  assert.deepEqual(await sidecarOf(dir, "sc-pdf"), { url: "https://example.test/b", fetchedAt: "2026-10-15T09:00:00.000Z" });

  const blocked = fakeFetch(() => respond("Forbidden", { status: 403 }));
  await loadSource(candidate("sc-bb", "https://example.test/c"), {
    rawDir: dir,
    fetchImpl: blocked.impl,
    browserbaseKey: "k",
    browserReader: async () => `<p>${words(200)}</p>`,
    now: CLOCK,
  });
  assert.deepEqual(await sidecarOf(dir, "sc-bb"), { url: "https://example.test/c", fetchedAt: "2026-10-15T09:00:00.000Z" });
});

test("I4: nothing is written for a failed download", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond("Forbidden", { status: 403 }));
  await loadSource(candidate("sc-fail"), { rawDir: dir, fetchImpl: impl });
  assert.equal(existsSync(join(dir, "sc-fail.source.json")), false);
});

test("I4: the same url is a cache hit, and a changed url ignores the cache and fetches again", async () => {
  const dir = await nextDir();
  const { impl, calls } = fakeFetch((url) => respond(url.endsWith("/new") ? `<p>${words(180)} fresh</p>` : bill, { type: "text/html; charset=utf-8" }));
  const first = await loadSource(candidate("sc-url", "https://example.test/old"), { rawDir: dir, fetchImpl: impl, now: CLOCK });
  assert.ok(first.ok && first.via === "fetch");

  const again = await loadSource(candidate("sc-url", "https://example.test/old"), { rawDir: dir, fetchImpl: impl });
  assert.ok(again.ok && again.via === "cache" && again.text === first.text);
  assert.equal(calls.length, 1);

  const moved = await loadSource(candidate("sc-url", "https://example.test/new"), { rawDir: dir, fetchImpl: impl, now: () => new Date("2026-11-01T00:00:00.000Z") });
  assert.ok(moved.ok && moved.via === "fetch" && moved.text.includes("fresh"), "the old document is not served for the new url");
  assert.equal(calls.length, 2);
  assert.deepEqual(await sidecarOf(dir, "sc-url"), { url: "https://example.test/new", fetchedAt: "2026-11-01T00:00:00.000Z" });
  const next = await loadSource(candidate("sc-url", "https://example.test/new"), { rawDir: dir, fetchImpl: impl });
  assert.ok(next.ok && next.via === "cache" && next.text.includes("fresh"));
  assert.equal(calls.length, 2);
});

test("I4: when the new url fails, the old download is still not served", async () => {
  const dir = await nextDir();
  const ok = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  await loadSource(candidate("sc-fail2", "https://example.test/old"), { rawDir: dir, fetchImpl: ok.impl });
  const gone = fakeFetch(() => respond("gone", { status: 404 }));
  assert.deepEqual(await loadSource(candidate("sc-fail2", "https://example.test/new"), { rawDir: dir, fetchImpl: gone.impl }), { ok: false, reason: "HTTP 404" });
});

test("I4: a new url that gives a different kind of file does not leave the old file shadowing it", async () => {
  const dir = await nextDir();
  const html = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  await loadSource(candidate("sc-kind", "https://example.test/old"), { rawDir: dir, fetchImpl: html.impl });
  assert.ok(existsSync(join(dir, "sc-kind.html")));

  const asPdf = fakeFetch(() => respond(makePdf(words(200)), { type: "application/pdf" }));
  const moved = await loadSource(candidate("sc-kind", "https://example.test/new"), { rawDir: dir, fetchImpl: asPdf.impl });
  assert.ok(moved.ok && moved.via === "fetch");
  assert.equal(existsSync(join(dir, "sc-kind.html")), false, "the page from the old url is gone");
  const again = await loadSource(candidate("sc-kind", "https://example.test/new"), { rawDir: dir, fetchImpl: html.impl });
  assert.ok(again.ok && again.via === "cache" && again.text.includes("word199"));
});

test("I4: a hand-placed .md or .txt with no sidecar is trusted whatever the url", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "hand-md.md"), `# Placed by hand\n\n${words(200)}`);
  await writeFile(join(dir, "hand-txt.txt"), words(200));
  const { impl, calls } = fakeFetch(() => respond("should not be fetched"));
  for (const id of ["hand-md", "hand-txt"]) {
    const result = await loadSource(candidate(id, "https://example.test/any-url"), { rawDir: dir, fetchImpl: impl });
    assert.ok(result.ok && result.via === "cache", id);
  }
  assert.equal(calls.length, 0);
});

test("I4: a sidecar that cannot be read counts as a different url", async () => {
  const dir = await nextDir();
  const { impl, calls } = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  await loadSource(candidate("sc-bad", "https://example.test/a"), { rawDir: dir, fetchImpl: impl });
  await writeFile(join(dir, "sc-bad.source.json"), "{ not json");
  const result = await loadSource(candidate("sc-bad", "https://example.test/a"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "fetch");
  assert.equal(calls.length, 2);
  assert.equal((await sidecarOf(dir, "sc-bad")).url, "https://example.test/a");
});

test("I4: refresh=downloads refetches what an earlier run downloaded, and keeps a hand-placed file that has no sidecar", async () => {
  const dir = await nextDir();
  const { impl, calls } = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  await loadSource(candidate("rf-dl", "https://example.test/a"), { rawDir: dir, fetchImpl: impl });
  await writeFile(join(dir, "rf-hand.txt"), words(200));
  assert.equal(calls.length, 1);

  const refreshed = await loadSource(candidate("rf-dl", "https://example.test/a"), { rawDir: dir, fetchImpl: impl, refresh: "downloads" });
  assert.ok(refreshed.ok && refreshed.via === "fetch");
  assert.equal(calls.length, 2);

  const kept = await loadSource(candidate("rf-hand", "https://example.test/h"), { rawDir: dir, fetchImpl: impl, refresh: "downloads" });
  assert.ok(kept.ok && kept.via === "cache" && kept.text.startsWith("word0"));
  assert.equal(calls.length, 2, "the hand-placed file survives --refresh");
});

test("I4: refresh=all ignores a hand-placed file too, and the fetched page replaces it", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "rf-all.txt"), words(200));
  const { impl, calls } = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  const result = await loadSource(candidate("rf-all", "https://example.test/a"), { rawDir: dir, fetchImpl: impl, refresh: "all" });
  assert.ok(result.ok && result.via === "fetch" && result.text.includes("# Part 1"));
  assert.equal(calls.length, 1);
  assert.equal(existsSync(join(dir, "rf-all.txt")), false, "the old hand-placed file would shadow the new download");
  const again = await loadSource(candidate("rf-all", "https://example.test/a"), { rawDir: dir, fetchImpl: impl });
  assert.ok(again.ok && again.via === "cache" && again.text.includes("# Part 1"));
});

test("I4: a refresh that fails leaves the old download in place for a later run without --refresh", async () => {
  const dir = await nextDir();
  const ok = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  const first = await loadSource(candidate("rf-keep", "https://example.test/a"), { rawDir: dir, fetchImpl: ok.impl });
  const down = fakeFetch(() => respond("down", { status: 503 }));
  assert.deepEqual(await loadSource(candidate("rf-keep", "https://example.test/a"), { rawDir: dir, fetchImpl: down.impl, refresh: "downloads" }), { ok: false, reason: "HTTP 503" });
  const later = await loadSource(candidate("rf-keep", "https://example.test/a"), { rawDir: dir, fetchImpl: down.impl });
  assert.ok(later.ok && later.via === "cache" && first.ok && later.text === first.text);
});

// ---------------------------------------------------------------------------------------------------------------------
// M6: a Markdown capture is cleaned before it is split into passages

test("M6: a leading byte-order mark is stripped from a .md or .txt file", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "bom-md.md"), `\ufeff# Title\n\n${words(200)}`);
  await writeFile(join(dir, "bom-txt.txt"), `\ufeff${words(200)}`);
  const { impl } = fakeFetch(() => respond("no"));
  const md = await loadSource(candidate("bom-md"), { rawDir: dir, fetchImpl: impl });
  const txt = await loadSource(candidate("bom-txt"), { rawDir: dir, fetchImpl: impl });
  assert.ok(md.ok && md.text.startsWith("# Title"), "so the first heading is still a heading");
  assert.ok(txt.ok && txt.text.startsWith("word0"));
});

test("M6: links keep their text, images go, and bare reference definitions go", async () => {
  const dir = await nextDir();
  const md = [
    "# The Act",
    "",
    "See [section 4](https://example.test/s4) and [the guidance](https://example.test/g \"Guidance\") for the [rules][1].",
    "![A logo](https://example.test/logo.png)",
    "A [nested (paren)](https://example.test/a_(b)) link and a [bare](<https://example.test/x y>) one.",
    "[[1]](https://example.test/fn) stays as [1].",
    "",
    "[1]: https://example.test/rules",
    '[2]: https://example.test/other "Other"',
    "  [3]: <https://example.test/third>",
    "",
    words(200),
  ].join("\n");
  await writeFile(join(dir, "md-clean.md"), md);
  const { impl } = fakeFetch(() => respond("no"));
  const result = await loadSource(candidate("md-clean"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok);
  const text = result.ok ? result.text : "";
  assert.ok(text.includes("See section 4 and the guidance for the [rules][1]."), text);
  assert.ok(text.includes("A nested (paren) link and a bare one."), text);
  assert.ok(text.includes("[1] stays as [1]."), text);
  assert.ok(!text.includes("https://example.test"), text);
  assert.ok(!text.includes("A logo") && !text.includes("logo.png"), text);
  assert.ok(!/^\s*\[\d\]:/m.test(text), text);
  assert.ok(text.startsWith("# The Act"));
});

test("M6: markdownToText leaves ordinary prose, headings and bracketed text alone", () => {
  const prose = "# Heading\n\nA plain paragraph with [a bracket] and (a paren) and a: colon.\n\n- one\n- two\n";
  assert.equal(markdownToText(prose), prose);
});
