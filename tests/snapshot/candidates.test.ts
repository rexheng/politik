import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseCandidates } from "../../photon/scripts/snapshot/candidates.ts";

const fixture = readFileSync(new URL("../fixtures/sources/candidates.md", import.meta.url), "utf8");
const realFile = new URL("../../photon/data/snapshot/candidates.md", import.meta.url);

const HEADER = "| include | id | title | type | topics | status (best known) | landmark | url | url_confidence | why |\n|---|---|---|---|---|---|---|---|---|---|\n";
const row = (cells: Partial<Record<string, string>> = {}) => {
  const c = {
    include: "yes",
    id: "ca-sb-1-2025",
    title: "Title",
    type: "bill",
    topics: "ai-governance",
    status: "enacted",
    landmark: "no",
    url: "https://example.test/x",
    conf: "seen",
    why: "Because",
    ...cells,
  };
  return `| ${c.include} | ${c.id} | ${c.title} | ${c.type} | ${c.topics} | ${c.status} | ${c.landmark} | ${c.url} | ${c.conf} | ${c.why} |\n`;
};

test("the fixture parses to 4 rows across both tables, ignoring the counts table", () => {
  const rows = parseCandidates(fixture);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["ca-sb-900-2025", "ca-ab-100-2024", "sg-imda-genai-framework-2024", "sg-pdpc-advisory-guidelines-2024"],
  );
});

test("include no gives include false and the others are true", () => {
  const rows = parseCandidates(fixture);
  assert.deepEqual(
    rows.map((r) => r.include),
    [true, false, true, true],
  );
});

test("a row maps every column", () => {
  const [first] = parseCandidates(fixture);
  assert.deepEqual(first, {
    include: true,
    id: "ca-sb-900-2025",
    jurisdiction: "US-CA",
    title: "Example frontier model transparency (SB 900, Author)",
    type: "bill",
    topics: ["ai-governance", "online-safety"],
    status: "enacted (signed 2025-09-29; applies from 2026-01-01)",
    landmark: true,
    url: "https://example.test/bills/sb-900",
    urlConfidence: "constructed",
    why: "Developers publish safety frameworks: first duty of its kind",
  });
});

test("topics split on commas with or without a space", () => {
  const rows = parseCandidates(fixture);
  assert.deepEqual(rows[3]?.topics, ["privacy-data", "ai-governance"]);
});

test("the id prefix sets the jurisdiction", () => {
  const rows = parseCandidates(fixture);
  assert.deepEqual(
    rows.map((r) => r.jurisdiction),
    ["US-CA", "US-CA", "SG", "SG"],
  );
});

test("status keeps brackets and the dagger, why keeps parentheses and colons", () => {
  const rows = parseCandidates(fixture);
  assert.equal(rows[1]?.status, "vetoed (2024-09-29) †");
  assert.equal(rows[3]?.status, "published (2024-03-01) [updated 2025]");
  assert.equal(rows[3]?.why, "Explains consent and legitimate-interests: see section 3 (for AI recommender systems)");
});

test("url_confidence: seen stays seen, constructed stays constructed, seen (match unverified) becomes constructed", () => {
  const rows = parseCandidates(fixture);
  assert.deepEqual(
    rows.map((r) => r.urlConfidence),
    ["constructed", "seen", "seen", "constructed"],
  );
  const other = parseCandidates(HEADER + row({ conf: "seen (via mirror)" }));
  assert.equal(other[0]?.urlConfidence, "seen");
});

test("an unknown url_confidence throws, naming the row", () => {
  assert.throws(() => parseCandidates(HEADER + row({ conf: "guessed" })), /ca-sb-1-2025.*url_confidence/);
});

test("a bad id prefix throws, naming the row id", () => {
  assert.throws(() => parseCandidates(HEADER + row({ id: "uk-act-2025" })), /uk-act-2025/);
  assert.throws(() => parseCandidates(HEADER + row({ id: "uk-act-2025" })), /prefix/);
});

test("a malformed row throws, naming the row", () => {
  const cases: [Partial<Record<string, string>>, RegExp][] = [
    [{ type: "memo" }, /type/],
    [{ topics: "ai-governance, space-law" }, /topic.*space-law/],
    [{ topics: "" }, /topics/],
    [{ include: "maybe" }, /include/],
    [{ landmark: "sometimes" }, /landmark/],
    [{ url: "ftp://example.test/x" }, /url/],
    [{ url: "not a url" }, /url/],
    [{ id: "CA-SB-1" }, /id/],
    [{ title: "" }, /title/],
  ];
  for (const [cells, pattern] of cases) {
    const id = cells.id ?? "ca-sb-1-2025";
    assert.throws(() => parseCandidates(HEADER + row(cells)), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, pattern);
      assert.ok(e.message.includes(id), e.message);
      return true;
    });
  }
});

test("a row with the wrong number of cells throws, naming the row", () => {
  const short = "| yes | ca-sb-1-2025 | Title | bill | ai-governance | enacted | no | https://example.test/x | seen |\n";
  assert.throws(() => parseCandidates(HEADER + short), /ca-sb-1-2025.*10 cells/);
});

test("a duplicate id throws", () => {
  assert.throws(() => parseCandidates(HEADER + row() + row()), /duplicate.*ca-sb-1-2025/i);
});

test("an escaped pipe inside a cell is kept as a pipe", () => {
  const rows = parseCandidates(HEADER + row({ why: "Either A \\| B" }));
  assert.equal(rows[0]?.why, "Either A | B");
});

test("Windows line endings parse the same", () => {
  const rows = parseCandidates(fixture.replace(/\n/g, "\r\n"));
  assert.equal(rows.length, 4);
  assert.equal(rows[0]?.why, "Developers publish safety frameworks: first duty of its kind");
});

test("text with no candidate table gives no rows", () => {
  assert.deepEqual(parseCandidates("# Nothing here\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"), []);
});

test("the committed candidates.md parses, with unique ids and no malformed row", () => {
  const rows = parseCandidates(readFileSync(realFile, "utf8"));
  assert.ok(rows.length > 0);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  for (const r of rows) {
    assert.ok(r.topics.length > 0, r.id);
    assert.ok(r.urlConfidence === "seen" || r.urlConfidence === "constructed", r.id);
  }
});
