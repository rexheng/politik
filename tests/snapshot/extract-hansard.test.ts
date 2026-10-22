import assert from "node:assert/strict";
import { test } from "node:test";

import { checkClaims } from "../../photon/scripts/snapshot/check.ts";
import { extractHansard } from "../../photon/scripts/snapshot/extract/hansard.ts";
import { htmlPageText } from "../../photon/scripts/snapshot/meta.ts";
import { wordCount } from "../../photon/scripts/snapshot/passages.ts";
import { candidate, fixture, withPassages } from "../helpers/extract.ts";

const SPRS_URL = "https://sprs.parl.gov.sg/search/email/link?fullContentFlag=false&id=023_20121015_S0003_T0002";
function run(html: string, over: { id?: string; url?: string; snapshotDate?: string } = {}) {
  const c = candidate({ id: over.id ?? "sg-hansard-pdp-bill-2r-2012", type: "hansard", title: "Personal Data Protection Bill", url: over.url ?? SPRS_URL });
  const { text } = htmlPageText(html);
  const { passages } = withPassages(c, text);
  return { c, text, passages, result: extractHansard(c, text, passages, { snapshotDate: over.snapshotDate ?? "2026-10-15", format: "html", html }) };
}

test("an SPRS page: published is the sitting date; the speaker label and salutation are taken off the first substantive paragraph; a short procedural one is skipped", () => {
  const { result, passages } = run(fixture("hansard-sprs.html"));
  assert.ok(result.ok);
  assert.equal(result.fields.published, "2012-10-15");
  assert.ok(
    result.fields.summary.value.startsWith("today, vast amounts of personal data are collected, used and transferred for a variety of reasons."),
    result.fields.summary.value.slice(0, 120),
  );
  assert.ok(!result.fields.summary.value.includes("The Minister for"));
  assert.ok(!result.fields.summary.value.includes("Mr Speaker"));
  assert.ok(wordCount(result.fields.summary.value) <= 150 && wordCount(result.fields.summary.value) >= 25);
  assert.equal(result.fields.status.value, "published");
  assert.equal(result.fields.statusDate, "2012-10-15");
  assert.deepEqual(result.fields.timeline.map((t) => [t.date, t.event]), [["2012-10-15", "Sitting"]]);
  assert.deepEqual(result.fields.timeline[0]!.parts, ["15-10-2012"]);
  assert.deepEqual(result.fields.affected, []);
  const checked = checkClaims(result.fields, passages);
  assert.equal(checked.fatal, undefined);
  assert.deepEqual(checked.dropped, []);
});

test("an SPRS page is not summarised by its header rows: the long 'MPs Speaking' row is not the statement", () => {
  const { result } = run(fixture("hansard-sprs.html"));
  assert.ok(result.ok);
  assert.ok(!result.fields.summary.value.includes("Zaqy Mohamad"));
});

test("with the Sitting Date row cut, the date comes from the _20121015_ token in the candidate URL", () => {
  const html = fixture("hansard-sprs.html").replace(/<tr valign="top"><td width="15%"><font size="2">Sitting Date:<\/font><\/td>[\s\S]*?<\/tr>/, "");
  assert.ok(!html.includes("Sitting Date"));
  const { result, passages } = run(html);
  assert.ok(result.ok);
  assert.equal(result.fields.published, "2012-10-15");
  assert.equal(result.fields.statusDate, "2012-10-15");
  assert.deepEqual(result.fields.timeline.map((t) => [t.date, t.event]), [["2012-10-15", "Sitting"]]);
  assert.equal(checkClaims(result.fields, passages).dropped.length, 0);
  // a URL with no date token and no row gives no date
  const none = run(html, { url: "https://sprs.parl.gov.sg/search/email/link?id=abc" }).result;
  assert.ok(none.ok);
  assert.equal(none.fields.published, undefined);
  assert.equal(none.fields.statusDate, undefined);
  assert.deepEqual(none.fields.timeline, []);
});

test("a label like 'Assoc Prof Dr Yaacob Ibrahim:' is taken off too, and 'Mr Speaker, Sir,' only at the start", () => {
  const body = "Sir, " + Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ") + " and Mr Speaker, Sir, again.";
  const html = fixture("hansard-sprs.html").replace(/<p>The Minister for Communications and Information \(Dr Yaacob Ibrahim\): Mr Speaker, Sir, today[\s\S]*?<\/p>/, `<p>Assoc Prof Dr Yaacob Ibrahim: Mr Speaker, Sir, ${body}</p>`);
  const { result } = run(html);
  assert.ok(result.ok);
  assert.ok(result.fields.summary.value.startsWith("Sir, word0 word1"), result.fields.summary.value.slice(0, 60));
  assert.ok(result.fields.summary.value.includes("and Mr Speaker, Sir, again."));
});

