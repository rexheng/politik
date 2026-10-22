import assert from "node:assert/strict";
import { test } from "node:test";

import type { Candidate } from "../../photon/scripts/snapshot/candidates.ts";
import { checkClaims } from "../../photon/scripts/snapshot/check.ts";
import { extractHtml, isGenericDescription } from "../../photon/scripts/snapshot/extract/html.ts";
import { wordCount } from "../../photon/scripts/snapshot/passages.ts";
import { htmlPageText } from "../../photon/scripts/snapshot/meta.ts";
import { candidate, fixture, withPassages } from "../helpers/extract.ts";

const words = (n: number, label = "w") => Array.from({ length: n }, (_, i) => `${label}${i}`).join(" ");
/** A description of exactly n words that names a policy noun and is not generic. */
const desc = (n: number) => `Regulations require operators ${words(n - 3, "d")}`;
const page = (head: string, body: string) => `<!DOCTYPE html><html><head><meta charset="utf-8">${head}</head><body><main>${body}</main></body></html>`;

/** Runs the extractor on an HTML page the way the build does: the loader's text, its passages, the raw HTML. */
function run(c: Candidate, html: string, snapshotDate = "2026-10-15") {
  const { text } = htmlPageText(html);
  const { passages } = withPassages(c, text);
  const result = extractHtml(c, text, passages, { snapshotDate, format: "html", html });
  return { text, passages, result };
}
const press = (id = "ca-ag-x") => candidate({ id, type: "press-release", title: "Attorney General Bonta Sends Cease and Desist Letter to xAI" });

test("an OAG release: the description is cut at … in the lead, so the summary is the whole lead paragraph; published, status and timeline from the meta date", () => {
  const { result, passages } = run(press(), fixture("release-oag.html"));
  assert.ok(result.ok);
  const s = result.fields.summary.value;
  assert.match(s, /^OAKLAND — California Attorney General Rob Bonta today sent xAI a cease and desist letter, demanding the company take immediate action/);
  assert.ok(s.endsWith("including via the social media platform X."), s.slice(-80));
  assert.ok(wordCount(s) <= 150 && wordCount(s) > 100, String(wordCount(s)));
  assert.equal(result.fields.published, "2026-01-16");
  assert.equal(result.fields.status.value, "published");
  assert.equal(result.fields.statusDate, "2026-01-16");
  assert.deepEqual(result.fields.timeline.map((t) => [t.date, t.event]), [["2026-01-16", "Published"]]);
  assert.equal(result.fields.shortTitle, undefined);
  assert.deepEqual(result.fields.affected, []);
  const checked = checkClaims(result.fields, passages);
  assert.equal(checked.fatal, undefined);
  assert.deepEqual(checked.dropped, []);
});

test("a description cut off mid-sentence without an ellipsis, as the real OAG pages have it, is expanded to its paragraph too", () => {
  const html = fixture("release-oag.html").replaceAll("in violation of…", "in violation of");
  const { result } = run(press(), html);
  assert.ok(result.ok);
  assert.ok(result.fields.summary.value.endsWith("including via the social media platform X."));
});

test("dry run: a cut-off description that starts with the heading above its paragraph (the OAG regulation pages: \"Summary Signed into law ...\") is expanded to that paragraph, without the heading word", () => {
  const paragraph = `Signed into law in September 2024, the Act makes it unlawful for online platforms to provide addictive feeds to minors without parental consent. The Act requires the Attorney General to adopt regulations regarding age assurance and parental consent methods by January 1, 2027. ${words(12)}.`;
  const cut = `Summary ${paragraph.slice(0, paragraph.indexOf("regarding age") + "regarding age".length)}`;
  const html = page(`<meta name="description" content="${cut}">`, `<h1>Rulemaking</h1><h2>Summary</h2><p>${paragraph}</p><p>NOTE: ${words(30)}.</p>`);
  const { result, passages } = run(candidate({ id: "ca-ag-sb976-regs-2026", type: "regulation" }), html);
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, paragraph);
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
  // A complete description that starts with the heading is kept as it is, as the page's own description.
  const complete = `Summary ${paragraph}`;
  const kept = run(candidate({ id: "ca-ag-sb976-regs-2026", type: "regulation" }), page(`<meta name="description" content="${complete}">`, `<h1>Rulemaking</h1><h2>Summary</h2><p>${paragraph}</p>`));
  assert.ok(kept.result.ok);
  assert.equal(kept.result.fields.summary.value, paragraph);
});

