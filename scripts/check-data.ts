// Validates a policy snapshot (policies.json, passages.json, manifest.json).
// Zod checks every shape; the cross-checks below enforce the rules zod cannot express.
// Usage: pnpm check:data [snapshot-dir]   (default: photon/data/snapshot)
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { z } from "zod/v4";

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

function checkRecord(r: PolicyRecord, passageIds: Set<string>, recordIds: Set<string>, errors: string[]): void {
  const label = `policy ${r.id}`;

  const checkSupport = (field: string, support: string[]) => {
    for (const passageId of support) {
      if (!passageIds.has(passageId)) {
        errors.push(`${label}: ${field} support references unknown passage "${passageId}"`);
      }
    }
  };
  checkSupport("status", r.status.support);
  checkSupport("summary", r.summary.support);
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

/** Returns human-readable errors; an empty array means the snapshot is valid. */
export function checkSnapshot(input: { policies: unknown; passages: unknown; manifest: unknown }): string[] {
  const errors: string[] = [];

  const policies = parseAll("policy", "policies", input.policies, PolicyRecordSchema, errors);
  const passages = parseAll("passage", "passages", input.passages, PassageSchema, errors);

  for (const record of policies.valid) checkRecord(record, passages.ids, policies.ids, errors);

  for (const p of passages.valid) {
    if (!policies.ids.has(p.recordId)) {
      errors.push(`passage ${p.id}: recordId "${p.recordId}" is not a record in policies.json`);
    }
  }
  checkPassageSequences(passages.valid, errors);

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

  return errors;
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
  if (errors.length === 0) errors.push(...checkSnapshot({ policies, passages, manifest }));

  if (errors.length > 0) {
    console.error(`${errors.length} problem${errors.length === 1 ? "" : "s"} in ${dir}:`);
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  const m = ManifestSchema.parse(manifest);
  console.log(
    `ok: ${m.counts.total} records, ${(passages as unknown[]).length} passages, snapshot as of ${m.snapshotDate}`,
  );
  return 0;
}

// Run only when executed directly, so tests can import checkSnapshot.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
