import assert from "node:assert/strict";
import { test } from "node:test";

import { checkClaims } from "../../photon/scripts/snapshot/check.ts";
import { extractBill } from "../../photon/scripts/snapshot/extract/bill.ts";
import { wordCount } from "../../photon/scripts/snapshot/passages.ts";
import { candidate, fixture, withPassages } from "../helpers/extract.ts";

const meta = (snapshotDate = "2026-10-15") => ({ snapshotDate, format: "text" as const });
const run = (id: string, text: string, snapshotDate?: string) => {
  const c = candidate({ id, type: "bill" });
  const { passages } = withPassages(c, text);
  return { c, passages, result: extractBill(c, text, passages, meta(snapshotDate)) };
};
const enacted = fixture("bill-enacted.txt");

/** The text with the section that starts at `heading` (up to the next `# ` line, or the end) removed. */
const without = (text: string, heading: string) => text.replace(new RegExp(`^# ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?(?=^# |$(?![\\s\\S]))`, "m"), "");

test("the summary is what the bill would do, not the subject line or the existing law; the short title and published date come from the header and the first action", () => {
  const { result } = run("ca-sb-900-2025", enacted);
  assert.ok(result.ok);
  // R38: the summary is what the bill would do, from the first "This bill would" sentence to the end of its paragraph
  assert.match(result.fields.summary.value, /^This bill would require a developer of an automated decision system to publish on its internet website/);
  assert.ok(result.fields.summary.value.endsWith("citing Sec. 1798.140 of the Civil Code."));
  assert.ok(!result.fields.summary.value.includes("Existing law"));
  assert.ok(!result.fields.summary.value.includes("Automated decision systems: transparency."));
  assert.equal(result.fields.shortTitle, "SB 900");
  assert.equal(result.fields.published, "2025-02-19");
  assert.deepEqual(result.fields.affected, []);
});