test("dry run: a break after an honorific is not a paragraph break: 'made by Mrs<br>Josephine Teo' reads as one sentence", () => {
  const body = `The Government is making an additional investment of over S$1 billion under the National AI Research and Development Plan, as part of its commitment to strengthen research. The announcement was made by Mrs<br/>Josephine Teo, Minister for Digital Development and Information, at the Gala Dinner held today.`;
  const { text, result } = run(candidate({ id: "sg-mddi-national-ai-rd-plan", type: "press-release" }), page("", `<h1>Plan</h1><p>${body}</p><p>${words(150)}.</p>`));
  assert.ok(text.includes("made by Mrs Josephine Teo, Minister"), text.slice(0, 400));
  assert.ok(result.ok);
  assert.ok(result.fields.summary.value.endsWith("at the Gala Dinner held today."), result.fields.summary.value.slice(-80));
});

test("a description that is a complete first sentence of the lead stays the summary", () => {
  const sentence = `Regulations require operators to register with the commission and to keep ${words(8)}.`;
  const html = page(`<meta name="description" content="${sentence}">`, `<h1>T</h1><p>${sentence} Operators must also ${words(40)}.</p>`);
  const { result } = run(press(), html);
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, sentence);
});

test("an Isomer release: a blank description and a 30-word migrated-article notice are skipped; the summary is the first body paragraph; published from the date after the h1", () => {
  const html = fixture("release-isomer.html");
  const notice = /This article has been migrated[^<]*/.exec(html)![0];
  assert.equal(wordCount(notice), 30);
  const { result, passages } = run(candidate({ id: "sg-smart-nation-2-2024", type: "press-release" }), html);
  assert.ok(result.ok);
  assert.ok(result.fields.summary.value.startsWith("Singapore, 1 October 2024 – Prime Minister and Minister for Finance Lawrence Wong today announced Smart Nation 2.0"));
  assert.ok(!result.fields.summary.value.includes("migrated"));
  assert.equal(result.fields.published, "2024-10-01");
  assert.deepEqual(result.fields.timeline.map((t) => [t.date, t.event]), [["2024-10-01", "Published"]]);
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});

test("a description of 15 words is the summary, and one of 14 is not (the lead paragraph is)", () => {
  const lead = `The lead paragraph says something about the rules. ${words(30)}.`;
  const fifteen = run(press(), page(`<meta name="description" content="${desc(15)}">`, `<h1>T</h1><p>${lead}</p>`));
  assert.ok(fifteen.result.ok);
  assert.equal(fifteen.result.fields.summary.value, desc(15));
  const fourteen = run(press(), page(`<meta name="description" content="${desc(14)}">`, `<h1>T</h1><p>${lead}</p>`));
  assert.ok(fourteen.result.ok);
  assert.equal(fourteen.result.fields.summary.value, lead);
});

test("a description that is not in the body is cited to the Page description passage", () => {
  const html = page(`<meta name="description" content="${desc(20)}">`, `<h1>T</h1><p>${words(60, "b")}</p>`);
  const { result, passages } = run(press(), html);
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, desc(20));
  const described = passages.find((p) => p.heading === "Page description")!;
  assert.deepEqual(result.fields.summary.support, [described.id]);
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});

test("R26: a generic description is not the summary: marketing phrases, or no policy noun at all; the lead paragraph is", () => {
  assert.equal(isGenericDescription("Singapore launches world's first AI testing toolkit for responsible AI. Learn more about the framework."), true);
  assert.equal(isGenericDescription("Find out how the new rules affect operators of online platforms in the state of California today."), true);
  assert.equal(isGenericDescription("Discover the regulations that apply to operators of online platforms in the state of California today."), true);
  assert.equal(isGenericDescription("IMDA helps SMEs go digital by providing support with 5G, CTO-as-a-Service, the Open Innovation Platform and more to drive growth."), true);
  assert.equal(isGenericDescription("The Attorney General announced a settlement that requires the company to stop selling personal information and to pay a fine."), false);
  assert.equal(isGenericDescription(desc(15)), false);

  const lead = `The real lead paragraph of the page. ${words(30)}.`;
  const generic = page(`<meta name="description" content="Learn more about the new rules for operators ${words(10)}">`, `<h1>T</h1><p>${lead}</p>`);
  const { result } = run(press(), generic);
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, lead);

  // the real IMDA page: its description is a marketing line, the lead is in the Next.js payload
  const imda = run(candidate({ id: "sg-ai-verify-2022", type: "press-release" }), fixture("release-imda-next.html"));
  assert.ok(imda.result.ok);
  assert.match(imda.result.fields.summary.value, /^Singapore has taken another step in the advancement of artificial intelligence \(AI\) by launching A\.I\. Verify/);
  assert.equal(imda.result.fields.published, "2022-05-25");
  assert.equal(checkClaims(imda.result.fields, imda.passages).fatal, undefined);
});

