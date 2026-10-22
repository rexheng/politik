import assert from "node:assert/strict";
import { test } from "node:test";

import type { Passage } from "../../photon/src/data/schema.ts";
import {
  bulletItems,
  capSentences,
  cite,
  citeAll,
  findDates,
  leadParagraph,
  listProvisions,
  normalise,
  parseDate,
  pdfParagraphs,
  splitSentences,
  SUMMARY_MAX_WORDS,
} from "../../photon/scripts/snapshot/extract/common.ts";
import { toSections, wordCount } from "../../photon/scripts/snapshot/passages.ts";

const words = (n: number, label = "w") => Array.from({ length: n }, (_, i) => `${label}${i}`).join(" ");
const passage = (seq: number, text: string, heading?: string): Passage => ({
  id: `x#${seq}`,
  recordId: "x",
  seq,
  ...(heading !== undefined ? { heading } : {}),
  text,
});

test("normalise collapses runs of whitespace and trims", () => {
  assert.equal(normalise("a \n\t b  "), "a b");
  assert.equal(normalise(" x  y "), "x y");
  assert.equal(normalise(""), "");
});

test("parseDate reads the four date forms and the date as written, with no timezone shift", () => {
  assert.equal(parseDate("January 5, 2026"), "2026-01-05");
  assert.equal(parseDate("5 January 2026"), "2026-01-05");
  assert.equal(parseDate("5 Jan 2026"), "2026-01-05");
  assert.equal(parseDate("2026-01-05T09:56:34-08:00"), "2026-01-05");
  assert.equal(parseDate("2026-09-18T23:59:00-08:00"), "2026-09-18");
  assert.equal(parseDate("2026-01-05"), "2026-01-05");
});

test("parseDate also reads weekday prefixes, ordinals, zero-padded days, Sept and a trailing full stop", () => {
  assert.equal(parseDate("Friday, January 16, 2026"), "2026-01-16");
  assert.equal(parseDate("03 Nov 2023"), "2023-11-03");
  assert.equal(parseDate("6th September 2023"), "2023-09-06");
  assert.equal(parseDate("25 November 2025."), "2025-11-25");
  assert.equal(parseDate("Sept 3, 2024"), "2024-09-03");
  assert.equal(parseDate("Sep 18, 2026"), "2026-09-18");
});

test("parseDate gives undefined for an impossible date or text that is not a date", () => {
  assert.equal(parseDate("February 30, 2026"), undefined);
  assert.equal(parseDate("31 June 2026"), undefined);
  assert.equal(parseDate("2026-02-30"), undefined);
  assert.equal(parseDate("2026-13-01T00:00:00Z"), undefined);
  assert.equal(parseDate("soon"), undefined);
  assert.equal(parseDate(""), undefined);
  assert.equal(parseDate(undefined), undefined);
  assert.equal(parseDate("the 5 January 2026 meeting"), undefined);
});

test("findDates lists the dates written in a text, as written, in order, skipping impossible ones", () => {
  const found = findDates("Signed on 6 September 2023, effective January 1, 2024 (not 30 February 2024) and 2025-03-04.");
  assert.deepEqual(
    found.map((d) => [d.iso, d.written]),
    [
      ["2023-09-06", "6 September 2023"],
      ["2024-01-01", "January 1, 2024"],
      ["2025-03-04", "2025-03-04"],
    ],
  );
});

test("splitSentences splits after . ! ? and a capital, but not after Sec., Inc. and the other abbreviations", () => {
  const out = splitSentences("Sec. 22757.12 applies. This bill would add X. It also does Y.");
  assert.equal(out.length, 3);
  assert.deepEqual(out, ["Sec. 22757.12 applies.", "This bill would add X.", "It also does Y."]);

  assert.deepEqual(splitSentences("See Secs. 1 and 2, No. 5, Ch. 6, U.S. Dept. of Commerce, Cal. Gov. Code and Acme Inc. Then stop."), [
    "See Secs. 1 and 2, No. 5, Ch. 6, U.S. Dept. of Commerce, Cal. Gov. Code and Acme Inc. Then stop.",
  ]);
  assert.deepEqual(splitSentences("Is it so? Yes! It is."), ["Is it so?", "Yes!", "It is."]);
  assert.deepEqual(splitSentences("It rose by 3.5 percent. then fell"), ["It rose by 3.5 percent. then fell"]); // a lowercase start is not a new sentence
  assert.deepEqual(splitSentences("He said “stop.” Then he left."), ["He said “stop.”", "Then he left."]);
  assert.deepEqual(splitSentences("Mr. Smith and Dr. Jones met Acme Pte. Ltd. on Monday. They agreed."), ["Mr. Smith and Dr. Jones met Acme Pte. Ltd. on Monday.", "They agreed."]);
  assert.deepEqual(splitSentences(""), []);
});

