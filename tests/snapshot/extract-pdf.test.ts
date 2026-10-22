import assert from "node:assert/strict";
import { test } from "node:test";

import { checkClaims } from "../../photon/scripts/snapshot/check.ts";
import { extractPdf } from "../../photon/scripts/snapshot/extract/pdf.ts";
import { wordCount } from "../../photon/scripts/snapshot/passages.ts";
import { candidate, fixture, withPassages } from "../helpers/extract.ts";

const LEX = ["system", "data", "rules", "users", "risk", "policy", "audit", "model", "duty", "review"];
/** n lower-case words of running text, so that a paragraph of them is prose. */
const words = (n: number) => Array.from({ length: n }, (_, i) => LEX[i % LEX.length]).join(" ");
const guidance = (id = "sg-framework") => candidate({ id, type: "guidance", title: "Model Framework" });
function run(c = guidance(), text: string, snapshotDate = "2026-10-15") {
  const { passages } = withPassages(c, text);
  return { passages, result: extractPdf(c, text, passages, { snapshotDate, format: "pdf" }) };
}

test("the summary is the first paragraph under an Executive summary line, its lines joined by single spaces", () => {
  const { result, passages } = run(guidance(), fixture("framework.txt"));
  assert.ok(result.ok);
  assert.equal(
    result.fields.summary.value,
    "This framework sets out practical guidance for organisations that deploy automated decision systems in the public and private sectors. It explains how organisations can govern the use of these systems, manage the risks they create, and communicate clearly with the people they affect, in line with existing law.",
  );
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);
  assert.equal(result.fields.published, undefined);
  assert.equal(result.fields.status.value, "published");
  assert.equal(result.fields.statusDate, undefined);
  assert.deepEqual(result.fields.timeline, []);
});

test("a numbered Introduction heading works, and so do Overview and the unnumbered form", () => {
  const body = `Automated decision systems are used to approve loans and screen applicants. ${words(20)}.`;
  for (const heading of ["1. Introduction", "1 Introduction", "1.0 Introduction", "Introduction", "INTRODUCTION", "Overview", "2.1. Overview"]) {
    const text = `Title of the document\n\n${words(30)} before the heading is a long first paragraph that must not be chosen.\n\n${heading}\n${body}\n\nAnother paragraph here.`;
    const { result } = run(guidance(), text);
    assert.ok(result.ok, heading);
    assert.equal(result.fields.summary.value, body, heading);
  }
  // a heading followed by a blank line, and a contents line with a page number, are not confused
  const text = `Contents\nIntroduction 3\n\n${words(30)} a first paragraph of the front matter that is long enough.\n\nIntroduction\n\n${body}`;
  const { result } = run(guidance(), text);
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, body);
});

test("with no such heading, the first paragraph of 25 or more words, skipping the title and cover lines", () => {
  const { result, passages } = run(guidance(), fixture("report-no-heading.txt"));
  assert.ok(result.ok);
  assert.ok(result.fields.summary.value.startsWith("Artificial intelligence is advancing quickly, and its frontier models now carry benefits and risks that policymakers must weigh together."));
  assert.ok(result.fields.summary.value.endsWith("without prescribing particular rules."));
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});

test("a regulation notice: the Informative Digest paragraph, and a stated effective date decides the status", () => {
  const c = candidate({ id: "ca-cppa-oops-rulemaking-2026", type: "regulation" });
  const { result, passages } = run(c, fixture("notice-digest.txt"));
  assert.ok(result.ok);
  assert.ok(result.fields.summary.value.startsWith("Existing law, the California Consumer Privacy Act of 2018, gives consumers the right to know"));
  assert.ok(result.fields.summary.value.endsWith("and would take effect on January 1, 2027."));
  // "would take effect on January 1, 2027" is a proposal's date, not a fact: the regulation is proposed, with no status date
  assert.equal(result.fields.status.value, "proposed");
  assert.equal(result.fields.statusDate, undefined);
  assert.deepEqual(result.fields.timeline, []);
  const adopted = run(c, fixture("notice-digest.txt").replace("would take effect on", "take effect on")).result;
  assert.ok(adopted.ok && adopted.fields.status.value === "enacted" && adopted.fields.statusDate === "2027-01-01");
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);
  // the Informative Digest is read only for a regulation: a guidance document takes the first long paragraph
  const g = run(guidance(), fixture("notice-digest.txt")).result;
  assert.ok(g.ok && g.fields.summary.value.startsWith("NOTICE IS HEREBY GIVEN"));
});

