// Parses the owner-approved candidate list (photon/data/snapshot/candidates.md) into rows.
// Node-only build code: never import this from photon/src.
import { RecordTypeSchema, TopicSchema, type Jurisdiction, type RecordType, type Topic } from "../../src/data/schema.ts";

export type Candidate = {
  include: boolean;
  id: string;
  jurisdiction: Jurisdiction;
  title: string;
  type: RecordType;
  topics: Topic[];
  /** The status cell as written, e.g. "enacted (signed 2023-10-10)". The enrich step decides the real status. */
  status: string;
  landmark: boolean;
  url: string;
  urlConfidence: "seen" | "constructed";
  why: string;
};

const COLUMNS = 10; // include, id, title, type, topics, status, landmark, url, url_confidence, why
const HEADER = /^\|\s*include\s*\|\s*id\s*\|/i;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const JURISDICTION_BY_PREFIX: Record<string, Jurisdiction> = { "ca-": "US-CA", "sg-": "SG" };

/** Splits one table row on unescaped pipes. Returns the cells with the outer pipes removed and `\|` unescaped. */
function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

const isSeparator = (line: string) => /^\|[\s:|-]+\|?$/.test(line.trim()) && line.includes("-");

function yesNo(value: string, field: string, fail: (why: string) => never): boolean {
  const v = value.toLowerCase();
  if (v === "yes") return true;
  if (v === "no") return false;
  return fail(`${field} must be yes or no, got "${value}"`);
}

function parseRow(cells: string[], line: number): Candidate {
  const [include, id = "", title, type, topics, status, landmark, url, confidence, why] = cells as [string, ...string[]];
  const fail = (reason: string): never => {
    throw new Error(`candidates.md line ${line}, row "${id}": ${reason}`);
  };

  if (!ID.test(id)) fail("id must be a lowercase slug (letters, digits and single hyphens)");
  const prefix = Object.keys(JURISDICTION_BY_PREFIX).find((p) => id.startsWith(p));
  if (!prefix) fail('id prefix must be "ca-" or "sg-"');
  const jurisdiction = JURISDICTION_BY_PREFIX[prefix as string] as Jurisdiction;

  if (!title) fail("title is empty");

  const parsedType = RecordTypeSchema.safeParse(type);
  if (!parsedType.success) fail(`type "${type}" is not a record type`);

  const topicList = topics!.split(",").map((t) => t.trim()).filter(Boolean);
  if (topicList.length === 0) fail("topics is empty");
  const parsedTopics = topicList.map((t) => {
    const p = TopicSchema.safeParse(t);
    return p.success ? p.data : fail(`topic "${t}" is not a topic`);
  });

  try {
    if (!/^https?:$/.test(new URL(url!).protocol)) throw new Error("not http");
  } catch {
    fail(`url "${url}" is not an http(s) URL`);
  }

  // R8: "seen (match unverified)" is not a confirmed URL, so it counts as constructed.
  let urlConfidence: Candidate["urlConfidence"];
  if (confidence === "constructed" || confidence === "seen (match unverified)") urlConfidence = "constructed";
  else if (confidence!.startsWith("seen")) urlConfidence = "seen";
  else return fail(`url_confidence "${confidence}" must be seen or constructed`);

  return {
    include: yesNo(include!, "include", fail),
    id,
    jurisdiction,
    title: title!,
    type: parsedType.data!,
    topics: parsedTopics,
    status: status!,
    landmark: yesNo(landmark!, "landmark", fail),
    url: url!,
    urlConfidence,
    why: why!,
  };
}

/**
 * Reads every table whose header row starts `| include | id |` and returns its rows in file order.
 * Columns are read by position: include, id, title, type, topics, status, landmark, url, url_confidence, why.
 * A malformed row throws, naming the row, so a bad edit to the approved list fails the build instead of dropping a record.
 */
export function parseCandidates(markdown: string): Candidate[] {
  const lines = markdown.split(/\r?\n/);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let inTable = false;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (HEADER.test(line)) {
      inTable = true;
      return;
    }
    if (!line.startsWith("|")) {
      inTable = false;
      return;
    }
    if (!inTable || isSeparator(line)) return;

    const cells = splitRow(line);
    const lineNo = index + 1;
    if (cells.length !== COLUMNS) {
      throw new Error(`candidates.md line ${lineNo}, row "${cells[1] ?? ""}": expected ${COLUMNS} cells, found ${cells.length}`);
    }
    const candidate = parseRow(cells, lineNo);
    if (seen.has(candidate.id)) throw new Error(`candidates.md line ${lineNo}: duplicate id "${candidate.id}"`);
    seen.add(candidate.id);
    out.push(candidate);
  });

  return out;
}