test("capSentences keeps whole leading sentences within 150 words: a prefix of the input that ends on a sentence end", () => {
  assert.equal(SUMMARY_MAX_WORDS, 150);
  const sentences = Array.from({ length: 10 }, (_, i) => `S${i} ${words(18, "a")}.`); // 10 sentences of 19 words
  const input = `${sentences.join(" ")} X ${words(9, "c")}.`; // plus one of 10 words: 200 words in 11 sentences
  assert.equal(wordCount(input), 200);
  const out = capSentences(input);
  assert.ok(input.startsWith(out));
  assert.ok(out.endsWith("."));
  assert.ok(wordCount(out) <= 150, String(wordCount(out)));
  assert.equal(wordCount(out), 133); // 7 sentences of 19 words
  assert.equal(capSentences(input, 60), input.split(" ").slice(0, 57).join(" "));
});

test("capSentences returns a text of 150 words or fewer unchanged, and one over-long first sentence whole", () => {
  const short = "One sentence. Two sentences.";
  assert.equal(capSentences(short), short);
  const long = `${words(200)}.`;
  assert.equal(capSentences(long), long);
  assert.equal(capSentences(`${long} Next sentence here.`), long);
  assert.equal(capSentences("  padded text.  "), "padded text.");
});

test("cite returns every passage whose heading and text hold the needle, normalised", () => {
  const ps = [passage(1, "The operator must\nkeep records.", "Duties"), passage(2, "Records are kept for six years."), passage(3, "Nothing relevant.")];
  assert.deepEqual(cite(ps, "must keep   records"), ["x#1"]);
  assert.deepEqual(cite(ps, "Records"), ["x#2"]); // case-sensitive: passage 1 has lower-case "records"
  assert.deepEqual(cite(ps, "records"), ["x#1"]);
  assert.deepEqual(cite(ps, "kept"), ["x#2"]);
  const both = [passage(1, "same words here"), passage(2, "more same words here")];
  assert.deepEqual(cite(both, "same words"), ["x#1", "x#2"]);
});

test("cite finds a needle that is a passage's heading, and falls back to the first passage", () => {
  const ps = [passage(1, "Body one.", "First heading"), passage(2, "Body two.", "Second heading")];
  assert.deepEqual(cite(ps, "Second heading"), ["x#2"]);
  assert.deepEqual(cite(ps, "absent text"), ["x#1"]);
  assert.deepEqual(cite([], "anything"), []);
});

test("citeAll unites the passages for several parts, in passage order, with no duplicates", () => {
  const ps = [passage(1, "agency one"), passage(2, "supplier two"), passage(3, "agency one and supplier two")];
  assert.deepEqual(citeAll(ps, ["supplier two", "agency one"]), ["x#1", "x#2", "x#3"]);
  assert.deepEqual(citeAll(ps, ["supplier two"]), ["x#2", "x#3"]);
  assert.deepEqual(citeAll(ps, []), ["x#1"]);
});

test("leadParagraph is the first paragraph of 25 or more words, skipping boilerplate and page-description blocks", () => {
  const text = [
    "Short intro line.",
    `This article has been migrated from an earlier version of the site. ${words(30)}`,
    `Skip to main content ${words(30)}`,
    `We use cookies to improve your experience. ${words(30)}`,
    "# Page description",
    `A description paragraph that is in the metadata only. ${words(30)}`,
    "# Heading",
    `The real lead paragraph starts here. ${words(24)}`,
    `A later paragraph. ${words(40)}`,
  ].join("\n\n");
  assert.equal(leadParagraph(toSections(text)), `The real lead paragraph starts here. ${words(24)}`);
  assert.equal(leadParagraph(toSections(`Short.\n\n${words(24)}`)), undefined);
  assert.equal(leadParagraph(toSections(words(25))), words(25));
});

