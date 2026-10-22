// The deterministic check that replaces the verification pass (spec 5.4): a string comparison, not a model.
// A claim is a value, the passages it cites, and optionally `parts`, the strings that must each be found in those passages
// (default: the value itself). Both sides are normalised first (runs of whitespace become one space, the ends are
// trimmed), and a passage is searched as its heading followed by its text. Only for a record that may not be redistributed (R42) is a
// trailing ellipsis allowed: the quote is cut short, and the text before the ellipsis must be a verbatim piece of a cited passage
// that starts at a word boundary.
// `status` is a label chosen by a fixed rule and cannot be compared as text; it must still cite passages that exist, which
// `check:data` enforces. Dates and the short title are structured data, not quoted text, and are not claims.
// Node-only build code: never import this from photon/src.
import type { Passage } from "../../src/data/schema.ts";
import { NO_SUMMARY, passageHolds, passageHoldsFromWordStart, type Cited, type Extracted } from "./extract/common.ts";

export type CheckResult = {
  /** The extraction without the claims that failed (the summary stays, so the caller can name it). */
  fields: Extracted;
  /** The claims that were dropped, such as `provisions[2]` and `timeline[0]`, numbered as in the input. */
  dropped: string[];
  /** Set when the summary failed: the record has no official summary and must be excluded. */
  fatal?: typeof NO_SUMMARY;
};

const ELLIPSIS = /\s*…$/;

/**
 * True if every part occurs in at least one of the passages the claim cites, and every cited passage exists.
 * Without `parts` the value is the part. For a `restricted` record (R42: its public quotes are cut to 280 characters and an
 * ellipsis) a value that ends in one "…" is a cut quote: the text before the ellipsis, and nothing else, must be a verbatim
 * piece of a cited passage that starts at a word (not in the middle of one); a value whose `parts` are given is held to them,
 * the first of which starts at a word in the same way. For any other record "…" is just a character: it must be in the source.
 */
function holds(claim: { value: string; support: string[]; parts?: string[] }, byId: Map<string, Passage>, restricted: boolean): boolean {
  if (claim.support.length === 0 || claim.support.some((id) => !byId.has(id))) return false;
  const cited = claim.support.map((id) => byId.get(id)!);
  const cut = restricted && ELLIPSIS.test(claim.value);
  const parts = claim.parts ?? [cut ? claim.value.replace(ELLIPSIS, "") : claim.value];
  return parts.every((part, i) => part.trim() !== "" && cited.some((p) => (cut && i === 0 ? passageHoldsFromWordStart(p, part) : passageHolds(p, part))));
}

/**
 * Checks every claim of an extraction against the passages of its document. See the header. `restricted` is true for a record
 * that may not be redistributed, whose quotes may end in an ellipsis (see `holds`).
 */
export function checkClaims(f: Extracted, passages: Passage[], opts: { restricted?: boolean } = {}): CheckResult {
  const restricted = opts.restricted === true;
  const byId = new Map(passages.map((p) => [p.id, p]));
  const dropped: string[] = [];
  const keep = <T extends Cited | Extracted["timeline"][number]>(items: T[], name: string, valueOf: (t: T) => string): T[] =>
    items.filter((item, i) => {
      const ok = holds({ value: valueOf(item), support: item.support, ...(item.parts ? { parts: item.parts } : {}) }, byId, restricted);
      if (!ok) dropped.push(`${name}[${i}]`);
      return ok;
    });

  const timeline = keep(f.timeline, "timeline", (t) => t.event);
  const provisions = keep(f.provisions, "provisions", (p) => p.value);
  const affected = keep(f.affected, "affected", (a) => a.value);
  const fields: Extracted = { ...f, timeline, provisions, affected };
  return holds(f.summary, byId, restricted) ? { fields, dropped } : { fields, dropped, fatal: NO_SUMMARY };
}
