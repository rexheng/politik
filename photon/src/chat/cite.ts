// Step 5 of the chat pipeline: check the [n] markers in the composed answer against the sources, renumber the ones
// that are good, and build the citation list (docs/superpowers/specs/2026-10-15-chatbot-synthesis-design.md §3.5).
//   - A marker with no source behind it (0, or past the last source) is removed from the reply.
//   - The markers that stay are renumbered 1..k in order of first appearance, and `citations` is in that order.
//   - A source with no usable link (a post whose URL was not http(s) arrives with url "") is never cited: its markers
//     are removed like any other bad marker. A citation never has an empty URL.
//   - A citation's `quote` is the stretch of the source's text (at most 280 characters) that shares the most words with
//     the sentence(s) of the answer that cite it, so a card shows the passage's evidence, not just its first lines.
import { STOP_WORDS } from "../data/fts.ts";
import type { Citation, ComposeOut, Source } from "./types.ts";

/** A citation `quote` is at most this many characters. */
export const MAX_QUOTE_CHARS = 280;

/** How close to the limit a cut must fall to be moved back to a word boundary, in characters. */
const WORD_SLACK = 60;

/**
 * One marker: one or two digits in square brackets, or a comma-separated group of them ("[1, 2]"). Spaces and tabs may
 * sit inside the brackets ("[ 1 ]"). Three or more digits are not a marker, so a year ("In [2024] it passed") or a
 * neutral citation ("Tan v Lim [2020] SGCA 5") is left as written (sources never reach 100).
 */
const MARKER = String.raw`\[[ \t]*\d{1,2}(?:[ \t]*,[ \t]*\d{1,2})*[ \t]*\]`;

/**
 * A run of adjacent markers with the horizontal space before it: "[2]", "[2][1]", "[2] [1]" or "[1, 2]".
 * Group 1 is the space, group 2 the markers. A match starts at the start of its space (the lookbehind), so a long
 * run of spaces is scanned once, not once per space.
 */
const MARKER_RUN = new RegExp(String.raw`(?<![ \t])([ \t]*)(${MARKER}(?:[ \t]*${MARKER})*)`, "g");

/** What may follow a removed marker without a space being needed between the words around it. */
const NO_SPACE_BEFORE = /[\s.,;:!?)\]]/;

/**
 * Rewrites the markers in `text`. `renumber` gives the marker to write for each number in a run, or undefined to drop it.
 * A run keeps its markers' numbers once each, in ascending order, written side by side ("[1][2]"). A run with
 * nothing left is removed with the space before it, unless a word follows straight on, which then keeps one space.
 */
export function replaceMarkers(text: string, renumber: (n: number) => number | undefined): string {
  return text.replace(MARKER_RUN, (match: string, space: string, run: string, offset: number) => {
    const kept = new Set<number>();
    for (const digits of run.matchAll(/\d+/g)) {
      const n = renumber(Number(digits[0]));
      if (n !== undefined) kept.add(n);
    }
    if (kept.size === 0) {
      const next = text[offset + match.length];
      return next === undefined || NO_SPACE_BEFORE.test(next) ? "" : space;
    }
    return space + [...kept].sort((a, b) => a - b).map((n) => `[${n}]`).join("");
  });
}

/** `text` with every [n] marker (and the space before it) removed. */
export function stripMarkers(text: string): string {
  return replaceMarkers(text, () => undefined);
}

/** The first `max` characters of `text` with its whitespace made single spaces, cut at a word where one is near and ending in "…". */
export function clipQuote(text: string, max = MAX_QUOTE_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  let end = max - 1; // room for the ellipsis
  const last = flat.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // not half a surrogate pair
  let cut = flat.slice(0, end);
  const space = cut.lastIndexOf(" ");
  if (space >= end - WORD_SLACK) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

/**
 * A full stop that belongs to an abbreviation, not the end of a sentence: one letter ("U.S.", "e.g.", "i.e.") or a
 * common short word ("Sec.", "No."). Tested on the text up to and including the full stop.
 */
export const ABBREVIATION = /(?:^|[^\p{L}])(?:\p{L}|nos?|secs?|sect|art|arts|para|ch|pt|vol|fig|st|dr|mr|mrs|ms|vs|inc|ltd|corp|co|gov|dept|approx|cf)\.$/iu;

/** A sentence end: ., ! or ?, any markers after it, then the start of the next sentence or the end of the line. */
const SENTENCE_END = new RegExp(String.raw`[.!?]+(?:[ \t]*${MARKER})*(?=[ \t]+[A-Z"“'(*\[]|[ \t]*$)`, "g");

/**
 * The sentences of one line, each with the markers that follow its full stop. A full stop after an abbreviation
 * ("U.S.", "e.g.", "i.e.", "Sec.") does not end a sentence. The pieces joined give the line back.
 */
export function splitSentences(line: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const m of line.matchAll(SENTENCE_END)) {
    if (m[0][0] === "." && ABBREVIATION.test(line.slice(0, m.index + 1))) continue;
    const end = m.index + m[0].length;
    sentences.push(line.slice(start, end));
    start = end;
  }
  if (start < line.length || sentences.length === 0) sentences.push(line.slice(start));
  return sentences;
}