test("lines beginning with a bullet give up to 4 provisions; with none, numbered headings do", () => {
  const { result, passages } = run(guidance(), fixture("framework.txt"));
  assert.ok(result.ok);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), [
    "Organisations should assign clear roles and responsibilities for each automated decision system.",
    "Organisations should assess the risk of harm to individuals before deployment.",
    "Organisations should keep records of the testing and monitoring of each system.",
    "Organisations should give individuals a way to ask for human review of a decision.",
  ]);
  assert.equal(checkClaims(result.fields, passages).dropped.length, 0);

  const noBullets = fixture("framework.txt").split("\n").filter((l) => !l.startsWith("•")).join("\n");
  const headings = run(guidance(), noBullets).result;
  assert.ok(headings.ok);
  assert.deepEqual(headings.fields.provisions.map((p) => p.value), ["Scope of the framework", "Risk assessment and testing"]); // not the contents lines, not Introduction
  const report = run(guidance(), fixture("report-no-heading.txt")).result;
  assert.ok(report.ok);
  assert.deepEqual(report.fields.provisions.map((p) => p.value), ["Principles for policy"]);
});

test("no paragraph of 25 words gives no official summary", () => {
  const text = `Title\n\n${words(10)}\n\n${words(24)}\n\n- ${words(8)}\n- ${words(8)}`;
  assert.deepEqual(run(guidance(), text).result, { ok: false, reason: "no official summary found" });
});

test("an executive order PDF: in force from the signing date in its closing clause, a Signed event, short title from the id", () => {
  const c = candidate({ id: "ca-eo-n-12-23", type: "executive-order", title: "Executive Order N-12-23" });
  const text = `EXECUTIVE DEPARTMENT\nSTATE OF CALIFORNIA\nEXECUTIVE ORDER N-12-23\n\nWHEREAS the State of California is a global leader in innovation, research, development, human capital, and entrepreneurship; and\nWHEREAS generative artificial intelligence represents a significant leap forward in technology.\n\nIT IS HEREBY ORDERED THAT the agencies shall act.\n\nIN WITNESS WHEREOF I have hereunto set my hand and caused the Great Seal of the State of California to be affixed this 6th day of\nSeptember 2023.\n\nGAVIN NEWSOM\nGovernor of California`;
  const { result, passages } = run(c, text);
  assert.ok(result.ok);
  assert.equal(result.fields.status.value, "in-force");
  assert.equal(result.fields.statusDate, "2023-09-06");
  assert.deepEqual(result.fields.timeline.map((t) => [t.date, t.event]), [["2023-09-06", "Signed"]]);
  assert.equal(result.fields.shortTitle, "N-12-23");
  assert.equal(result.fields.published, undefined);
  assert.equal(checkClaims(result.fields, passages).dropped.length, 0);
});

test("a summary of a PDF whose text has no blank lines is still at most 150 words and a verbatim excerpt", () => {
  const sentences = Array.from({ length: 30 }, (_, i) => `Sentence ${["one", "two", "three", "four", "five"][i % 5]} says that ${words(12)}.`);
  const lines = sentences.flatMap((s) => [s.slice(0, Math.floor(s.length / 2)), s.slice(Math.floor(s.length / 2))]);
  const { result, passages } = run(guidance(), lines.join("\n"));
  assert.ok(result.ok);
  assert.ok(wordCount(result.fields.summary.value) <= 150 && result.fields.summary.value.endsWith("."));
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});