test("a ministry speech page (no header rows) follows the page rules: the lead paragraph, the page date, and a Published event", () => {
  const c = candidate({ id: "sg-hansard-eliona-2r-2024", type: "hansard", url: "https://www.mddi.gov.sg/newsroom/opening-speech/" });
  const html = fixture("speech-ministry.html");
  const { text } = htmlPageText(html);
  const { passages } = withPassages(c, text);
  const result = extractHansard(c, text, passages, { snapshotDate: "2026-10-15", format: "html", html });
  assert.ok(result.ok);
  assert.ok(result.fields.summary.value.startsWith("Mr Speaker, Sir, I beg to move, “That the Bill be now read a second time”. The Elections (Integrity of Online Advertising)"));
  assert.equal(result.fields.published, "2024-10-15");
  assert.equal(result.fields.status.value, "published");
  assert.equal(result.fields.statusDate, "2024-10-15");
  assert.deepEqual(result.fields.timeline.map((t) => [t.date, t.event]), [["2024-10-15", "Published"]]);
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});

test("a Hansard page with no statement of 25 words has no official summary", () => {
  const html = fixture("hansard-sprs.html").replace(/<p>(?:The|To|Mr)[\s\S]*?<\/p>/g, "");
  assert.deepEqual(run(html).result, { ok: false, reason: "no official summary found" });
});

test("dry run: a ministry page of a parliamentary question is summarised by the Answer, not by the question", () => {
  const question = `*13 Dr Choo Pei Ling asked the Minister for Digital Development and Information (i) whether the Government assesses that advances in generative AI have materially increased the risk of coordinated deepfake campaigns targeting Singapore; and (ii) how national detection capabilities are being strengthened. Mrs`;
  const answer = `The Government shares the member\u2019s concern that generative AI can be exploited by bad actors to spread falsehoods, conduct hostile information operations, and manipulate public opinion through convincing deepfakes produced at scale.`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><main><h1>MDDI's Response to PQ on Deepfake Campaigns</h1><p>2 March 2026</p><h2>Question for Oral Answer</h2><p>${question}</p><p>Answer:</p><p>${answer}</p><p>We have introduced safeguards to moderate these risks. ${"Further detail. ".repeat(20)}</p></main></body></html>`;
  const { result, passages } = run(html, { id: "sg-hansard-pq-deepfake-campaigns-2026", url: "https://www.mddi.gov.sg/newsroom/threat-assessment/" });
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, answer);
  assert.equal(result.fields.status.value, "published");
  const checked = checkClaims(result.fields, passages);
  assert.equal(checked.fatal, undefined);
  assert.deepEqual(checked.dropped, []);
});

test("dry run: a ministry page with no Answer marker (a speech) is summarised as any web page is", () => {
  const lead = `Mr Chairman, AI has taken center stage at this year\u2019s Budget and COS debates. Members have asked how the Government will support companies in adopting AI safely and responsibly across the economy.`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><main><h1>Committee of Supply Speech</h1><p>${lead}</p><p>${"More detail follows here. ".repeat(20)}</p></main></body></html>`;
  const { result } = run(html, { id: "sg-hansard-mddi-cos-2026", url: "https://www.mddi.gov.sg/newsroom/cos-speech/" });
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, lead);
});

/** An SPRS-style page whose statement is the one paragraph given. */
const sprsWith = (paragraph: string) =>
  `<html><head><title>T</title></head><body><div class="hansardContent"><h3>Some Bill</h3><p>Order for Second Reading read.</p><p>${paragraph}</p><p>${Array.from({ length: 30 }, (_, i) => `filler${i}`).join(" ")}.</p></div></body></html>`;

test("I1: only a real speaker label is taken off: '(Name):' or a short label with no clause words; a lead-in clause before a colon is kept", () => {
  const body = "first, to protect individuals from the misuse of their data; second, to set clear duties for the organisations that handle it; and third, to give the Commission the powers it needs to enforce those duties properly.";
  // the sentence "The Bill has three main objectives:" is the statement's own words, not a speaker
  const clause = run(sprsWith(`The Bill has three main objectives: ${body}`)).result;
  assert.ok(clause.ok);
  assert.equal(clause.fields.summary.value, `The Bill has three main objectives: ${body}`);
  // a salutation, then a clause before a colon: the salutation goes, the clause stays
  const salutation = run(sprsWith(`Mr Speaker, Sir, the Bill does three things: ${body}`)).result;
  assert.ok(salutation.ok);
  assert.equal(salutation.fields.summary.value, `the Bill does three things: ${body}`);
  // the real forms
  const named = run(sprsWith(`The Minister for Communications and Information (Dr Yaacob Ibrahim): Mr Speaker, Sir, ${body}`)).result;
  assert.ok(named.ok);
  assert.equal(named.fields.summary.value, body);
  const short = run(sprsWith(`Mr Speaker: ${body}`)).result;
  assert.ok(short.ok);
  assert.equal(short.fields.summary.value, body);
  const prof = run(sprsWith(`Assoc Prof Daniel Goh: ${body}`)).result;
  assert.ok(prof.ok);
  assert.equal(prof.fields.summary.value, body);
  const minister = run(sprsWith(`The Minister for Digital Development and Information: ${body}`)).result;
  assert.ok(minister.ok);
  assert.equal(minister.fields.summary.value, body);
});
