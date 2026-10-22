// Hansard: statements and answers in the Singapore Parliament (spec 5.3).
//
// A page of the Parliament's own report (sprs.parl.gov.sg) opens with header rows (`Sitting Date: 15-10-2012`, `Title: ...`,
// `MPs Speaking: ...`) and then the debate. Its date is the sitting date (or the `_YYYYMMDD_` token of the report's id in the
// URL); its summary is the first paragraph of the statement with at least 25 words, without the speaker's label
// (`The Minister for ... (Name):`) and the salutation (`Mr Speaker, Sir,`), which leaves a verbatim excerpt. Most Hansard
// records are ministry speech pages (mddi.gov.sg, csa.gov.sg), which have no header rows and are read as any web page is.
// Node-only build code: never import this from photon/src.
import type { Passage } from "../../../src/data/schema.ts";
import type { Candidate } from "../candidates.ts";
import { toSections, wordCount, type Section } from "../passages.ts";
import { bodySections, capSentences, cite, EVENT, LEAD_MIN_WORDS, noSummary, normalise, quote, type ExtractMeta, type ExtractResult } from "./common.ts";
import { extractHtml, pageProvisions } from "./html.ts";

const SITTING_DATE = /^Sitting Date:\s*(\d{2})-(\d{2})-(\d{4})$/;
/** A header row of an SPRS page. */
const HEADER_ROW = /^(?:Parliament No|Session No|Volume No|Sitting No|Sitting Date|Section Name|Title|MPs Speaking):/;
/** How a speaker's label begins: `The Minister for ...`, `Mr Name`, `Assoc Prof Dr Name`, `Mr Speaker`. */
const LABEL_START =
  /^(?:The |Mr |Mrs |Ms |Mdm |Madam |Dr |Er |Prof |Assoc Prof |Asst Prof |Minister |Senior Minister |Second Minister |Parliamentary Secretary |Mr Speaker|Leader of)/;
/** The text before the first colon of a paragraph, when a colon comes within 140 characters. */
const BEFORE_COLON = /^([^:\n]{1,140}):\s+/;
/** The small words a label may hold in lower case (`The Minister for Digital Development and Information`). */
const LABEL_WORDS = new Set(["for", "of", "and", "the", "in", "to", "on"]);

/**
 * True for the label of a speaker's turn (I1): `The Minister for X (Name)`, whose name is in brackets, or a short label that has
 * no clause words, such as `Mr Speaker`, `Assoc Prof Daniel Goh` or `The Minister for Digital Development and Information`. A
 * lead-in of the statement itself ("The Bill has three main objectives") has lower-case words and is not one.
 */
function isSpeakerLabel(label: string): boolean {
  if (!LABEL_START.test(label)) return false;
  const named = /\([^()\n]{1,80}\)$/.exec(label);
  const outside = named ? label.slice(0, named.index).trim() : label;
  if (/[,;]/.test(outside)) return false; // "Mr Speaker, Sir, the Bill does ..." is a salutation and a clause
  const words = outside.split(/\s+/);
  if (words.length > (named ? 14 : 10)) return false;
  return named !== null || words.every((w) => /^[A-Z(]/.test(w) || LABEL_WORDS.has(w));
}

/** `Mr Speaker, Sir,` and the like, once, after the label. */
const SALUTATION = /^(?:(?:Mr|Madam|Mdm) (?:Deputy )?Speaker(?:, Sir)?|Sir|Madam),?\s+/;

/** The statement's paragraph without its speaker label and salutation, or the paragraph as it is when it has neither. */
function withoutLabel(paragraph: string): string {
  const m = BEFORE_COLON.exec(paragraph);
  const rest = m && isSpeakerLabel(m[1]!) ? paragraph.slice(m[0].length) : paragraph;
  return rest.replace(SALUTATION, "");
}

/** A paragraph that is only the word Answer: `Answer:`, `Written Answer`, `Oral Answers`. */
const ANSWER_MARKER = /^(?:Written |Oral )?Answers?:?$/i;

/** The first paragraph of at least 25 words after an "Answer" marker (a paragraph or a heading of its own), or undefined if there is none. */
function answerLead(sections: Section[]): string | undefined {
  let after = false;
  for (const s of bodySections(sections)) {
    if (s.heading !== undefined && ANSWER_MARKER.test(normalise(s.heading))) after = true;
    for (const p of s.paragraphs) {
      if (ANSWER_MARKER.test(p)) after = true;
      else if (after && wordCount(p) >= LEAD_MIN_WORDS) return p;
    }
  }
  return undefined;
}

function isDate(year: number, month: number, day: number): string | undefined {
  const d = new Date(Date.UTC(year, month - 1, day));
  const ok = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  return ok ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : undefined;
}

export function extractHansard(c: Candidate, text: string, passages: Passage[], meta: ExtractMeta): ExtractResult {
  const sections = toSections(text);
  const paragraphs = sections.flatMap((s) => s.paragraphs);
  const row = paragraphs.find((p) => SITTING_DATE.test(p));
  const isSprs = row !== undefined || /(?:^|\.)sprs\.parl\.gov\.sg$/i.test(hostOf(c.url));
  if (!isSprs) {
    const page = extractHtml(c, text, passages, meta);
    // A ministry page for a parliamentary question prints the question, then "Answer:". The minister's statement is the answer.
    const answer = answerLead(sections);
    return page.ok && answer !== undefined ? { ok: true, fields: { ...page.fields, summary: quote(passages, capSentences(answer)) } } : page;
  }

  const m = row ? SITTING_DATE.exec(row) : undefined;
  const fromRow = m ? isDate(Number(m[3]), Number(m[2]), Number(m[1])) : undefined;
  const token = /_(\d{4})(\d{2})(\d{2})_/.exec(c.url);
  const sitting = fromRow ?? (token ? isDate(Number(token[1]), Number(token[2]), Number(token[3])) : undefined);

  const statement = bodySections(sections).flatMap((s) => s.paragraphs.filter((p) => !HEADER_ROW.test(p)));
  const spoken = statement.map(withoutLabel).find((p) => wordCount(p) >= LEAD_MIN_WORDS);
  if (spoken === undefined) return noSummary();
  const summary = quote(passages, capSentences(spoken));

  const written = fromRow && m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
  const support = written ? cite(passages, written) : summary.support;
  return {
    ok: true,
    fields: {
      ...(sitting ? { published: sitting, statusDate: sitting } : {}),
      status: { value: "published", support },
      timeline: sitting ? [{ date: sitting, event: EVENT.Sitting, support, parts: written ? [written] : [] }] : [],
      summary,
      provisions: pageProvisions(c, text, sections, passages),
      affected: [],
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
