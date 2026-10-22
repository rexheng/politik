// California bills (spec 5.3). The text is the layout leginfo.ts writes (LEGINFO_TEXT_LAYOUT "2"): a `# Bill:` header, the
// Legislative Counsel's Digest, `# Legislative history` (one `YYYY-MM-DD — action` paragraph per action, the Legislature's own
// BILL_HISTORY_TBL), then the bill's sections. Everything here is read back from that text, so each field can cite the passage
// it came from: the summary is what the bill would do (R38: from the digest's first "This bill would" sentence to the end of its
// paragraph), the provisions are its "This bill would" sentences, and the status and timeline come from the history. The parts may come in any order (the layout before R23 put the history first and had no header).
// Node-only build code: never import this from photon/src.
import type { Passage } from "../../../src/data/schema.ts";
import type { Candidate } from "../candidates.ts";
import { parseLegislativeHistory } from "../leginfo.ts";
import { toSections, wordCount, type Section } from "../passages.ts";
import {
  bodySections,
  capSentences,
  cite,
  citeAll,
  EVENT,
  findDates,
  noStatus,
  noSummary,
  normalise,
  quote,
  splitSentences,
  type Extracted,
  type ExtractMeta,
  type ExtractResult,
} from "./common.ts";

/**
 * The history rows that become timeline events: introduced, passed a house, enrolled, approved, vetoed, chaptered. A Senate bill
 * is "Introduced. Read first time ..."; an Assembly bill's first row is "Read first time. To print." (R35), and only the first
 * such row counts: the other house reads the bill for the first time later on.
 */
export const BILL_MILESTONES: RegExp[] = [
  /^Introduced/i,
  /^Read first time\. To print/i,
  /^Read third time\. Passed/i,
  /^Enrolled and presented to the Governor/i,
  /^Approved by the Governor/i,
  /^Vetoed by (?:the )?Governor/i, // "Vetoed by Governor." in some years
  /^Chaptered by Secretary of State/i,
];
const INTRODUCTION = /^(?:Introduced|Read first time\. To print)/i;
const VETOED = /^Vetoed by (?:the )?Governor/i;
const CHAPTERED = /^Chaptered by Secretary of State/i;

/** The most digest sentences listed as provisions. */
const MAX_PROVISIONS = 6;
/** "This bill would ...", "The bill would also ...", "The bill, among other things, would ..." (R32). */
const PROVISION_START = /^(?:This|The) (?:bill|act|measure)\b[^.]{0,100}?\bwould\b/;
/** ... and any sentence that says what the bill would require, prohibit or authorize, such as "By expanding a crime, this bill would authorize ...". */
const PROVISION_VERB = /\bwould (?:also |further )?(?:require|prohibit|authorize)\b/;
/** The digest says the bill takes effect on chaptering: "This bill would declare that it is to take effect immediately as an urgency statute". */
const URGENCY = /\b(?:this|the) bill (?:would declare|declares) that it is to take effect immediately\b/i;
/** A sentence of a bill's own section that states when the act or a section of it takes effect. */
const OWN_CLAUSE = /^(?:This act|This section|Section \d+(?:\.\d+)? of this act)\b/;
/** Any such sentence is an operative clause: it either gives a date (below) or leaves the date unresolved. */
const CLAUSE = /\b(?:become(?:s)? operative|take(?:s)? effect)\b/;
/** The words that make a date conditional on something else. */
const CONTINGENT = /\b(?:only if|upon|contingent (?:on|upon)|if and when)\b/i;
/** The clause with a date right after it: "shall become operative on January 1, 2026", "shall become operative January 1, 2026", "shall take effect on or after ...". */
const ANCHORED = /\b(become(?:s)? operative|take(?:s)? effect) (?:on )?(?:or after )?/;
/** A sentence of quoted code that gives its own operative date. */
const QUOTED_OPERATIVE = /\bshall become operative (?:on )?(?:or after )?/;
/**
 * A section that quotes a code section it adds or amends: its dates are the code's, not the bill's. A code unit (a Section, Chapter,
 * Article ...) that "is added", "is amended" ..., or "to read:". Another bill that "is enacted" is only a mention (I3).
 */
const QUOTED_CODE =
  /\bto read:|\b(?:Sections?|Chapters?|Articles?|Titles?|Divisions?|Parts?|Subdivisions?|Paragraphs?)\b[^.]{0,200}?\b(?:is|are) (?:hereby )?(?:added|amended|repealed|renumbered)\b/i;

