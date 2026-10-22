import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { Candidate } from "../../photon/scripts/snapshot/candidates.ts";
import { htmlToText, markdownToText } from "../../photon/scripts/snapshot/extract.ts";
import { loadSource, loadViaBrowser } from "../../photon/scripts/snapshot/fetch.ts";
import { wordCount } from "../../photon/scripts/snapshot/passages.ts";
import { archiveUrl, pubinfoZip, wordsOf, type FixtureBill } from "../helpers/pubinfo.ts";
import { serveRanges } from "../helpers/zip.ts";

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

test("the cache is read in the order .txt, .html, .pdf, and a .md capture is only the last resort", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "doc-b.pdf"), pdf);
  await writeFile(join(dir, "doc-b.html"), bill);
  await writeFile(join(dir, "doc-b.md"), `# From markdown\n\n${words(200)}`);
  const { impl, calls } = fakeFetch(() => respond("no"));

  let result = await loadSource(candidate("doc-b"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "cache" && result.format === "html" && result.text.includes("# Part 1: Definitions and scope"), "a cached page beats a capture");

  await writeFile(join(dir, "doc-b.txt"), words(160));
  result = await loadSource(candidate("doc-b"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.text.startsWith("word0 word1"));

  await rm(join(dir, "doc-b.txt"));
  result = await loadSource(candidate("doc-b"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.format === "html", "a page is read before a pdf");
  assert.equal(calls.length, 0);

  await rm(join(dir, "doc-b.html"));
  await rm(join(dir, "doc-b.pdf"));
  result = await loadSource(candidate("doc-b"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "cache" && result.text.startsWith("# From markdown"), "only the capture is left, and the page is no better");
  assert.equal(calls.length, 1, "the live page was tried first");
});

test("R33: the live page is preferred to a hand-placed .md capture; the capture is kept as the fallback", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "cap-a.md"), `# From the capture\n\n${words(200)}`);
  const live = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  const first = await loadSource(candidate("cap-a"), { rawDir: dir, fetchImpl: live.impl });
  assert.ok(first.ok && first.via === "fetch" && first.format === "html" && first.text.includes("# Part 1: Definitions and scope"), "the live page, not the capture");
  assert.ok(existsSync(join(dir, "cap-a.html")) && existsSync(join(dir, "cap-a.source.json")), "the page is cached with its sidecar");
  assert.ok(existsSync(join(dir, "cap-a.md")), "the capture is kept");
  // the next run reads the cached page and asks for nothing
  const offline = fakeFetch(() => respond("no", { status: 500 }));
  const second = await loadSource(candidate("cap-a"), { rawDir: dir, fetchImpl: offline.impl });
  assert.ok(second.ok && second.via === "cache" && second.format === "html");
  assert.equal(offline.calls.length, 0);
});

test("R33: when the live page cannot be read the capture stands in, and no browser session is paid for", async () => {
  for (const status of [403, 404, 200]) {
    const dir = await nextDir();
    await writeFile(join(dir, "cap-b.md"), `# From the capture\n\n${words(200)}`);
    const seen: string[] = [];
    const down = fakeFetch(() => (status === 200 ? respond("<html><body><p>Please log in.</p></body></html>", { type: "text/html" }) : respond("no", { status })));
    const result = await loadSource(candidate("cap-b"), {
      rawDir: dir,
      fetchImpl: down.impl,
      browserbaseKey: "bb-key",
      browserReader: async (url) => {
        seen.push(url);
        return bill.toString();
      },
    });
    assert.ok(result.ok && result.via === "cache" && result.format === "text" && result.text.startsWith("# From the capture"), String(status));
    assert.equal(down.calls.length, 1);
    assert.deepEqual(seen, [], "the capture is the browser's stand-in");
    assert.ok(!existsSync(join(dir, "cap-b.html")));
  }
});

test("R33: a capture of a Statutes Online or leginfo page is used as it is, and a hand-placed .txt still overrides the live page", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "cap-c.md"), `# An Act\n\n${words(200)}`);
  const never = fakeFetch(() => respond("should not be fetched"));
  const sso = await loadSource(candidate("cap-c", "https://sso.agc.gov.sg/Act/X?WholeDoc=1"), { rawDir: dir, fetchImpl: never.impl });
  assert.ok(sso.ok && sso.via === "cache" && sso.text.startsWith("# An Act"));
  await writeFile(join(dir, "cap-d.txt"), words(200));
  await writeFile(join(dir, "cap-d.md"), `# Capture\n\n${words(200)}`);
  const txt = await loadSource(candidate("cap-d"), { rawDir: dir, fetchImpl: never.impl });
  assert.ok(txt.ok && txt.text.startsWith("word0 word1"));
  assert.equal(never.calls.length, 0);
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

