// Fills a record's fields from the text of its official source, with no model (spec 5.3, ruling R25: extract, don't generate).
// One extractor per source type reads the document's text (and, for an HTML page, its raw HTML) and returns the summary,
// status, dates, timeline and provisions as verbatim excerpts or as labels chosen by fixed rules, each with the passages it
// cites; `check.ts` then proves them against those passages. `type`, `title`, `topics` and `landmark` are not extracted: they
// come from the approved candidate row. The function is pure: no I/O, no clock, no network, and the same input gives the
// same output. `parts` (the strings a claim must find in its passages) exist only while building and are taken off by
// `withoutParts` before a record is assembled.
// Node-only build code: never import this from photon/src.
import type { Passage } from "../../../src/data/schema.ts";
import type { Candidate } from "../candidates.ts";
import { extractBill } from "./bill.ts";
import type { Cited, ExtractMeta, ExtractResult, Extracted } from "./common.ts";
import { extractHansard } from "./hansard.ts";
import { extractHtml } from "./html.ts";
import { extractPdf } from "./pdf.ts";
import { extractStatute } from "./statute.ts";
import { extractTender } from "./tender.ts";

export type { Cited, Extracted, ExtractMeta, ExtractResult } from "./common.ts";
export { linkRelated } from "./related.ts";

/**
 * Extracts the record fields of one candidate from its document. `text` is the loader's text, `passages` its split (the
 * citations name them) and `meta` the snapshot date, the source format and, for an HTML page, its raw HTML.
 * Returns the reason when the document has no official summary, or a bill has no status.
 */
export function extractRecord(c: Candidate, text: string, passages: Passage[], meta: ExtractMeta): ExtractResult {
  switch (c.type) {
    case "bill":
      // The bill rules read the California Legislature's text (digest and history). A bill of another place is a web page or a
      // PDF, such as a ministry's page about a Singapore bill, and is read as one.
      if (c.jurisdiction !== "US-CA") return meta.format === "pdf" ? extractPdf(c, text, passages, meta) : extractHtml(c, text, passages, meta);
      return extractBill(c, text, passages, meta);
    case "statute":
      return extractStatute(c, text, passages, meta);
    case "tender":
      return extractTender(c, text, passages, meta);
    case "hansard":
      return extractHansard(c, text, passages, meta);
    case "press-release":
    case "guidance":
    case "regulation":
    case "executive-order":
      return meta.format === "pdf" ? extractPdf(c, text, passages, meta) : extractHtml(c, text, passages, meta);
  }
}

type WithoutParts<T> = T extends { parts?: string[] } ? Omit<T, "parts"> : T;
const strip = <T extends { parts?: string[] }>({ parts: _parts, ...rest }: T): WithoutParts<T> => rest as WithoutParts<T>;

/** The extraction without `parts` on any claim, the shape the record stores. */
export function withoutParts(f: Extracted): {
  shortTitle?: string;
  published?: string;
  status: Extracted["status"];
  statusDate?: string;
  timeline: { date: string; event: string; support: string[] }[];
  summary: { value: string; support: string[] };
  provisions: { value: string; support: string[] }[];
  affected: { value: string; support: string[] }[];
} {
  return {
    ...f,
    timeline: f.timeline.map((t) => strip(t)),
    summary: strip<Cited>(f.summary),
    provisions: f.provisions.map((p) => strip(p)),
    affected: f.affected.map((a) => strip(a)),
  };
}
