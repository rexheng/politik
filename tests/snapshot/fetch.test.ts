import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { Candidate } from "../../photon/scripts/snapshot/candidates.ts";
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
  assert.ok(!result.ok && /network error.*fetch failed/.test(result.reason), JSON.stringify(result));
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
  assert.ok(!result.ok && /^pdf extraction failed/.test(result.reason), JSON.stringify(result));
  assert.equal(existsSync(join(dir, "doc-j3.pdf")), false);
});

test("an unsupported content-type fails without being cached", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond("PNG...", { type: "image/png" }));
  const result = await loadSource(candidate("doc-k"), { rawDir: dir, fetchImpl: impl });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && /content-type.*image\/png/.test(result.reason), JSON.stringify(result));
});

test("a plain-text response is accepted", async () => {
  const dir = await nextDir();
  const { impl } = fakeFetch(() => respond(words(200), { type: "text/plain" }));
  const result = await loadSource(candidate("doc-l"), { rawDir: dir, fetchImpl: impl });
  assert.ok(result.ok && result.via === "fetch");
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
  assert.ok(!failed.ok && /HTTP 403/.test(failed.reason) && /browserbase.*session limit/.test(failed.reason), JSON.stringify(failed));

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
  assert.equal(calls.length, 0);
});