// ---- a quote chosen by the sentence that cites it ---------------------------------------------------------------

const WORD = /[\p{L}\p{N}]+/gu;
/** Words that tell nothing about which stretch of a passage a sentence rests on. */
const COMMON_WORDS = new Set([...STOP_WORDS, ..."also any all each not shall may must can could would should some such than too very their there these those been being does did doing more most other only own same so".split(" ")]);

/** A word reduced for comparing: lowercase, with a plural "s" taken off. */
const stemOf = (word: string): string => {
  const w = word.toLowerCase();
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
};

/** The distinct stems of the words in `text` that carry meaning (not common words, not single characters). */
function contentStems(text: string): Set<string> {
  const stems = new Set<string>();
  for (const m of text.matchAll(WORD)) {
    const lower = m[0].toLowerCase();
    if (lower.length > 1 && !COMMON_WORDS.has(lower)) stems.add(stemOf(lower));
  }
  return stems;
}

/**
 * At most `max` characters of `text`: the stretch that shares the most different words with `claim`, the sentence(s)
 * that cite it, earliest on a tie, centred a little so a lead-in comes before the first shared word. With no word in
 * common (or no claim) it is the start of the text, as `clipQuote` gives. A cut end of the stretch is marked with "…".
 */
export function bestQuote(text: string, claim: string, max = MAX_QUOTE_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const wanted = contentStems(claim);
  if (wanted.size === 0) return clipQuote(flat, max);

  const tokens = Array.from(flat.matchAll(WORD), (m) => ({ start: m.index, end: m.index + m[0].length, stem: stemOf(m[0]) }));
  const room = max - 2; // an ellipsis may sit at each end
  let best = { first: -1, last: -1, score: 0 };
  const counts = new Map<string, number>();
  let distinct = 0;
  let hi = 0; // the window that starts at `first` is tokens[first .. hi - 1]
  for (let first = 0; first < tokens.length; first++) {
    if (hi < first) hi = first;
    while (hi < tokens.length && tokens[hi]!.end - tokens[first]!.start <= room) {
      const stem = tokens[hi]!.stem;
      if (wanted.has(stem)) {
        const had = counts.get(stem) ?? 0;
        counts.set(stem, had + 1);
        if (had === 0) distinct++;
      }
      hi++;
    }
    // Only a window that starts on a shared word is a candidate; a later start with the same score is a worse lead-in.
    if (hi > first && wanted.has(tokens[first]!.stem) && distinct > best.score) best = { first, last: hi - 1, score: distinct };
    if (hi > first) {
      const gone = tokens[first]!.stem;
      if (wanted.has(gone)) {
        const left = (counts.get(gone) ?? 1) - 1;
        counts.set(gone, left);
        if (left === 0) distinct--;
      }
    }
  }
  if (best.score === 0) return clipQuote(flat, max);

  // The content runs from the first to the last shared-word token; spend the room left over on the lead-in, up to 60 characters.
  const firstStart = tokens[best.first]!.start;
  let start = firstStart;
  let lastShared = best.last;
  while (lastShared > best.first && !wanted.has(tokens[lastShared]!.stem)) lastShared--;
  let end = tokens[lastShared]!.end;
  const spare = room - (end - start);
  start = Math.max(0, start - Math.min(60, Math.floor(spare / 2)));
  while (start > 0 && start < firstStart && /\S/.test(flat[start - 1]!)) start++; // not in the middle of a word
  end = Math.min(flat.length, start + room);
  while (end < flat.length && /\S/.test(flat[end]!) && end > start) end--; // nor end in the middle of one
  while (end > start && !/\S/.test(flat[end - 1]!)) end--;
  const code = flat.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) start++;
  const body = flat.slice(start, end).trim();
  if (!body) return clipQuote(flat, max);
  return `${start > 0 ? "…" : ""}${body}${end < flat.length && !/[.!?]["')\]”’]*$/.test(body) ? "…" : ""}`;
}

