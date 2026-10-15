// Splits extracted text into the ~400-word passages the dataset stores and searches, and hashes full texts.
// Node-only build code: never import this from photon/src.
import { createHash } from "node:crypto";

import type { Passage } from "../../src/data/schema.ts";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

const HEADING_LINE = /^#{1,6}[ \t]+(\S.*)$/;
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Cuts one over-long run into pieces of at most `target` words, on word boundaries. */
function chunkWords(text: string, target: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += target) out.push(words.slice(i, i + target).join(" "));
  return out;
}

/**
 * Splits a paragraph that is too long into pieces of about `target` words, ending on sentence boundaries.
 * A single sentence longer than 1.5 x target has no boundary to use, so it is cut on word boundaries.
 */
function hardSplit(paragraph: string, target: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?]["'”’)\]]?)\s+/);
  const units = sentences.flatMap((s) => (wordCount(s) > target * 1.5 ? chunkWords(s, target) : [s]));
  const out: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const unit of units) {
    const n = wordCount(unit);
    if (current.length > 0 && words + n > target) {
      out.push(current.join(" "));
      current = [];
      words = 0;
    }
    current.push(unit);
    words += n;
  }
  if (current.length > 0) out.push(current.join(" "));
  return out;
}

type Section = { heading?: string; paragraphs: string[] };

/** Groups the text into sections: a new one starts at each `# ` heading line, and paragraphs are separated by blank lines. */
function toSections(text: string): Section[] {
  const sections: Section[] = [{ paragraphs: [] }];
  let lines: string[] = [];
  const endParagraph = () => {
    const paragraph = collapse(lines.join(" "));
    lines = [];
    if (paragraph) sections[sections.length - 1]!.paragraphs.push(paragraph);
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = HEADING_LINE.exec(line.trim());
    if (heading) {
      endParagraph();
      sections.push({ heading: collapse(heading[1]!), paragraphs: [] });
    } else if (line.trim() === "") {
      endParagraph();
    } else {
      lines.push(line);
    }
  }
  endParagraph();
  return sections;
}

/**
 * Splits text into passages with ids `${recordId}#1..n`.
 * A heading line (`# Title`) starts a new passage, and every passage in that section records the heading (the heading
 * line itself is not repeated in the text). Within a section, paragraphs are packed up to `targetWords`; a paragraph longer
 * than 1.5 x `targetWords` is split on sentence boundaries first, so no passage is longer than 1.5 x `targetWords`.
 */
export function splitPassages(recordId: string, text: string, targetWords = 400): Passage[] {
  if (!(targetWords >= 1)) throw new RangeError(`targetWords must be at least 1, got ${targetWords}`);
  const passages: Passage[] = [];

  for (const section of toSections(text)) {
    let current: string[] = [];
    let words = 0;
    const emit = () => {
      if (current.length === 0) return;
      const seq = passages.length + 1;
      passages.push({
        id: `${recordId}#${seq}`,
        recordId,
        seq,
        ...(section.heading !== undefined && { heading: section.heading }),
        text: current.join("\n\n"),
      });
      current = [];
      words = 0;
    };

    for (const paragraph of section.paragraphs) {
      const n = wordCount(paragraph);
      const pieces = n > targetWords * 1.5 ? hardSplit(paragraph, targetWords) : [paragraph];
      for (const piece of pieces) {
        const w = wordCount(piece);
        if (current.length > 0 && words + w > targetWords) emit();
        current.push(piece);
        words += w;
      }
    }
    emit();
  }

  return passages;
}
