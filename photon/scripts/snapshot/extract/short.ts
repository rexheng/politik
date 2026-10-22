// Short quotes for the records that may not be redistributed (R42). The repository is public, so the summary and each provision
// (and affected group) of a record whose publisher has not allowed redistribution is cut to at most 280 characters at a word
// boundary, plus an ellipsis: still a verbatim start of what it quotes, with the same citations. `checkClaims` ignores one
// trailing ellipsis, so a quote like this is checked as the start of the passage it cites.
// Node-only build code: never import this from photon/src.
import { MAX_RESTRICTED_QUOTE_CHARS } from "../../../src/data/redistribution.ts";
import type { Passage } from "../../../src/data/schema.ts";
import { citeAll, quote, type Cited, type Extracted } from "./common.ts";

/** The first `max` characters of `value`, backed up to the end of the last whole word (a word longer than the limit is cut hard). */
export function wordPrefix(value: string, max: number = MAX_RESTRICTED_QUOTE_CHARS): string {
  if (value.length <= max) return value;
  let end = max;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // not half a surrogate pair
  const cut = value.slice(0, end);
  if (/\s/.test(value[end] ?? "")) return cut.trimEnd(); // the cut already falls between two words
  const space = cut.search(/\s\S*$/);
  return space > 0 ? cut.slice(0, space).trimEnd() : cut;
}

/** The pieces (`parts`) of a value that lie inside its prefix: the last one may be cut short. Never empty. */
function partsOfPrefix(prefix: string, parts: string[]): string[] {
  const out: string[] = [];
  let position = 0;
  for (const part of parts) {
    const rest = prefix.slice(position);
    if (rest.trim() === "") break;
    const at = rest.indexOf(part);
    if (at >= 0) {
      out.push(part);
      position += at + part.length;
      continue;
    }
    const tail = rest.trimStart().trimEnd();
    if (part.startsWith(tail)) out.push(tail); // the piece that the cut ran through
    break;
  }
  return out.length > 0 ? out : [prefix];
}

/** The claim cut to at most `max` characters and an ellipsis, citing the passages that hold what is left; a claim already within `max` is returned as it is. */
export function shortenClaim(claim: Cited, passages: Passage[], max: number = MAX_RESTRICTED_QUOTE_CHARS): Cited {
  if (claim.value.length <= max) return claim;
  const prefix = wordPrefix(claim.value, max);
  if (claim.parts) {
    const parts = partsOfPrefix(prefix, claim.parts);
    return { value: `${prefix}…`, support: citeAll(passages, parts), parts };
  }
  const kept = quote(passages, prefix);
  return { value: `${prefix}…`, support: kept.support, ...(kept.parts ? { parts: kept.parts } : {}) };
}

/** The extraction of a restricted record with its summary, provisions and affected groups cut to short quotes. */
export function shortenRestricted(f: Extracted, passages: Passage[]): Extracted {
  return {
    ...f,
    summary: shortenClaim(f.summary, passages),
    provisions: f.provisions.map((p) => shortenClaim(p, passages)),
    affected: f.affected.map((a) => shortenClaim(a, passages)),
  };
}