test("403 with a browserbase key retries through the browser reader and caches the rendered page as .html", async () => {
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
  assert.ok(existsSync(join(dir, "doc-m.html")));
  assert.equal(existsSync(join(dir, "doc-m.txt")), false);
  assert.ok(result.ok && result.format === "html" && result.html === `<html><body><h1>Statute</h1><p>${words(200)}</p></body></html>`);

  const again = await loadSource(c, { rawDir: dir, fetchImpl: impl, browserbaseKey: "bb-key", browserReader: reader });
  assert.ok(again.ok && again.via === "cache");
  assert.ok(again.ok && result.ok && again.format === "html" && again.html === result.html && again.text === result.text, "a cache hit still has the HTML");
  assert.equal(seen.length, 1);
});

test("an older Browserbase cache (the extracted text as .txt) is still read, as text", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "doc-m2.txt"), `# Statute\n\n${words(200)}`);
  await writeFile(join(dir, "doc-m2.source.json"), JSON.stringify({ url: "https://sso.example.test/Act/X", fetchedAt: "2026-10-14T00:00:00.000Z" }));
  const { impl, calls } = fakeFetch(() => respond("no"));
  const result = await loadSource(candidate("doc-m2", "https://sso.example.test/Act/X"), { rawDir: dir, fetchImpl: impl, browserbaseKey: "bb-key" });
  assert.ok(result.ok && result.via === "cache" && result.format === "text" && result.html === undefined);
  assert.equal(calls.length, 0);
});

test("a page the browser returns in another charset is cached as UTF-8 and reads the same from the cache", async () => {
  const dir = await nextDir();
  const html = `<html><head><meta charset="windows-1252"></head><body><p>café ${words(200)}</p></body></html>`;
  const c = candidate("doc-m3");
  const { impl } = fakeFetch(() => respond("Forbidden", { status: 403 }));
  const fresh = await loadSource(c, { rawDir: dir, fetchImpl: impl, browserbaseKey: "bb-key", browserReader: async () => html });
  const cached = await loadSource(c, { rawDir: dir, fetchImpl: impl });
  assert.ok(fresh.ok && cached.ok && fresh.text.startsWith("café word0") && cached.text === fresh.text && cached.html === fresh.html);
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
  assert.equal(existsSync(join(dir, "doc-o.html")), false);
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

test("I4: a hand-placed .md or .txt with no sidecar is trusted whatever the url (the .md after a failed attempt at the live page)", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "hand-md.md"), `# Placed by hand\n\n${words(200)}`);
  await writeFile(join(dir, "hand-txt.txt"), words(200));
  const { impl, calls } = fakeFetch(() => respond("not found", { status: 404 }));
  for (const id of ["hand-md", "hand-txt"]) {
    const result = await loadSource(candidate(id, "https://example.test/any-url"), { rawDir: dir, fetchImpl: impl });
    assert.ok(result.ok && result.via === "cache", id);
  }
  assert.equal(calls.length, 1, "only the capture's page was asked for");
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

test("dry run: markdownToText removes emphasis markers and backslash escapes, so a capture reads as the page does", () => {
  assert.equal(
    markdownToText("1\\. Singapore launched _A.I. Verify_ - a **Testing Framework** and __Toolkit__, with *care*.\n\n**SINGAPORE \u2013 20 JUL 2022**  EDB and IMDA\n\n**Resources:**"),
    "1. Singapore launched A.I. Verify - a Testing Framework and Toolkit, with care.\n\nSINGAPORE \u2013 20 JUL 2022  EDB and IMDA\n\nResources:",
  );
  assert.equal(markdownToText("It costs 5 \\* 3 and C:\\Users stays."), "It costs 5 * 3 and C:\\Users stays.");
});

test("dry run: markdownToText leaves snake_case words, a lone asterisk, a rule of asterisks, a list marker and unpaired markers alone", () => {
  const text = "The my_field_name and file_name_2 are kept.\n\n* a star bullet\n\n*****\n\n5 * 3 = 15 and 2 ** 3.\n\nOne **unpaired marker and one_ underscore.";
  assert.equal(markdownToText(text), text);
});

// ---------------------------------------------------------------------------------------------------------------------
// 7a: California bills are read from the Legislature's bulk download, because leginfo.legislature.ca.gov answers 403

const NAV53 = "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB53";
const TEXT53 = "https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB53";
const sb53 = (body = `The Legislature finds ${wordsOf(200, "tfaia")}.`): FixtureBill => ({
  session: "202520260",
  type: "SB",
  num: 53,
  subject: "Artificial intelligence models: large developers.",
  versions: [
    { stage: "INT", versionNum: 99, date: "2025-01-07", body: "Introduced text" },
    { stage: "CHP", versionNum: 90, date: "2025-09-29", body },
  ],
});

test("7a: a leginfo bill is read from the bulk archive, written as .txt with a sidecar naming the version, and then served from the cache", async () => {
  const dir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  const c = candidate("ca-sb-53-2025", NAV53);
  const result = await loadSource(c, { rawDir: dir, fetchImpl: server.fetch, now: CLOCK });
  assert.ok(result.ok && result.via === "leginfo-bulk", JSON.stringify(result).slice(0, 300));
  assert.ok(result.ok && result.text.startsWith("# Bill: SB 53 (2025-2026) \u2014 Artificial intelligence models: large developers."));
  assert.ok(result.ok && result.text.includes("tfaia0 tfaia1"));
  assert.ok(server.requests.length > 0 && server.requests.every((r) => r.url === archiveUrl("2025") && r.range !== null), "only ranges of the archive, never leginfo itself");

  assert.equal(await readFile(join(dir, "ca-sb-53-2025.txt"), "utf8"), result.ok ? result.text : "");
  assert.deepEqual(await sidecarOf(dir, "ca-sb-53-2025"), { url: NAV53, fetchedAt: "2026-10-15T09:00:00.000Z", via: "leginfo-bulk", versionId: "20250SB5390CHP", layout: "2" });
  assert.ok(existsSync(join(dir, "leginfo", "2025-versions.json")), "the session's version index is kept next to the downloads");

  const before = server.requests.length;
  const again = await loadSource(c, { rawDir: dir, fetchImpl: server.fetch });
  assert.ok(again.ok && again.via === "cache" && result.ok && again.text === result.text);
  assert.equal(server.requests.length, before, "a cache hit makes no request");
});

test("7a: a bill that is not in the archive fails as 'loading failed' with the reason in the detail, and nothing is cached", async () => {
  const dir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  let browserUsed = false;
  const result = await loadSource(candidate("ca-sb-9-2025", "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB9"), {
    rawDir: dir,
    fetchImpl: server.fetch,
    browserbaseKey: "key",
    browserReader: async () => {
      browserUsed = true;
      return words(200);
    },
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "loading failed" && /202520260SB9\b/.test(result.detail ?? ""), JSON.stringify(result));
  assert.equal(browserUsed, false, "a blocked leginfo page is not retried in a browser; the archive is the source");
  assert.equal(existsSync(join(dir, "ca-sb-9-2025.txt")), false);
  assert.equal(existsSync(join(dir, "ca-sb-9-2025.source.json")), false);
});

test("7a: an unreachable archive is 'loading failed' too, with the network error in the detail", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const result = await loadSource(candidate("ca-sb-53-2025", NAV53), { rawDir: dir, fetchImpl: impl });
  assert.ok(!result.ok && result.reason === "loading failed" && /fetch failed/.test(result.detail ?? ""), JSON.stringify(result));
});

test("7a: a leginfo URL that names no bill, such as a code section, takes the ordinary fetch path", async () => {
  const dir = await nextDir();
  const codeUrl = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.100";
  const { impl, calls } = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  const result = await loadSource(candidate("ca-civ-1798-100", codeUrl), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "fetch");
  assert.deepEqual(calls.map((c) => c.url), [codeUrl]);
  assert.equal(existsSync(join(dir, "leginfo")), false);
  assert.equal((await sidecarOf(dir, "ca-civ-1798-100")).url, codeUrl);
  assert.equal((await sidecarOf(dir, "ca-civ-1798-100")).via, undefined, "an ordinary download has no via in its sidecar");
});

test("7a: a bill with under 150 words fails as 'too little text' and is not cached", async () => {
  const dir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53("Just a few words.")]).zip });
  const result = await loadSource(candidate("ca-sb-53-2025", NAV53), { rawDir: dir, fetchImpl: server.fetch });
  assert.deepEqual(result, { ok: false, reason: "too little text" });
  assert.equal(existsSync(join(dir, "ca-sb-53-2025.txt")), false);
  assert.equal(existsSync(join(dir, "ca-sb-53-2025.source.json")), false);
});

