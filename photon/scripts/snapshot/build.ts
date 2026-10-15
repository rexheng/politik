// The snapshot build (spec section 5): candidates -> source text -> passages -> enrich -> verify -> the committed JSON files.
// Run it with `pnpm snapshot:build [--date YYYY-MM-DD] [--no-gebiz]`.
//
// Re-runs are cheap and repeatable. Downloads are cached in `rawDir`, and the model answers are cached by the sha256 of
// the document text in `cacheDir`, so a second run over unchanged sources makes no model calls and writes byte-identical
// files. Every candidate ends in exactly one place: policies.json, or manifest.excluded with a reason.
// Node-only build code: never import this from photon/src.
import { readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseDotenv } from "dotenv";
import { z } from "zod/v4";

import { checkSnapshot } from "../../../scripts/check-data.ts";
import {
  JurisdictionSchema,
  ManifestSchema,
  PolicyRecordSchema,
  RecordTypeSchema,
  TopicSchema,
  type Jurisdiction,
  type Manifest,
  type Passage,
  type PolicyRecord,
  type RecordType,
} from "../../src/data/schema.ts";
import { groqLlm, LlmError, resolveModels, type Llm } from "../../src/llm/groq.ts";
import { parseCandidates, type Candidate } from "./candidates.ts";
import { enrichRecord, EnrichedSchema, type Enriched } from "./enrich.ts";
import { fetchGebizTenders, GEBIZ_RULE, type GebizRule } from "./gebiz.ts";
import { loadSource } from "./fetch.ts";
import { sha256Hex, splitPassages, wordCount } from "./passages.ts";
import { publisherFor } from "./publishers.ts";
import { renderReview } from "./review.ts";
import { verifyRecord } from "./verify.ts";

/** Enrichment is sent the first passages up to this many words. Groq's free tier rejects larger requests (HTTP 413). */
export const DEFAULT_ENRICH_MAX_WORDS = 6000;
/** Tenders kept when the GeBIZ rule has no `max`. */
export const DEFAULT_GEBIZ_MAX = 40;
/** A built document with fewer words than this (tenders aside) is flagged in the summary: it may be a contents page. */
const SHORT_WORDS = 300;
const MAX_REASON = 300;

export interface BuildOptions {
  candidatesPath: string;
  outDir: string;
  rawDir: string;
  cacheDir: string;
  reviewedPath: string;
  /** The "as of" date (YYYY-MM-DD). It is also given to both models as today's date. */
  snapshotDate: string;
  llm: { enrich: Llm; verify: Llm };
  /** The model names, recorded in the manifest and part of the cache key. */
  models: { enrich: string; verify: string };
  fetchImpl?: typeof fetch;
  browserbaseKey?: string;
  /** Adds the GeBIZ tenders chosen by the selection rule. Default false. */
  gebiz?: boolean;
  /** The GeBIZ selection rule. Default: GEBIZ_RULE. */
  gebizRule?: GebizRule;
  /** Enrichment sees the first passages totalling at most this many words (the first passage always). Default 6000. */
  enrichMaxWords?: number;
  /** The clock, for tests. */
  now?: () => Date;
  /** Progress lines, one per candidate. */
  log?: (line: string) => void;
}

/** What happened to one candidate. */
export interface RecordStat {
  id: string;
  jurisdiction: Jurisdiction;
  type: RecordType;
  outcome: "built" | "excluded";
  /** Words in the extracted text (0 when the source could not be loaded). */
  words: number;
  passages: number;
  landmark: boolean;
  humanReviewed: boolean;
  /** Claims the verification step removed, such as `provisions[2]`. */
  dropped: string[];
  enrich?: "cache" | "llm";
  verify?: "cache" | "llm";
  reason?: string;
  /** True when a step threw (a model error, say), as opposed to the content failing a check. */
  failed?: boolean;
}

export interface RunResult {
  manifest: Manifest;
  stats: RecordStat[];
}

