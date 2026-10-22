// What the record extractors share: text and date helpers, the citing of passages, and the types of an extraction.
// Every text value an extractor returns is copied from the document: whitespace is collapsed and nothing else changes.
// Node-only build code: never import this from photon/src.
import type { Passage, RecordType, Status } from "../../../src/data/schema.ts";
import { wordCount, type Section } from "../passages.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Constants

/** A summary is cut after its last whole sentence that fits in this many words (a first sentence over it is kept whole). */
export const SUMMARY_MAX_WORDS = 150;
/** The lead paragraph of a page, and the first paragraph of a PDF, has at least this many words. */
export const LEAD_MIN_WORDS = 25;
/** A meta description is used as a summary only when it has at least this many words. */
export const DESCRIPTION_MIN_WORDS = 15;
/** A list item is a provision only when it has at least this many words. */
export const LIST_ITEM_MIN_WORDS = 6;
/** A provision heading has at least this many words. */
export const HEADING_MIN_WORDS = 2;

/** The headings of the sections the loader adds in front of a page's own text (spec 5.2). They are not the page's body. */
export const PAGE_DESCRIPTION_HEADING = "Page description";
export const CONTENTS_HEADING = "Contents";

/** The fixed timeline labels. An extractor never invents another. */
export const EVENT = {
  Published: "Published",
  Signed: "Signed",
  Effective: "Takes effect",
  Assented: "Assented",
  Commenced: "Commenced",
  Operative: "Operative",
  Awarded: "Awarded",
  Sitting: "Sitting",
} as const;

/** A paragraph that begins like this is page furniture, not the page's lead. Compared in lower case. */
const BOILERPLATE_STARTS = ["this article has been migrated", "skip to", "we use cookies", "applies to:"];

/** Headings that name no provision. Compared in lower case. */
const GENERIC_HEADINGS = new Set([
  "overview", "contents", "introduction", "background", "related", "share", "contact", "resources", "references", "summary",
  // seen on real pages' furniture
  "explore more", "footnotes", "related links", "related news", "related tags", "page description", "legislative history",
  "table of contents", "contact us", "more information", "see also", "quick links",
  // the labels of a parliamentary question page
  "question for oral answer", "question for written answer", "oral answer", "written answer", "answer", "question",
]);

// ---------------------------------------------------------------------------------------------------------------------
// The shape of an extraction

/** A claim: a value, the passages it cites, and optionally the strings that must each occur in those passages (default: the value). */
export type Cited = { value: string; support: string[]; parts?: string[] };

export type Extracted = {
  shortTitle?: string;
  published?: string;
  status: { value: Status; support: string[] };
  statusDate?: string;
  timeline: { date: string; event: string; support: string[]; parts?: string[] }[];
  summary: Cited;
  provisions: Cited[];
  affected: Cited[];
};

export type ExtractMeta = { snapshotDate: string; format: "html" | "pdf" | "text"; html?: string };

export const NO_SUMMARY = "no official summary found";
export const NO_STATUS = "no official status found";
export type ExtractResult = { ok: true; fields: Extracted } | { ok: false; reason: typeof NO_SUMMARY | typeof NO_STATUS };

export const noSummary = (): ExtractResult => ({ ok: false, reason: NO_SUMMARY });
export const noStatus = (): ExtractResult => ({ ok: false, reason: NO_STATUS });

// ---------------------------------------------------------------------------------------------------------------------
// Text

/** Runs of whitespace become one space and the ends are trimmed: the form in which values and passages are compared. */
export const normalise = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Abbreviations (with their full stop) after which a capital letter does not start a sentence. */
const ABBREVIATIONS = new Set([
  "sec.", "secs.", "no.", "nos.", "ch.", "art.", "u.s.", "cal.", "inc.", "dept.", "gov.",
  "mr.", "mrs.", "ms.", "dr.", "prof.", "hon.", "st.", "co.", "corp.", "ltd.", "pte.", "vs.", "jr.", "sr.", "e.g.", "i.e.",
]);

/** `4.` or `4.2.`: the number of a paragraph (up to three digits, so that a year such as `2024.` still ends a sentence). */
const PARAGRAPH_NUMBER = /^\d{1,3}(?:\.\d{1,3})*\.$/;