test("the short title falls back to the bill type and number in the id", () => {
  const legacy = enacted.replace(/^# Bill: .*\n\n.*\n\n/, "");
  assert.ok(!legacy.includes("# Bill:"));
  assert.equal((run("ca-sb-900-2025", legacy).result as { fields: { shortTitle?: string } }).fields.shortTitle, "SB 900");
  assert.equal((run("ca-ab-1008-2024", legacy).result as { fields: { shortTitle?: string } }).fields.shortTitle, "AB 1008");
  assert.equal((run("ca-acr-17-2025", legacy).result as { fields: { shortTitle?: string } }).fields.shortTitle, "ACR 17");
});

test("a chaptered bill is in-force from the operative date in its own last section, dated by it", () => {
  const { result, passages } = run("ca-sb-900-2025", enacted);
  assert.ok(result.ok);
  assert.equal(result.fields.status.value, "in-force");
  assert.equal(result.fields.statusDate, "2026-01-01");
  // it cites the chaptering row and the operative sentence
  const chaptered = passages.find((p) => p.text.includes("Chaptered by Secretary of State"))!;
  const operative = passages.find((p) => p.text.includes("This act shall become operative on January 1, 2026."))!;
  assert.ok(result.fields.status.support.includes(chaptered.id));
  assert.ok(result.fields.status.support.includes(operative.id));
});

test("with a snapshot date before the operative date the bill is enacted, dated by the chaptering; the digest's and the quoted code's dates change nothing", () => {
  const before = run("ca-sb-900-2025", enacted, "2025-12-31").result;
  assert.ok(before.ok);
  assert.equal(before.fields.status.value, "enacted");
  assert.equal(before.fields.statusDate, "2025-09-29");
  assert.ok(!before.fields.timeline.some((t) => t.event === "Operative"));
  const same = run("ca-sb-900-2025", enacted, "2026-01-01").result; // on the operative date itself
  assert.ok(same.ok && same.fields.status.value === "in-force");
  // the digest says "would become operative on January 1, 2027" and a quoted section says January 1, 2028: neither counts
  // no operative date stated in the bill's own sections: R31's default (1 January of the year after chaptering) applies, never the digest's or the quoted code's
  const onlyDigest = enacted.replace("This act shall become operative on January 1, 2026.", "No operative date is stated here.");
  const none = run("ca-sb-900-2025", onlyDigest, "2025-12-31").result;
  assert.ok(none.ok);
  assert.equal(none.fields.status.value, "enacted", "the default date, 2026-01-01, is after the snapshot date");
  assert.equal(none.fields.statusDate, "2025-09-29");
});

test("the latest operative date counts when a bill states several, and Section N of this act is read", () => {
  const text = enacted.replace(
    "This act shall become operative on January 1, 2026.",
    "Section 2 of this act shall become operative on July 1, 2026. This act shall become operative on January 1, 2027.",
  );
  assert.equal((run("ca-sb-900-2025", text, "2026-10-15").result as any).fields.status.value, "enacted");
  const r = run("ca-sb-900-2025", text, "2027-02-01").result;
  assert.ok(r.ok && r.fields.status.value === "in-force" && r.fields.statusDate === "2027-01-01");
  const only = enacted.replace("This act shall become operative on January 1, 2026.", "Section 2 of this act shall take effect on March 3, 2026.");
  const s = run("ca-sb-900-2025", only).result;
  assert.ok(s.ok && s.fields.statusDate === "2026-03-03");
});

test("provisions are the digest's 'This bill would' / 'The bill would' sentences, verbatim, in order, at most 6; 'also' counts and Sec. does not split a sentence", () => {
  const { result } = run("ca-sb-900-2025", enacted);
  assert.ok(result.ok);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), [
    "This bill would require a developer of an automated decision system to publish on its internet website a summary of the system’s intended uses and known limitations.",
    "This bill would also require a deployer, as defined, to notify a consumer, before an automated decision system is used to make a consequential decision about the consumer, as specified.",
    "The bill would define consequential decision for these purposes, citing Sec. 1798.140 of the Civil Code.",
    "This bill would require the department to publish guidance on the notices required by the bill on or before July 1, 2026.",
    "This bill would also authorize the Attorney General to enforce the bill by civil action and to seek a civil penalty of up to $2,500 per violation.",
    "The bill would become operative on January 1, 2027, for purposes of the penalty provisions.",
  ]);

  const eight = Array.from({ length: 8 }, (_, i) => `This bill would do thing number ${i + 1} under Sec. 1798.14${i} of the Civil Code.`);
  const text = enacted.replace(/(# Legislative Counsel's Digest\n\nAutomated decision systems: transparency\.\n\n)[\s\S]*?(?=# Legislative history)/, `$1(1) Existing law does something.\n\n${eight.join(" ")}\n\n`);
  const six = run("ca-sb-900-2025", text).result;
  assert.ok(six.ok);
  assert.deepEqual(six.fields.provisions.map((p) => p.value), eight.slice(0, 6));
});

test("the timeline is the milestone rows only, ascending, in the history's own wording with whitespace collapsed, plus Operative for in-force", () => {
  const { result } = run("ca-sb-900-2025", enacted);
  assert.ok(result.ok);
  assert.deepEqual(result.fields.timeline.map((t) => [t.date, t.event]), [
    ["2025-02-19", "Introduced. Read first time. To Com. on RLS. for assignment. To print."],
    ["2025-05-28", "Read third time. Passed. (Ayes 37. Noes 0. Page 1281.) Ordered to the Assembly."],
    ["2025-09-12", "Read third time. Passed. (Ayes 59. Noes 7. Page 3432.) Ordered to the Senate."],
    ["2025-09-23", "Enrolled and presented to the Governor at 2 p.m."],
    ["2025-09-29", "Approved by the Governor."],
    ["2025-09-29", "Chaptered by Secretary of State. Chapter 138, Statutes of 2025."],
    ["2026-01-01", "Operative"],
    ["2028-01-01", "Operative"], // R37: SEC. 1 quotes a section that "shall become operative on January 1, 2028"
  ]);
  assert.deepEqual(result.fields.timeline[1]!.parts, ["2025-05-28", "Read third time. Passed. (Ayes 37. Noes 0. Page 1281.) Ordered to the Assembly."]);
  assert.deepEqual(result.fields.timeline.at(-2)!.parts, ["January 1, 2026"]);
  assert.deepEqual(result.fields.timeline.at(-1)!.parts, ["January 1, 2028"]);
});

test("every claim of every fixture passes the check against the passages of the same text", () => {
  for (const [id, name, date] of [
    ["ca-sb-900-2025", "bill-enacted.txt", "2026-10-15"],
    ["ca-sb-900-2025", "bill-enacted.txt", "2025-12-31"],
    ["ca-sb-901-2025", "bill-vetoed.txt", "2026-10-15"],
    ["ca-ab-902-2025", "bill-in-progress.txt", "2026-10-15"],
  ] as const) {
    const { result, passages } = run(id, fixture(name), date);
    assert.ok(result.ok, name);
    const checked = checkClaims(result.fields, passages);
    assert.equal(checked.fatal, undefined, name);
    assert.deepEqual(checked.dropped, [], name);
  }
});

test("a vetoed bill is vetoed, dated by the veto, and the veto is its last milestone", () => {
  const { result, passages } = run("ca-sb-901-2025", fixture("bill-vetoed.txt"));
  assert.ok(result.ok);
  assert.equal(result.fields.status.value, "vetoed");
  assert.equal(result.fields.statusDate, "2025-09-29");
  assert.equal(result.fields.shortTitle, "SB 901");
  assert.equal(result.fields.published, "2025-02-07");
  assert.equal(result.fields.timeline.at(-1)!.event, "Vetoed by the Governor.");
  assert.deepEqual(result.fields.timeline.map((t) => t.date), ["2025-02-07", "2025-08-28", "2025-09-09", "2025-09-29"]);
  const veto = passages.find((p) => p.text.includes("Vetoed by the Governor."))!;
  assert.deepEqual(result.fields.status.support, [veto.id]);
  // the older wording
  const old = run("ca-sb-901-2025", fixture("bill-vetoed.txt").replace("Vetoed by the Governor.", "VETOED BY GOVERNOR.")).result;
  assert.ok(old.ok && old.fields.status.value === "vetoed" && old.fields.timeline.at(-1)!.event === "VETOED BY GOVERNOR.");
});

test("a bill still moving is in-progress, dated by its last action, and the current-status line is not an action", () => {
  const { result, passages } = run("ca-ab-902-2025", fixture("bill-in-progress.txt"));
  assert.ok(result.ok);
  assert.equal(result.fields.status.value, "in-progress");
  assert.equal(result.fields.statusDate, "2025-05-23");
  assert.ok(!result.fields.timeline.some((t) => /chaptered|enacted/i.test(t.event)));
  assert.deepEqual(result.fields.timeline.map((t) => t.date), ["2025-02-21"]);
  const last = passages.find((p) => p.text.includes("Held in committee and under submission."))!;
  assert.deepEqual(result.fields.status.support, [last.id]);
});

test("a bill with no digest has no official summary, and one with no history has no official status", () => {
  assert.deepEqual(run("ca-sb-900-2025", without(enacted, "Legislative Counsel's Digest")).result, { ok: false, reason: "no official summary found" });
  assert.deepEqual(run("ca-sb-900-2025", without(enacted, "Legislative history")).result, { ok: false, reason: "no official status found" });
  assert.deepEqual(run("ca-sb-900-2025", "# Bill: SB 900 (2025-2026) — Subject.\n\nAn act relating to things.").result, { ok: false, reason: "no official summary found" });
});

test("a digest paragraph of 220 words gives a summary of at most 150 words that ends on a sentence end", () => {
  const sentence = (i: number) => `This bill would require the department to do thing number ${i} ${Array.from({ length: 16 }, (_, j) => `thing${j}`).join(" ")}.`;
  const long = Array.from({ length: 11 }, (_, i) => sentence(i)).join(" ");
  assert.ok(wordCount(long) >= 220);
  const text = enacted.replace(/(# Legislative Counsel's Digest\n\nAutomated decision systems: transparency\.\n\n)[\s\S]*?(?=# Legislative history)/, `$1(1) Existing law covers things.\n\n${long}\n\nThis bill would require a thing.\n\n`);
  const { result, passages } = run("ca-sb-900-2025", text);
  assert.ok(result.ok);
  assert.ok(wordCount(result.fields.summary.value) <= 150, String(wordCount(result.fields.summary.value)));
  assert.ok(result.fields.summary.value.endsWith("."));
  assert.ok(long.startsWith(result.fields.summary.value));
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});

// ---------------------------------------------------------------------------------------------------------------------
// R38: the summary says what the bill would do, never what existing law says

/** The text with the digest replaced by these paragraphs. */
const withDigest = (...paragraphs: string[]) =>
  enacted.replace(/(# Legislative Counsel's Digest\n\nAutomated decision systems: transparency\.\n\n)[\s\S]*?(?=# Legislative history)/, `$1${paragraphs.join("\n\n")}\n\n`);

test("R38: an SB 53-shaped digest (several Existing law paragraphs, then the bill) is summarised by the bill's own paragraph, verbatim", () => {
  const existing = [
    "(1) Existing law generally regulates artificial intelligence, including by requiring a developer of a generative artificial intelligence system to post documentation regarding the data used to train it, as prescribed.",
    "Existing law establishes the Department of Technology within the Government Operations Agency.",
  ];
  const would =
    "This bill would enact the Transparency in Frontier Artificial Intelligence Act (TFAIA) that would, among other things, require a large frontier developer to write, implement, and publish a frontier AI framework. The bill would also authorize the Attorney General to bring a civil action to enforce the act.";
  const { result, passages } = run("ca-sb-53-2025", withDigest(...existing, would, "The bill would establish a consortium within the Government Operations Agency."));
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, would);
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);
});

test("R38: an SB 1047-shaped digest, where the bill's paragraph follows an Existing law paragraph about another subject, is summarised by the bill", () => {
  const existing = "Existing law requires the Secretary of Government Operations to develop a coordinated plan to investigate the feasibility of standards and technologies for state departments to determine digital content provenance.";
  const would = "This bill would enact the Safe and Secure Innovation for Frontier Artificial Intelligence Models Act to, among other things, require a developer of a covered model to submit a certification of compliance to the Attorney General.";
  const { result } = run("ca-sb-1047-2024", withDigest(existing, would));
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, would);
});

test("R38: the summary starts at the first 'This bill would' sentence of a paragraph that also holds the existing law, and drops the '(2)' number", () => {
  const paragraph = "(1) Existing law requires the department to keep an inventory of the systems that state agencies use. (2) This bill would require the department to publish it. The bill would also authorize an audit.";
  const { result } = run("ca-sb-900-2025", withDigest(paragraph));
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, "This bill would require the department to publish it. The bill would also authorize an audit.");
});

test("R38: 'The bill would' starts a summary too; a bill with no such sentence keeps the first digest paragraph (the old rule)", () => {
  const { result } = run("ca-sb-900-2025", withDigest("(1) Existing law covers things.", "The bill, among other things, would define a covered model."));
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, "The bill, among other things, would define a covered model.");
  const none = run("ca-sb-900-2025", withDigest("(1) Existing law covers things in detail.", "Existing law also covers other things.")).result;
  assert.ok(none.ok);
  assert.equal(none.fields.summary.value, "(1) Existing law covers things in detail.");
});

