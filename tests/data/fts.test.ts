import assert from "node:assert/strict";
import { test } from "node:test";

import { toFtsQuery } from "../../photon/src/data/fts.ts";

const PLAIN_TERMS = /^"[\p{L}\p{N}][\p{L}\p{N}\p{M}]*"(?: "[\p{L}\p{N}][\p{L}\p{N}\p{M}]*")*$/u;

test("terms are quoted and lowercased", () => {
  assert.equal(toFtsQuery("frontier AI"), '"frontier" "ai"');
});

test("stop-words are removed", () => {
  assert.equal(toFtsQuery("the rules of the frontier"), '"rules" "frontier"');
});

test("repeated terms are kept once, in first-seen order", () => {
  assert.equal(toFtsQuery("AI frontier ai"), '"ai" "frontier"');
});

test("quotes, semicolons and asterisks never survive", () => {
  const q = toFtsQuery('"; DROP');
  assert.ok(q !== null);
  assert.equal(q, '"drop"');
  assert.ok(!/[;*]/.test(q));
  // every double quote pairs up around a plain term
  assert.match(q, PLAIN_TERMS);
});

test("FTS operators come out as plain quoted terms", () => {
  const q = toFtsQuery("NEAR(a b) * AND OR NOT");
  assert.ok(q !== null);
  assert.match(q, PLAIN_TERMS);
  assert.ok(!q.includes("*") && !q.includes("("));
});

test("column filters and prefix syntax are neutralised", () => {
  const q = toFtsQuery('title:secret ^start frontier* -excluded {text}');
  assert.ok(q !== null);
  assert.match(q, PLAIN_TERMS);
  assert.ok(!/[:^*{}-]/.test(q));
});

test("empty, all-stop-word and symbol-only input give null", () => {
  assert.equal(toFtsQuery(""), null);
  assert.equal(toFtsQuery("   \n\t"), null);
  assert.equal(toFtsQuery("the of and"), null);
  assert.equal(toFtsQuery("🙂🙂"), null);
  assert.equal(toFtsQuery('"" ** ;;'), null);
});

test("CJK input is kept", () => {
  const q = toFtsQuery("数据 中心");
  assert.ok(q !== null);
  assert.equal(q, '"数据" "中心"');
});

test("Malay and accented Latin input is kept", () => {
  assert.equal(toFtsQuery("Pelan Perlindungan Data Peribadi"), '"pelan" "perlindungan" "data" "peribadi"');
  assert.equal(toFtsQuery("café"), '"café"');
});

test("a lone combining mark is not a term", () => {
  assert.equal(toFtsQuery("́"), null);
});

test("a 2,000-character input yields at most 32 terms", () => {
  const distinct = Array.from({ length: 600 }, (_, i) => `w${i}`).join(" ").slice(0, 2000);
  assert.equal(distinct.length, 2000);
  const q = toFtsQuery(distinct);
  assert.ok(q !== null);
  assert.equal(q.split(" ").length, 32);

  const oneWord = "a".repeat(2000);
  const single = toFtsQuery(oneWord);
  assert.ok(single !== null);
  assert.equal(single.split(" ").length, 1);
});

test("random input never produces anything but quoted plain terms or null", () => {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let n = 0; n < 500; n++) {
    let s = "";
    const len = Math.floor(rand() * 60);
    for (let i = 0; i < len; i++) {
      const pick = rand();
      if (pick < 0.3) s += String.fromCodePoint(32 + Math.floor(rand() * 95));
      else if (pick < 0.5) s += String.fromCodePoint(0x4e00 + Math.floor(rand() * 200));
      else if (pick < 0.6) s += String.fromCodePoint(0x1f300 + Math.floor(rand() * 200));
      else if (pick < 0.7) s += String.fromCodePoint(0x300 + Math.floor(rand() * 112));
      else s += String.fromCodePoint(0x61 + Math.floor(rand() * 26));
    }
    const q = toFtsQuery(s);
    if (q !== null) assert.match(q, PLAIN_TERMS, JSON.stringify(s));
  }
});