/** The spans of the sentences of a text: each ends after . ! or ? (and any closing quote or bracket) before whitespace and a capital. */
function sentenceSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  // After . ! or ?, a capital starts a sentence, and so does a paragraph number (`1.2 The purpose`) in a numbered document and
  // the number of a digest item (`(2) This bill would`).
  const boundary = /[.!?]["”’'’)\]]*(?=\s+["“‘'(\[]*(?:[A-Z]|\d+(?:\.\d+)*\.?\s+[A-Z]|\d{1,2}\)\s+[A-Z]))/g;
  let start = 0;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
    const end = m.index + m[0].length;
    const word = /(\S+)$/.exec(text.slice(start, m.index + 1))?.[1]?.toLowerCase() ?? "";
    const bare = word.replace(/^["“‘'(\[]+/, "");
    // An abbreviation, or a paragraph number that is all the sentence has so far ("4." in "service. 4. The categories"), is not the end of
    // a sentence; a number after other words ("Assembly Bill 56. This bill would") is.
    const wholeSpan = text.slice(start, m.index + 1).trim();
    if (m[0].length === 1 && (ABBREVIATIONS.has(bare) || PARAGRAPH_NUMBER.test(wholeSpan))) continue;
    spans.push({ start, end });
    const next = /\S/.exec(text.slice(end));
    start = next ? end + next.index : text.length;
  }
  if (start < text.length && text.slice(start).trim()) spans.push({ start, end: text.length });
  return spans;
}

/** The sentences of a text, trimmed. See ABBREVIATIONS for the full stops that do not end one. */
export function splitSentences(text: string): string[] {
  return sentenceSpans(text).map(({ start, end }) => text.slice(start, end).trim());
}

/**
 * A summary does not end on a lead-in or a fragment. A last sentence that ends in a colon ("Today I will elaborate on four areas:")
 * is left off when an earlier sentence stands, and so is a last piece with no closing punctuation at all (the header of a table that
 * follows the paragraph); a recital that ends "; and" loses the dangling word. What is left is still a prefix.
 */
function withoutLeadIn(text: string): string {
  let out = text;
  for (let spans = sentenceSpans(out); /:$/.test(out) && spans.length > 1; spans = sentenceSpans(out)) out = out.slice(0, spans[spans.length - 2]!.end).trim();
  const spans = sentenceSpans(out);
  if (spans.length > 1 && !/[.!?]["”’')\]]*$/.test(out)) out = out.slice(0, spans[spans.length - 2]!.end).trim();
  return out.replace(/(;)\s+(?:and|or)$/, "$1");
}

/** The longest run of whole leading sentences with at most `maxWords` words; a first sentence over the limit is kept whole. */
export function capSentences(text: string, maxWords = SUMMARY_MAX_WORDS): string {
  const trimmed = text.trim();
  if (wordCount(trimmed) <= maxWords) return withoutLeadIn(trimmed);
  const spans = sentenceSpans(trimmed);
  let end = spans[0]?.end ?? trimmed.length;
  for (const span of spans.slice(1)) {
    if (wordCount(trimmed.slice(0, span.end)) > maxWords) break;
    end = span.end;
  }
  return withoutLeadIn(trimmed.slice(0, end).trim());
}

// ---------------------------------------------------------------------------------------------------------------------
// Dates

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_NAMES = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const WEEKDAY = "(?:(?:Mon|Tues?|Wednes|Wed|Thurs?|Fri|Satur|Sat|Sun)(?:day)?,?\\s+)?";

/** The alternatives of a date: ISO, `D Month YYYY` or `Month D, YYYY`. The groups are (y,m,d), (d,month,y) and (month,d,y). */
const DATE_BODY = `(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})\\.?,?\\s+(\\d{4})|(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`;

function isoDate(year: number, month: number, day: number): string | undefined {
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fromMatch(m: RegExpExecArray, offset: number): string | undefined {
  const g = (i: number) => m[offset + i];
  if (g(1)) return isoDate(Number(g(1)), Number(g(2)), Number(g(3)));
  if (g(4)) return isoDate(Number(g(6)), MONTHS[g(5)!.toLowerCase()]!, Number(g(4)));
  if (g(7)) return isoDate(Number(g(9)), MONTHS[g(7)!.toLowerCase()]!, Number(g(8)));
  return undefined;
}

const WHOLE_DATE = new RegExp(`^${WEEKDAY}(?:${DATE_BODY})(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?[.;,]?$`, "i");

/**
 * The ISO date of a date written as `January 5, 2026`, `5 January 2026`, `5 Jan 2026` or `2026-01-05T09:56:34-08:00`: the
 * date as written, with no timezone conversion. A weekday before it, an ordinal after the day and a trailing full stop are
 * allowed. `undefined` for anything else, and for an impossible date such as 30 February.
 */
export function parseDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = WHOLE_DATE.exec(normalise(s));
  return m ? fromMatch(m, 0) : undefined;
}

/** The dates written in a text, in order, each with its ISO form, how it was written and where it starts. Impossible dates are skipped. */
export function findDates(text: string): { iso: string; written: string; index: number }[] {
  const out: { iso: string; written: string; index: number }[] = [];
  const re = new RegExp(`(?<![\\w-])(?:${DATE_BODY})(?![\\w-])`, "gi");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const iso = fromMatch(m, 0);
    if (iso) out.push({ iso, written: m[0], index: m.index });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Citing

const haystack = (p: Passage) => normalise(p.heading ? `${p.heading}\n\n${p.text}` : p.text);

/** True if the needle occurs in the passage's heading followed by its text, both normalised. */
export const passageHolds = (p: Passage, needle: string): boolean => haystack(p).includes(normalise(needle));

/** Like `passageHolds`, but the needle must start at the start of the passage or right after a character that is not a letter or digit: not in the middle of a word. */
export function passageHoldsFromWordStart(p: Passage, needle: string): boolean {
  const text = haystack(p);
  const wanted = normalise(needle);
  for (let at = text.indexOf(wanted); at >= 0; at = text.indexOf(wanted, at + 1)) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1]!)) return true;
  }
  return false;
}