test("a bill in the layout before R23 (the history first, no header) is read the same", () => {
  const history = enacted.slice(enacted.indexOf("# Legislative history"), enacted.indexOf("# SECTION 1."));
  const digest = enacted.slice(enacted.indexOf("# Legislative Counsel's Digest"), enacted.indexOf("# Legislative history"));
  const rest = enacted.slice(enacted.indexOf("# SECTION 1."));
  const legacy = `${history}${digest}${rest}`;
  const a = run("ca-sb-900-2025", enacted).result;
  const b = run("ca-sb-900-2025", legacy).result;
  assert.ok(a.ok && b.ok);
  assert.equal(b.fields.summary.value, a.fields.summary.value);
  assert.deepEqual(b.fields.timeline.map((t) => t.event), a.fields.timeline.map((t) => t.event));
  assert.equal(b.fields.status.value, "in-force");
});

// ---------------------------------------------------------------------------------------------------------------------
// R31: California's default effective date, an urgency statute, and an explicit operative date that wins

const noOperative = enacted.replace("This act shall become operative on January 1, 2026.", "No operative date is stated here.");
const urgency = (text: string) => text.replace("This bill would provide that no reimbursement is required by this act for a specified reason.", "This bill would provide that no reimbursement is required by this act for a specified reason.\n\nThis bill would declare that it is to take effect immediately as an urgency statute.");