test("7a: refresh reads the bill again from the archive and records the new version", async () => {
  const dir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  const c = candidate("ca-sb-53-2025", NAV53);
  await loadSource(c, { rawDir: dir, fetchImpl: server.fetch, now: CLOCK });

  const newer = sb53();
  newer.versions.push({ stage: "CHP", versionNum: 89, date: "2026-03-01", body: `Amended again ${wordsOf(200, "later")}` });
  server.files.set(archiveUrl("2025"), pubinfoZip([newer]).zip);

  const kept = await loadSource(c, { rawDir: dir, fetchImpl: server.fetch });
  assert.ok(kept.ok && kept.via === "cache" && kept.text.includes("tfaia0"), "without --refresh the cached text stays");

  const refreshed = await loadSource(c, { rawDir: dir, fetchImpl: server.fetch, refresh: "downloads", now: () => new Date("2026-11-01T00:00:00.000Z") });
  assert.ok(refreshed.ok && refreshed.via === "leginfo-bulk" && refreshed.text.includes("later0"), JSON.stringify(refreshed).slice(0, 200));
  assert.deepEqual(await sidecarOf(dir, "ca-sb-53-2025"), { url: NAV53, fetchedAt: "2026-11-01T00:00:00.000Z", via: "leginfo-bulk", versionId: "20250SB5389CHP", layout: "2" });
});

test("7a: a candidate whose URL changed is read again, and the session's index is reused", async () => {
  const dir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  await loadSource(candidate("ca-sb-53-2025", NAV53), { rawDir: dir, fetchImpl: server.fetch, now: CLOCK });
  const before = server.requests.length;
  const moved = await loadSource(candidate("ca-sb-53-2025", TEXT53), { rawDir: dir, fetchImpl: server.fetch, now: CLOCK });
  assert.ok(moved.ok && moved.via === "leginfo-bulk");
  assert.equal((await sidecarOf(dir, "ca-sb-53-2025")).url, TEXT53);
  assert.equal(server.requests.length - before, 2, "only the bill's own XML is read again");
});

