// Validates a policy snapshot (policies.json, passages.json, manifest.json, and the private passages if they are there).
// Zod checks every shape; the cross-checks below enforce the rules zod cannot express.
// The passages of a record whose publisher does not allow redistribution (R39) are not committed: they are in
// `<dir>-private/passages.json` (git-ignored). The two files are checked together; with the private file missing, those records'
// claims are not checked against their passages, which is a warning, not an error. Restricted text in the committed file is an error.
// Usage: pnpm check:data [snapshot-dir]   (default: photon/data/snapshot)
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { z } from "zod/v4";

import { MAX_RESTRICTED_CLAIM_CHARS, privateDirOf, restrictedRecordIds } from "../photon/src/data/redistribution.ts";
import {
  JurisdictionSchema,
  ManifestSchema,
  PassageSchema,
  PolicyRecordSchema,
  RecordTypeSchema,
  type Passage,
  type PolicyRecord,
} from "../photon/src/data/schema.ts";

const DEFAULT_DIR = fileURLToPath(new URL("../photon/data/snapshot/", import.meta.url));

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, segment) => {
    if (typeof segment === "number") return `${out}[${segment}]`;
    return out ? `${out}.${String(segment)}` : String(segment);
  }, "");
}

function formatIssues(label: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = formatPath(issue.path);
    return path ? `${label}: ${path}: ${issue.message}` : `${label}: ${issue.message}`;
  });
}

function idOf(item: unknown): string | undefined {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : undefined;
}

/** Parse every item of `items` with `schema`; report shape errors and duplicate ids. */
function parseAll<S extends z.ZodType>(
  noun: string,
  plural: string,
  items: unknown,
  schema: S,
  errors: string[],
): { valid: z.infer<S>[]; ids: Set<string>; allValid: boolean } {
  const valid: z.infer<S>[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(items)) {
    errors.push(`${plural}: expected an array of ${plural}`);
    return { valid, ids, allValid: false };
  }
  items.forEach((item, index) => {
    const id = idOf(item);
    const label = id ? `${noun} ${id}` : `${plural}[${index}]`;
    if (id) {
      if (ids.has(id)) errors.push(`${label}: duplicate ${noun} id`);
      ids.add(id);
    }
    const parsed = schema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
    else errors.push(...formatIssues(label, parsed.error));
  });
  return { valid, ids, allValid: valid.length === items.length };
}

function checkRecord(r: PolicyRecord, passageIds: Set<string>, recordIds: Set<string>, errors: string[], unchecked = false): void {
  const label = `policy ${r.id}`;

  const checkSupport = (field: string, support: string[]) => {
    for (const passageId of support) {
      // The private passages are missing: a restricted record's own passages cannot be looked up.
      if (unchecked && passageId.startsWith(`${r.id}#`)) continue;
      if (!passageIds.has(passageId)) {
        errors.push(`${label}: ${field} support references unknown passage "${passageId}"`);
      }
    }
  };
  checkSupport("status", r.status.support);
  checkSupport("summary", r.summary.support);
  if (r.headline) checkSupport("headline", r.headline.support);
  r.provisions.forEach((claim, i) => checkSupport(`provisions[${i}]`, claim.support));
  r.affected.forEach((claim, i) => checkSupport(`affected[${i}]`, claim.support));
  r.timeline.forEach((event, i) => checkSupport(`timeline[${i}]`, event.support));

  r.related.forEach((link, i) => {
    if (!recordIds.has(link.id)) errors.push(`${label}: related[${i}] references unknown record "${link.id}"`);
  });

  for (let i = 1; i < r.timeline.length; i++) {
    const prev = r.timeline[i - 1]!;
    const next = r.timeline[i]!;
    if (next.date < prev.date) {
      errors.push(
        `${label}: timeline must be sorted ascending, but timeline[${i}] (${next.date}) is before timeline[${i - 1}] (${prev.date})`,
      );
    }
  }
}

function checkPassageSequences(passages: Passage[], errors: string[]): void {
  const seqsByRecord = new Map<string, number[]>();
  for (const p of passages) seqsByRecord.set(p.recordId, [...(seqsByRecord.get(p.recordId) ?? []), p.seq]);
  for (const [recordId, seqs] of seqsByRecord) {
    seqs.sort((a, b) => a - b);
    if (seqs.some((seq, i) => seq !== i + 1)) {
      errors.push(`passages for ${recordId}: seq must run 1..${seqs.length} without gaps or repeats (found ${seqs.join(", ")})`);
    }
  }
}

function checkCounts(records: PolicyRecord[], manifest: z.infer<typeof ManifestSchema>, errors: string[]): void {
  const compare = (name: string, declared: number, actual: number, what: string) => {
    if (declared !== actual) errors.push(`manifest ${name} is ${declared} but policies.json has ${actual} ${what}`);
  };
  compare("counts.total", manifest.counts.total, records.length, "records");
  for (const jurisdiction of JurisdictionSchema.options) {
    compare(
      `counts.byJurisdiction.${jurisdiction}`,
      manifest.counts.byJurisdiction[jurisdiction],
      records.filter((r) => r.jurisdiction === jurisdiction).length,
      `${jurisdiction} records`,
    );
  }
  for (const type of RecordTypeSchema.options) {
    compare(
      `counts.byType.${type}`,
      manifest.counts.byType[type],
      records.filter((r) => r.type === type).length,
      `${type} records`,
    );
  }
}