test("R31: a chaptered bill with no stated operative date takes effect on 1 January of the year after chaptering, and cites the chaptering row", () => {
  const { result, passages } = run("ca-sb-900-2025", noOperative, "2026-10-15");
  assert.ok(result.ok);
  assert.equal(result.fields.status.value, "in-force");
  assert.equal(result.fields.statusDate, "2026-01-01");
  const chaptered = passages.find((p) => p.text.includes("Chaptered by Secretary of State"))!;
  assert.deepEqual(result.fields.status.support, [chaptered.id]);
  const takes = result.fields.timeline.find((t) => t.event === "Takes effect")!;
  assert.deepEqual([takes.date, takes.event, takes.parts], ["2026-01-01", "Takes effect", []], "R37: a rule's date is not the bill's 'operative' date");
  assert.deepEqual(takes.support, [chaptered.id]);
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);
  // the day before, and on the day
  const before = run("ca-sb-900-2025", noOperative, "2025-12-31").result;
  assert.ok(before.ok && before.fields.status.value === "enacted" && before.fields.statusDate === "2025-09-29");
  assert.ok(!before.fields.timeline.some((t) => t.event === "Takes effect"));
  const on = run("ca-sb-900-2025", noOperative, "2026-01-01").result;
  assert.ok(on.ok && on.fields.status.value === "in-force" && on.fields.statusDate === "2026-01-01");
});