test("R40: a bullet that starts in lower case or has no closing punctuation is a line-wrap fragment, not a provision", () => {
  const item = (t: string) => `• ${t}`;
  const full = "Organisations should assess the risk of harm to individuals before they deploy a system, and record it";
  const text = [
    `${words(30)}.`,
    "",
    item(`${full}.`),
    item("Organisations should keep records of the testing of each system;"),
    item("Organisations should give individuals a way to ask for review; and"),
    item("and the second half of an item that was wrapped from the line above it."),
    item("Organisations must publish a plan for every system they run in the"),
    item("(a) Organisations must keep records of the work done for each system."),
  ].join("\n");
  const { result, passages } = run(guidance(), text);
  assert.ok(result.ok);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), [
    `${full}.`,
    "Organisations should keep records of the testing of each system;",
    "Organisations should give individuals a way to ask for review; and",
    "(a) Organisations must keep records of the work done for each system.",
  ]);
  assert.equal(checkClaims(result.fields, passages).dropped.length, 0);
  // fewer than two whole bullets: the numbered headings are used instead
  const fragments = [`${words(30)}.`, "", item("Organisations must publish a plan for every system they run in the"), item("and the second half of an item that was wrapped over."), "", "1. Scope of the framework", `Body ${words(10)}`].join("\n");
  const fallback = run(guidance(), fragments).result;
  assert.ok(fallback.ok);
  assert.deepEqual(fallback.fields.provisions.map((p) => p.value), ["Scope of the framework"]);
});

test("R40: a numbered line that is the first line of a wrapped paragraph is a fragment, not a heading; real headings stay", () => {
  const body = (n: number) => `Body ${words(n)}.`;
  const text = [
    `${words(30)}.`,
    "",
    "1. Scope of the framework",
    body(12),
    "",
    "1.1 The four supported data centres have committed to exceed the minimum",
    "requirements set out in the call for applications, and will report each year.",
    "",
    "2. Risk assessment and testing",
    body(12),
    "",
    "2.1 EDB and IMDA will continue to engage industry stakeholders and review the",
    "outcomes of the exercise.",
    "",
    "3. Citation and Commencement",
    "These words follow a heading that has a capital letter.",
  ].join("\n");
  const { result, passages } = run(guidance(), text);
  assert.ok(result.ok);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), ["Scope of the framework", "Risk assessment and testing", "Citation and Commencement"]);
  assert.equal(checkClaims(result.fields, passages).dropped.length, 0);
  // every provision of a PDF is a whole item or a heading: nothing that starts in lower case
  assert.ok(result.fields.provisions.every((p) => /^\p{Lu}/u.test(p.value)));
});

test("R40: a numbered line that runs to the right margin is the first line of a wrapped paragraph, even when the next line starts with a capital", () => {
  const line = (n: number) => `Body text of the document that runs all the way to the right margin of the page, line ${n}.`;
  const text = [
    `${words(30)}.`,
    "",
    "1.1 Digital infrastructure, in particular the compute infrastructure such as Cloud and Data",
    "Centres (“DCs”), has become integral to Singapore’s economy and to the daily lives of its people.",
    line(1),
    line(2),
    "",
    "1.2 The “Check” process monitors and reviews performance against the established",
    "BCMS’ goals and objectives, and the results are presented to top management for review.",
    line(3),
    "",
    "2. Citation and Commencement",
    line(4),
    "",
    "3. Key risks to resilience and security",
    line(5),
  ].join("\n");
  const { result, passages } = run(guidance(), text);
  assert.ok(result.ok);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), ["Citation and Commencement", "Key risks to resilience and security"]);
  assert.equal(checkClaims(result.fields, passages).dropped.length, 0);
});

test("R40: a line that starts with a day of the month ('1 November 2021 and remains designated as such at the') is a date, not a numbered heading", () => {
  const text = [`${words(30)}.`, "", "A computer system was designated as a CII on", "1 November 2021 and remains designated as such at the", "Effective Date. This is an Existing CII.", "", "2. Scope of the code", "Body text follows here."].join("\n");
  const { result } = run(guidance(), text);
  assert.ok(result.ok);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), ["Scope of the code"]);
});