/** The ids of the passages whose heading and text hold the needle, or the first passage when none does. */
export function cite(passages: Passage[], needle: string): string[] {
  if (passages.length === 0) return [];
  const hits = passages.filter((p) => passageHolds(p, needle));
  return (hits.length > 0 ? hits : [passages[0]!]).map((p) => p.id);
}

/** The passages that cite each of the parts, together and in passage order. No parts gives the first passage. */
export function citeAll(passages: Passage[], parts: string[]): string[] {
  const ids = new Set(parts.flatMap((part) => cite(passages, part)));
  if (ids.size === 0) return passages[0] ? [passages[0].id] : [];
  return passages.filter((p) => ids.has(p.id)).map((p) => p.id);
}

/**
 * The pieces of a value, when it runs across passages, each of which is in one passage: the passage splitter cuts a long
 * paragraph only after a sentence end (`. ` `! ` `? `), so the value is cut there too, and neighbouring pieces that share a
 * passage are kept together. `undefined` when the value is in one passage whole (or in none: the check will say so).
 */
function piecesAcrossPassages(passages: Passage[], value: string): string[] | undefined {
  if (passages.some((p) => passageHolds(p, value))) return undefined;
  const sentences = normalise(value).split(/(?<=[.!?]["'”’)\]]?)\s+/);
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const joined = current ? `${current} ${sentence}` : sentence;
    if (!current || passages.some((p) => passageHolds(p, joined))) {
      current = joined;
    } else {
      pieces.push(current);
      current = sentence;
    }
  }
  if (current) pieces.push(current);
  return pieces.length > 1 ? pieces : undefined;
}

/**
 * A claim whose value is copied from the document, citing the passages that hold it. A value that runs across passages
 * (a summary at the start of a long paragraph that the splitter cut) lists its pieces as `parts`, each of which the check
 * finds in one of the passages cited.
 */
export function quote(passages: Passage[], value: string): Cited {
  const pieces = piecesAcrossPassages(passages, value);
  return pieces ? { value, support: citeAll(passages, pieces), parts: pieces } : { value, support: cite(passages, value) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sections

/** The sections of the document's own text: those the loader added in front of it (Page description, Contents) are left out. */
export const bodySections = (sections: Section[]): Section[] =>
  sections.filter((s) => s.heading !== PAGE_DESCRIPTION_HEADING && s.heading !== CONTENTS_HEADING);

const isBoilerplate = (paragraph: string) => {
  const start = paragraph.toLowerCase();
  return BOILERPLATE_STARTS.some((b) => start.startsWith(b));
};

/**
 * The first paragraph of the document's own text with at least 25 words, skipping boilerplate, list items (a breadcrumb or a
 * menu entry can be long) and a paragraph that only repeats a heading (the page title). `undefined` if there is none.
 */
export function leadParagraph(sections: Section[], minWords = LEAD_MIN_WORDS): string | undefined {
  const own = bodySections(sections);
  const headings = new Set(own.flatMap((s) => (s.heading ? [normalise(s.heading).toLowerCase()] : [])));
  for (const section of own) {
    for (const paragraph of section.paragraphs) {
      if (wordCount(paragraph) < minWords || isBoilerplate(paragraph) || BULLET.test(paragraph) || headings.has(paragraph.toLowerCase())) continue;
      return paragraph;
    }
  }
  return undefined;
}

const BULLET = /^(?:[••▪●‣*]|[-–—])\s+(\S.*)$/;

/** The 90th-percentile length of a text's non-empty lines: about where a wrapped line reaches the right margin. */
export function marginWidth(text: string): number {
  const lengths = text
    .split(/\r?\n/)
    .map((l) => l.trim().length)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  return lengths[Math.floor((lengths.length - 1) * 0.9)] ?? 0;
}

/** A line shorter than this share of the margin width is the last line of its paragraph or item... */
export const FULL_LINE_SHARE = 0.7;

/**
 * ...unless the sentence goes on: a line that does not end in closing punctuation, followed by a line that starts in lower
 * case, is wrapped text whose next word did not fit (a PDF with wide tables has a wide margin, so many full lines look short).
 */
const PAGE_NUMBER = /^[-–—]\s*\d{1,4}\s*[-–—]$/; // a page footer such as "- 3 -": not a bullet, and not a break in the text

const continues = (previous: string, next: string): boolean => /^\p{Ll}/u.test(next) && !/[.!?:;"”’')\]]$/.test(previous);

/**
 * True for a list item that is a whole statement and not a wrapped fragment of a PDF line (R40): it starts with a capital letter, a
 * digit or an opening bracket or quote, and ends with `.`, `!`, `?` or `;` (a closing quote or bracket may follow), or with `; and` / `; or`.
 */
export function isWholeItem(item: string): boolean {
  const t = item.trim();
  return /^[\p{Lu}\p{N}("“‘'\[]/u.test(t) && /(?:[.!?;]["”’')\]]*|;\s+(?:and|or))$/.test(t);
}

/** A list item that ends in a file size, `Annex A: Quotes (102.56KB)`, is a link to a download, not a provision. */
const DOWNLOAD_LINK = /\(\s*\d[\d.,]*\s?(?:KB|MB|GB)\s*\)\s*$/i;

/**
 * The bullet items of a text: a line that begins `•`, `-` or `–` followed by a space starts one, and the lines after it
 * continue it (joined by single spaces, as the passage splitter joins them) while the item's last line reaches the right
 * margin, until a blank line, the next marker, or a capitalised line after an item that ends a sentence. A PDF has few blank
 * lines, so the margin is what tells where an item stops. The marker is dropped. A link to a download (an item that ends in a
 * file size) is not an item.
 */
export function bulletItems(text: string): string[] {
  const items: string[] = [];
  const width = marginWidth(text);
  let current: string | undefined;
  let last = 0; // length of the last line added to the current item
  const end = () => {
    if (current !== undefined) items.push(normalise(current));
    current = undefined;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (PAGE_NUMBER.test(line)) continue;
    if (line === "") {
      end();
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      end();
      current = bullet[1]!;
      last = line.length;
    } else if (current !== undefined) {
      if ((last < width * FULL_LINE_SHARE && !continues(current, line)) || (/[.!?]$/.test(current) && /^[A-Z]/.test(line))) end();
      else {
        current = `${current} ${line}`;
        last = line.length;
      }
    }
  }
  end();
  return items.filter((item) => item !== "" && !DOWNLOAD_LINK.test(item));
}

/**
 * Up to `max` provisions copied from the document's sections: bullet items of at least 6 words when there are at least 2 of
 * them, otherwise headings of at least 2 words that are not generic. `skip` lists headings to leave out (such as the
 * record's own title), compared without case.
 */
export function listProvisions(sections: Section[], max = 4, skip: string[] = []): string[] {
  const own = bodySections(sections);
  const bullets = own
    .flatMap((s) => s.paragraphs)
    .flatMap((p) => {
      const m = BULLET.exec(p);
      return m && wordCount(m[1]!) >= LIST_ITEM_MIN_WORDS && !DOWNLOAD_LINK.test(m[1]!) ? [normalise(m[1]!)] : [];
    });
  if (bullets.length >= 2) return bullets.slice(0, max);

  const skipped = new Set(skip.map((s) => normalise(s).toLowerCase()));
  const headings = own.flatMap((s) => {
    if (s.paragraphs.length === 0) return []; // a heading with no text under it is in no passage
    const h = s.heading ? normalise(s.heading) : "";
    const lower = h.toLowerCase();
    const named = h.split(" ").filter((w) => /\p{L}{2,}/u.test(w)).length >= HEADING_MIN_WORDS; // words, not marks such as "#"
    return named && !GENERIC_HEADINGS.has(lower) && !skipped.has(lower) ? [h] : [];
  });
  return [...new Set(headings)].slice(0, max);
}

// ---------------------------------------------------------------------------------------------------------------------
// Dated documents: the status of a release, an executive order or a regulation (spec 5.3)

export type WrittenDate = { iso: string; written: string };

/** `N-12-23` from `ca-eo-n-12-23`: an executive order's number as the Governor's office writes it. */
export function eoShortTitle(id: string): string | undefined {
  const m = /^ca-eo-([a-z])-(\d+)-(\d+)$/.exec(id);
  return m ? `${m[1]!.toUpperCase()}-${m[2]}-${m[3]}` : undefined;
}

const CLOSING_CLAUSE = new RegExp(`\\bthis\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+day\\s+of\\s+(${MONTH_NAMES}),?\\s+(\\d{4})`, "i");

/** The signing date in an order's closing clause, `... affixed this 6th day of September 2023`, with the words that state it. */
export function closingClauseDate(text: string): WrittenDate | undefined {
  const m = CLOSING_CLAUSE.exec(text);
  if (!m) return undefined;
  const iso = isoDate(Number(m[3]), MONTHS[m[2]!.toLowerCase()]!, Number(m[1]));
  return iso ? { iso, written: normalise(m[0].replace(/^this\s+/i, "")) } : undefined;
}

const EFFECTIVE = /\b(?:takes? effect|becomes? effective|effective)(?:\s+(?:on|as of|from))?\s+/gi;

/**
 * The first `take(s) effect on <date>` or `effective <date>` in the text, with the date as written. `conditional` is true when
 * the words before it say the rules *would* take effect: a proposal states the date it proposes, which is no fact yet.
 */
export function effectiveDate(text: string): (WrittenDate & { conditional: boolean }) | undefined {
  EFFECTIVE.lastIndex = 0;
  for (let m = EFFECTIVE.exec(text); m; m = EFFECTIVE.exec(text)) {
    const date = findDates(text.slice(m.index + m[0].length, m.index + m[0].length + 40))[0];
    if (date && date.index === 0) {
      const before = text.slice(Math.max(0, m.index - 24), m.index);
      return { iso: date.iso, written: date.written, conditional: /\b(?:would|could|may|might|proposed to)\s*(?:\w+\s+){0,2}$/i.test(before) };
    }
  }
  return undefined;
}

/**
 * Status, status date and timeline of a document that is not a bill, a statute, a tender or a Hansard record. `published` is
 * its publish date (with the words that state it, when the text itself states it). `lead` is what to cite for a fact the
 * text does not hold (a meta date, a label chosen by a rule): the passages of the document's summary.
 *   executive order: in force, dated by the signing date (the closing clause, else the publish date), a Signed event;
 *   regulation: a stated effective date on or before the snapshot date is in force, a later one enacted (R26), with an
 *     Effective event; one that is only proposed ("would take effect on ...") is proposed, with no date; no stated date is
 *     published, dated by the publish date;
 *   anything else: published, dated by the publish date, one Published event.
 * With no date at all there is no statusDate and no timeline.
 */
export function documentStatus(a: {
  type: RecordType;
  text: string;
  published?: WrittenDate | { iso: string; written?: undefined };
  snapshotDate: string;
  passages: Passage[];
  lead: string[];
}): Pick<Extracted, "status" | "statusDate" | "timeline"> {
  const { passages, lead } = a;
  const publishedEvent = (): Extracted["timeline"] =>
    a.published
      ? [{ date: a.published.iso, event: EVENT.Published, support: a.published.written ? cite(passages, a.published.written) : lead, parts: a.published.written ? [a.published.written] : [] }]
      : [];

  if (a.type === "executive-order") {
    const clause = closingClauseDate(a.text);
    const signed = clause ?? a.published;
    return {
      status: { value: "in-force", support: clause ? cite(passages, clause.written) : lead },
      ...(signed ? { statusDate: signed.iso } : {}),
      timeline: signed
        ? [{ date: signed.iso, event: EVENT.Signed, support: clause ? cite(passages, clause.written) : lead, parts: clause ? [clause.written] : [] }]
        : [],
    };
  }
  if (a.type === "regulation") {
    const effective = effectiveDate(a.text);
    if (effective?.conditional) {
      return { status: { value: "proposed", support: cite(passages, effective.written) }, timeline: publishedEvent() };
    }
    if (effective) {
      const support = cite(passages, effective.written);
      const events: Extracted["timeline"] = [...publishedEvent(), { date: effective.iso, event: EVENT.Effective, support, parts: [effective.written] }];
      events.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
      return { status: { value: effective.iso <= a.snapshotDate ? "in-force" : "enacted", support }, statusDate: effective.iso, timeline: events };
    }
  }
  return {
    status: { value: "published", support: a.published?.written ? cite(passages, a.published.written) : lead },
    ...(a.published ? { statusDate: a.published.iso } : {}),
    timeline: publishedEvent(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// PDF text

/** Dot leaders (`Introduction ......... 3`) make a line of a table of contents. */
const DOT_LEADERS = /\.{4,}|(?:\s\.){4,}/;
/** A paragraph of prose is mostly lower-case words: a cover, a table, a contents list or a slide is not. */
const PROSE_SHARE = 0.6;

/**
 * The paragraphs of a PDF's text, each with the offset in the text where it starts. A PDF's text keeps its line breaks and
 * rarely has a blank line, so a paragraph is the lines up to a blank line or up to a line that stops short of the right margin
 * (the last line of a paragraph does), joined by single spaces as the passage splitter joins them.
 */
export function pdfParagraphs(text: string, width = marginWidth(text)): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let lines: string[] = [];
  let start = 0;
  let offset = 0;
  const flush = () => {
    if (lines.length > 0) out.push({ text: normalise(lines.join(" ")), start });
    lines = [];
  };
  let short = false; // the last line stopped short of the margin: it ends the paragraph, unless the sentence goes on
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (PAGE_NUMBER.test(line)) {
      offset += raw.length + 1;
      continue;
    }
    if (line === "") {
      flush();
      short = false;
    } else {
      if (short && !continues(lines[lines.length - 1]!, line)) flush();
      if (lines.length === 0) start = offset + raw.indexOf(line);
      lines.push(line);
      short = line.length < width * FULL_LINE_SHARE;
    }
    offset += raw.length + 1;
  }
  flush();
  return out;
}

/** True for a paragraph of running text with at least `minWords` words, not a table of contents, a cover or a table. */
export function isProse(paragraph: string, minWords = LEAD_MIN_WORDS): boolean {
  if (wordCount(paragraph) < minWords || DOT_LEADERS.test(paragraph) || BULLET.test(paragraph) || isBoilerplate(paragraph)) return false;
  const tokens = paragraph.split(/\s+/);
  return tokens.filter((t) => /^[a-z][a-z'’-]*[,;:.)]?$/.test(t)).length / tokens.length >= PROSE_SHARE;
}