test("R31: a bill chaptered early in the year takes effect on 1 January of the next year too", () => {
  const early = noOperative.replaceAll("2025-09-29", "2025-03-14");
  const r = run("ca-sb-900-2025", early, "2025-12-31").result;
  assert.ok(r.ok);
  assert.equal(r.fields.status.value, "enacted");
  assert.equal(r.fields.statusDate, "2025-03-14");
  assert.equal((run("ca-sb-900-2025", early, "2026-01-01").result as any).fields.statusDate, "2026-01-01");
});

test("R31: an urgency statute takes effect on chaptering, and cites the chaptering row and the digest sentence", () => {
  const { result, passages } = run("ca-sb-900-2025", urgency(noOperative), "2025-10-01");
  assert.ok(result.ok);
  assert.equal(result.fields.status.value, "in-force");
  assert.equal(result.fields.statusDate, "2025-09-29");
  const chaptered = passages.find((p) => p.text.includes("Chaptered by Secretary of State"))!;
  const sentence = passages.find((p) => p.text.includes("take effect immediately as an urgency statute"))!;
  assert.ok(result.fields.status.support.includes(chaptered.id) && result.fields.status.support.includes(sentence.id));
  const takes = result.fields.timeline.filter((t) => t.event === "Takes effect");
  assert.deepEqual(takes.map((t) => [t.date, t.parts]), [["2025-09-29", []]], "R37: the urgency date is a Takes effect event too");
  assert.ok(takes[0]!.support.includes(chaptered.id) && takes[0]!.support.includes(sentence.id));
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);
});

test("R31: an explicit, anchored operative date wins over the default and over an urgency clause", () => {
  const explicit = run("ca-sb-900-2025", urgency(enacted.replace("January 1, 2026.", "July 1, 2027.")), "2026-10-15").result;
  assert.ok(explicit.ok);
  assert.equal(explicit.fields.status.value, "enacted");
  assert.equal(explicit.fields.statusDate, "2025-09-29");
  const later = run("ca-sb-900-2025", enacted.replace("January 1, 2026.", "July 1, 2027."), "2027-07-01").result;
  assert.ok(later.ok && later.fields.status.value === "in-force" && later.fields.statusDate === "2027-07-01");
});

test("R31: a vetoed bill and a bill still moving take no default date", () => {
  const vetoed = run("ca-sb-901-2025", fixture("bill-vetoed.txt")).result;
  assert.ok(vetoed.ok && vetoed.fields.status.value === "vetoed" && !vetoed.fields.timeline.some((t) => t.event === "Operative"));
  const moving = run("ca-ab-902-2025", fixture("bill-in-progress.txt")).result;
  assert.ok(moving.ok && moving.fields.status.value === "in-progress");
});

// ---------------------------------------------------------------------------------------------------------------------
// I3: the operative date is anchored on the clause, and an incidental bill mention does not hide a section

