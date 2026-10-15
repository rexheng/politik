// Turns free text into a safe FTS5 MATCH expression. Only letters, digits and their combining marks
// survive, and each term is double-quoted, so no FTS operator in the input (NEAR, AND, OR, NOT, *, ^, :,
// parentheses, quotes) can reach the query parser. Quoted terms are ANDed by default, or ORed with
// `match: "any"` (the only operator we ever write, between quoted terms). The table's own tokenizer
// still stems them, so "centres" finds "centre".

const MAX_TERMS = 32;

const TERM = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu;

/** Words that carry no search value. The question router drops these too, so its keywords match what FTS keeps. */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    "a an and are as at be but by for from has have how if in into is its of on or such than that the their then " +
    "there these they this to was were what when where which who why will with"
  ).split(" "),
);

/**
 * `'"frontier" "ai"'` for "frontier AI", or `null` when nothing searchable is left.
 * `match` is "all" (every term must be in the passage, the default) or "any" (`'"frontier" OR "ai"'`).
 */
export function toFtsQuery(text: string, match: "all" | "any" = "all"): string | null {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const found of text.normalize("NFKC").toLowerCase().matchAll(TERM)) {
    const term = found[0];
    if (STOP_WORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    terms.push(`"${term}"`);
    if (terms.length === MAX_TERMS) break;
  }
  return terms.length ? terms.join(match === "any" ? " OR " : " ") : null;
}
