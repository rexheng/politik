// Tenders (GeBIZ, via the data.gov.sg dataset): the text is a few `Label: value` lines built by gebiz.ts, so every field is read
// from the line that holds it, and the summary is a sentence built only from those fields (spec 5.3). The sentence is not
// in the text, so its `parts` are the field values it was built from: the check proves each is in the tender's passage.
// Node-only build code: never import this from photon/src.
import type { Candidate } from "../candidates.ts";
import type { Passage } from "../../../src/data/schema.ts";
import { citeAll, EVENT, noSummary, normalise, parseDate, type ExtractMeta, type ExtractResult } from "./common.ts";

/** The value of the first line `Label: value`, or undefined. */
function field(text: string, label: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const m = new RegExp(`^${label}:\\s*(.+?)\\s*$`).exec(line.trim());
    if (m) return normalise(m[1]!);
  }
  return undefined;
}

/** `NTT SINGAPORE PTE. LTD. (S$15,099,039); FUJITSU ASIA PTE LTD (S$532,068)` is two suppliers: the names, as written. */
const supplierNames = (line: string): string[] => line.split(/;\s*/).map((s) => s.replace(/\s*\(S\$[\d,.]+\)\s*$/, "").trim()).filter(Boolean);

export function extractTender(_c: Candidate, text: string, passages: Passage[], _meta: ExtractMeta): ExtractResult {
  const no = field(text, "Tender number");
  const description = field(text, "Description");
  const agency = field(text, "Agency");
  const date = field(text, "Award date");
  const single = field(text, "Supplier");
  const several = field(text, "Suppliers");
  const amount = single !== undefined ? field(text, "Awarded amount") : field(text, "Largest single award");
  const suppliers = single ?? several;
  const iso = parseDate(date);
  if (!no || !description || !agency || !suppliers || !amount || !date || !iso) return noSummary();

  const sentence =
    single !== undefined
      ? `${agency} awarded tender ${no} (${description}) to ${single} for ${amount} on ${date}.`
      : `${agency} awarded tender ${no} (${description}) to ${suppliers} for a largest single award of ${amount} on ${date}.`;
  const parts = [agency, no, description, suppliers, amount, date];
  const names = single !== undefined ? [single] : supplierNames(suppliers);

  return {
    ok: true,
    fields: {
      status: { value: "awarded", support: citeAll(passages, [date]) },
      statusDate: iso,
      published: iso,
      timeline: [{ date: iso, event: EVENT.Awarded, support: citeAll(passages, [date]), parts: [date] }],
      summary: { value: sentence, support: citeAll(passages, parts), parts },
      provisions: [],
      affected: [agency, ...names].map((value) => ({ value, support: citeAll(passages, [value]) })),
    },
  };
}