test("an operative clause whose date is not what follows it ('on the date the department certifies ..., but not before January 1, 2026') gives no date, and no default", () => {
  const text = enacted.replace(
    "This act shall become operative on January 1, 2026.",
    "This act shall become operative on the date the department certifies that the system is ready, but not before January 1, 2026.",
  );
  const { result } = run("ca-sb-900-2025", text, "2026-10-15");
  assert.ok(result.ok);
  assert.equal(result.fields.status.value, "enacted", "the date the department certifies is not in the text: we claim only what it shows");
  assert.equal(result.fields.statusDate, "2025-09-29");
  assert.ok(!result.fields.timeline.some((t) => t.event === "Operative"));
});

test("an incidental bill mention in a section's first paragraph does not hide its operative date; quoted code still does", () => {
  const text = enacted.replace(
    "This act shall become operative on January 1, 2026.",
    "Senate Bill 55 of this session is enacted at the same time. This act shall become operative on January 1, 2027.",
  );
  assert.equal((run("ca-sb-900-2025", text, "2026-10-15").result as any).fields.status.value, "enacted");
  const r = run("ca-sb-900-2025", text, "2027-02-01").result;
  assert.ok(r.ok && r.fields.status.value === "in-force" && r.fields.statusDate === "2027-01-01");
  // a section that quotes a code section is still skipped for the status: its dates are the code's
  const quoted = enacted.replace(
    "This act shall become operative on January 1, 2026.",
    "Section 22761 of the Business and Professions Code is amended to read:\n\n22761. This section shall become operative on January 1, 2031.",
  );
  assert.equal((run("ca-sb-900-2025", quoted, "2026-10-15").result as any).fields.statusDate, "2026-01-01", "the default, not the quoted 2031");
});

// ---------------------------------------------------------------------------------------------------------------------
// R37: a contingent or undated operative clause leaves the bill enacted; the default is labelled honestly; later quoted dates are events

test("R37: 'This act shall become operative only if Senate Bill 1381 ... is enacted' is unresolved: the bill stays enacted, with no default and no Operative event", () => {
  for (const clause of [
    "This act shall become operative only if Senate Bill 1381 of the 2023-24 Regular Session is enacted.",
    "Section 2 of this act shall become operative only if Senate Bill 55 is enacted and takes effect.",
    "This act shall become operative upon the date the director certifies the system.",
    "This act shall become operative contingent on an appropriation in the Budget Act.",
    "This act shall become operative if and when the department publishes its guidance.",
    "This act shall take effect on January 1, 2027, only if Senate Bill 55 is enacted.",
    "This act shall take effect when the department certifies the system.",
    "This act shall become operative.",
  ]) {
    const text = enacted.replace("This act shall become operative on January 1, 2026.", clause);
    const { result } = run("ca-sb-900-2025", text, "2029-01-01");
    assert.ok(result.ok, clause);
    assert.equal(result.fields.status.value, "enacted", clause);
    assert.equal(result.fields.statusDate, "2025-09-29", clause);
    assert.ok(!result.fields.timeline.some((t) => t.event === "Takes effect" || t.date === "2026-01-01"), clause);
  }
  // the reviewer's probe: an extra section 99
  const probe = enacted.replace("This act shall become operative on January 1, 2026.", "No operative date is stated here.") + "\n\n# SEC. 99.\n\nThis act shall become operative only if Senate Bill 1381 of the 2023-24 Regular Session is enacted.";
  const p = run("ca-sb-900-2025", probe, "2026-10-15").result;
  assert.ok(p.ok && p.fields.status.value === "enacted" && p.fields.statusDate === "2025-09-29");
});

test("R37: an undated or contingent clause in a quoted code section is the code's, and does not stop the default", () => {
  const text = enacted.replace(
    "This act shall become operative on January 1, 2026.",
    "Section 22761 of the Business and Professions Code is amended to read:\n\n22761. This section shall become operative only if Senate Bill 55 is enacted.",
  );
  const { result } = run("ca-sb-900-2025", text, "2026-10-15");
  assert.ok(result.ok && result.fields.status.value === "in-force" && result.fields.statusDate === "2026-01-01");
});

