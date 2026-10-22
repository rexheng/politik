// Releases, guidance, frameworks, regulations and executive orders that are web pages (or a text capture of one) (spec 5.3).
//
// The summary is the page's own words, in this order: the meta description, when it has at least 15 words and is not generic
// (R26: marketing lines such as "Learn more about ..." say nothing about the document); a description that is cut off, as
// the Attorney General's pages cut theirs, is replaced by the whole paragraph it starts. Otherwise the lead paragraph, the
// first paragraph of the page with at least 25 words that is not boilerplate. Either way at most 150 words, cut after a whole
// sentence. The dates come from the page's meta data (meta.ts); a text capture has none, but may print a date under its title.
// Node-only build code: never import this from photon/src.
import type { Passage } from "../../../src/data/schema.ts";
import type { Candidate } from "../candidates.ts";
import { pageMeta } from "../meta.ts";
import { toSections, wordCount, type Section } from "../passages.ts";
import {
  bodySections,
  bulletItems,
  capSentences,
  documentStatus,
  eoShortTitle,
  findDates,
  LIST_ITEM_MIN_WORDS,
  leadParagraph,
  listProvisions,
  noSummary,
  normalise,
  quote,
  type Cited,
  type ExtractMeta,
  type ExtractResult,
  type WrittenDate,
} from "./common.ts";

/** Phrases that mark a description as marketing copy. */
const MARKETING = /\b(?:learn more|find out|discover|read more|click here|welcome to|explore our)\b/i;
/**
 * A description names a document when it names an instrument or an action on one. These are the words that do (law and
 * regulation, guidance, enforcement and its results); a description with none of them is a site's tagline or a teaser.
 */
const POLICY_NOUNS =
  /\b(?:acts?|bills?|laws?|legislation|statutes?|regulations?|regulatory|rules?|rulemaking|polic(?:y|ies)|frameworks?|guidelines?|guidance|strateg(?:y|ies)|roadmap|codes?|standards?|orders?|requirements?|obligations?|mandates?|directives?|settlements?|lawsuits?|investigations?|enforcement|penalt(?:y|ies)|fines?|consultation|advisory|advisories|rulings?|decisions?|injunctions?|subpoenas?|complaints?|proposals?|amendments?|executive order|cease and desist)\b/i;

/** True for a meta description that is no summary of the document (R26): a marketing phrase, or no policy noun at all. */
export function isGenericDescription(description: string): boolean {
  return MARKETING.test(description) || !POLICY_NOUNS.test(description);
}

