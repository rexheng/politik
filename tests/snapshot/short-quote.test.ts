// R42: the summary and provisions of a record that may not be redistributed are short quotes (at most 280 characters and an
// ellipsis, cut at a word), and the check accepts such a quote as the start of what it cites.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Passage } from "../../photon/src/data/schema.ts";
import { checkClaims } from "../../photon/scripts/snapshot/check.ts";
import type { Extracted } from "../../photon/scripts/snapshot/extract/common.ts";
import { quote } from "../../photon/scripts/snapshot/extract/common.ts";
import { shortenClaim, shortenRestricted, wordPrefix } from "../../photon/scripts/snapshot/extract/short.ts";
import { splitPassages } from "../../photon/scripts/snapshot/passages.ts";

const RESTRICTED = { restricted: true };
const sentence = (i: number) => `Operator ${i} shall keep careful records of every complaint received and shall report each serious incident to the commission without delay.`;
const LONG = Array.from({ length: 7 }, (_, i) => sentence(i)).join(" "); // 1,000 characters or so, in one paragraph
const passage = (seq: number, text: string, heading?: string): Passage => ({ id: `r#${seq}`, recordId: "r", seq, ...(heading ? { heading } : {}), text });
const base = (over: Partial<Extracted> = {}): Extracted => ({
  status: { value: "published", support: ["r#1"] },
  timeline: [],
  summary: { value: "Operators keep records.", support: ["r#1"] },
  provisions: [],
  affected: [],
  ...over,
});

test("wordPrefix is at most 280 characters, ends at a word, and is a prefix of the value", () => {
  assert.ok(LONG.length > 900);
  const prefix = wordPrefix(LONG, 280);
  assert.ok(prefix.length <= 280 && prefix.length > 200, String(prefix.length));
  assert.ok(LONG.startsWith(prefix));
  assert.match(LONG.slice(prefix.length), /^\s/, "the cut is at a word boundary");
  assert.equal(wordPrefix("short", 280), "short");
  assert.equal(wordPrefix("x".repeat(400), 280).length, 280, "a word longer than the limit is cut hard");
  assert.equal(wordPrefix(`${"a ".repeat(139)}b ${"c".repeat(20)}`, 280).endsWith(" b"), true);
});

test("R42: a 1,036-character provision of a restricted record becomes at most 281 characters and passes the check", () => {
  const text = `${LONG} ${LONG}`.slice(0, 1036);
  assert.ok(text.length === 1036);
  const passages = [passage(1, text)];
  const claim = shortenClaim(quote(passages, text), passages);
  assert.ok(claim.value.length <= 281, String(claim.value.length));
  assert.ok(claim.value.endsWith("…"));
  assert.ok(text.startsWith(claim.value.slice(0, -1)));
  const checked = checkClaims(base({ provisions: [claim] }), passages, RESTRICTED);
  assert.deepEqual(checked.dropped, []);
  assert.equal(checked.fields.provisions[0]!.value, claim.value);
});

test("R42: a quote already within the limit is left as it is, and a redistributable record is not touched (the build does not call shortenRestricted for it)", () => {
  const short = "Operator 0 shall keep careful records of every complaint received.";
  const passages = [passage(1, short)];
  const claim = quote(passages, short);
  assert.deepEqual(shortenClaim(claim, passages), claim);
  const exactly = "x ".repeat(139) + "xx"; // 280 characters
  assert.equal(exactly.length, 280);
  assert.equal(shortenClaim({ value: exactly, support: ["r#1"] }, [passage(1, exactly)]).value, exactly);
});

test("R42: shortenRestricted cuts the summary, the provisions and the affected values, and leaves the rest of the extraction", () => {
  const passages = [passage(1, LONG)];
  const long = quote(passages, LONG);
  const f = base({ summary: long, provisions: [long, quote(passages, sentence(0))], affected: [long], timeline: [{ date: "2025-01-01", event: "Published", support: ["r#1"], parts: [] }] });
  const cut = shortenRestricted(f, passages);
  assert.ok(cut.summary.value.length <= 281 && cut.summary.value.endsWith("…"));
  assert.ok(cut.provisions[0]!.value.length <= 281 && cut.provisions[0]!.value.endsWith("…"));
  assert.equal(cut.provisions[1]!.value, sentence(0), "a short value stays whole");
  assert.ok(cut.affected[0]!.value.endsWith("…"));
  assert.deepEqual(cut.timeline, f.timeline);
  assert.deepEqual(cut.status, f.status);
  assert.equal(checkClaims(cut, passages, RESTRICTED).fatal, undefined);
  assert.deepEqual(checkClaims(cut, passages, RESTRICTED).dropped, []);
});

test("R42: a value that crosses passages is cut and keeps pieces that each sit in a passage it cites", () => {
  const paragraph = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says that every operator ${"keeps careful records of each complaint ".repeat(2).trim()}.`).join(" ");
  const passages = splitPassages("r", `# Heading\n\n${paragraph}`);
  assert.ok(passages.length >= 1);
  const whole = quote(passages, paragraph.slice(0, 2400));
  const cut = shortenClaim(whole, passages);
  assert.ok(cut.value.length <= 281);
  const checked = checkClaims(base({ summary: cut }), passages, RESTRICTED);
  assert.equal(checked.fatal, undefined);
});

