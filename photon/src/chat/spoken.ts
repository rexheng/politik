// A reply as speech, for the voice route and anywhere else the text is read aloud (design §4): no [n] markers and no
// markdown, each bullet or heading a sentence of its own, and no more than `max` characters, cut at a sentence end.
import { ABBREVIATION, stripMarkers } from "./cite.ts";
import { FALLBACK_REPLY } from "./index.ts";
import type { ChatResponse } from "./types.ts";

/** The most characters a spoken reply has by default. */
export const SPOKEN_MAX_CHARS = 600;

/** A sentence end, with any closing quote or bracket after it, that is followed by a space or the end of the text. */
const SENTENCE_END = /[.!?]["')\]”’]*(?=\s|$)/g;
/** A line that already ends a sentence, or opens a list ("What to watch:"). */
const ENDS_LINE = /[.!?:]["')\]”’]*$/;
/** The start of a heading or a bullet. */
const LINE_MARK = /^(?:#{1,6}\s+|[-*•]\s+)/;
/** The reply as plain sentences; see the header. A reply with nothing to say gives "". */
export function toSpoken(reply: string, max = SPOKEN_MAX_CHARS): string {
  const sentences = stripMarkers(reply)
    .replace(/[*`]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(LINE_MARK, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => (ENDS_LINE.test(line) ? line : `${line.replace(/[,;]+$/, "")}.`));
  const text = sentences.join(" ");
  if (!(max >= 1)) return "";
  return text.length <= max ? text : cut(text, max);
}

/** `text` (longer than `max`) up to its last sentence end that fits, else up to the last word that fits plus a full stop. */
function cut(text: string, max: number): string {
  let end = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const stop = m.index + m[0].length;
    if (stop > max) break;
    if (m[0][0] === "." && ABBREVIATION.test(text.slice(0, m.index + 1))) continue;
    end = stop;
  }
  if (end > 0) return text.slice(0, end);

  // No sentence ends in range: the first sentence alone is too long. Cut at a word, and say it as a sentence.
  let head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  if (space > 0) head = head.slice(0, space);
  head = head.replace(/[\ud800-\udbff]$/, "").replace(/[\s,;:\-–—(]+$/, "");
  return head ? `${head}.` : "";
}

/** The most record titles a spoken fallback names. */
export const SPOKEN_FALLBACK_TITLES = 3;

/** "A", "A and B" or "A, B and C". */
function joinTitles(titles: string[]): string {
  return titles.length <= 1 ? (titles[0] ?? "") : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

/** The fixed fallback line up to its dash: "I couldn't write a summary just now." (the rest, "here are the records", cannot be heard as a list). */
const FALLBACK_LEAD = (() => {
  const dash = FALLBACK_REPLY.indexOf(" — ");
  return dash > 0 ? `${FALLBACK_REPLY.slice(0, dash)}.` : FALLBACK_REPLY;
})();

/**
 * A response as speech. An answer is `toSpoken(reply)`. A fallback that has records (the model could not write a summary)
 * names them, because "here are the most relevant records" means nothing without a screen: "I couldn't write a summary
 * just now. The most relevant records are SB 53, SB 1047 and PDPA." (up to three, by short title where there is one).
 */
export function toSpokenResponse(response: Pick<ChatResponse, "reply" | "mode" | "citations">, max = SPOKEN_MAX_CHARS): string {
  if (response.mode !== "fallback" || response.citations.length === 0) return toSpoken(response.reply ?? "", max);
  const titles = response.citations
    .slice(0, SPOKEN_FALLBACK_TITLES)
    .map((c) => (c.shortTitle?.trim() || c.title).replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, ""))
    .filter(Boolean);
  if (titles.length === 0) return toSpoken(response.reply ?? "", max);
  return toSpoken(`${FALLBACK_LEAD} The most relevant records are ${joinTitles(titles)}.`, max);
}