test("a summary longer than 150 words is cut after its last whole sentence that fits", () => {
  const sentences = Array.from({ length: 12 }, (_, i) => `Sentence ${i} of the lead says ${words(14)}.`).join(" ");
  const { result, passages } = run(press(), page("", `<h1>T</h1><p>${sentences}</p>`));
  assert.ok(result.ok);
  assert.ok(wordCount(result.fields.summary.value) <= 150 && result.fields.summary.value.endsWith("."));
  assert.ok(sentences.startsWith(result.fields.summary.value));
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});

test("a page with no date is published with no statusDate and no timeline; a page with only short paragraphs and no description has no summary", () => {
  const lead = `A lead paragraph of the page. ${words(30)}.`;
  const undated = run(press(), page("", `<h1>T</h1><p>${lead}</p>`));
  assert.ok(undated.result.ok);
  assert.equal(undated.result.fields.status.value, "published");
  assert.equal(undated.result.fields.statusDate, undefined);
  assert.equal(undated.result.fields.published, undefined);
  assert.deepEqual(undated.result.fields.timeline, []);

  const thin = run(press(), page("", `<h1>T</h1><p>${words(10)}</p><p>${words(24)}</p>`));
  assert.deepEqual(thin.result, { ok: false, reason: "no official summary found" });
});

test("an executive order page: in force from the signing date in its closing clause, not the page date; Signed event; short title from the id", () => {
  const c = candidate({ id: "ca-eo-n-12-23", type: "executive-order", title: "Executive Order N-12-23" });
  const { result, passages } = run(c, fixture("eo.html"));
  assert.ok(result.ok);
  assert.equal(result.fields.status.value, "in-force");
  assert.equal(result.fields.statusDate, "2023-09-06");
  assert.equal(result.fields.published, "2023-09-08");
  assert.deepEqual(result.fields.timeline.map((t) => [t.date, t.event]), [["2023-09-06", "Signed"]]);
  assert.deepEqual(result.fields.timeline[0]!.parts, ["6th day of September 2023"]);
  assert.equal(result.fields.shortTitle, "N-12-23");
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
  assert.deepEqual(checkClaims(result.fields, passages).dropped, []);

  const noClause = fixture("eo.html").replace(/<p>IN WITNESS[\s\S]*?<\/p>/, "");
  const fallback = run(c, noClause).result;
  assert.ok(fallback.ok);
  assert.equal(fallback.fields.statusDate, "2023-09-08", "else the publish date");
  assert.deepEqual(fallback.fields.timeline.map((t) => [t.date, t.event]), [["2023-09-08", "Signed"]]);
  const other = run(candidate({ id: "ca-eo-n-5-26", type: "executive-order" }), noClause).result;
  assert.ok(other.ok && other.fields.shortTitle === "N-5-26");
});

test("a regulation page: a stated effective date on or before the snapshot date is in force; a later one is enacted (R26); none is published", () => {
  const c = candidate({ id: "ca-cppa-admt-risk-cyber-regs-2025", type: "regulation" });
  const past = run(c, fixture("regulation.html"));
  assert.ok(past.result.ok);
  assert.equal(past.result.fields.status.value, "in-force");
  assert.equal(past.result.fields.statusDate, "2026-01-01");
  assert.deepEqual(past.result.fields.timeline.map((t) => [t.date, t.event]), [["2025-09-23", "Published"], ["2026-01-01", "Takes effect"]]);
  assert.deepEqual(past.result.fields.timeline[1]!.parts, ["January 1, 2026"]);
  assert.equal(checkClaims(past.result.fields, past.passages).fatal, undefined);
  assert.deepEqual(checkClaims(past.result.fields, past.passages).dropped, []);

  const future = run(c, fixture("regulation.html").replace("January 1, 2026", "January 1, 2027"));
  assert.ok(future.result.ok);
  assert.equal(future.result.fields.status.value, "enacted");
  assert.equal(future.result.fields.statusDate, "2027-01-01");

  const on = run(c, fixture("regulation.html"), "2026-01-01").result;
  assert.ok(on.ok && on.fields.status.value === "in-force", "on the effective date itself");

  const none = run(c, fixture("regulation.html").replace(/<p>The regulations take effect on[^<]*<\/p>/, ""));
  assert.ok(none.result.ok);
  assert.equal(none.result.fields.status.value, "published");
  assert.equal(none.result.fields.statusDate, "2025-09-23");
  assert.deepEqual(none.result.fields.timeline.map((t) => t.event), ["Published"]);

  const effective = run(c, fixture("regulation.html").replace("take effect on January 1, 2026", "are effective July 1, 2025"));
  assert.ok(effective.result.ok && effective.result.fields.statusDate === "2025-07-01");
});