/** ca-ab-1043-2025's shape: the act has no operative clause of its own, and the section it adds says "This title shall become operative on January 1, 2027." */
const ab1043 = noOperative.replace(
  "(d) This section shall become operative on January 1, 2028.",
  "(d) This chapter does not apply to a system used by a state agency.",
) + "\n\n# SEC. 5.\n\nTitle 1.81.9 (commencing with Section 1798.500) is added to Part 4 of Division 3 of the Civil Code, to read:\n\n1798.500.\n\n(a) A covered application store shall request age assurance signals.\n\n(b) This title shall become operative on January 1, 2027.";

test("R37: later 'shall become operative on <date>' sentences of the quoted code are extra Operative events, cited; the status stays in-force from the effective date", () => {
  const { result, passages } = run("ca-ab-1043-2025", ab1043, "2026-10-15");
  assert.ok(result.ok);
  assert.equal(result.fields.status.value, "in-force");
  assert.equal(result.fields.statusDate, "2026-01-01");
  assert.deepEqual(
    result.fields.timeline.filter((t) => t.date >= "2025-09-29").map((t) => [t.date, t.event]),
    [
      ["2025-09-29", "Approved by the Governor."],
      ["2025-09-29", "Chaptered by Secretary of State. Chapter 138, Statutes of 2025."],
      ["2026-01-01", "Takes effect"],
      ["2027-01-01", "Operative"],
    ],
  );
  const extra = result.fields.timeline.at(-1)!;
  assert.deepEqual(extra.parts, ["January 1, 2027"]);
  assert.ok(extra.support.some((id) => passages.find((p) => p.id === id)!.text.includes("This title shall become operative on January 1, 2027.")));
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);
  // a quoted date that is not later than the effective date adds nothing; neither does one in a bill that is only enacted
  const same = run("ca-ab-1043-2025", ab1043.replace("January 1, 2027.", "January 1, 2026."), "2026-10-15").result;
  assert.ok(same.ok && !same.fields.timeline.some((t) => t.event === "Operative"));
  const notYet = run("ca-ab-1043-2025", ab1043, "2025-12-31").result;
  assert.ok(notYet.ok && notYet.fields.status.value === "enacted" && !notYet.fields.timeline.some((t) => t.event === "Operative" || t.event === "Takes effect"));
});

test("R37: 'shall become operative January 1, 2027' (no 'on') counts, and several sentences with one date are one event citing them all", () => {
  const text = ab1043.replace(
    "(b) This title shall become operative on January 1, 2027.",
    "(b) This title shall become operative January 1, 2027.\n\n# SEC. 6.\n\nSection 1798.600 of the Civil Code is added to read:\n\n1798.600.\n\n(a) This section shall become operative on January 1, 2027.\n\n(b) This article shall become operative on January 1, 2029.",
  );
  const { result, passages } = run("ca-ab-1043-2025", text, "2026-10-15");
  assert.ok(result.ok);
  const operative = result.fields.timeline.filter((t) => t.event === "Operative");
  assert.deepEqual(operative.map((t) => t.date), ["2027-01-01", "2029-01-01"]);
  assert.equal(operative[0]!.support.length, 2, "both sentences are cited for the shared date");
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);
});

test("R37: a quoted 'become operative on <date>' sentence with a contingency or without a date adds no event", () => {
  const text = ab1043.replace("(b) This title shall become operative on January 1, 2027.", "(b) This title shall become operative on January 1, 2027, only if Senate Bill 55 is enacted.\n\n(c) This article shall become operative when the board adopts its rules.");
  const { result } = run("ca-ab-1043-2025", text, "2026-10-15");
  assert.ok(result.ok && result.fields.status.value === "in-force");
  assert.ok(!result.fields.timeline.some((t) => t.event === "Operative"));
});

test("R37: an explicit 'take effect on <date>' clause of the act is labelled Takes effect, an 'operative' one Operative", () => {
  const takes = run("ca-sb-900-2025", enacted.replace("This act shall become operative on January 1, 2026.", "This act shall take effect on March 3, 2026."), "2026-10-15").result;
  assert.ok(takes.ok);
  assert.ok(takes.fields.timeline.some((t) => t.date === "2026-03-03" && t.event === "Takes effect"));
});