test("listProvisions prefers bullets (at least 2 of 6 or more words) and caps at 4", () => {
  const sections = toSections(
    [
      "# Heading one",
      "• Operators must register with the commission before trading",
      "• Short bullet",
      "• Operators must keep records of every complaint for six years",
      "- Platforms shall publish a transparency report every year",
      "– Regulators may inspect any platform without prior notice",
      "• A fifth bullet that is long enough to be a provision here",
      "# Heading two",
      "Plain paragraph text that is not a bullet at all but is long enough.",
    ].join("\n\n"),
  );
  assert.deepEqual(listProvisions(sections), [
    "Operators must register with the commission before trading",
    "Operators must keep records of every complaint for six years",
    "Platforms shall publish a transparency report every year",
    "Regulators may inspect any platform without prior notice",
  ]);
  assert.equal(listProvisions(sections, 2).length, 2);
});

test("listProvisions leaves out the labels of a parliamentary question page: Question for Oral Answer, Question for Written Answer, Answer", () => {
  const sections = toSections(["# Question for Oral Answer", "text", "# Question for Written Answer", "text", "# Answer", "text", "# Detection and response capabilities", "text"].join("\n\n"));
  assert.deepEqual(listProvisions(sections), ["Detection and response capabilities"]);
});

test("listProvisions does not take a download link (an item that ends in a file size) for a provision", () => {
  const sections = toSections(
    [
      "# Launch of the framework",
      "text",
      "# Why it matters to companies",
      "text",
      "• Annex A: Quotes from Industry and Partners (102.56KB)",
      "• Annex B: Background on Singapore's AI governance work (260.39 KB)",
      "• Annex C: Summary of key parameters and criteria for applicants (1.4MB)",
    ].join("\n\n"),
  );
  assert.deepEqual(listProvisions(sections), ["Launch of the framework", "Why it matters to companies"]);
  const mixed = toSections(["• Operators must register with the commission before trading", "• Annex A: A long list of the participating bodies (12 KB)", "• Operators must keep records of every complaint for six years"].join("\n\n"));
  assert.deepEqual(listProvisions(mixed), ["Operators must register with the commission before trading", "Operators must keep records of every complaint for six years"]);
  const inSentence = toSections(["• The publication of the Evaluation Report (1.41MB), so that we understand how models perform", "• The release of a Joint Testing Report in collaboration with Japan"].join("\n\n"));
  assert.equal(listProvisions(inSentence).length, 2, "a size in the middle of a sentence is part of the sentence");
});

test("listProvisions falls back to non-generic headings of 2 or more words when fewer than 2 bullets qualify", () => {
  const sections = toSections(
    [
      "# Overview",
      "text",
      "# Penalties for non-compliance",
      "• Only one bullet with enough words to qualify as one",
      "# Scope",
      "text",
      "# Who must register",
      "text",
      "# Contact",
      "text",
      "# Reporting duties of operators",
      "text",
      "# Duty of care owed to users",
      "text",
      "# Enforcement and appeals",
      "text",
    ].join("\n\n"),
  );
  assert.deepEqual(listProvisions(sections), ["Penalties for non-compliance", "Who must register", "Reporting duties of operators", "Duty of care owed to users"]);
  assert.deepEqual(listProvisions(toSections("no bullets or headings in this text at all")), []);
  assert.deepEqual(listProvisions(sections, 4, ["penalties for NON-compliance"]), ["Who must register", "Reporting duties of operators", "Duty of care owed to users", "Enforcement and appeals"]);
});

test("bulletItems joins a bullet's wrapped lines while they reach the margin, drops the marker and stops at a blank line, the next marker or a short line", () => {
  const text = [
    "Title line",
    "• First bullet that wraps because its first line reaches the right margin of the page",
    "onto a second line.",
    "• Second bullet.",
    "A new sentence on the next line is not part of the bullet.",
    "",
    "A paragraph after a blank line.",
    "- Dash bullet one",
    "– En dash bullet",
    "",
    "-not a bullet because there is no space",
  ].join("\n");
  assert.deepEqual(bulletItems(text), [
    "First bullet that wraps because its first line reaches the right margin of the page onto a second line.",
    "Second bullet.",
    "Dash bullet one",
    "En dash bullet",
  ]);
});

