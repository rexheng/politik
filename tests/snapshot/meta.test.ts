import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { htmlToText } from "../../photon/scripts/snapshot/extract.ts";
import { htmlPageText, nextPayload, pageBlocks, pageMeta, ssoFacts } from "../../photon/scripts/snapshot/meta.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/extract/${name}`, import.meta.url), "utf8");
const words = (n: number, label = "w") => Array.from({ length: n }, (_, i) => `${label}${i}`).join(" ");
const page = (head: string, body = "<p>Body</p>") => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

// ---------------------------------------------------------------------------------------------------------------------
// pageMeta: description

test("pageMeta description: attribute order and quote style do not matter", () => {
  const d = words(15);
  assert.equal(pageMeta(page(`<meta content='${d}' name='description'>`)).description, d);
  assert.equal(pageMeta(page(`<meta name="description" content="${d}" />`)).description, d);
  assert.equal(pageMeta(page(`<META NAME="Description" CONTENT="${d}">`)).description, d);
});

test("pageMeta description decodes entities and collapses whitespace", () => {
  const out = pageMeta(page(`<meta name="description" content="Rules  on AI &amp; data\n  protection&#8217;s scope, for  ${words(12)}">`)).description;
  assert.equal(out, `Rules on AI & data protection’s scope, for ${words(12)}`);
});

test("pageMeta description needs 15 words after decoding: 14 gives undefined", () => {
  assert.equal(pageMeta(page(`<meta name="description" content="${words(14)}">`)).description, undefined);
  assert.equal(pageMeta(page(`<meta name="description" content="${words(13)} a&amp;b">`)).description, undefined); // 14 words once decoded
  assert.equal(pageMeta(page(`<meta name="description" content="${words(14)}">`)).description, undefined);
});

test("pageMeta description falls through from a short name=description to a long og:description", () => {
  const d = words(20);
  assert.equal(pageMeta(page(`<meta name="description" content="Too short"><meta property="og:description" content="${d}">`)).description, d);
  assert.equal(pageMeta(page(`<meta property="og:description" content="${words(16, "og")}"><meta name="description" content="${d}">`)).description, d);
});

test("pageMeta description: a lone space, a missing tag and a page without a head give undefined", () => {
  assert.equal(pageMeta(page(`<meta name="description" content=" "><meta property="og:description" content=" ">`)).description, undefined);
  assert.equal(pageMeta(page("")).description, undefined);
  assert.equal(pageMeta("").description, undefined);
});

// ---------------------------------------------------------------------------------------------------------------------
// pageMeta: published

test("pageMeta published: article:published_time gives the date as written", () => {
  assert.equal(pageMeta(page(`<meta property="article:published_time" content="2026-01-16T09:56:34-08:00">`)).published, "2026-01-16");
  assert.equal(pageMeta(page(`<meta property="article:published_time" content="2026-09-18T23:30:17+00:00">`)).published, "2026-09-18");
});

test("pageMeta published: the other meta names are read in order, and an invalid value falls through", () => {
  for (const tag of [
    `<meta name="date" content="2025-03-04">`,
    `<meta name="dcterms.date" content="2025-03-04">`,
    `<meta name="DC.date.issued" content="2025-03-04">`,
    `<meta name="publish-date" content="March 4, 2025">`,
    `<meta name="pubdate" content="4 March 2025">`,
    `<meta itemprop="datePublished" content="2025-03-04T10:00:00Z">`,
  ]) {
    assert.equal(pageMeta(page(tag)).published, "2025-03-04", tag);
  }
  assert.equal(pageMeta(page(`<meta property="article:published_time" content="not a date"><meta name="date" content="2025-03-04">`)).published, "2025-03-04");
});