test("7a: a hand-placed .txt for a leginfo bill is trusted and nothing is downloaded", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "ca-sb-53-2025.txt"), words(200));
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  const result = await loadSource(candidate("ca-sb-53-2025", NAV53), { rawDir: dir, fetchImpl: server.fetch });
  assert.ok(result.ok && result.via === "cache" && result.text.startsWith("word0"));
  assert.equal(server.requests.length, 0);
});

test("7a fix: a leginfo bill's text is the header, the digest, then the legislative history (a chaptered bill has no status line), and the cache keeps it", async () => {
  const dir = await nextDir();
  const bill = sb53();
  bill.currentStatus = "Chaptered";
  bill.history = [
    { date: "2025-09-29", text: "Chaptered by Secretary of State.  Chapter 138, Statutes of 2025." },
    { date: "2025-01-07", text: "Introduced.  Read first time." },
  ];
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([bill]).zip });
  const c = candidate("ca-sb-53-2025", NAV53);
  const result = await loadSource(c, { rawDir: dir, fetchImpl: server.fetch, now: CLOCK, leginfoBills: ["202520260SB53"] });
  assert.ok(result.ok && result.via === "leginfo-bulk");
  const headings = result.ok ? result.text.split("\n").filter((l) => l.startsWith("# ")) : [];
  assert.deepEqual(headings, ["# Bill: SB 53 (2025-2026) \u2014 Artificial intelligence models: large developers.", "# Legislative Counsel's Digest", "# Legislative history", "# SECTION 1."]);
  assert.ok(
    result.ok &&
      result.text.includes(
        "# Legislative history\n\n2025-01-07 \u2014 Introduced. Read first time.\n\n2025-09-29 \u2014 Chaptered by Secretary of State. Chapter 138, Statutes of 2025.\n\n# SECTION 1.",
      ),
    result.ok ? result.text.slice(0, 500) : "",
  );
  assert.ok(existsSync(join(dir, "leginfo", "2025-history.json")));
  const again = await loadSource(c, { rawDir: dir, fetchImpl: server.fetch });
  assert.ok(again.ok && again.via === "cache" && result.ok && again.text === result.text, "the cached .txt has the history in it");
});

test("R23: a leginfo bill cached in an earlier text layout (no layout in its sidecar) is read again, so the new order reaches the build", async () => {
  const dir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  const c = candidate("ca-sb-53-2025", NAV53);
  // What 7b left behind: the history first, no header, and a sidecar from before `layout` existed.
  await writeFile(join(dir, "ca-sb-53-2025.txt"), `# Legislative history\n\n2025-01-07 \u2014 Introduced.\n\n# Legislative Counsel's Digest\n\n${words(200)}`);
  await writeFile(join(dir, "ca-sb-53-2025.source.json"), JSON.stringify({ url: NAV53, fetchedAt: "2026-10-15T04:51:27.210Z", via: "leginfo-bulk", versionId: "20250SB5390CHP" }));

  const result = await loadSource(c, { rawDir: dir, fetchImpl: server.fetch, now: CLOCK });
  assert.ok(result.ok && result.via === "leginfo-bulk" && result.text.startsWith("# Bill: SB 53 (2025-2026)"), JSON.stringify(result).slice(0, 200));
  assert.equal((await sidecarOf(dir, "ca-sb-53-2025")).layout, "2");

  const again = await loadSource(c, { rawDir: dir, fetchImpl: server.fetch });
  assert.ok(again.ok && again.via === "cache", "and the new layout is served from the cache");
});

test("R23: the layout check applies only to leginfo downloads: a hand-placed .txt with no sidecar, and a download from another route with a sidecar, are still trusted", async () => {
  const dir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  await writeFile(join(dir, "ca-sb-53-2025.txt"), words(200));
  const handPlaced = await loadSource(candidate("ca-sb-53-2025", NAV53), { rawDir: dir, fetchImpl: server.fetch });
  assert.ok(handPlaced.ok && handPlaced.via === "cache");

  await writeFile(join(dir, "ca-sb-9-2025.txt"), words(200));
  await writeFile(join(dir, "ca-sb-9-2025.source.json"), JSON.stringify({ url: NAV53, fetchedAt: "2026-10-15T04:51:27.210Z", via: "firecrawl" }));
  const other = await loadSource(candidate("ca-sb-9-2025", NAV53), { rawDir: dir, fetchImpl: server.fetch });
  assert.ok(other.ok && other.via === "cache");
  assert.equal(server.requests.length, 0);
});

test("7a fix: the 150-word gate counts the bill, not its history", async () => {
  const dir = await nextDir();
  const bill = sb53("Just a few words.");
  bill.history = Array.from({ length: 40 }, (_, i) => ({ date: `2025-02-${String(i + 1).padStart(2, "0")}`, text: `Action number ${i} was taken by the house on this day.` }));
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([bill]).zip });
  const result = await loadSource(candidate("ca-sb-53-2025", NAV53), { rawDir: dir, fetchImpl: server.fetch });
  assert.deepEqual(result, { ok: false, reason: "too little text" });
  assert.equal(existsSync(join(dir, "ca-sb-53-2025.txt")), false);
});