test("R37: only the digest's own declaration ('This bill would declare that it is to take effect immediately') makes an urgency statute", () => {
  const existing = noOperative.replace(
    "(2) Existing law establishes the Department of Technology within the Government Operations Agency.",
    "(2) Existing law establishes the Department of Technology within the Government Operations Agency. Under an earlier act, certain rules take effect immediately as an urgency statute.",
  );
  const { result } = run("ca-sb-900-2025", existing, "2025-10-01");
  assert.ok(result.ok);
  assert.equal(result.fields.status.value, "enacted", "an 'Existing law' sentence is not the bill declaring itself an urgency statute");
  const own = run("ca-sb-900-2025", urgency(noOperative), "2025-10-01").result;
  assert.ok(own.ok && own.fields.status.value === "in-force");
  const declares = run("ca-sb-900-2025", noOperative.replace("This bill would provide that no reimbursement is required by this act for a specified reason.", "The bill declares that it is to take effect immediately as an urgency statute."), "2025-10-01").result;
  assert.ok(declares.ok && declares.fields.status.value === "in-force");
});

// ---------------------------------------------------------------------------------------------------------------------
// R35: the Assembly bills' introduction row

test("R35: an Assembly bill's first 'Read first time. To print.' row is its introduction event; a later 'Read first time' is not", () => {
  const text = enacted
    .replace("2025-02-19 — Introduced. Read first time. To Com. on RLS. for assignment. To print.", "2025-02-19 — Read first time. To print.")
    .replace("2025-06-05 — In Assembly. Referred to Com. on P. & C.P.", "2025-06-05 — In Senate. Read first time. To print.\n\n2025-06-06 — Read first time. To print.");
  const { result, passages } = run("ca-ab-900-2025", text);
  assert.ok(result.ok);
  assert.deepEqual(result.fields.timeline[0]!.event, "Read first time. To print.");
  assert.equal(result.fields.timeline[0]!.date, "2025-02-19");
  assert.equal(result.fields.timeline.filter((t) => /^Read first time/.test(t.event)).length, 1);
  assert.equal(result.fields.published, "2025-02-19");
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);
});

// ---------------------------------------------------------------------------------------------------------------------
// R32: more of the digest's sentences are provisions

test("R32: 'The bill would', 'This bill would also', 'The bill, among other things, would' and 'would require/prohibit/authorize' sentences are provisions, in order", () => {
  const digest = [
    "(1) Existing law requires the department to keep an inventory of the systems that state agencies use and to report it every year to the Legislature.",
    "The bill would require a developer to publish a safety framework. The bill would also prohibit the sale of data collected for a purpose it was not collected for. The bill, among other things, would define a covered model.",
    "(2) Existing law authorizes the department to adopt rules.",
    "By expanding the scope of a crime, this bill would authorize the Attorney General to bring an action. This bill would declare that it is to take effect immediately as an urgency statute.",
    "Existing law would be the same.",
  ].join("\n\n");
  const text = enacted.replace(/(# Legislative Counsel's Digest\n\nAutomated decision systems: transparency\.\n\n)[\s\S]*?(?=# Legislative history)/, `$1${digest}\n\n`);
  const { result, passages } = run("ca-sb-900-2025", text);
  assert.ok(result.ok);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), [
    "The bill would require a developer to publish a safety framework.",
    "The bill would also prohibit the sale of data collected for a purpose it was not collected for.",
    "The bill, among other things, would define a covered model.",
    "By expanding the scope of a crime, this bill would authorize the Attorney General to bring an action.",
    "This bill would declare that it is to take effect immediately as an urgency statute.",
  ]);
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);
});

test("R32: a numbered paragraph '(2) This bill would ...' that follows another sentence in the same paragraph is split off and kept verbatim", () => {
  const digest = "(1) Existing law requires the department to keep an inventory of the systems that state agencies use and to report it every year. (2) This bill would require the department to publish it. (3) The bill would also authorize an audit.";
  const text = enacted.replace(/(# Legislative Counsel's Digest\n\nAutomated decision systems: transparency\.\n\n)[\s\S]*?(?=# Legislative history)/, `$1${digest}\n\n`);
  const { result, passages } = run("ca-sb-900-2025", text);
  assert.ok(result.ok);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), ["This bill would require the department to publish it.", "The bill would also authorize an audit."]);
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);
});
