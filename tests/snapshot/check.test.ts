import assert from "node:assert/strict";
import { test } from "node:test";

import type { Passage } from "../../photon/src/data/schema.ts";
import { checkClaims } from "../../photon/scripts/snapshot/check.ts";
import type { Extracted } from "../../photon/scripts/snapshot/extract/common.ts";

const passage = (seq: number, text: string, heading?: string): Passage => ({
  id: `x#${seq}`,
  recordId: "x",
  seq,
  ...(heading !== undefined ? { heading } : {}),
  text,
});

const passages = [
  passage(1, "The Ministry of Digital Development and Information awarded tender GBZ000123 to Example Pte Ltd.", "Award"),
  passage(2, "Operators must keep records.\n\nThey   must also report   incidents to the commission."),
  passage(3, "A paragraph about something else entirely."),
];

const base = (over: Partial<Extracted> = {}): Extracted => ({
  status: { value: "published", support: ["x#1"] },
  timeline: [],
  summary: { value: "Operators must keep records.", support: ["x#2"] },
  provisions: [],
  affected: [],
  ...over,
});

test("a value that differs from its passage only in whitespace passes", () => {
  const r = checkClaims(base({ summary: { value: "They must also report incidents to the commission.", support: ["x#2"] } }), passages);
  assert.equal(r.fatal, undefined);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.fields.summary.value, "They must also report incidents to the commission.");
});

test("a value equal to a passage heading passes", () => {
  const r = checkClaims(base({ provisions: [{ value: "Award", support: ["x#1"] }] }), passages);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.fields.provisions.length, 1);
});

test("a value found only in a passage that is not in its support fails", () => {
  const r = checkClaims(base({ summary: { value: "A paragraph about something else entirely.", support: ["x#2"] } }), passages);
  assert.equal(r.fatal, "no official summary found");
});

test("parts all have to occur in the cited passages: both present passes, one absent fails", () => {
  const sentence = "The Ministry of Digital Development and Information awarded tender GBZ000123 (Cloud) to Example Pte Ltd.";
  const ok = checkClaims(base({ summary: { value: sentence, support: ["x#1"], parts: ["Ministry of Digital Development and Information", "Example Pte Ltd"] } }), passages);
  assert.equal(ok.fatal, undefined);
  const bad = checkClaims(base({ summary: { value: sentence, support: ["x#1"], parts: ["Ministry of Digital Development and Information", "Other Pte Ltd"] } }), passages);
  assert.equal(bad.fatal, "no official summary found");
});

test("parts may be found in different cited passages", () => {
  const r = checkClaims(base({ summary: { value: "Joined statement", support: ["x#1", "x#2"], parts: ["Example Pte Ltd", "Operators must keep records."] } }), passages);
  assert.equal(r.fatal, undefined);
});

test("empty parts pass, and an unknown support id fails", () => {
  const fixedLabel = checkClaims(base({ timeline: [{ date: "2026-01-05", event: "Published", support: ["x#1"], parts: [] }] }), passages);
  assert.deepEqual(fixedLabel.dropped, []);
  assert.equal(fixedLabel.fields.timeline.length, 1);
  const unknown = checkClaims(base({ summary: { value: "Operators must keep records.", support: ["x#99"] } }), passages);
  assert.equal(unknown.fatal, "no official summary found");
  const none = checkClaims(base({ summary: { value: "Operators must keep records.", support: [] } }), passages);
  assert.equal(none.fatal, "no official summary found");
});

test("a failing provision is dropped, the others keep their order, and dropped names it", () => {
  const r = checkClaims(
    base({
      provisions: [
        { value: "Operators must keep records.", support: ["x#2"] },
        { value: "An invented provision that no passage holds.", support: ["x#2"] },
        { value: "Award", support: ["x#1"] },
      ],
    }),
    passages,
  );
  assert.deepEqual(r.dropped, ["provisions[1]"]);
  assert.deepEqual(r.fields.provisions.map((p) => p.value), ["Operators must keep records.", "Award"]);
  assert.equal(r.fatal, undefined);
});

test("a failing timeline event or affected group is dropped by its index in the input", () => {
  const r = checkClaims(
    base({
      timeline: [
        { date: "2026-01-05", event: "Invented event", support: ["x#2"] },
        { date: "2026-02-05", event: "Published", support: ["x#2"], parts: [] },
      ],
      affected: [
        { value: "Example Pte Ltd", support: ["x#1"] },
        { value: "Nobody mentioned", support: ["x#1"] },
      ],
    }),
    passages,
  );
  assert.deepEqual(r.dropped, ["timeline[0]", "affected[1]"]);
  assert.deepEqual(r.fields.timeline.map((t) => t.event), ["Published"]);
  assert.deepEqual(r.fields.affected.map((a) => a.value), ["Example Pte Ltd"]);
});

test("the other fields come back unchanged, and the input is not modified", () => {
  const input = base({ shortTitle: "SB 53", published: "2026-01-05", statusDate: "2026-02-01", provisions: [{ value: "invented", support: ["x#2"] }] });
  const copy = structuredClone(input);
  const r = checkClaims(input, passages);
  assert.deepEqual(input, copy);
  assert.equal(r.fields.shortTitle, "SB 53");
  assert.equal(r.fields.published, "2026-01-05");
  assert.equal(r.fields.statusDate, "2026-02-01");
  assert.deepEqual(r.fields.status, input.status);
});
