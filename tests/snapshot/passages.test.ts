import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { PassageSchema } from "../../photon/src/data/schema.ts";
import { htmlToText } from "../../photon/scripts/snapshot/extract.ts";
import { sha256Hex, splitPassages, wordCount } from "../../photon/scripts/snapshot/passages.ts";

const bill = readFileSync(new URL("../fixtures/sources/bill.html", import.meta.url), "utf8");

/** A paragraph of exactly n words; the first word is a label so paragraphs are distinguishable. */
const para = (label: string, n: number) => [label, ...Array.from({ length: n - 1 }, (_, i) => `w${i}`)].join(" ");
/** A paragraph of n words made of sentences of 10 words each. */
const sentences = (label: string, n: number) =>
  Array.from({ length: n / 10 }, (_, i) => `${label}${i} ${Array.from({ length: 9 }, (_, j) => `w${j}`).join(" ")}.`).join(" ");

test("sha256Hex matches the known digest of abc", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256Hex hashes the UTF-8 bytes", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.match(sha256Hex("日本語"), /^[0-9a-f]{64}$/);
});

test("empty or blank text gives no passages", () => {
  assert.deepEqual(splitPassages("x", ""), []);
  assert.deepEqual(splitPassages("x", " \n\n  \n"), []);
});

test("a heading with no body gives no passage", () => {
  assert.deepEqual(splitPassages("x", "# Only a heading\n\n# Another"), []);
});

test("about 900 words in 100-word paragraphs gives 3 passages x#1..x#3, none over 600 words", () => {
  const text = Array.from({ length: 9 }, (_, i) => para(`p${i}`, 100)).join("\n\n");
  const passages = splitPassages("x", text);
  assert.deepEqual(
    passages.map((p) => p.id),
    ["x#1", "x#2", "x#3"],
  );
  assert.deepEqual(
    passages.map((p) => wordCount(p.text)),
    [400, 400, 100],
  );
  for (const p of passages) {
    assert.ok(wordCount(p.text) <= 600);
    assert.equal(p.recordId, "x");
    assert.equal(PassageSchema.safeParse(p).success, true, p.id);
  }
  assert.equal(passages.map((p) => p.seq).join(), "1,2,3");
});

test("the bill fixture (about 900 words) splits into 3 passages, one per section, each carrying its heading", () => {
  const passages = splitPassages("x", htmlToText(bill));
  assert.deepEqual(
    passages.map((p) => [p.id, p.heading]),
    [
      ["x#1", "Part 1: Definitions and scope"],
      ["x#2", "Part 2: Duties of platform operators"],
      ["x#3", "Part 3: Enforcement and review"],
    ],
  );
  for (const p of passages) assert.ok(wordCount(p.text) <= 600, p.id);
  assert.ok(!passages.some((p) => p.text.includes("# ")));
});

test("a heading starts a new passage even when the current one is short, and the text before any heading has no heading", () => {
  const passages = splitPassages("x", "Preamble words here.\n\n# One\n\nFirst body.\n\n# Two\n\nSecond body.");
  assert.deepEqual(
    passages.map((p) => [p.heading, p.text]),
    [
      [undefined, "Preamble words here."],
      ["One", "First body."],
      ["Two", "Second body."],
    ],
  );
  assert.ok(!("heading" in passages[0]!), "no heading key when there is none");
});

test("a section longer than the target is packed into several passages that all carry its heading", () => {
  const text = "# Long section\n\n" + Array.from({ length: 9 }, (_, i) => para(`p${i}`, 100)).join("\n\n");
  const passages = splitPassages("x", text);
  assert.equal(passages.length, 3);
  assert.deepEqual([...new Set(passages.map((p) => p.heading))], ["Long section"]);
});

test("paragraphs are packed up to the target and joined by blank lines", () => {
  const passages = splitPassages("x", [para("a", 150), para("b", 150), para("c", 150)].join("\n\n"));
  assert.deepEqual(
    passages.map((p) => wordCount(p.text)),
    [300, 150],
  );
  assert.equal(passages[0]!.text, `${para("a", 150)}\n\n${para("b", 150)}`);
});

test("a paragraph between the target and 1.5 times the target stays whole", () => {
  const passages = splitPassages("x", [para("a", 550), para("b", 20)].join("\n\n"));
  assert.deepEqual(
    passages.map((p) => wordCount(p.text)),
    [550, 20],
  );
});

test("a paragraph over 1.5 times the target is split on sentence boundaries", () => {
  const long = sentences("s", 1000);
  const passages = splitPassages("x", long);
  assert.deepEqual(
    passages.map((p) => wordCount(p.text)),
    [400, 400, 200],
  );
  for (const p of passages) {
    assert.ok(p.text.endsWith("."), `passage ends mid-sentence: ...${p.text.slice(-30)}`);
    assert.ok(p.text.startsWith("s"), `passage starts mid-sentence: ${p.text.slice(0, 30)}...`);
  }
  assert.equal(passages.map((p) => p.text).join(" "), long);
});

test("a long run with no sentence boundaries is split on words at the target", () => {
  const passages = splitPassages("x", para("w", 1300));
  assert.deepEqual(
    passages.map((p) => wordCount(p.text)),
    [400, 400, 400, 100],
  );
  assert.equal(passages.map((p) => p.text).join(" "), para("w", 1300));
});

test("a custom target changes the packing and the hard-split limit", () => {
  const text = [para("a", 30), para("b", 30), para("c", 30)].join("\n\n");
  assert.deepEqual(
    splitPassages("x", text, 60).map((p) => wordCount(p.text)),
    [60, 30],
  );
  assert.deepEqual(
    splitPassages("x", sentences("s", 100), 20).map((p) => wordCount(p.text)),
    [20, 20, 20, 20, 20],
  );
});

test("single newlines inside a paragraph are whitespace, as in text from a PDF", () => {
  const [p] = splitPassages("x", "Line one of a\nwrapped paragraph that\ncontinues here.");
  assert.equal(p!.text, "Line one of a wrapped paragraph that continues here.");
});

test("splitting is deterministic", () => {
  const text = htmlToText(bill);
  assert.deepEqual(splitPassages("r", text), splitPassages("r", text));
});

test("wordCount counts whitespace-separated words", () => {
  assert.equal(wordCount(""), 0);
  assert.equal(wordCount("  \n "), 0);
  assert.equal(wordCount(" one  two\nthree "), 3);
});