test("pageMeta published: JSON-LD datePublished is used, also inside @graph, and dateModified is ignored", () => {
  const flat = `<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2024-07-01T08:00:00+08:00","dateModified":"2026-01-01T00:00:00Z"}</script>`;
  assert.equal(pageMeta(page(flat)).published, "2024-07-01");
  const graph = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"x"},{"@type":"WebPage","datePublished":"2026-09-18T15:08:17+00:00","dateModified":"2026-09-19T19:56:32+00:00"}]}</script>`;
  assert.equal(pageMeta(page(graph)).published, "2026-09-18");
  const onlyModified = `<script type="application/ld+json">{"@type":"WebPage","dateModified":"2026-07-30T17:22:15.848Z"}</script>`;
  assert.equal(pageMeta(page(onlyModified)).published, undefined);
  assert.equal(pageMeta(page(`<script type="application/ld+json">{ broken json</script><meta name="date" content="2025-03-04">`)).published, "2025-03-04");
});

test("pageMeta published: modified dates are never used", () => {
  assert.equal(pageMeta(page(`<meta property="article:modified_time" content="2026-01-16T12:21:53-08:00">`)).published, undefined);
  assert.equal(pageMeta(page(`<meta property="og:updated_time" content="2026-01-16T12:21:53-08:00">`)).published, undefined);
  assert.equal(
    pageMeta(page(`<meta property="article:modified_time" content="2026-02-01T00:00:00Z"><meta property="article:published_time" content="2025-12-30T00:00:00Z">`)).published,
    "2025-12-30",
  );
});

test("pageMeta published: the OAG release-date span gives its content date", () => {
  const span = `<div class="field field-name-field-release-date"><div class="field-items"><div class="field-item even"><span property="dc:date" content="2026-01-16T00:00:00-08:00" class="date-display-single">Friday, January 16, 2026</span></div></div></div>`;
  assert.equal(pageMeta(page("", span)).published, "2026-01-16");
});

test("pageMeta published: a <time datetime> is the last resort", () => {
  assert.equal(pageMeta(page("", `<p>Posted <time datetime="2025-12-17">17 December 2025</time></p>`)).published, "2025-12-17");
  assert.equal(pageMeta(page("", `<time>no datetime</time>`)).published, undefined);
});

test("pageMeta published: release-oag.html gives the date part of article:published_time", () => {
  assert.equal(pageMeta(fixture("release-oag.html")).published, "2026-01-16");
});

test("pageMeta published: the IMDA Next.js payload gives its publish_date", () => {
  assert.equal(pageMeta(fixture("release-imda-next.html")).published, "2022-05-25");
});

test("pageMeta published: the Isomer template's date paragraph after the h1, and not its dateModified", () => {
  assert.equal(pageMeta(fixture("release-isomer.html")).published, "2024-10-01");
  assert.equal(pageMeta(page("", `<h1>Title</h1><p>Some text</p><p>5 March 2024</p>`)).published, "2024-03-05");
  assert.equal(pageMeta(page("", `<p>1 January 2020</p><h1>Title</h1><p>Some intro words here.</p>`)).published, undefined); // before the h1
});

test("pageMeta published: the PDPC hub page's 'Published on' banner is the hub's date, not the document's", () => {
  assert.equal(pageMeta(fixture("hub-pdpc.html")).published, undefined);
  assert.equal(pageMeta(page("", `<span class="page-banner__date">Published on 03 Nov 2023</span>`)).published, undefined);
});

test("pageMeta of a page with no dates is undefined for published", () => {
  assert.deepEqual(pageMeta(page("<title>x</title>")), {});
});

// ---------------------------------------------------------------------------------------------------------------------
// nextPayload

test("nextPayload decodes the IMDA payload: title, written date and the section texts, with referenced text rows resolved", () => {
  const next = nextPayload(fixture("release-imda-next.html"));
  assert.ok(next);
  assert.equal(next.pageTitle, "Singapore launches world’s first AI testing framework and toolkit to promote transparency; Invites companies to pilot and contribute to international standards development");
  assert.equal(next.publishDate, "25 May 2022");
  const text = htmlToText(next.bodyHtml);
  assert.match(text, /^# Singapore remains at the forefront of international discourse on AI ethics\n\nSingapore has taken another step in the advancement of artificial intelligence \(AI\) by launching A\.I\. Verify - the world’s first/);
  assert.match(text, /# Objective and verifiable testing process for industry\n\nDevelopers and owners can verify the claimed performance/); // a "$48" reference
  assert.match(text, /# Organisations invited to participate in pilot\n\nAs AI governance and testing is nascent/);
  assert.ok(!text.includes("cookies"), "the cookie banner's content is not the body");
});

test("nextPayload reads a body held in a referenced text row under `content` (PDPC), and takes no page title or date from the banner", () => {
  const next = nextPayload(fixture("hub-pdpc.html"));
  assert.ok(next);
  assert.equal(next.pageTitle, undefined);
  assert.equal(next.publishDate, undefined);
  assert.match(htmlToText(next.bodyHtml), /On 21 January 2020, the PDPC released the second edition of the Model Framework\./);
});

test("nextPayload is null for a page without a payload, or with one that holds no body", () => {
  assert.equal(nextPayload(fixture("release-oag.html")), null);
  assert.equal(nextPayload(page(`<script>self.__next_f.push([1,"1:\\"$Sreact.fragment\\"\\n"])</script>`)), null);
  assert.equal(nextPayload(page(`<script>self.__next_f.push([1,"unfinished`)), null);
});

test("I2: publish_date is taken only from the object that also carries page_title, not from a related-news card before it", () => {
  const rows = (...objects: object[]) => objects.map((o, i) => `${i + 5}:["$","div",null,{"data":${JSON.stringify(o)}}]\n`).join("");
  const card = { title: "An older release", publish_date: "3 March 2020", content: "<p>Card text</p>" };
  const own = { page_title: "The page's own title", publish_date: "25 May 2022", section_description: "<p>Body of the page.</p>" };
  const html = (stream: string) => page(`<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`);
  const both = nextPayload(html(rows(card, own)));
  assert.ok(both);
  assert.equal(both.publishDate, "25 May 2022");
  assert.equal(both.pageTitle, "The page's own title");
  assert.equal(pageMeta(html(rows(card, own))).published, "2022-05-25");
  // only the card carries a date: the page has none
  const onlyCard = nextPayload(html(rows(card, { section_description: "<p>Body of the page.</p>" })));
  assert.ok(onlyCard);
  assert.equal(onlyCard.publishDate, undefined);
  assert.equal(pageMeta(html(rows(card, { section_description: "<p>Body of the page.</p>" }))).published, undefined);
});

test("nextPayload counts a text row's length in UTF-8 bytes", () => {
  const stream = `5:["$","div",null,{"data":{"section_description":"$a"}}]\na:T${Buffer.byteLength("<p>café — ünïcode ✓ text</p>").toString(16)},<p>café — ünïcode ✓ text</p>6:["$","div",null,{"data":{"section_description":"<p>after</p>"}}]\n`;
  const html = page(`<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`);
  const next = nextPayload(html);
  assert.ok(next);
  assert.equal(htmlToText(next.bodyHtml), "café — ünïcode ✓ text\n\nafter");
});

// ---------------------------------------------------------------------------------------------------------------------
// ssoFacts

test("ssoFacts of a revised edition: long title without the amendment cite, in two pieces; commencement; no assent; ten Parts", () => {
  const facts = ssoFacts(fixture("sso-revised-act.html"));
  assert.ok(facts);
  assert.equal(
    facts.longTitle,
    "An Act to govern the collection, use and disclosure of personal data by organisations, and to establish the Do Not Call Register and to provide for its administration, and for matters connected therewith.",
  );
  assert.ok(!facts.longTitle!.includes("[22/2016]"));
  assert.deepEqual(facts.longTitleParts, [
    "An Act to govern the collection, use and disclosure of personal data by organisations, and to establish the Do Not Call Register",
    "and to provide for its administration, and for matters connected therewith.",
  ]);
  assert.deepEqual(facts.commencement, { date: "2013-01-02", written: "2 January 2013" });
  assert.equal(facts.assent, undefined);
  const parts = facts.toc.filter((e) => e.kind === "part");
  assert.equal(parts.length, 10);
  assert.equal(parts[3]!.text, "Part 4 COLLECTION, USE AND DISCLOSURE OF PERSONAL DATA");
  assert.equal(parts[6]!.text, "Part 6A NOTIFICATION OF DATA BREACHES");
  assert.ok(!parts.some((p) => /^Part [78]$/.test(p.text)), "repealed Parts with no title are skipped");
  assert.ok(!facts.toc.some((e) => e.text.startsWith("Division")), "divisions are not Parts");
  const sections = facts.toc.filter((e) => e.kind === "section");
  assert.ok(sections.some((s) => s.text === "13 Consent required"));
  assert.equal(facts.toc[0]!.text, "Part 1 PRELIMINARY"); // document order: a Part, then its sections
  assert.equal(facts.toc[1]!.text, "1 Short title");
});

test("ssoFacts of an original-format Act: assent and commencement from PADate, sigDate and cDateL", () => {
  const facts = ssoFacts(fixture("sso-original-act.html"));
  assert.ok(facts);
  assert.deepEqual(facts.assent, { date: "2025-11-25", written: "25 November 2025" });
  assert.deepEqual(facts.commencement, { date: "2026-06-29", written: "29 June 2026" });
  assert.match(facts.longTitle!, /^An Act to provide persons affected by online harmful activity/);
  assert.equal(facts.longTitleParts.length, 1);
  assert.equal(facts.toc.filter((e) => e.kind === "part").length, 2);
});

test("ssoFacts takes the assent date from sigDate when there is no PADate, and the first dated commencement row", () => {
  const html = `<div class="front"><div class="sigDate"> 3 June 2019.</div><div class="cDateL">Date of Commencement: to be notified</div><div class="cDateL">Date of Commencement: 2 October 2019 Sections 1 to 5</div><table><tr><td class="longTitle">An Act to prevent things.</td></tr></table></div>`;
  const facts = ssoFacts(html);
  assert.deepEqual(facts?.assent, { date: "2019-06-03", written: "3 June 2019" });
  assert.deepEqual(facts?.commencement, { date: "2019-10-02", written: "2 October 2019" });
  assert.deepEqual(facts?.toc, []);
});

test("ssoFacts of a page with none of the elements is null", () => {
  assert.equal(ssoFacts(fixture("release-oag.html")), null);
  assert.equal(ssoFacts(""), null);
  assert.equal(ssoFacts("<p>An Act to do something.</p>"), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// pageBlocks and htmlPageText

test("pageBlocks adds the page description when the body does not hold it", () => {
  const d = `Rules about ${words(18)}`;
  const html = page(`<meta name="description" content="${d}">`, `<p>${words(30, "b")}</p>`);
  assert.equal(pageBlocks(html, htmlToText(html)), `# Page description\n\n${d}`);
});

test("pageBlocks leaves the description out when the body already holds it, even if the description was cut off with an ellipsis", () => {
  const d = `Rules about ${words(18)}`;
  const html = page(`<meta name="description" content="${d}">`, `<p>${d} and then the paragraph goes on.</p>`);
  assert.equal(pageBlocks(html, htmlToText(html)), "");
  const cut = page(`<meta name="description" content="${d}…">`, `<p>${d} and then the paragraph goes on.</p>`);
  assert.equal(pageBlocks(cut, htmlToText(cut)), "");
  assert.equal(pageBlocks(page(`<meta name="description" content="${words(14)}">`), "unrelated body"), ""); // 14 words
});

test("pageBlocks gives an SSO page a Contents block of one paragraph per entry the body lacks, and none when the body holds them", () => {
  const html = fixture("sso-revised-act.html");
  const body = htmlToText(html);
  const blocks = pageBlocks(html, body);
  assert.ok(blocks.startsWith("# Contents\n\n"));
  assert.ok(blocks.includes("\n\n13 Consent required\n\n"), blocks);
  assert.ok(!blocks.includes("Part 4 COLLECTION"), "the Part headings are in the body already");
  const paragraphs = blocks.split("\n\n").slice(1);
  assert.equal(new Set(paragraphs).size, paragraphs.length);
  const facts = ssoFacts(html)!;
  assert.equal(pageBlocks(html, facts.toc.map((e) => e.text).join("\n\n")), "");
  assert.equal(pageBlocks(html, "nothing here").split("\n\n").length, 1 + facts.toc.length);
  assert.equal(pageBlocks(html, "nothing here").includes("# Page description"), false); // the SSO site's description is 8 words
});

test("pageBlocks of a page with neither is empty", () => {
  assert.equal(pageBlocks(page("<title>t</title>"), "body"), "");
  assert.equal(pageBlocks("", ""), "");
});

test("htmlPageText puts the blocks in front of the body, and counts a payload body for a Next.js page", () => {
  const imda = htmlPageText(fixture("release-imda-next.html"));
  assert.ok(imda.text.endsWith(imda.body));
  assert.ok(imda.body.startsWith("# Singapore launches world’s first AI testing framework"), imda.body.slice(0, 200));
  assert.ok(imda.body.includes("Singapore has taken another step in the advancement of artificial intelligence"));
  assert.ok(imda.body.includes("25 May 2022"), "the visible page's own text is kept after the payload's");
  assert.ok(imda.text.startsWith("# Page description\n\nSingapore launches world's first AI testing toolkit"));

  const plain = htmlPageText(fixture("release-oag.html"));
  assert.equal(plain.body, htmlToText(fixture("release-oag.html"), { bullets: true }));
  assert.equal(plain.text, plain.body); // the description (cut at …) is the start of the lead paragraph
  assert.ok(plain.body.includes("• Creating, disclosing, or publicizing digitized sexually explicit material"));
});

test("htmlPageText uses the payload only when the visible page lacks the body", () => {
  const hub = htmlPageText(fixture("hub-pdpc.html"));
  assert.ok(hub.body.startsWith("# Singapore’s Approach to AI Governance\n\nAs Singapore develops its digital economy"), hub.body.slice(0, 200));
  assert.ok(hub.body.includes("On 21 January 2020, the PDPC released the second edition of the Model Framework."));
  const visible = `<h1>Title</h1><p>${words(60, "v")}</p>`;
  const stream = `5:["$","div",null,{"data":{"section_description":"<p>${words(10, "p")}</p>"}}]\n`;
  const html = page(`<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`, visible);
  assert.equal(htmlPageText(html).body, htmlToText(html, { bullets: true }));
});