test("R42: a long title with its own pieces (parts) is cut to the pieces inside the quote, and passes", () => {
  const pieces = ["An Act to govern the collection, use and disclosure of personal data by organisations, and to establish the Do Not Call Register", "and to provide for its administration, and for matters connected therewith, including the powers of the Commission and the duties of every organisation that collects personal data from individuals in Singapore, and the rights of those individuals"];
  const value = pieces.join(" ");
  const passages = [passage(1, `${pieces[0]} [22/2016] ${pieces[1]}.`)];
  const cut = shortenClaim({ value, support: ["r#1"], parts: pieces }, passages);
  assert.ok(cut.value.length <= 281 && cut.value.endsWith("…"));
  assert.ok(cut.parts && cut.parts.length >= 1 && cut.parts.every((p) => value.includes(p)));
  assert.equal(checkClaims(base({ summary: cut }), passages, RESTRICTED).fatal, undefined);
});

// ---------------------------------------------------------------------------------------------------------------------
// The check: on a restricted record one trailing ellipsis is ignored, and the rest must be a verbatim piece of what is cited

const FAIL = "no official summary found";
const passages2 = [passage(1, "Operators must keep records of every complaint they receive for six years."), passage(2, "Another passage about something else.")];

test("R42: for a restricted record, a value that is a verbatim piece of a cited passage that starts at a word, plus an ellipsis, passes", () => {
  const check = (value: string, support = ["r#1"]) => checkClaims(base({ summary: { value, support } }), passages2, RESTRICTED);
  assert.equal(check("Operators must keep records of every complaint…").fatal, undefined, "the start of the passage");
  assert.equal(check("Operators must keep records of every complaint …").fatal, undefined, "a space before the ellipsis");
  assert.equal(check("keep records of every…").fatal, undefined, "a piece that starts at a word inside the passage");
  assert.deepEqual(checkClaims(base({ provisions: [{ value: "keep records of every…", support: ["r#1"] }] }), passages2, RESTRICTED).dropped, []);
  assert.equal(check("Operators must keep records of every complaint they receive for six years.…").fatal, undefined);
});

test("R42: ... and still fails what is not such a piece", () => {
  const bad = (value: string, support = ["r#1"]) => checkClaims(base({ summary: { value, support } }), passages2, RESTRICTED).fatal;
  assert.equal(bad("Operators must keep … for six years…"), FAIL, "an ellipsis in the middle joins two pieces");
  assert.equal(bad("Operators must retain records of every…"), FAIL, "a changed word");
  assert.equal(bad("Operators must keep records of every complaint they receive for six years and more…"), FAIL, "longer than the passage");
  assert.equal(bad("Operators must keep records…", ["r#2"]), FAIL, "cited from another passage");
  assert.equal(bad("…"), FAIL, "an ellipsis alone");
  assert.equal(bad("Operators must keep records of every complaint…", []), FAIL, "no support");
  assert.equal(bad("ators must keep records…"), FAIL, "a piece that starts in the middle of a word");
  assert.equal(bad("rators must keep…"), FAIL, "a piece that starts in the middle of a word");
  const provision = checkClaims(base({ provisions: [{ value: "Operators must keep … six years…", support: ["r#1"] }] }), passages2, RESTRICTED);
  assert.deepEqual(provision.dropped, ["provisions[0]"]);
  // parts are still read as they are
  assert.equal(checkClaims(base({ summary: { value: "anything…", support: ["r#1"], parts: ["Operators must retain"] } }), passages2, RESTRICTED).fatal, FAIL);
  assert.equal(checkClaims(base({ summary: { value: "anything…", support: ["r#1"], parts: ["ators must keep"] } }), passages2, RESTRICTED).fatal, FAIL, "the first part starts at a word too");
});

test("R42: a record that may be redistributed is not given the ellipsis: a trailing '…' fails unless the source text has it", () => {
  const openCheck = (value: string, text = passages2[0]!.text) => checkClaims(base({ summary: { value, support: ["r#1"] } }), [passage(1, text)]).fatal;
  assert.equal(openCheck("Operators must keep records of every complaint…"), FAIL, "the passage has no ellipsis there");
  assert.equal(openCheck("Operators must keep records of every complaint"), undefined, "whole is fine");
  assert.equal(openCheck("Operators must keep records…", "Operators must keep records… and more."), undefined, "the source text itself has the ellipsis");
  assert.equal(openCheck("Operators must keep records…", "Operators must keep records and more."), FAIL);
  // and the build's own call, without the option, is the strict one
  assert.equal(checkClaims(base({ summary: { value: "Operators must keep…", support: ["r#1"] } }), passages2, { restricted: false }).fatal, FAIL);
});

test("R42: an ellipsis claim of a restricted record whose part spans passages is still checked piece by piece", () => {
  const paragraph = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says that every operator keeps careful records of each complaint.`).join(" ");
  const passages = splitPassages("r", `# Heading\n\n${paragraph}`);
  const cut = shortenClaim(quote(passages, paragraph.slice(0, 1800)), passages);
  assert.equal(checkClaims(base({ summary: cut }), passages, RESTRICTED).fatal, undefined);
  assert.equal(checkClaims(base({ summary: { ...cut, parts: ["Sentence number 0 says that EVERY operator"] } }), passages, RESTRICTED).fatal, FAIL);
});