const ELLIPSIS = /\s*(?:…|\.\.\.)$/;
const SENTENCE_END = /[.!?]["”’')\]]*$/;

/**
 * The summary of a page: its description if that is usable, else its lead paragraph. A description that is cut off (it ends
 * in an ellipsis, or ends mid-sentence and is the start of a longer paragraph) is replaced by that whole paragraph.
 */
export function pageSummary(sections: Section[], passages: Passage[], description: string | undefined): Cited | undefined {
  if (description && !isGenericDescription(description)) {
    const plain = normalise(description).replace(ELLIPSIS, "");
    const body = bodySections(sections);
    const paragraphs = body.flatMap((s) => s.paragraphs);
    // The Attorney General's regulation pages print the heading above the lead in front of their description ("Summary Signed
    // into law ..."): the description without that heading word is what the paragraph holds.
    const headings = body.flatMap((s) => (s.heading ? [normalise(s.heading)] : []));
    const forms = [plain, ...headings.filter((h) => plain.startsWith(`${h} `)).map((h) => plain.slice(h.length + 1))];
    const form = forms.find((f) => paragraphs.some((p) => p.includes(f)));
    // A description that is in the body only across paragraphs (the Attorney General's pages join a call-out and the lead)
    // is no excerpt of either: the lead paragraph is used. One that is not in the body at all is cited from its own section.
    if (form !== undefined || !paragraphs.join(" ").includes(plain)) {
      const text = form ?? plain;
      const whole = paragraphs.find((p) => p.startsWith(text) && p.length > text.length);
      const ellipsis = ELLIPSIS.test(normalise(description));
      const cutOff = ellipsis || !SENTENCE_END.test(text);
      if (whole && cutOff) return quote(passages, capSentences(whole));
      if (form !== undefined && form !== plain) return quote(passages, capSentences(form));
      // A description with an ellipsis that is in the body but not at the start of a paragraph is no whole sentence, and the
      // ellipsis is in no passage: the lead paragraph is the summary, else the excerpt itself (I2).
      if (ellipsis && form !== undefined) {
        const lead = leadParagraph(sections);
        return quote(passages, capSentences(lead ?? text));
      }
      return quote(passages, capSentences(normalise(description)));
    }
  }
  const lead = leadParagraph(sections);
  return lead === undefined ? undefined : quote(passages, capSentences(lead));
}

const FIRST_LINES = 14;
/** `25 May 2022 | 6 mins read` (a release's date line under its title) or `SINGAPORE – 01 DEC 2025` (its dateline). */
const DATE_LINE = /^(\d{1,2} [A-Za-z]+ \d{4})(?:\s*\|.*)?$/;
const DATELINE = /^[A-Z][A-Z ,.'’-]+\s[–—-]\s(\d{1,2} [A-Z]+ \d{4})$/;

/** The date a text capture prints near its top: the date line under the title, else the dateline of a release. */
export function captureDate(text: string): WrittenDate | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => normalise(l.replace(/[*_]+/g, "")))
    .filter(Boolean)
    .slice(0, FIRST_LINES);
  for (const pattern of [DATE_LINE, DATELINE]) {
    for (const line of lines) {
      const m = pattern.exec(line);
      const date = m ? findDates(m[1]!)[0] : undefined;
      if (date) return { iso: date.iso, written: date.written };
    }
  }
  return undefined;
}

/**
 * Up to 4 provisions: bullet items of at least 6 words (at least two of them), else the page's non-generic headings. The
 * page's own title (the candidate's title, and the first heading of the text, which is the page's <h1>) is not a provision.
 */
export function pageProvisions(c: Candidate, text: string, sections: Section[], passages: Passage[]): Cited[] {
  // Lists before the lead paragraph are the page's furniture (a breadcrumb, a menu), not its content.
  const lead = leadParagraph(sections);
  const from = lead === undefined ? 0 : Math.max(0, text.indexOf(lead.slice(0, 60)));
  const items = bulletItems(text.slice(from)).filter((item) => wordCount(item) >= LIST_ITEM_MIN_WORDS);
  const firstHeading = bodySections(sections).find((s) => s.heading !== undefined)?.heading;
  const values = items.length >= 2 ? [...new Set(items)].slice(0, 4) : listProvisions(sections, 4, [c.title, ...(firstHeading ? [firstHeading] : [])]);
  return values.map((value) => quote(passages, value));
}

export function extractHtml(c: Candidate, text: string, passages: Passage[], meta: ExtractMeta): ExtractResult {
  const sections = toSections(text);
  const page = meta.html !== undefined ? pageMeta(meta.html) : {};
  const summary = pageSummary(sections, passages, page.description);
  if (!summary) return noSummary();

  const published: WrittenDate | { iso: string; written?: undefined } | undefined = page.published
    ? { iso: page.published }
    : meta.format === "text"
      ? captureDate(text)
      : undefined;
  const shortTitle = c.type === "executive-order" ? eoShortTitle(c.id) : undefined;

  return {
    ok: true,
    fields: {
      ...(shortTitle ? { shortTitle } : {}),
      ...(published ? { published: published.iso } : {}),
      ...documentStatus({ type: c.type, text, ...(published ? { published } : {}), snapshotDate: meta.snapshotDate, passages, lead: summary.support }),
      summary,
      provisions: pageProvisions(c, text, sections, passages),
      affected: [],
    },
  };
}