test("bulletItems leaves out a link to a download: an item that ends in a file size", () => {
  const text = ["Resources:", "- Annex A: Quotes from Industry and Partners (102.56KB)", "- Annex B: Background on the governance work (260.39 KB)", "- Operators must keep records of every complaint."].join("\n");
  assert.deepEqual(bulletItems(text), ["Operators must keep records of every complaint."]);
});

test("bulletItems does not run a bullet on into the text that follows it when the page has no blank lines", () => {
  const full = (label: string) => `${label} a line of text that runs all the way to the right margin of this page, yes`;
  const text = [
    full("Intro"),
    full("More"),
    `• ${full("First item")}`,
    "that wraps to a short last line",
    `• ${full("Second item")}`,
    "and its short last line",
    "PART IV: A HEADING THAT FOLLOWS THE LIST",
    full("Body"),
  ].join("\n");
  assert.deepEqual(bulletItems(text), [
    `${full("First item")} that wraps to a short last line`,
    `${full("Second item")} and its short last line`,
  ]);
});

test("splitSentences also splits before a paragraph number, as in a numbered report", () => {
  assert.deepEqual(splitSentences("1.1 The Act sets rules for data. 1.2 The Guidelines explain them. They apply to AI."), [
    "1.1 The Act sets rules for data.",
    "1.2 The Guidelines explain them.",
    "They apply to AI.",
  ]);
});

// Lines of 113 characters against a margin of 120: a line under 84 characters (70%) is a short one.
const full = (label: string) => `${label} ${"word ".repeat(22).trim()}`;

test("pdfParagraphs: a short line that stops mid-sentence (no closing punctuation, the next line lower-case) continues its paragraph", () => {
  const text = [
    full("One"),
    full("Two"),
    "Singapore believes in AI for Public Good, and its transformational potential to", // 79 characters: the next word did not fit
    "benefit the economy and society.", // the last line
    full("Three"),
    "A short last line.",
    "Next paragraph starts with a capital after a full stop.",
  ].join("\n");
  const paragraphs = pdfParagraphs(text, 120).map((p) => p.text);
  assert.equal(paragraphs.length, 3);
  assert.ok(paragraphs[0]!.endsWith("potential to benefit the economy and society."), paragraphs[0]);
  assert.ok(paragraphs[1]!.endsWith("A short last line."));
  assert.equal(paragraphs[2], "Next paragraph starts with a capital after a full stop.");
});

test("pdfParagraphs: a short line that ends a sentence, or is followed by a capital, still ends its paragraph", () => {
  const text = [full("A"), "Short line ends here.", "and a lower-case line follows", full("B"), "Short without a stop", "Capital line follows."].join("\n");
  const paragraphs = pdfParagraphs(text, 120).map((p) => p.text);
  assert.deepEqual(paragraphs, [`${full("A")} Short line ends here.`, "and a lower-case line follows", `${full("B")} Short without a stop`, "Capital line follows."]);
});

test("a page-number footer (`- 3 -`) is not a bullet and does not break a paragraph or an item that runs across the page", () => {
  const text = [full("Intro"), full("More"), "summer reliability benefits; the Commission authorised all utilities to", "- 3 -", "change the structure of residential bills.", "- 4 -", `• ${full("First item")}`, "- 5 -", "that wraps to a short last line", "• Second bullet is long enough to count as one."].join("\n");
  assert.deepEqual(bulletItems(text), [`${full("First item")} that wraps to a short last line`, "Second bullet is long enough to count as one."]);
  const paragraphs = pdfParagraphs(text, 120).map((p) => p.text);
  assert.ok(paragraphs.every((p) => !/- \d -/.test(p)), JSON.stringify(paragraphs));
  assert.ok(paragraphs.some((p) => p.includes("authorised all utilities to change the structure of residential bills.")), JSON.stringify(paragraphs));
});

