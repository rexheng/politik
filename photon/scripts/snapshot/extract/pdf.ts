// PDFs (the text `pdfToText` makes of a report, a framework, a notice or an order) (spec 5.3).
//
// A PDF's text keeps its line breaks and rarely has a blank line, so a "paragraph" is the lines up to a blank line or up to a line
// that stops short of the right margin (see `pdfParagraphs`), joined by single spaces as `splitPassages` joins them. The summary is the first paragraph under a bare heading line (`Executive
// summary`, `Summary`, `Abstract`, `Overview`, `Introduction`, numbered or not; for a regulation also `Informative Digest`), else the first paragraph
// of running text with at least 25 words (not a cover, a table or a table of contents), cut after a whole sentence at 150 words. A PDF has no meta data, so there is no `published` date;
// an executive order is dated by its closing clause and a regulation by a stated effective date.
// Node-only build code: never import this from photon/src.
import type { Passage } from "../../../src/data/schema.ts";
import type { Candidate } from "../candidates.ts";
import { wordCount } from "../passages.ts";
import {
  bulletItems,
  isProse,
  pdfParagraphs,
  capSentences,
  documentStatus,
  eoShortTitle,
  FULL_LINE_SHARE,
  isWholeItem,
  marginWidth,
  HEADING_MIN_WORDS,
  LIST_ITEM_MIN_WORDS,
  noSummary,
  normalise,
  quote,
  type Cited,
  type ExtractMeta,
  type ExtractResult,
} from "./common.ts";

/** A bare line that names the section whose first paragraph is the summary. */
const LABEL = String.raw`(?:(?:PART|SECTION|CHAPTER)\s+[IVXLC\d]+\s*[:.\u2013\u2014-]\s*)?`; // "PART I: EXECUTIVE SUMMARY"
const SUMMARY_HEADING = new RegExp(String.raw`^(?:\d+(?:\.\d+)*\.?\s+)?${LABEL}(?:Executive Summary|Summary|Abstract|Overview|Introduction)\s*$`, "i");
const DIGEST_HEADING = /^INFORMATIVE DIGEST(?:\s*\/\s*POLICY STATEMENT OVERVIEW)?\s*:?\s*$/i;
/** `3.1 Scope of the guidelines`: a numbered heading, as opposed to a numbered sentence or a contents line (which ends in a page number). */
const NUMBERED_HEADING = /^\d+(?:\.\d+)*\.?\s+([A-Z][^\n]{2,90}[^\s.;,:\d])$/;
const GENERIC_NUMBERED = new Set(["introduction", "overview", "background", "summary", "conclusion", "references", "contents", "acknowledgements", "appendix"]);
const MAX_HEADING_WORDS = 12;
/** "1 November 2021 and remains ..." is a date inside a sentence, not heading 1. */
const MONTH_START = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/;

/** The first paragraph of running text (see `isProse`) after the first line that is the heading. */
function paragraphUnder(text: string, paragraphs: Paragraph[], heading: RegExp): Paragraph | undefined {
  let offset = 0;
  for (const raw of text.split("\n")) {
    const end = offset + raw.length;
    if (heading.test(raw.trim())) return paragraphs.find((p) => p.start > end && isProse(p.text));
    offset = end + 1;
  }
  return undefined;
}

type Paragraph = ReturnType<typeof pdfParagraphs>[number];

/** True when the next non-empty line after `lines[index]` starts in lower case: the line before it was wrapped, not ended. */
function continuesBelow(lines: string[], index: number): boolean {
  for (let i = index + 1; i < lines.length; i++) {
    const next = lines[i]!.trim();
    if (next !== "") return /^\p{Ll}/u.test(next);
  }
  return false;
}

/** Up to 4 provisions: whole bullet lines of at least 6 words (at least two; a wrapped fragment is not one, R40), else the numbered headings, without their numbers. */
function pdfProvisions(text: string, passages: Passage[]): Cited[] {
  // A bullet that starts in lower case or stops without closing punctuation is a wrapped line, not a statement (R40).
  const bullets = bulletItems(text).filter((b) => wordCount(b) >= LIST_ITEM_MIN_WORDS && isWholeItem(b));
  if (bullets.length >= 2) return [...new Set(bullets)].slice(0, 4).map((value) => quote(passages, value));
  const lines = text.split(/\r?\n/);
  const width = marginWidth(text);
  const headings = lines
    .map((l, i) => {
      const heading = NUMBERED_HEADING.exec(l.trim())?.[1];
      // The first line of a numbered paragraph that wraps is a fragment (R40), not a heading: it is not a whole item, and either the
      // next line carries on in lower case or the line itself runs to the right margin (a heading stops short of it).
      if (heading !== undefined && MONTH_START.test(heading)) return undefined;
      if (heading !== undefined && !isWholeItem(normalise(heading)) && (continuesBelow(lines, i) || l.trim().length >= width * FULL_LINE_SHARE)) return undefined;
      return heading;
    })
    .flatMap((h) => {
      if (!h) return [];
      const heading = normalise(h);
      const n = wordCount(heading);
      return n >= HEADING_MIN_WORDS && n <= MAX_HEADING_WORDS && !GENERIC_NUMBERED.has(heading.toLowerCase()) ? [heading] : [];
    });
  return [...new Set(headings)].slice(0, 4).map((value) => quote(passages, value));
}

export function extractPdf(c: Candidate, text: string, passages: Passage[], meta: ExtractMeta): ExtractResult {
  const paragraphs = pdfParagraphs(text);
  // For a regulation the Informative Digest comes first: it is the notice's own summary of what the rules do.
  const digest = c.type === "regulation" ? paragraphUnder(text, paragraphs, DIGEST_HEADING) : undefined;
  const chosen = digest ?? paragraphUnder(text, paragraphs, SUMMARY_HEADING) ?? paragraphs.find((p) => isProse(p.text));
  if (chosen === undefined) return noSummary();
  const summary = quote(passages, capSentences(chosen.text));
  const shortTitle = c.type === "executive-order" ? eoShortTitle(c.id) : undefined;

  return {
    ok: true,
    fields: {
      ...(shortTitle ? { shortTitle } : {}),
      ...documentStatus({ type: c.type, text, snapshotDate: meta.snapshotDate, passages, lead: summary.support }),
      summary,
      provisions: pdfProvisions(text.slice(chosen.start), passages), // lists before the summary are front matter
      affected: [],
    },
  };
}