/** The warning for a snapshot whose private passages are not on this machine, the same for check:data and seed:d1 (both print it). */
export function missingPrivateWarning(ids: string[], path = "the private passages file (<snapshot dir>-private/passages.json)"): string {
  const shown = `${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", ..." : ""}`;
  return (
    `${path} is missing, so ${ids.length} record${ids.length === 1 ? "" : "s"} that may not be redistributed (${shown}) ` +
    `${ids.length === 1 ? "has" : "have"} no passages here: their claims were not checked against the text, and seed:d1 loads them with no passage text, so passage search cannot find them. ` +
    "Run pnpm snapshot:build again to write the file: it fetches the sources again."
  );
}

export interface SnapshotInput {
  policies: unknown;
  /** The committed passages.json. */
  passages: unknown;
  manifest: unknown;
  /** The private passages (restricted records), or undefined when that file is missing. */
  privatePassages?: unknown;
  /** Where that file belongs, for the warning when it is missing. */
  privatePath?: string;
}

/** Errors (an empty array means the snapshot is valid) and warnings (things that were not checked). */
export function inspectSnapshot(input: SnapshotInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const policies = parseAll("policy", "policies", input.policies, PolicyRecordSchema, errors);
  const passages = parseAll("passage", "passages", input.passages, PassageSchema, errors);
  const privateMissing = input.privatePassages === undefined;
  const privatePassages = privateMissing
    ? { valid: [] as Passage[], ids: new Set<string>() }
    : parseAll("private passage", "private passages", input.privatePassages, PassageSchema, errors);

  const restricted = restrictedRecordIds(policies.valid);
  const allIds = new Set([...passages.ids, ...privatePassages.ids]);
  for (const id of privatePassages.ids) if (passages.ids.has(id)) errors.push(`passage ${id}: duplicate passage id (it is in both passages.json and the private passages)`);

  for (const record of policies.valid) checkRecord(record, allIds, policies.ids, errors, privateMissing && restricted.has(record.id));
  // R42: the committed summary and provisions of a restricted record are short quotes, not the document.
  for (const record of policies.valid) {
    if (!restricted.has(record.id)) continue;
    const tooLong = (field: string, value: string) => {
      if (value.length > MAX_RESTRICTED_CLAIM_CHARS) {
        errors.push(`policy ${record.id}: ${field} is ${value.length} characters, but a record that may not be redistributed is quoted at most ${MAX_RESTRICTED_CLAIM_CHARS} (280 and an ellipsis)`);
      }
    };
    tooLong("summary", record.summary.value);
    record.provisions.forEach((p, i) => tooLong(`provisions[${i}]`, p.value));
    record.affected.forEach((a, i) => tooLong(`affected[${i}]`, a.value));
  }

  for (const p of passages.valid) {
    if (!policies.ids.has(p.recordId)) {
      errors.push(`passage ${p.id}: recordId "${p.recordId}" is not a record in policies.json`);
    } else if (restricted.has(p.recordId)) {
      errors.push(
        `passage ${p.id}: record "${p.recordId}" is restricted (its publisher does not allow redistribution), so its passages must not be committed; they belong in the private passages file`,
      );
    }
  }
  for (const p of privatePassages.valid) {
    if (!policies.ids.has(p.recordId)) errors.push(`private passage ${p.id}: recordId "${p.recordId}" is not a record in policies.json`);
    else if (!restricted.has(p.recordId)) errors.push(`private passage ${p.id}: record "${p.recordId}" may be redistributed, so its passages belong in the committed passages.json, not the private file`);
  }
  checkPassageSequences([...passages.valid, ...privatePassages.valid], errors);

  if (privateMissing && restricted.size > 0) warnings.push(missingPrivateWarning([...restricted].sort(), input.privatePath));

  const manifest = ManifestSchema.safeParse(input.manifest);
  if (!manifest.success) {
    errors.push(...formatIssues("manifest", manifest.error));
  } else {
    // Counts are only meaningful when every record parsed; otherwise they would just echo the shape errors.
    if (policies.allValid) checkCounts(policies.valid, manifest.data, errors);
    for (const entry of manifest.data.excluded) {
      if (policies.ids.has(entry.id)) {
        errors.push(`manifest excluded entry "${entry.id}" is also a record in policies.json`);
      }
    }
  }

  return { errors, warnings };
}

/** Returns human-readable errors; an empty array means the snapshot is valid. */
export function checkSnapshot(input: SnapshotInput): string[] {
  return inspectSnapshot(input).errors;
}

function readJson(path: string, errors: string[]): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function main(argv: string[]): number {
  const dir = argv[0] ? resolve(argv[0]) : DEFAULT_DIR;
  const errors: string[] = [];
  const policies = readJson(resolve(dir, "policies.json"), errors);
  const passages = readJson(resolve(dir, "passages.json"), errors);
  const manifest = readJson(resolve(dir, "manifest.json"), errors);
  const privateFile = resolve(privateDirOf(dir), "passages.json");
  const privatePassages = existsSync(privateFile) ? readJson(privateFile, errors) : undefined;
  let warnings: string[] = [];
  if (errors.length === 0) {
    const result = inspectSnapshot({ policies, passages, manifest, privatePassages, privatePath: privateFile });
    errors.push(...result.errors);
    warnings = result.warnings;
  }

  for (const warning of warnings) console.error(`Warning: ${warning}`);
  if (errors.length > 0) {
    console.error(`${errors.length} problem${errors.length === 1 ? "" : "s"} in ${dir}:`);
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  const m = ManifestSchema.parse(manifest);
  const committed = (passages as unknown[]).length;
  const hidden = Array.isArray(privatePassages) ? privatePassages.length : 0;
  console.log(
    `ok: ${m.counts.total} records, ${committed + hidden} passages (${committed} committed, ${hidden} private), snapshot as of ${m.snapshotDate}`,
  );
  return 0;
}

// Run only when executed directly, so tests can import checkSnapshot.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
