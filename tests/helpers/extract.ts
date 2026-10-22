// Helpers for the record-extractor tests: a candidate row, and the passages of a text.
import { readFileSync } from "node:fs";

import type { Passage } from "../../photon/src/data/schema.ts";
import type { Candidate } from "../../photon/scripts/snapshot/candidates.ts";
import { splitPassages } from "../../photon/scripts/snapshot/passages.ts";

export const fixture = (name: string): string => readFileSync(new URL(`../fixtures/extract/${name}`, import.meta.url), "utf8");

export const candidate = (over: Partial<Candidate> & Pick<Candidate, "id" | "type">): Candidate => ({
  include: true,
  jurisdiction: over.id.startsWith("sg-") ? "SG" : "US-CA",
  title: "A document",
  topics: ["ai-governance"],
  status: "",
  landmark: false,
  url: "https://example.test/doc",
  urlConfidence: "seen",
  why: "Because",
  ...over,
});

/** The text of the document and its passages, as the build splits them. */
export const withPassages = (c: Candidate, text: string): { text: string; passages: Passage[] } => ({ text, passages: splitPassages(c.id, text) });