/** The sentences of `answer` that cite each source, by the number written in the answer, as one text per number. */
function citingText(answer: string): Map<number, string> {
  const byMarker = new Map<number, string[]>();
  for (const raw of answer.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]\s+|#{1,6}\s+)/, "").replaceAll("**", "");
    for (const sentence of splitSentences(line)) {
      const written = new Set<number>();
      for (const run of sentence.matchAll(MARKER_RUN)) for (const digits of run[2]!.matchAll(/\d+/g)) written.add(Number(digits[0]));
      if (written.size === 0) continue;
      const text = stripMarkers(sentence).trim();
      for (const n of written) byMarker.set(n, [...(byMarker.get(n) ?? []), text]);
    }
  }
  return new Map([...byMarker].map(([n, texts]) => [n, texts.join(" ")]));
}

/** The text a source's quote is cut from: its passage, else the record's summary, else the post. */
const textOf = (source: Source): string => (source.kind === "post" ? (source.post?.text ?? "") : (source.passage?.text ?? source.record?.summary ?? ""));

const HTTP_URL = /^https?:\/\/\S+$/i;

/** What a post is called on its card. */
export function postTitle(post: { author: string }): string {
  return post.author.trim() ? `Public post by ${post.author.trim()}` : "Public post";
}

/** The citation for a source, numbered `n`, or undefined when the source cannot be cited (no record or post, or no http(s) link). */
export function citationOf(source: Source, n: number): Citation | undefined {
  if (source.kind === "post") {
    const post = source.post;
    const url = typeof post?.url === "string" ? post.url.trim() : "";
    if (!post || !HTTP_URL.test(url)) return undefined;
    return { n, kind: "post", title: postTitle(post), url, quote: clipQuote(post.text) };
  }
  const { record, passage } = source;
  const url = typeof record?.url === "string" ? record.url.trim() : "";
  if (!record || !HTTP_URL.test(url)) return undefined;
  // `fetched` is not on a RecordSummary and this step does not read the store, so `chat()` adds it afterwards (withFetched in index.ts).
  return {
    n,
    kind: "policy",
    recordId: record.id,
    ...(passage ? { passageId: passage.id } : {}),
    title: record.title,
    ...(record.shortTitle ? { shortTitle: record.shortTitle } : {}),
    url,
    jurisdiction: record.jurisdiction,
    type: record.type,
    status: record.status,
    reviewState: record.reviewState,
    quote: clipQuote(passage?.text ?? record.summary),
  };
}

/** True when the source can be cited: it has a record or a post, with an http(s) link. */
export function isCitable(source: Source): boolean {
  return citationOf(source, 1) !== undefined;
}

/**
 * Checks the markers in `raw.answer` against `sources` (marker n is `sources[n - 1]`) and builds the citations.
 * `valid` is false when there are sources but no valid marker is left, which the caller treats as a compose failure.
 */
export function finalize(raw: ComposeOut, sources: Source[]): { reply: string; citations: Citation[]; valid: boolean } {
  const candidates = sources.map((source) => citationOf(source, 0));
  const renumbered = new Map<number, number>(); // marker as written -> marker now, in order of first appearance
  for (const digits of raw.answer.matchAll(MARKER_RUN)) {
    for (const written of digits[2]!.matchAll(/\d+/g)) {
      const n = Number(written[0]);
      if (!renumbered.has(n) && candidates[n - 1] !== undefined) renumbered.set(n, renumbered.size + 1);
    }
  }
  const claims = citingText(raw.answer);
  const citations = [...renumbered].map(([written, n]) => {
    const candidate = candidates[written - 1]!;
    const claim = claims.get(written);
    return { ...candidate, n, quote: claim ? bestQuote(textOf(sources[written - 1]!), claim) : candidate.quote };
  });
  const reply = replaceMarkers(raw.answer, (n) => renumbered.get(n)).trim();
  return { reply, citations, valid: sources.length === 0 || citations.length > 0 };
}