test("provisions: three list items of 6 or more words are the provisions; one list item and four headings give the four non-generic headings; none gives []", () => {
  const li = (n: number) => `<li>Operators must ${words(5, `item${n}x`)} and report them</li>`;
  const three = run(press(), page("", `<h1>T</h1><p>${words(40)}.</p><ul>${li(1)}${li(2)}${li(3)}<li>Too short</li></ul>`));
  assert.ok(three.result.ok);
  assert.deepEqual(three.result.fields.provisions.map((p) => p.value), [1, 2, 3].map((n) => `Operators must ${words(5, `item${n}x`)} and report them`));
  assert.equal(checkClaims(three.result.fields, three.passages).dropped.length, 0);

  const headings = run(
    press(),
    page("", `<h1>T</h1><p>${words(40)}.</p><ul>${li(1)}</ul><h2>Overview</h2><p>text</p><h2>Who must comply</h2><p>text</p><h2>Reporting duties of operators</h2><p>text</p><h2>Penalties</h2><p>text</p><h2>Enforcement by the commission</h2><p>text</p><h2>Appeals and review</h2><p>text</p>`),
  );
  assert.ok(headings.result.ok);
  assert.deepEqual(headings.result.fields.provisions.map((p) => p.value), ["Who must comply", "Reporting duties of operators", "Enforcement by the commission", "Appeals and review"]);

  const none = run(press(), page("", `<h1>Title only</h1><p>${words(40)}.</p>`));
  assert.ok(none.result.ok);
  assert.deepEqual(none.result.fields.provisions, []);
});

test("provisions: more than four list items give the first four; the page title is not a provision heading", () => {
  const li = (n: number) => `<li>Operators must ${words(5, `row${n}x`)} and report them</li>`;
  const r = run(press(), page("", `<h1>A heading of a title</h1><p>${words(40)}.</p><ul>${[1, 2, 3, 4, 5, 6].map(li).join("")}</ul>`));
  assert.ok(r.result.ok);
  assert.equal(r.result.fields.provisions.length, 4);
  const titled = run(candidate({ id: "ca-x", type: "guidance", title: "A heading of a title" }), page("", `<h1>A heading of a title</h1><p>${words(40)}.</p><h2>Two words</h2><p>x</p>`));
  assert.ok(titled.result.ok);
  assert.deepEqual(titled.result.fields.provisions.map((p) => p.value), ["Two words"]);
});

test("the PDPC hub page's banner date is not taken as the page's date; the Next.js payload is the body", () => {
  const { result, passages } = run(candidate({ id: "sg-pdpc-hub", type: "guidance", title: "Singapore’s Approach to AI Governance" }), fixture("hub-pdpc.html"));
  assert.ok(result.ok);
  assert.equal(result.fields.published, undefined);
  assert.equal(result.fields.statusDate, undefined);
  assert.deepEqual(result.fields.timeline, []);
  assert.match(result.fields.summary.value, /^As Singapore develops its digital economy, a trusted ecosystem is key/);
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});