test("splitSentences splits before a numbered digest item: '... as specified. (2) This bill would ...'", () => {
  assert.deepEqual(splitSentences("Existing law does X. (2) This bill would add Y. (3) The bill would also do Z."), ["Existing law does X.", "(2) This bill would add Y.", "(3) The bill would also do Z."]);
  assert.deepEqual(splitSentences("See Sec. 5(a) of the Act."), ["See Sec. 5(a) of the Act."]);
  assert.deepEqual(splitSentences("It is set out in Art. IV of the Constitution. Then stop."), ["It is set out in Art. IV of the Constitution.", "Then stop."]);
});

test("capSentences drops a trailing lead-in sentence that ends in a colon, and the dangling 'and' of a recital that ends '; and'", () => {
  const body = "Last year, the Prime Minister launched Smart Nation 2.0, a refresh of our vision for Singapore to use technology to uplift the lives of our people.";
  assert.equal(capSentences(`2. ${body} Today, I will elaborate on our efforts in four areas:`), `2. ${body}`);
  assert.equal(capSentences("The categories of harmful content include:"), "The categories of harmful content include:", "a lone lead-in is all there is");
  const recital = 'WHEREAS the State is a global leader in innovation; and WHEREAS Generative Artificial Intelligence ("GenAI") represents a significant leap forward in technology, which will transform the way that the State conduct business and serve the public; and';
  assert.equal(capSentences(recital), recital.slice(0, -" and".length));
  assert.equal(capSentences("A recital that ends with a full stop; and then goes on."), "A recital that ends with a full stop; and then goes on.");
  // a cut at 150 words that ends on a lead-in drops it too
  const long = Array.from({ length: 9 }, (_, i) => `Sentence ${i} ${words(14, "x")}.`).join(" ");
  const withLead = `${long} The areas are as follows:`;
  assert.ok(!capSentences(withLead, 120).endsWith(":"));
});

test("a bare paragraph number ('4.') is not a sentence: it stays with the sentence it numbers, and a dropped lead-in takes its number with it", () => {
  assert.deepEqual(splitSentences("3. This Code sets outcomes. 4. The categories of harmful content include:"), ["3. This Code sets outcomes.", "4. The categories of harmful content include:"]);
  const text = "3. This Code specifies outcomes that Services have to meet to enhance online user safety, particularly for children. 4. The categories of harmful content include:";
  assert.equal(capSentences(text), "3. This Code specifies outcomes that Services have to meet to enhance online user safety, particularly for children.");
  assert.equal(splitSentences("It rose in 2024. Then it fell.").length, 2, "a year is not a paragraph number");
});

test("R37: a number is a paragraph number only when it is all the sentence has so far: '... Assembly Bill 56. This bill would also ...' ends a sentence", () => {
  assert.deepEqual(splitSentences("Existing law is amended by Assembly Bill 56. This bill would also require a report."), ["Existing law is amended by Assembly Bill 56.", "This bill would also require a report."]);
  assert.deepEqual(splitSentences("It cites Section 5. Then it stops. 4. A numbered paragraph follows."), ["It cites Section 5.", "Then it stops.", "4. A numbered paragraph follows."]);
  assert.deepEqual(splitSentences("4. The first paragraph is numbered. 5. So is the next."), ["4. The first paragraph is numbered.", "5. So is the next."]);
});

test("R37: capSentences drops a trailing fragment with no closing punctuation when a full sentence remains, and keeps a lone one", () => {
  const lead = "This page sets out the specific provisions and timeline with which all owners are required to comply, and the dates apply only to existing owners.";
  assert.equal(capSentences(`${lead} Version No. Compliance Date Section and Clause References`), lead);
  assert.equal(capSentences(`${lead} The table that follows`), lead);
  assert.equal(capSentences("Version No. Compliance Date Section and Clause References"), "Version No. Compliance Date Section and Clause References", "a lone fragment is all there is");
  assert.equal(capSentences(`${lead} “Quoted end.”`), `${lead} “Quoted end.”`);
  assert.equal(capSentences("First. Second (ends in a bracket)"), "First.", "no terminal punctuation, not even a bracket, is a fragment");
});