const DIGEST_HEADING = /^Legislative Counsel['’]s Digest$/i;
const SECTION_HEADING = /^(?:SECTION|SEC\.?)\s*\d+/i;
/** A short first paragraph that begins like this is a digest paragraph, not the subject line. */
const DIGEST_OPENING = /^(?:\(|Existing|This|The|Under|Current)\b/;

/** `SB 53` from the `# Bill: SB 53 (2025-2026) — subject` header, else from an id such as `ca-sb-53-2025`. */
function shortTitleOf(text: string, id: string): { shortTitle?: string; subject?: string } {
  const header = /^# Bill:[ \t]*([A-Z]+)[ \t]+(\d+)\b(.*)$/m.exec(text);
  if (header) {
    const subject = /—\s*(.+?)\s*$/.exec(header[3]!)?.[1];
    return { shortTitle: `${header[1]} ${header[2]}`, ...(subject ? { subject } : {}) };
  }
  const fromId = /^ca-([a-z]+)-(\d+)-/.exec(id);
  return fromId ? { shortTitle: `${fromId[1]!.toUpperCase()} ${fromId[2]}` } : {};
}

const sameLine = (a: string, b: string) => normalise(a).replace(/[.\s]+$/, "").toLowerCase() === normalise(b).replace(/[.\s]+$/, "").toLowerCase();

/** The digest's paragraphs without the subject line that precedes them. */
function digestParagraphs(sections: Section[], subject: string | undefined): string[] | undefined {
  const digest = sections.find((s) => s.heading !== undefined && DIGEST_HEADING.test(normalise(s.heading)));
  if (!digest) return undefined;
  const [first, ...rest] = digest.paragraphs;
  if (first === undefined) return undefined;
  const isSubject = subject !== undefined ? sameLine(first, subject) : false;
  const looksLikeSubject = rest.length > 0 && wordCount(first) < 15 && !DIGEST_OPENING.test(first);
  return isSubject || looksLikeSubject ? rest : [first, ...rest];
}

const row = (a: { date: string; action: string }) => `${a.date} — ${a.action}`;

/** From the first sentence that says what the bill would do (without its "(2)" number) to the end of its paragraph, verbatim; else undefined. */
function billWouldText(paragraphs: string[]): string | undefined {
  for (const paragraph of paragraphs) {
    for (const raw of splitSentences(paragraph)) {
      const sentence = raw.replace(/^\(\w+\)\s+/, "");
      if (PROVISION_START.test(sentence)) return paragraph.slice(paragraph.indexOf(sentence));
    }
  }
  return undefined;
}

type Stated = { iso: string; written: string; sentence: string; event: typeof EVENT.Operative | typeof EVENT.Effective };

/** The date written right at the start of `rest`, if there is one. */
const dateAtStart = (rest: string) => {
  const date = findDates(rest)[0];
  return date && date.index === 0 ? date : undefined;
};

/**
 * The operative dates the bill states.
 *  - In its own sections ("This act shall become operative on January 1, 2026"): `latest` is the latest date given, as
 *    `effectiveDate` reads one, with the date right after the clause. A clause of the act that gives no such date, or makes it
 *    conditional ("only if Senate Bill 1381 is enacted", "upon ...", "on the date the department certifies ..., but not before
 *    January 1, 2026"), is `unresolved` (R37): we claim no date.
 *  - In the code it quotes ("This title shall become operative on January 1, 2027"): `later` lists the sentences that give a date,
 *    for the timeline; the code's dates are not the bill's.
 */
function operativeDates(sections: Section[]): { latest?: Stated; later: Stated[]; unresolved: boolean } {
  let latest: Stated | undefined;
  let unresolved = false;
  const later: Stated[] = [];
  for (const section of sections) {
    if (!section.heading || !SECTION_HEADING.test(section.heading)) continue;
    const quoted = section.paragraphs[0] !== undefined && QUOTED_CODE.test(section.paragraphs[0]);
    for (const paragraph of section.paragraphs) {
      for (const sentence of splitSentences(paragraph)) {
        if (quoted) {
          const clause = QUOTED_OPERATIVE.exec(sentence);
          const date = clause ? dateAtStart(sentence.slice(clause.index + clause[0].length)) : undefined;
          if (date && !CONTINGENT.test(sentence) && !later.some((l) => l.sentence === sentence)) later.push({ iso: date.iso, written: date.written, sentence, event: EVENT.Operative });
          continue;
        }
        if (!OWN_CLAUSE.test(sentence) || !CLAUSE.test(sentence)) continue;
        const clause = ANCHORED.exec(sentence);
        const date = clause && !CONTINGENT.test(sentence) ? dateAtStart(sentence.slice(clause.index + clause[0].length)) : undefined;
        if (!clause || !date) {
          unresolved = true;
          continue;
        }
        if (!latest || date.iso > latest.iso) latest = { iso: date.iso, written: date.written, sentence, event: clause[1]!.startsWith("take") ? EVENT.Effective : EVENT.Operative };
      }
    }
  }
  return { ...(latest ? { latest } : {}), later, unresolved };
}

/** 1 January of the year after the date: the day a statute enacted at a regular session takes effect (Cal. Const. art. IV, section 8(c), R31). */
const nextNewYear = (iso: string): string => `${Number(iso.slice(0, 4)) + 1}-01-01`;

export function extractBill(c: Candidate, text: string, passages: Passage[], meta: ExtractMeta): ExtractResult {
  const sections = bodySections(toSections(text));
  const { shortTitle, subject } = shortTitleOf(text, c.id);

  const paragraphs = digestParagraphs(sections, subject);
  const first = paragraphs?.[0];
  if (first === undefined) return noSummary();
  const history = parseLegislativeHistory(text);
  if (history.length === 0) return noStatus();

  // R38: the summary says what the bill would do. A digest opens with what existing law does, which is not the bill and misleads
  // (a chat answer gave an existing-law duty to SB 53); so the summary runs from the first "This bill would" / "The bill would"
  // sentence to the end of its paragraph, capped at 150 words. A digest with no such sentence keeps its first paragraph.
  const summary = quote(passages, capSentences(billWouldText(paragraphs!) ?? first));
  const digestSentences = paragraphs!.flatMap((p) => splitSentences(p));
  const provisions = digestSentences
    .map((s) => s.replace(/^\(\w+\)\s+/, "")) // "(2) This bill would ..." is the sentence that follows its number
    .filter((s) => PROVISION_START.test(s) || PROVISION_VERB.test(s))
    .slice(0, MAX_PROVISIONS)
    .map((value) => quote(passages, value));

  const introduction = history.findIndex((a) => INTRODUCTION.test(a.action));
  const timeline: Extracted["timeline"] = history
    .filter((a, i) => (INTRODUCTION.test(a.action) ? i === introduction : BILL_MILESTONES.some((m) => m.test(a.action))))
    .map((a) => ({ date: a.date, event: normalise(a.action), support: cite(passages, row(a)), parts: [a.date, normalise(a.action)] }));

  // The latest decisive action decides.
  let decisive = -1;
  for (let i = history.length - 1; i >= 0 && decisive < 0; i--) if (VETOED.test(history[i]!.action) || CHAPTERED.test(history[i]!.action)) decisive = i;

  let status: Extracted["status"];
  let statusDate: string;
  if (decisive < 0) {
    const last = history[history.length - 1]!;
    status = { value: "in-progress", support: cite(passages, row(last)) };
    statusDate = last.date;
  } else {
    const deciding = history[decisive]!;
    if (VETOED.test(deciding.action)) {
      status = { value: "vetoed", support: cite(passages, row(deciding)) };
      statusDate = deciding.date;
    } else {
      status = { value: "enacted", support: cite(passages, row(deciding)) };
      statusDate = deciding.date;
      // When the act takes effect: an operative date its own sections state wins; else an urgency statute (the digest says so)
      // takes effect on chaptering; else the constitutional default, 1 January of the next year (R31). An operative clause whose
      // date the text does not give, or makes conditional, leaves it unknown, and the bill enacted (R37). A date that is a rule's,
      // not the text's, is labelled "Takes effect", never "Operative".
      const operative = operativeDates(sections);
      const urgent = operative.latest || operative.unresolved ? undefined : digestSentences.find((s) => URGENCY.test(s));
      if (operative.latest) {
        if (operative.latest.iso <= meta.snapshotDate) {
          status = { value: "in-force", support: citeAll(passages, [row(deciding), operative.latest.sentence]) };
          statusDate = operative.latest.iso;
          timeline.push({ date: statusDate, event: operative.latest.event, support: cite(passages, operative.latest.sentence), parts: [operative.latest.written] });
        }
      } else if (urgent !== undefined) {
        const support = citeAll(passages, [row(deciding), urgent]);
        status = { value: "in-force", support };
        timeline.push({ date: statusDate, event: EVENT.Effective, support, parts: [] });
      } else if (!operative.unresolved) {
        const effective = nextNewYear(deciding.date);
        if (effective <= meta.snapshotDate) {
          status = { value: "in-force", support: cite(passages, row(deciding)) };
          statusDate = effective;
          timeline.push({ date: effective, event: EVENT.Effective, support: cite(passages, row(deciding)), parts: [] });
        }
      }
      // Parts of the act that become operative later, in the code it quotes, are events of their own.
      if (status.value === "in-force") {
        for (const iso of [...new Set(operative.later.map((l) => l.iso))].filter((d) => d > statusDate)) {
          const same = operative.later.filter((l) => l.iso === iso); // one event per date, citing every sentence that gives it
          timeline.push({ date: iso, event: EVENT.Operative, support: citeAll(passages, same.map((l) => l.sentence)), parts: [same[0]!.written] });
        }
      }
    }
  }
  timeline.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); // stable: same-day rows keep the history's order

  return {
    ok: true,
    fields: {
      ...(shortTitle ? { shortTitle } : {}),
      published: history[0]!.date,
      status,
      statusDate,
      timeline,
      summary,
      provisions,
      affected: [],
    },
  };
}
