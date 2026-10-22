// Singapore statutes (Singapore Statutes Online) (spec 5.3).
//
// From the page's HTML (meta.ts `ssoFacts`): the summary is the Act's long title; the status and dates are its commencement
// and assent dates (in force from a commencement on or before the snapshot date; enacted when only the assent, or a later
// commencement, is shown: R34); the provisions are the Part headings of its table of contents (or, for an Act with fewer than 3 Parts,
// its section headings). The Act is assembled whole by the loader (sso.ts), so the body is in the text too, but the contents
// are what the provisions quote. A capture with no HTML (a Firecrawl capture) has the long title as its `An Act to ...`
// paragraph and its Parts as `Part N` lines; it has no dates.
// Node-only build code: never import this from photon/src.
import type { Passage } from "../../../src/data/schema.ts";
import type { Candidate } from "../candidates.ts";
import { ssoFacts, type SsoFacts } from "../meta.ts";
import { toSections } from "../passages.ts";
import {
  bodySections,
  capSentences,
  cite,
  citeAll,
  EVENT,
  noSummary,
  normalise,
  quote,
  type Cited,
  type Extracted,
  type ExtractMeta,
  type ExtractResult,
} from "./common.ts";

const MAX_PARTS = 8;
const MIN_PARTS_FOR_PARTS = 3;
const LONG_TITLE_START = /^An Act (?:to|for|relating|respecting)\b/i;
const REPEALED = /\((?:Repealed|Omitted)\)\s*$/i;

/** `PDPA` from `sg-pdpa-2012`: the id's segment between the place and the year, when it is 2 to 6 letters. */
function acronymOf(id: string): string | undefined {
  const m = /^sg-([a-z]{2,6})-\d{4}$/.exec(id);
  return m ? m[1]!.toUpperCase() : undefined;
}

/** The Part headings of a capture: a line `Part N` and the paragraph after it, joined by a space. */
function captureParts(text: string): string[] {
  const parts: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!/^Part\s+\d+[A-Z]?$/.test(lines[i]!)) continue;
    const rest: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === "") {
        if (rest.length > 0) break;
        continue;
      }
      rest.push(lines[j]!);
    }
    if (rest.length > 0) parts.push(normalise(`${lines[i]} ${rest.join(" ")}`));
  }
  return [...new Set(parts)];
}

function provisionsFrom(facts: SsoFacts | null, text: string, passages: Passage[]): Cited[] {
  let values: string[];
  if (facts) {
    const parts = facts.toc.filter((e) => e.kind === "part").map((e) => e.text);
    values =
      parts.length >= MIN_PARTS_FOR_PARTS
        ? parts
        : facts.toc.filter((e) => e.kind === "section" && !REPEALED.test(e.text)).map((e) => e.text);
  } else {
    const parts = captureParts(text);
    values = parts.length >= MIN_PARTS_FOR_PARTS ? parts : [];
  }
  return values.slice(0, MAX_PARTS).map((value) => quote(passages, value));
}

export function extractStatute(c: Candidate, text: string, passages: Passage[], meta: ExtractMeta): ExtractResult {
  const facts = meta.html !== undefined ? ssoFacts(meta.html) : null;

  let summary: Cited | undefined;
  if (facts?.longTitle) {
    summary = { value: facts.longTitle, support: citeAll(passages, facts.longTitleParts), parts: facts.longTitleParts };
  } else {
    const paragraph = bodySections(toSections(text))
      .flatMap((s) => s.paragraphs)
      .find((p) => LONG_TITLE_START.test(p));
    if (paragraph !== undefined) summary = quote(passages, capSentences(paragraph));
  }
  if (!summary) return noSummary();

  const assent = facts?.assent;
  const commencement = facts?.commencement;
  const timeline: Extracted["timeline"] = [
    ...(assent ? [{ date: assent.date, event: EVENT.Assented, support: cite(passages, assent.written), parts: [assent.written] }] : []),
    ...(commencement ? [{ date: commencement.date, event: EVENT.Commenced, support: cite(passages, commencement.written), parts: [commencement.written] }] : []),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let status: Extracted["status"];
  let statusDate: string | undefined;
  if (commencement && commencement.date > meta.snapshotDate) {
    status = { value: "enacted", support: cite(passages, commencement.written) };
    statusDate = assent?.date ?? commencement.date;
  } else if (commencement) {
    status = { value: "in-force", support: cite(passages, commencement.written) };
    statusDate = commencement.date;
  } else if (assent) {
    // Assented, and the page shows no commencement: an Act commences by notification, so only "enacted" is shown (R34).
    status = { value: "enacted", support: cite(passages, assent.written) };
    statusDate = assent.date;
  } else {
    status = { value: "in-force", support: summary.support };
  }

  const shortTitle = acronymOf(c.id);
  return {
    ok: true,
    fields: {
      ...(shortTitle ? { shortTitle } : {}),
      ...(assent ? { published: assent.date } : {}),
      status,
      ...(statusDate ? { statusDate } : {}),
      timeline,
      summary,
      provisions: provisionsFrom(facts, text, passages),
      affected: [],
    },
  };
}