test("a text capture is read too: the lead paragraph, and a date line printed under the title or in the dateline", () => {
  const capture = [
    "# Launch of second data centre – Call for application",
    "25 May 2022 | 6 mins read",
    "**SINGAPORE – 01 DEC 2025**",
    `1\\. The Singapore Economic Development Board and the Infocomm Media Development Authority have launched the second call for application as part of ${words(20)}.`,
    "- Strengthen Singapore's international standing as a trusted hub for AI and DC investments;\n- Make significant contributions to Singapore's economic objectives through investments;\n- Accelerate the use of green energy, to realise the broader goals of sustainable development.",
  ].join("\n\n");
  const c = candidate({ id: "sg-dc-cfa2-2025", type: "press-release" });
  const { passages } = withPassages(c, capture);
  const result = extractHtml(c, capture, passages, { snapshotDate: "2026-10-15", format: "text" });
  assert.ok(result.ok);
  assert.ok(result.fields.summary.value.startsWith("1\\. The Singapore Economic Development Board"));
  assert.equal(result.fields.published, "2022-05-25");
  assert.equal(result.fields.statusDate, "2022-05-25");
  assert.deepEqual(result.fields.timeline[0]!.parts, ["25 May 2022"]);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), [
    "Strengthen Singapore's international standing as a trusted hub for AI and DC investments;",
    "Make significant contributions to Singapore's economic objectives through investments;",
    "Accelerate the use of green energy, to realise the broader goals of sustainable development.",
  ]);
  assert.equal(checkClaims(result.fields, passages).dropped.length, 0);

  const dateline = capture.replace("25 May 2022 | 6 mins read\n\n", "");
  const d = extractHtml(c, dateline, withPassages(c, dateline).passages, { snapshotDate: "2026-10-15", format: "text" });
  assert.ok(d.ok);
  assert.equal(d.fields.published, "2025-12-01");
});

test("a proposed regulation ('would take effect on ...') is proposed, with no status date, even if the date has passed or is ahead", () => {
  const c = candidate({ id: "ca-cppa-oops-rulemaking-2026", type: "regulation" });
  for (const date of ["January 1, 2020", "January 1, 2030"]) {
    const html = fixture("regulation.html").replace("The regulations take effect on January 1, 2026.", `The regulations would take effect on ${date}.`);
    const r = run(c, html).result;
    assert.ok(r.ok);
    assert.equal(r.fields.status.value, "proposed", date);
    assert.equal(r.fields.statusDate, undefined);
    assert.deepEqual(r.fields.timeline.map((t) => t.event), ["Published"]);
  }
});

test("a description that joins a call-out paragraph and the lead (as the Attorney General's pages do) is not the summary: the lead paragraph is", () => {
  const lead = `OAKLAND — The Attorney General announced an investigation into the practices of a company. ${words(30)}.`;
  const callout = "Potential victims can file a complaint at oag.ca.gov/report";
  const html = page(`<meta name="description" content="${callout} ${lead.slice(0, 120)}">`, `<h1>T</h1><p>${callout}</p><p>${lead}</p>`);
  const { result, passages } = run(press(), html);
  assert.ok(result.ok);
  assert.equal(result.fields.summary.value, lead);
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});

test("a heading with no text under it is not a provision (it is in no passage), nor is a heading that is only marks", () => {
  const html = page("", `<h1>Title of page</h1><p>${words(40)}.</p><h2>Parliament Sitting on 3 March 2026</h2><h2>Duties of the operator</h2><p>${words(5)}</p><h2>#</h2><p>text</p><h2># #</h2><p>text</p>`);
  const { result, passages } = run(press(), html);
  assert.ok(result.ok);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), ["Duties of the operator"]);
  assert.equal(checkClaims(result.fields, passages).dropped.length, 0);
});

test("I2: a description that ends in an ellipsis and starts mid-paragraph falls back to the lead paragraph, and the record is still built", () => {
  const lead = `Regulations require operators to register with the commission before they trade. ${words(30, "lead")}.`;
  const second = `The commission explained that operators must keep records of every complaint they receive and must ${words(18, "keep")} for six years.`;
  const excerpt = second.slice(second.indexOf("operators must keep"), second.indexOf("operators must keep") + 90).trim();
  const html = page(`<meta name="description" content="${excerpt}…">`, `<h1>Rules</h1><p>${lead}</p><p>${second}</p>`);
  const { result, passages } = run(press(), html);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.fields.summary.value, lead);
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});

test("I2: such a description with no lead paragraph to fall back to is cited as the excerpt it is, and the record is still built", () => {
  const paragraph = "The commission explained that operators must keep records of every complaint they receive under the new regulations for six years.";
  const excerpt = "operators must keep records of every complaint they receive under the new regulations for six years";
  assert.ok(paragraph.split(/\s+/).length < 25, "no paragraph of 25 words: no lead");
  const { result, passages } = run(press(), page(`<meta name="description" content="${excerpt}…">`, `<h1>Rules</h1><p>${paragraph}</p>`));
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.fields.summary.value, excerpt);
  assert.equal(checkClaims(result.fields, passages).fatal, undefined);
});