// ---------------------------------------------------------------------------------------------------------------------
// Task 8: the format, the HTML, and the sections that make a page's meta facts citable

const descriptionPage = (description: string, body = words(200)) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title><meta name="description" content="${description}"></head><body><h1>Heading</h1><p>${body}</p></body></html>`;
const sentenceOf = (n: number, label = "desc") => Array.from({ length: n }, (_, i) => `${label}${i}`).join(" ");

test("T8: a fetched HTML page returns format html, its raw HTML, and the meta description in front of the text when the body lacks it", async () => {
  const dir = await nextDir();
  const page = descriptionPage(sentenceOf(20));
  const { impl } = fakeFetch(() => respond(page, { type: "text/html; charset=utf-8" }));
  const result = await loadSource(candidate("t8-a"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "fetch" && result.format === "html");
  assert.ok(result.ok && result.html === page);
  assert.ok(result.ok && result.text.startsWith(`# Page description\n\n${sentenceOf(20)}\n\n# Heading\n\n`), result.ok ? result.text.slice(0, 200) : "");
});

test("T8: a cache hit returns the same text and html as the fetch did", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond(descriptionPage(sentenceOf(20)), { type: "text/html; charset=utf-8" }));
  const fresh = await loadSource(candidate("t8-b"), { rawDir: dir, fetchImpl: impl });
  const hit = await loadSource(candidate("t8-b"), { rawDir: dir, fetchImpl: fakeFetch(() => respond("no")).impl });
  assert.ok(fresh.ok && hit.ok && hit.via === "cache" && hit.format === "html");
  assert.ok(fresh.ok && hit.ok && hit.text === fresh.text && hit.html === fresh.html);
});

test("T8: a description of 14 words adds no block, and one already in the body adds none either", async () => {
  const dir = await nextDir();
  const short = await loadSource(candidate("t8-c"), { rawDir: dir, fetchImpl: fakeFetch(() => respond(descriptionPage(sentenceOf(14)), { type: "text/html" })).impl });
  assert.ok(short.ok && !short.text.includes("Page description") && short.text.startsWith("# Heading"));
  const inBody = await loadSource(candidate("t8-c2"), {
    rawDir: dir,
    fetchImpl: fakeFetch(() => respond(descriptionPage(sentenceOf(20), `${sentenceOf(20)} and then ${words(200)}`), { type: "text/html" })).impl,
  });
  assert.ok(inBody.ok && !inBody.text.includes("Page description"));
});

test("T8: the 150-word gate counts the page's own text, not the added description", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond(descriptionPage(sentenceOf(200), words(40)), { type: "text/html" }));
  const result = await loadSource(candidate("t8-d"), { rawDir: dir, fetchImpl: impl });
  assert.deepEqual(result, { ok: false, reason: "too little text" });
  assert.equal(existsSync(join(dir, "t8-d.html")), false);
  // and the same page from the cache
  await writeFile(join(dir, "t8-d2.html"), descriptionPage(sentenceOf(200), words(40)));
  assert.deepEqual(await loadSource(candidate("t8-d2"), { rawDir: dir, fetchImpl: impl }), { ok: false, reason: "too little text" });
});

test("T8: a hand-placed .md or .txt is format text, with no html", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "t8-f.md"), `# From markdown\n\n${words(200)}`);
  const md = await loadSource(candidate("t8-f"), { rawDir: dir, fetchImpl: fakeFetch(() => respond("no")).impl });
  assert.ok(md.ok && md.format === "text" && md.html === undefined && md.via === "cache");
  await writeFile(join(dir, "t8-g.txt"), words(200));
  const txt = await loadSource(candidate("t8-g"), { rawDir: dir, fetchImpl: fakeFetch(() => respond("no")).impl });
  assert.ok(txt.ok && txt.format === "text" && txt.html === undefined);
});

test("T8: a long PDF gives format pdf and no html, fresh and from the cache", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond(makePdf(words(200)), { type: "application/pdf" }));
  const fresh = await loadSource(candidate("t8-h"), { rawDir: dir, fetchImpl: impl });
  assert.ok(fresh.ok && fresh.format === "pdf" && fresh.html === undefined, JSON.stringify(fresh).slice(0, 200));
  const hit = await loadSource(candidate("t8-h"), { rawDir: dir, fetchImpl: fakeFetch(() => respond("no")).impl });
  assert.ok(hit.ok && hit.via === "cache" && hit.format === "pdf" && hit.html === undefined);
});

test("T8: a leginfo bill is format text", async () => {
  const dir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  const result = await loadSource(candidate("ca-sb-53-2025", NAV53), { rawDir: dir, fetchImpl: server.fetch });
  assert.ok(result.ok && result.via === "leginfo-bulk" && result.format === "text" && result.html === undefined);
});

