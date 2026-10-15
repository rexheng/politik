import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { htmlToText, pdfToText } from "../../photon/scripts/snapshot/extract.ts";

const bill = readFileSync(new URL("../fixtures/sources/bill.html", import.meta.url), "utf8");
const pdf = new Uint8Array(readFileSync(new URL("../fixtures/sources/one-page.pdf", import.meta.url)));

test("htmlToText leaves no markup and none of the nav, script, header or footer text", () => {
  const text = htmlToText(bill);
  assert.ok(!text.includes("<"), text);
  assert.ok(!text.includes(">"), text);
  for (const token of ["NAVTOKEN", "HEADERTOKEN", "FOOTERTOKEN", "NOSCRIPTTOKEN", "NAVSCRIPTTOKEN", "FOOTSCRIPTTOKEN", "COMMENTTOKEN", "Contact us", "color: red"]) {
    assert.ok(!text.includes(token), `${token} leaked into: ${text.slice(0, 200)}`);
  }
});

test("htmlToText turns h1-h4 into '# ' lines and keeps the body text", () => {
  const text = htmlToText(bill);
  const headings = text.split("\n").filter((line) => line.startsWith("# "));
  assert.deepEqual(headings, [
    "# Example Online Services Safety Bill",
    "# Part 1: Definitions and scope",
    "# Part 2: Duties of platform operators",
    "# Part 3: Enforcement and review",
  ]);
  assert.ok(text.includes("A platform operator must take reasonable steps"));
});

test("htmlToText marks h1 to h4 as headings and leaves h5 and h6 as plain paragraphs", () => {
  assert.equal(
    htmlToText("<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>"),
    "# One\n\n# Two\n\n# Three\n\n# Four\n\nFive\n\nSix",
  );
});

test("htmlToText keeps paragraph breaks as blank lines and collapses other whitespace", () => {
  const text = htmlToText("<p>one\n   two\t three</p>\n\n\n<p>four</p><div>five<br>six</div><ul><li>a</li><li>b</li></ul>");
  assert.equal(text, "one two three\n\nfour\n\nfive\n\nsix\n\na\n\nb");
});

test("htmlToText keeps inline words together and decodes entities", () => {
  const text = htmlToText("<p>The <strong>harm</strong>ful &amp; <a href='/x?a=1&b=2'>bad</a> content&nbsp;isn&rsquo;t &#8220;fine&#8221; &#x41; &sect; 5 &unknown; &lt;ok&gt;</p>");
  assert.equal(text, "The harmful & bad content isn’t “fine” A § 5 &unknown; <ok>");
});

test("htmlToText keeps a heading on one line even when it contains markup or line breaks", () => {
  assert.equal(htmlToText("<h2>Part <em>1</em>:\n  <span>Scope</span><br>and aims</h2><p>Body</p>"), "# Part 1: Scope and aims\n\nBody");
});

test("htmlToText drops empty headings and unclosed script content", () => {
  assert.equal(htmlToText("<h2> </h2><p>Body</p>"), "Body");
  assert.equal(htmlToText("<p>Before</p><script>if (a < b) { x = '</p>' }</script><p>After</p>"), "Before\n\nAfter");
});

test("htmlToText skips nested nav and keeps text after it", () => {
  assert.equal(htmlToText("<nav>a<nav>b</nav>c</nav><p>Body</p>"), "Body");
});

test("htmlToText keeps a stray less-than sign in text", () => {
  assert.equal(htmlToText("<p>if x < 5 and y > 3 then 2<3</p>"), "if x < 5 and y > 3 then 2<3");
});

test("htmlToText of an empty or markup-only page is an empty string", () => {
  assert.equal(htmlToText(""), "");
  assert.equal(htmlToText("<html><head><title>T</title></head><body><nav>x</nav></body></html>"), "");
});

test("pdfToText returns the fixture's sentence", async () => {
  const text = await pdfToText(pdf);
  assert.ok(text.includes("The Example Agency published its draft guidance on responsible artificial intelligence on 1 March 2026."), text);
});

test("pdfToText rejects bytes that are not a PDF", async () => {
  await assert.rejects(() => pdfToText(new TextEncoder().encode("not a pdf")));
});