/**
 * The build refuses to write because Groq is failing wholesale (R14), not because of anything in the documents:
 * writing would replace a good committed snapshot with a mostly empty one.
 * `auth`: Groq answered HTTP 401 or 403 to some record. `llm-failures`: more than half of the records that reached
 * enrichment were lost to Groq errors (a thrown LlmError: timeout, exhausted rate limit, 5xx, an unusable reply).
 */
export class SnapshotGuardError extends Error {
  constructor(
    readonly kind: "auth" | "llm-failures",
    message: string,
  ) {
    super(message);
    this.name = "SnapshotGuardError";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Small file helpers

const jsonText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const errorMessage = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e) || "unknown error");

/** Writes through a temporary file, so an interrupted run never leaves a truncated file for the next run to trust. */
async function writeAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.part`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** The parsed JSON in a file, or undefined if the file is missing or not JSON (a cache file is then simply a miss). */
async function readJsonOrUndefined(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Cache files are objects keyed by record id, so two candidates that share one source text (and so one sha256)
 * each keep their own entry; a citation names `${recordId}#n` and must never be handed to a different record.
 */
async function readEntry<S extends z.ZodType>(path: string, id: string, schema: S): Promise<z.infer<S> | undefined> {
  const file = await readJsonOrUndefined(path);
  if (!isRecord(file)) return undefined;
  const parsed = schema.safeParse(file[id]);
  return parsed.success ? parsed.data : undefined;
}