test("T8: a Next.js page keeps its text in a script payload: it is decoded, counts for the gate, and the raw HTML is returned", async () => {
  const dir = await nextDir();
  const page = readFileSync(new URL("../fixtures/extract/release-imda-next.html", import.meta.url), "utf8");
  assert.ok(wordCount(htmlToText(page)) < 150, "the visible page alone is too little");
  const { impl } = fakeFetch(() => respond(page, { type: "text/html; charset=utf-8" }));
  const result = await loadSource(candidate("t8-i", "https://www.imda.gov.sg/resources/press-releases-factsheets-and-speeches/press-releases/2022/x"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.format === "html" && result.html === page, JSON.stringify(result).slice(0, 200));
  assert.ok(result.ok && result.text.includes("# Singapore launches world’s first AI testing framework"));
  assert.ok(result.ok && result.text.includes("Developers and owners can verify the claimed performance"), "a section held in a referenced text row");
  const hit = await loadSource(candidate("t8-i", "https://www.imda.gov.sg/resources/press-releases-factsheets-and-speeches/press-releases/2022/x"), { rawDir: dir, fetchImpl: fakeFetch(() => respond("no")).impl });
  assert.ok(hit.ok && hit.via === "cache" && result.ok && hit.text === result.text);
});

test("T8: a Next.js page whose payload holds little text is still too little text", async () => {
  const dir = await nextDir();
  const stream = `5:["$","div",null,{"data":{"section_description":"<p>${words(30)}</p>"}}]\n`;
  const page = `<html><body><h1>Title</h1><p>${words(20)}</p><script>self.__next_f.push([1,${JSON.stringify(stream)}])</script></body></html>`;
  const result = await loadSource(candidate("t8-j"), { rawDir: dir, fetchImpl: fakeFetch(() => respond(page, { type: "text/html" })).impl });
  assert.deepEqual(result, { ok: false, reason: "too little text" });
});

// ---------------------------------------------------------------------------------------------------------------------
// R23: Singapore Statutes Online loads most of an Act by script, so its pages are assembled (see sso.ts)

const SSO_URL = "https://sso.agc.gov.sg/Act/FIXT2024?WholeDoc=1";
const ssoTerms = ["t-2", "t-3"];
const ssoPage = () => {
  const cfg = {
    lazyLoadFilter: { TocSysId: "toc-1", SeriesId: null, V: "41" },
    lazyLoadContentUrl: "/Details/GetLazyLoadContent",
    fragments: Object.fromEntries(ssoTerms.map((t) => [t, { Item1: `f-${t}`, Item2: "20260714171716" }])),
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title></title></head><body>
<div class="global-vars" data-json='${JSON.stringify(cfg)}'></div><nav>Contents</nav>
<div id="legisContent"><p>Fixture Act front part ${wordsOf(40, "front")}</p>${ssoTerms.map((t) => `<div class="dms" data-field="seriesId" data-term="${t}"></div>`).join("")}</div></body></html>`;
};
/** A fake Singapore Statutes Online: the page, and a part per SeriesId. `fail` makes the named part answer HTTP 500. */
function fakeSsoSite(opts: { fail?: string; pageStatus?: number } = {}) {
  const urls: string[] = [];
  const { impl } = fakeFetch((url) => {
    urls.push(url);
    if (url.includes("/Details/GetLazyLoadContent")) {
      const term = new URL(url).searchParams.get("SeriesId")!;
      if (term === opts.fail) return respond("error", { status: 500 });
      return respond(`<table><tr><td>Part for ${term} ${wordsOf(60, `part${term.replace("-", "")}w`)}</td></tr></table>`, { type: "text/html; charset=utf-8" });
    }
    return opts.pageStatus ? respond("Forbidden", { status: opts.pageStatus }) : respond(ssoPage(), { type: "text/html; charset=utf-8" });
  });
  return { impl, urls };
}
const ssoFast = { pauseMs: 0, sleep: async () => undefined, retryWaitMs: 1, challengeWaitMs: 1, maxAttempts: 2, log: () => undefined };

test("R23: a Singapore Statutes Online Act on a cache miss is assembled from its lazy-loaded parts, and cached whole", async () => {
  const dir = await nextDir();
  const site = fakeSsoSite();
  const c = candidate("sg-fixt-2024", SSO_URL);
  const result = await loadSource(c, { rawDir: dir, fetchImpl: site.impl, now: CLOCK, sso: ssoFast });
  assert.ok(result.ok && result.via === "sso-lazyload", JSON.stringify(result).slice(0, 300));
  assert.ok(result.ok && result.text.includes("front0") && result.text.includes("partt2w0") && result.text.includes("partt3w59"), "the page's own part and both lazy-loaded parts");
  assert.deepEqual(site.urls.map((u) => new URL(u).pathname), ["/Act/FIXT2024", "/Details/GetLazyLoadContent", "/Details/GetLazyLoadContent"]);

  assert.deepEqual(await sidecarOf(dir, "sg-fixt-2024"), { url: SSO_URL, fetchedAt: "2026-10-15T09:00:00.000Z", via: "sso-lazyload" });
  const cachedHtml = await readFile(join(dir, "sg-fixt-2024.html"), "utf8");
  assert.ok(cachedHtml.includes("partt3w59") && !cachedHtml.includes('class="dms"'), "the assembled page is what is cached");

  const before = site.urls.length;
  const again = await loadSource(c, { rawDir: dir, fetchImpl: site.impl, sso: ssoFast });
  assert.ok(again.ok && again.via === "cache" && result.ok && again.text === result.text);
  assert.equal(site.urls.length, before, "a cache hit makes no request");
});

test("R23: a hand-assembled Act in the cache (7b's captures) is served from the cache and is not overwritten", async () => {
  const dir = await nextDir();
  const handAssembled = `<html><body><p>Hand assembled ${wordsOf(300, "hand")}</p></body></html>`;
  await writeFile(join(dir, "sg-fixt-2024.html"), handAssembled);
  await writeFile(join(dir, "sg-fixt-2024.source.json"), JSON.stringify({ url: SSO_URL, fetchedAt: "2026-10-15T05:05:29.089Z", via: "sso-lazyload" }));
  const site = fakeSsoSite();
  const result = await loadSource(candidate("sg-fixt-2024", SSO_URL), { rawDir: dir, fetchImpl: site.impl, sso: ssoFast });
  assert.ok(result.ok && result.via === "cache" && result.text.includes("hand0"));
  assert.equal(site.urls.length, 0);
  assert.equal(await readFile(join(dir, "sg-fixt-2024.html"), "utf8"), handAssembled);
  assert.equal((await sidecarOf(dir, "sg-fixt-2024")).fetchedAt, "2026-10-15T05:05:29.089Z");
});

test("R23: --refresh replaces an Act's cached copy with a freshly assembled one", async () => {
  const dir = await nextDir();
  await writeFile(join(dir, "sg-fixt-2024.html"), `<html><body><p>Old ${wordsOf(300, "old")}</p></body></html>`);
  await writeFile(join(dir, "sg-fixt-2024.source.json"), JSON.stringify({ url: SSO_URL, fetchedAt: "2026-10-15T05:05:29.089Z", via: "sso-lazyload" }));
  const site = fakeSsoSite();
  const result = await loadSource(candidate("sg-fixt-2024", SSO_URL), { rawDir: dir, fetchImpl: site.impl, refresh: "downloads", now: CLOCK, sso: ssoFast });
  assert.ok(result.ok && result.via === "sso-lazyload" && result.text.includes("partt3w0") && !result.text.includes("old0"));
  assert.equal((await sidecarOf(dir, "sg-fixt-2024")).fetchedAt, "2026-10-15T09:00:00.000Z");
});

test("R23: an Act with a part that cannot be fetched fails as 'loading failed', is not cached, and is not given to a browser", async () => {
  const dir = await nextDir();
  const site = fakeSsoSite({ fail: "t-3" });
  let browserUsed = false;
  const result = await loadSource(candidate("sg-fixt-2024", SSO_URL), {
    rawDir: dir,
    fetchImpl: site.impl,
    browserbaseKey: "key",
    browserReader: async () => {
      browserUsed = true;
      return `<p>${words(200)}</p>`;
    },
    sso: ssoFast,
  });
  assert.ok(!result.ok && result.reason === "loading failed" && /t-3/.test(result.detail ?? ""), JSON.stringify(result));
  assert.equal(browserUsed, false, "a browser would show the same partial Act");
  assert.equal(existsSync(join(dir, "sg-fixt-2024.html")), false);
  assert.equal(existsSync(join(dir, "sg-fixt-2024.source.json")), false);
});

/** An Act cached by hand, as 7b left them, to show that a failed or refused load leaves it alone. */
async function handCapture(dir: string, id = "sg-fixt-2024") {
  const html = `<html><body><p>Hand assembled ${wordsOf(300, "hand")}</p></body></html>`;
  const sidecar = JSON.stringify({ url: SSO_URL, fetchedAt: "2026-10-15T05:05:29.089Z", via: "sso-lazyload" });
  await writeFile(join(dir, `${id}.html`), html);
  await writeFile(join(dir, `${id}.source.json`), sidecar);
  return { html, sidecar };
}
const untouched = async (dir: string, kept: { html: string; sidecar: string }, id = "sg-fixt-2024") => {
  assert.equal(await readFile(join(dir, `${id}.html`), "utf8"), kept.html, "the hand capture is still there, byte for byte");
  assert.equal(await readFile(join(dir, `${id}.source.json`), "utf8"), kept.sidecar);
  assert.equal(existsSync(join(dir, `${id}.txt`)), false, "and no partial .txt was written beside it");
};

test("R28: a Statutes Online page that cannot be fetched (403, 429, unreachable, a challenge that never clears) never reaches the browser fallback, and a hand capture stays", async () => {
  const cases: [string, typeof fetch, string][] = [
    ["403", fakeSsoSite({ pageStatus: 403 }).impl, "HTTP 403"],
    ["429", fakeSsoSite({ pageStatus: 429 }).impl, "HTTP 429"],
    ["unreachable", fakeFetch(() => { throw new TypeError("fetch failed"); }).impl, "unreachable"],
    ["challenge", fakeFetch(() => new Response("<script>window.gokuProps = {}</script>", { status: 202 })).impl, "loading failed"],
  ];
  for (const [label, impl, reason] of cases) {
    const dir = await nextDir();
    const kept = await handCapture(dir);
    let browserUsed = false;
    const result = await loadSource(candidate("sg-fixt-2024", SSO_URL), {
      rawDir: dir,
      fetchImpl: impl,
      refresh: "downloads", // so that the cache is not simply served, and the page is asked for
      browserbaseKey: "key",
      browserReader: async () => {
        browserUsed = true;
        return `<p>Part 1 only. ${words(3000)}</p>`; // a browser reads the first part, which is long enough to pass the 150-word gate
      },
      sso: ssoFast,
    });
    assert.ok(!result.ok && result.reason === reason, `${label}: ${JSON.stringify(result)}`);
    assert.equal(browserUsed, false, `${label}: a browser would return the first part only`);
    await untouched(dir, kept);
  }
});

test("R28: a browser result for a Statutes Online page that still has lazy-load placeholders is rejected as 'loading failed' before anything is stored", async () => {
  const dir = await nextDir();
  const kept = await handCapture(dir);
  // What a browser session returns at the load event: the contents, the first part (about 3,000 words) and the empty placeholders.
  const firstPartOnly = ssoPage().concat(`<p>${words(3000)}</p>`);
  assert.ok(firstPartOnly.includes('class="dms"'));
  const result = await loadViaBrowser(candidate("sg-fixt-2024", SSO_URL), { rawDir: dir, browserReader: async () => firstPartOnly, now: CLOCK }, "key", "HTTP 403");
  assert.ok(!result.ok && result.reason === "loading failed" && /lazy-load|part/i.test(result.detail ?? ""), JSON.stringify(result));
  await untouched(dir, kept);

  // The same page without placeholders is a whole Act and is accepted (a unit test of the guard, not of the policy: loadSource does not send Acts here).
  const whole = ssoPage().replace(/<div class="dms"[^>]*><\/div>/g, "") + `<p>${words(300)}</p>`;
  const ok = await loadViaBrowser(candidate("sg-fixt-2025", SSO_URL), { rawDir: dir, browserReader: async () => whole, now: CLOCK }, "key", "HTTP 403");
  assert.ok(ok.ok && ok.via === "browserbase", JSON.stringify(ok));
});

test("R28: a placeholder-bearing page from the download path is rejected too, whichever layer notices, and nothing is stored over the hand capture", async () => {
  const dir = await nextDir();
  const kept = await handCapture(dir);
  // Markup the assembler's own pattern does not read (single quotes), so the page would look like an Act with no parts.
  const odd = ssoPage().replace(/<div class="dms"[^>]*><\/div>/g, "").replace("</div></body>", "<div class='dms' data-field='seriesId' data-term='odd'></div></div></body>");
  const { impl } = fakeFetch(() => respond(odd, { type: "text/html; charset=utf-8" }));
  const result = await loadSource(candidate("sg-fixt-2024", SSO_URL), { rawDir: dir, fetchImpl: impl, refresh: "downloads", sso: ssoFast });
  assert.ok(!result.ok && result.reason === "loading failed", JSON.stringify(result));
  await untouched(dir, kept);
});

test("R28: the Act's time limit and progress lines come through the loader's sso options", async () => {
  const dir = await nextDir();
  const site = fakeSsoSite();
  const lines: string[] = [];
  const ok = await loadSource(candidate("sg-fixt-2024", SSO_URL), { rawDir: dir, fetchImpl: site.impl, sso: { ...ssoFast, log: (line) => lines.push(line) } });
  assert.ok(ok.ok);
  assert.deepEqual(lines, ["sso FIXT2024: part 1/2", "sso FIXT2024: part 2/2"]);

  let t = 0;
  const slow = await loadSource(candidate("sg-fixt-2025", SSO_URL), { rawDir: dir, fetchImpl: fakeSsoSite().impl, sso: { ...ssoFast, pauseMs: 400, deadlineMs: 300, now: () => t, sleep: async (ms) => void (t += ms) } });
  assert.ok(!slow.ok && slow.reason === "loading failed" && /deadline/i.test(slow.detail ?? ""), JSON.stringify(slow));
  assert.equal(existsSync(join(dir, "sg-fixt-2025.html")), false, "an Act that ran out of time is not cached");
});

test("R23: other sites are not touched: a Singapore Government page is fetched once, as before", async () => {
  const dir = await nextDir();
  const { impl, calls } = fakeFetch(() => respond(bill, { type: "text/html; charset=utf-8" }));
  const result = await loadSource(candidate("sg-other", "https://www.mddi.gov.sg/some-page"), { rawDir: dir, fetchImpl: impl, now: CLOCK });
  assert.ok(result.ok && result.via === "fetch");
  assert.equal(calls.length, 1);
  assert.equal((await sidecarOf(dir, "sg-other")).via, undefined);
});
