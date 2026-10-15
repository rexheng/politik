// Step 5 of the chat pipeline: check the [n] markers in the composed answer against the sources, renumber the ones
// that are good, and build the citation list (docs/superpowers/specs/2026-10-15-chatbot-synthesis-design.md §3.5).
//   - A marker with no source behind it (0, or past the last source) is removed from the reply.
//   - The markers that stay are renumbered 1..k in order of first appearance, and `citations` is in that order.
//   - A source with no usable link (a post whose URL was not http(s) arrives with url "") is never cited: its markers
//     are removed like any other bad marker. A citation never has an empty URL.
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
  // `fetched` is not on a RecordSummary, and this step does not query the store, so it is left out.
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
  const citations = [...renumbered].map(([written, n]) => ({ ...candidates[written - 1]!, n }));
  const reply = replaceMarkers(raw.answer, (n) => renumbered.get(n)).trim();
  return { reply, citations, valid: sources.length === 0 || citations.length > 0 };
}