async function writeEntry(path: string, id: string, entry: unknown): Promise<void> {
  const file = await readJsonOrUndefined(path);
  await writeAtomic(path, jsonText({ ...(isRecord(file) ? file : {}), [id]: entry }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Inputs: reviewed.json and the GeBIZ tenders

const IsoDate = z.iso.date();
const ReviewedSchema = z.array(
  z.object({
    id: z.string().min(1),
    reviewer: z.string().trim().min(1),
    reviewedAt: z.string().refine((v) => IsoDate.safeParse(v.slice(0, 10)).success && (v.length === 10 || /^[T ]/.test(v[10]!)), {
      message: "must be a date (YYYY-MM-DD)",
    }),
    sha256: z.string().min(1),
  }),
);
type Reviewed = z.infer<typeof ReviewedSchema>[number];

/** A missing file means nothing has been reviewed. A file that is there but wrong stops the build: it is hand-edited. */
async function readReviewed(path: string): Promise<Reviewed[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Cannot read ${path}: ${errorMessage(e)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${errorMessage(e)}`);
  }
  const parsed = ReviewedSchema.safeParse(json);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`${path} must be a list of { id, reviewer, reviewedAt, sha256 }: ${why}`);
  }
  return parsed.data;
}

const CandidateSchema = z.object({
  include: z.boolean(),
  id: z.string().min(1),
  jurisdiction: JurisdictionSchema,
  title: z.string().min(1),
  type: RecordTypeSchema,
  topics: z.array(TopicSchema).min(1),
  status: z.string(),
  landmark: z.boolean(),
  url: z.string().min(1),
  urlConfidence: z.enum(["seen", "constructed"]),
  why: z.string(),
});
const TendersSchema = z.array(z.object({ candidate: CandidateSchema, text: z.string().min(1) }));
type Tender = { candidate: Candidate; text: string };

/**
 * The GeBIZ tenders to build, largest award first, at most `rule.max ?? 40`. The tender texts are cached in
 * `${rawDir}/gebiz-tenders.json` on the first fetch and read from there afterwards, so the output stays the same even
 * though the live dataset grows. Delete that file to take a fresh selection.
 */
async function loadTenders(opts: BuildOptions): Promise<Tender[]> {
  const rule = opts.gebizRule ?? GEBIZ_RULE;
  const max = rule.max ?? DEFAULT_GEBIZ_MAX;
  if (!Number.isInteger(max) || max < 0) throw new Error(`The GeBIZ rule's max must be a whole number of at least 0, got ${max}`);
  const cachePath = join(opts.rawDir, "gebiz-tenders.json");

  const cached = TendersSchema.safeParse(await readJsonOrUndefined(cachePath));
  if (cached.success) return cached.data.slice(0, max);

  let tenders: Tender[];
  try {
    tenders = await fetchGebizTenders(rule, opts.fetchImpl ?? fetch);
  } catch (e) {
    throw new Error(`GeBIZ tenders could not be fetched: ${errorMessage(e)}. Run with --no-gebiz to build without them.`);
  }
  const kept = tenders.slice(0, max);
  await writeAtomic(cachePath, jsonText(kept));
  return kept;
}

// ---------------------------------------------------------------------------------------------------------------------
// The build

const FetchedSchema = z.record(z.string(), z.object({ sha256: z.string(), fetched: z.string() }));
const EnrichEntrySchema = z.object({ model: z.string(), value: EnrichedSchema });
const VerifyEntrySchema = z.object({
  model: z.string(),
  /** Which enriched value this verdict is about. A different enrichment needs a new verdict. */
  enrichedHash: z.string(),
  kept: EnrichedSchema,
  dropped: z.array(z.string()),
  fatal: z.string().optional(),
});
const BuiltSchema = z.object({ contentHash: z.string(), builtAt: z.string() });

/** The first passages whose words total at most `maxWords`. The first passage is always included. */
function firstPassages(passages: Passage[], maxWords: number): Passage[] {
  const out: Passage[] = [];
  let total = 0;
  for (const p of passages) {
    const words = wordCount(p.text);
    if (out.length > 0 && total + words > maxWords) break;
    out.push(p);
    total += words;
  }
  return out;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string) => (text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1).trimEnd()}…` : text);

type Done =
  | { kind: "built"; record: PolicyRecord; passages: Passage[]; stat: RecordStat; reachedEnrichment: true }
  | { kind: "excluded"; reason: string; stat: RecordStat; reachedEnrichment: boolean; llmError?: LlmError };

/**
 * Builds the snapshot and writes policies.json, passages.json, manifest.json and review.md to `outDir`, and returns
 * the manifest. Throws, leaving `outDir` untouched, if the inputs are unusable (a bad candidates.md or reviewed.json, a
 * failed GeBIZ fetch), if the result fails `checkSnapshot`, or with a SnapshotGuardError if Groq is failing wholesale
 * (an auth error, or more than half of the records that reached enrichment lost to Groq errors). Work already cached
 * is kept, so a rerun after the cause is fixed resumes where it stopped.
 */
export async function buildSnapshot(opts: BuildOptions): Promise<Manifest> {
  return (await runBuild(opts)).manifest;
}

/** `buildSnapshot`, plus what happened to every candidate (for the command's summary). */
export async function runBuild(opts: BuildOptions): Promise<RunResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => undefined);
  const maxWords = opts.enrichMaxWords ?? DEFAULT_ENRICH_MAX_WORDS;

  // Fail before the first fetch or model call, not after hours of them, if the manifest could not be written.
  if (!IsoDate.safeParse(opts.snapshotDate).success) throw new Error(`snapshotDate must be a real date written YYYY-MM-DD, got "${opts.snapshotDate}"`);
  if (!opts.models.enrich.trim() || !opts.models.verify.trim()) throw new Error("Both model names (enrich and verify) are required");
  if (!Number.isInteger(maxWords) || maxWords < 1) throw new Error(`enrichMaxWords must be a whole number of at least 1, got ${maxWords}`);

  const listed = parseCandidates(await readFile(opts.candidatesPath, "utf8")).filter((c) => c.include);
  const tenders = opts.gebiz ? await loadTenders(opts) : [];
  const textFor = new Map(tenders.map((t) => [t.candidate.id, t.text]));
  const work = [...listed, ...tenders.map((t) => t.candidate)].sort(byId);
  for (let i = 1; i < work.length; i++) {
    if (work[i]!.id === work[i - 1]!.id) throw new Error(`Duplicate candidate id "${work[i]!.id}" (a GeBIZ tender has the id of a listed candidate)`);
  }
  const allIds = work.map((c) => c.id);
  const reviewed = await readReviewed(opts.reviewedPath);

  const enrichDir = join(opts.cacheDir, "enrich");
  const verifyDir = join(opts.cacheDir, "verify");
  const fetchedPath = join(opts.cacheDir, "fetched.json");
  const fetchedParsed = FetchedSchema.safeParse(await readJsonOrUndefined(fetchedPath));
  const fetchedAt = fetchedParsed.success ? fetchedParsed.data : {};

  /** The time this text was first fetched, kept in the cache so a re-run writes the same value. */
  async function fetchedFor(id: string, sha: string): Promise<string> {
    const known = fetchedAt[id];
    if (known && known.sha256 === sha) return known.fetched;
    const stamp = now().toISOString();
    fetchedAt[id] = { sha256: sha, fetched: stamp };
    await writeAtomic(fetchedPath, jsonText(fetchedAt));
    return stamp;
  }

  /** The newest human review of this exact text, if any. A review of an older text no longer counts. */
  const reviewFor = (id: string, sha: string): Reviewed | undefined =>
    reviewed
      .filter((r) => r.id === id && r.sha256.toLowerCase() === sha)
      .sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : a.reviewedAt > b.reviewedAt ? -1 : 0))[0];

  async function buildOne(c: Candidate): Promise<Done> {
    const stat: RecordStat = {
      id: c.id,
      jurisdiction: c.jurisdiction,
      type: c.type,
      outcome: "excluded",
      words: 0,
      passages: 0,
      landmark: c.landmark,
      humanReviewed: false,
      dropped: [],
    };
    let reachedEnrichment = false;
    const exclude = (reason: string, failed = false, llmError?: LlmError): Done => ({
      kind: "excluded",
      reason,
      stat: { ...stat, outcome: "excluded", reason, ...(failed ? { failed: true } : {}) },
      reachedEnrichment,
      ...(llmError ? { llmError } : {}),
    });

    let stage = "loading";
    try {
      // A tender's text is a short structured description from the data.gov.sg API, so it skips the 150-word gate.
      const tenderText = textFor.get(c.id);
      const loaded =
        tenderText !== undefined
          ? ({ ok: true, text: tenderText } as const)
          : await loadSource(c, { rawDir: opts.rawDir, fetchImpl: opts.fetchImpl, browserbaseKey: opts.browserbaseKey });
      if (!loaded.ok) return exclude(loaded.reason);

      const text = loaded.text;
      const sha = sha256Hex(text);
      const passages = splitPassages(c.id, text);
      stat.words = wordCount(text);
      stat.passages = passages.length;
      if (passages.length === 0) return exclude("no text to split into passages");
      const fetched = await fetchedFor(c.id, sha);

      stage = "enrichment";
      reachedEnrichment = true;
      const enrichPath = join(enrichDir, `${sha}.json`);
      let enriched: Enriched;
      const cachedEnrich = await readEntry(enrichPath, c.id, EnrichEntrySchema);
      if (cachedEnrich && cachedEnrich.model === opts.models.enrich) {
        enriched = cachedEnrich.value;
        stat.enrich = "cache";
      } else {
        enriched = await enrichRecord(c, firstPassages(passages, maxWords), opts.llm.enrich, {
          otherIds: allIds.filter((id) => id !== c.id),
          today: opts.snapshotDate,
        });
        await writeEntry(enrichPath, c.id, { model: opts.models.enrich, value: enriched });
        stat.enrich = "llm";
      }

      stage = "verification";
      const verifyPath = join(verifyDir, `${sha}.json`);
      const enrichedHash = sha256Hex(JSON.stringify(enriched));
      let verdict: { kept: Enriched; dropped: string[]; fatal?: string };
      const cachedVerify = await readEntry(verifyPath, c.id, VerifyEntrySchema);
      if (cachedVerify && cachedVerify.model === opts.models.verify && cachedVerify.enrichedHash === enrichedHash) {
        verdict = { kept: cachedVerify.kept, dropped: cachedVerify.dropped, ...(cachedVerify.fatal ? { fatal: cachedVerify.fatal } : {}) };
        stat.verify = "cache";
      } else {
        verdict = await verifyRecord(enriched, passages, opts.llm.verify, { today: opts.snapshotDate });
        await writeEntry(verifyPath, c.id, { model: opts.models.verify, enrichedHash, ...verdict });
        stat.verify = "llm";
      }
      stat.dropped = verdict.dropped;
      // A verdict that excludes the record is cached like any other, so a re-run does not ask the model again.
      if (verdict.fatal) return exclude(verdict.fatal);

      stage = "assembly";
      const { kept } = verdict;
      const where = publisherFor(c.url, kept.issuer);
      const review = reviewFor(c.id, sha);
      stat.humanReviewed = review !== undefined;
      const checked = PolicyRecordSchema.safeParse({
        id: c.id,
        jurisdiction: c.jurisdiction,
        type: c.type,
        title: c.title,
        ...(kept.shortTitle ? { shortTitle: kept.shortTitle } : {}),
        issuer: kept.issuer,
        status: kept.status,
        ...(kept.statusDate ? { statusDate: kept.statusDate } : {}),
        timeline: kept.timeline,
        summary: kept.summary,
        provisions: kept.provisions,
        affected: kept.affected,
        topics: kept.topics,
        related: kept.related,
        url: c.url,
        publisher: where.publisher,
        ...(kept.published ? { published: kept.published } : {}),
        fetched,
        sha256: sha,
        attribution: where.attribution,
        redistributionOk: where.redistributionOk,
        landmark: c.landmark,
        review: review
          ? { state: "human-reviewed", reviewedAt: review.reviewedAt.slice(0, 10), reviewer: review.reviewer }
          : { state: "auto-checked" },
      });
      if (!checked.success) {
        const why = checked.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        return exclude(clip(`the assembled record is not valid: ${why}`), true);
      }
      return { kind: "built", record: checked.data, passages, stat: { ...stat, outcome: "built" }, reachedEnrichment: true };
    } catch (e) {
      // A thrown error (a model error such as HTTP 413, a failed repair) costs this record, not the build,
      // unless they are so many that the run as a whole is not usable (see the guard below).
      const llmError = e instanceof LlmError && (stage === "enrichment" || stage === "verification") ? e : undefined;
      return exclude(clip(`${stage} failed: ${oneLine(errorMessage(e))}`), true, llmError);
    }
  }

  const done: Done[] = [];
  for (const [i, c] of work.entries()) {
    const result = await buildOne(c);
    done.push(result);
    const s = result.stat;
    const how = result.kind === "built" ? `built (${s.words} words, ${s.passages} passages; enrich ${s.enrich}, verify ${s.verify})` : `excluded: ${result.reason}`;
    log(`[${i + 1}/${work.length}] ${c.id}: ${how}`);

    // R14 (a): a rejected key fails every remaining record the same way, so stop at once.
    if (result.kind === "excluded" && (result.llmError?.status === 401 || result.llmError?.status === 403)) {
      throw new SnapshotGuardError(
        "auth",
        `Refusing to write the snapshot: Groq rejected the request with HTTP ${result.llmError.status} on ${c.id}, after ${i + 1} of ${work.length} records (${clip(oneLine(errorMessage(result.llmError)))}). ` +
          "Check GROQ_API_KEY and the key's access to the models. Nothing was written; results already cached are kept, so run again once it is fixed.",
      );
    }
  }

  // R14 (b): too many records lost to Groq errors means the run says nothing about the documents. Fetch failures,
  // too little text and verification fatals are about the documents, so they are not counted.
  const reachedCount = done.filter((d) => d.reachedEnrichment).length;
  const lost = done.flatMap((d, i) => (d.kind === "excluded" && d.llmError ? [{ id: work[i]!.id, error: d.llmError }] : []));
  if (lost.length * 2 > reachedCount) {
    throw new SnapshotGuardError(
      "llm-failures",
      `Refusing to write the snapshot: ${lost.length} of the ${reachedCount} records that reached enrichment were lost to Groq errors (more than half), so the run is not usable. ` +
        `First error, on ${lost[0]!.id}: ${clip(oneLine(errorMessage(lost[0]!.error)))}. ` +
        "Nothing was written; results already cached are kept, so run again once Groq is reachable.",
    );
  }

  // A related link may only point at a record that made it into the snapshot.
  const builtIds = new Set(done.flatMap((d) => (d.kind === "built" ? [d.record.id] : [])));
  const records = done
    .flatMap((d) => (d.kind === "built" ? [d.record] : []))
    .map((r) => ({ ...r, related: r.related.filter((link) => link.id !== r.id && builtIds.has(link.id)) }))
    .sort(byId);
  const passages = done
    .flatMap((d) => (d.kind === "built" ? d.passages : []))
    .sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : a.seq - b.seq));
  const excluded = work.flatMap((c, i) => {
    const d = done[i]!;
    return d.kind === "excluded"
      ? [{ id: c.id, jurisdiction: c.jurisdiction, url: c.url, title: c.title, reason: d.reason }]
      : [];
  });

  const counts = {
    total: records.length,
    byJurisdiction: Object.fromEntries(JurisdictionSchema.options.map((j) => [j, records.filter((r) => r.jurisdiction === j).length])),
    byType: Object.fromEntries(RecordTypeSchema.options.map((t) => [t, records.filter((r) => r.type === t).length])),
  };

  // builtAt moves only when something else in the output does, so an unchanged re-run is byte-identical.
  const body = { snapshotDate: opts.snapshotDate, models: opts.models, counts, excluded };
  const contentHash = sha256Hex(JSON.stringify([records, passages, body]));
  const builtPath = join(opts.cacheDir, "built.json");
  const prior = BuiltSchema.safeParse(await readJsonOrUndefined(builtPath));
  const builtAt = prior.success && prior.data.contentHash === contentHash ? prior.data.builtAt : now().toISOString();
  const manifest = ManifestSchema.parse({ ...body, builtAt });

  const files = {
    "policies.json": jsonText(records),
    "passages.json": jsonText(passages),
    "manifest.json": jsonText(manifest),
    "review.md": renderReview(records, passages),
  };
  // Check exactly what would be written, before writing it: a bad build must not replace a good committed snapshot.
  const problems = checkSnapshot({
    policies: JSON.parse(files["policies.json"]),
    passages: JSON.parse(files["passages.json"]),
    manifest: JSON.parse(files["manifest.json"]),
  });
  if (problems.length > 0) throw new Error(`The snapshot failed its own checks (nothing was written):\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  for (const [name, content] of Object.entries(files)) await writeAtomic(join(opts.outDir, name), content);
  await writeAtomic(builtPath, jsonText({ contentHash, builtAt }));

  return { manifest, stats: done.map((d) => d.stat) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The command

const USAGE = "Usage: pnpm snapshot:build [--date YYYY-MM-DD] [--no-gebiz]";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function parseArgs(argv: string[]): { date?: string; gebiz: boolean } {
  let date: string | undefined;
  let gebiz = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--no-gebiz") gebiz = false;
    else if (arg === "--date" || arg.startsWith("--date=")) {
      const value = arg === "--date" ? argv[++i] : arg.slice("--date=".length);
      if (value === undefined) throw new Error("--date needs a value such as --date 2026-10-15");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !IsoDate.safeParse(value).success) {
        throw new Error(`--date must be a real date written YYYY-MM-DD, got "${value}"`);
      }
      date = value;
    } else throw new Error(`Unknown argument "${arg}"`);
  }
  return { ...(date ? { date } : {}), gebiz };
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plural = (n: number, noun: string) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;

/** The text the command prints: counts, every excluded row with its reason, and the word count of every record. */
export function formatSummary({ manifest: m, stats }: RunResult): string {
  const built = stats.filter((s) => s.outcome === "built");
  const landmarks = built.filter((s) => s.landmark);
  const failed = stats.filter((s) => s.failed);
  const byType = Object.entries(m.counts.byType).filter(([, n]) => n > 0).map(([type, n]) => `${type} ${n}`);
  const lines = [
    `Snapshot as of ${m.snapshotDate} (built ${m.builtAt}).`,
    `Models: enrich ${m.models.enrich}, verify ${m.models.verify}.`,
    `Records: ${m.counts.total} (${JurisdictionSchema.options.map((j) => `${j} ${m.counts.byJurisdiction[j]}`).join(", ")}). By type: ${byType.join(", ") || "none"}.`,
    `Landmarks: ${landmarks.length} (${landmarks.filter((s) => s.humanReviewed).length} human-reviewed).`,
    `Excluded: ${m.excluded.length}`,
    ...m.excluded.map((e) => `  ${e.id} (${e.jurisdiction}): ${e.reason}`),
    ...(failed.length > 0
      ? [`${plural(failed.length, "record")} failed in a step rather than on content. Run again to retry them: finished work is cached.`]
      : []),
    ...(built.length > 0
      ? [
          "",
          "Words extracted per record (a record with few words may be a contents page or a stub):",
          ...built.map((s) => {
            const dropped = s.dropped.length > 0 ? `, ${plural(s.dropped.length, "claim")} dropped` : "";
            const short = s.type !== "tender" && s.words < SHORT_WORDS ? " (short: check the capture)" : "";
            return `  ${s.id}: ${plural(s.words, "word")}, ${plural(s.passages, "passage")}${dropped}${short}`;
          }),
        ]
      : []),
  ];
  return lines.join("\n");
}

export interface CliDeps {
  /** Defaults to process.env. Values in .dev.vars fill in what it lacks. */
  env?: Record<string, string | undefined>;
  /** The repository root that the default paths hang from. */
  root?: string;
  /** Replaces the build, for tests. */
  run?: (options: BuildOptions) => Promise<RunResult>;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

function readDevVars(root: string): Record<string, string> {
  try {
    return parseDotenv(readFileSync(join(root, ".dev.vars")));
  } catch {
    return {}; // no .dev.vars: the key must then come from the environment
  }
}

/** Runs the command and returns the process exit code. */
export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const root = deps.root ?? REPO_ROOT;
  const fail = (message: string) => {
    error(message);
    return 1;
  };

  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    error(errorMessage(e));
    return fail(USAGE);
  }

  // Real environment variables win over .dev.vars, and a blank one counts as unset.
  const fromEnv = Object.fromEntries(Object.entries(deps.env ?? process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const env: Record<string, string | undefined> = { ...readDevVars(root), ...fromEnv };

  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) return fail("GROQ_API_KEY is not set. Add GROQ_API_KEY=... to .dev.vars in the repository root (or export it), then run again.");

  let enrichMaxWords: number | undefined;
  if (env.ENRICH_MAX_WORDS !== undefined) {
    enrichMaxWords = Number(env.ENRICH_MAX_WORDS.trim());
    if (!Number.isInteger(enrichMaxWords) || enrichMaxWords < 1) {
      return fail(`ENRICH_MAX_WORDS must be a whole number of at least 1, got "${env.ENRICH_MAX_WORDS}".`);
    }
  }

  const models = resolveModels(env);
  const dataDir = join(root, "photon/data/snapshot");
  const options: BuildOptions = {
    candidatesPath: join(dataDir, "candidates.md"),
    outDir: dataDir,
    reviewedPath: join(dataDir, "reviewed.json"),
    rawDir: join(root, ".tmp-snapshot/raw"),
    cacheDir: join(root, ".tmp-snapshot/cache"),
    snapshotDate: args.date ?? localDate(new Date()),
    llm: { enrich: groqLlm({ apiKey, model: models.enrich }), verify: groqLlm({ apiKey, model: models.verify }) },
    models,
    browserbaseKey: env.BROWSERBASE_API_KEY?.trim() || undefined,
    gebiz: args.gebiz,
    ...(enrichMaxWords !== undefined ? { enrichMaxWords } : {}),
    log,
  };

  let result: RunResult;
  try {
    result = await (deps.run ?? runBuild)(options);
  } catch (e) {
    return fail(`Build failed: ${errorMessage(e)}`);
  }
  log("");
  log(formatSummary(result));
  return 0;
}

// Run only when executed directly, so tests can import this module.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
