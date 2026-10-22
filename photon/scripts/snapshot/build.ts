// The snapshot build (spec section 5): candidates -> source text -> passages -> extract -> check -> the committed JSON files.
// Run it with `pnpm snapshot:build [--date YYYY-MM-DD] [--no-gebiz] [--refresh | --refresh-all] [--allow-partial] [--llm-headlines]`.
//
// Since ruling R25 ("extract, don't generate") the build makes no model call and needs no key: each record is filled from the
// official text by the extractors (extract/), and every claim is checked against the passage it cites by a string comparison
// (check.ts). Only `--llm-headlines` calls Groq, to add a one-sentence headline to each landmark (spec 5.4b); its answers are
// cached by the sha256 of the document text in `cacheDir`. Downloads are cached in `rawDir`, so a second run over unchanged
// sources makes no request and writes byte-identical files. Every candidate ends in exactly one place: policies.json, or
// manifest.excluded with a reason.
//
// The passages of a record whose publisher does not allow redistribution (redistributionOk false) are not committed (R39): they
// are written to `<outDir>-private/passages.json`, which git ignores, and rebuilt on a fresh machine by running the build again
// (a re-fetch). The committed passages.json holds the other records' passages only; policies.json keeps every record, with the
// summary and provisions of a restricted record cut to short quotes of at most 280 characters and an ellipsis (R42).
// Node-only build code: never import this from photon/src.
import { readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseDotenv } from "dotenv";
import { z } from "zod/v4";

import { checkSnapshot } from "../../../scripts/check-data.ts";
import { privateDirOf, splitPassagesByLicence } from "../../src/data/redistribution.ts";
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
import { checkClaims } from "./check.ts";
import { parseCandidates, type Candidate } from "./candidates.ts";
import { headlineFor } from "./enrich.ts";
import { extractRecord, linkRelated, withoutParts } from "./extract/index.ts";
import { shortenRestricted } from "./extract/short.ts";
import { DEFAULT_GEBIZ_MAX, fetchGebizTenders, GEBIZ_RULE, selectTenders, type GebizRule, type GebizTender } from "./gebiz.ts";
import { loadSource, type LoadSourceOptions } from "./fetch.ts";
import { parseLeginfoBillId } from "./leginfo.ts";
import { sha256Hex, splitPassages, wordCount } from "./passages.ts";
import { publisherFor } from "./publishers.ts";
import { renderReview, type ConstructedCheck } from "./review.ts";
import { verifyHeadline } from "./verify.ts";

/** The model names the manifest records when no model was used. */
const NO_MODELS = { enrich: "none", verify: "none" } as const;
export { DEFAULT_GEBIZ_MAX };
/**
 * The version of what the headline step asks and checks: its prompts and the claim it verifies. It is stored with every cached
 * headline answer, and an answer from another version is a miss. Raise it when a prompt changes in a way that makes an old
 * answer wrong.
 */
export const HEADLINE_VERSION = 1;
/** A built document with fewer words than this (tenders aside) is flagged in the summary: it may be a contents page. */
const SHORT_WORDS = 300;
const MAX_REASON = 300;
/** A page with no heading at the top is shown by its first characters, this many. */
const OPENS_CHARS = 80;
/** The partial-build guard (I5) refuses when more than this share of the listed documents failed to load. */
const MAX_LOAD_FAILURE_SHARE = 0.25;

export interface BuildOptions {
  candidatesPath: string;
  outDir: string;
  /**
   * Where the passages of the records that may not be redistributed (R39) are written, as `passages.json`. Default: `outDir` with
   * `-private` added (`photon/data/snapshot-private`), which git ignores. The committed `outDir/passages.json` holds the others only.
   */
  privateDir?: string;
  rawDir: string;
  cacheDir: string;
  reviewedPath: string;
  /** The "as of" date (YYYY-MM-DD). It decides whether a bill or an Act is in force, and is given to the headline checker as today's date. */
  snapshotDate: string;
  /** The models for the optional headlines. Needed (with `models`) only when `headlines` is set; the default build makes no model call. */
  llm?: { enrich: Llm; verify: Llm };
  /** The model names, recorded in the manifest and part of the headline cache key. Only used with `headlines`; otherwise the manifest says "none". */
  models?: { enrich: string; verify: string };
  /** Adds a one-sentence headline to each landmark (spec 5.4b), written by `llm.enrich` and checked by `llm.verify`. Default false. */
  headlines?: boolean;
  fetchImpl?: typeof fetch;
  browserbaseKey?: string;
  /**
   * Ignore the raw caches and download again: "downloads" the files an earlier run downloaded and the GeBIZ list, "all"
   * also the files placed in rawDir by hand. See fetch.ts.
   */
  refresh?: "downloads" | "all";
  /** Write the snapshot even if many documents failed to load or a landmark did (see SnapshotGuardError). Default false. */
  allowPartial?: boolean;
  /** Adds the GeBIZ tenders chosen by the selection rule. Default false. */
  gebiz?: boolean;
  /** The GeBIZ selection rule. Default: GEBIZ_RULE. */
  gebizRule?: GebizRule;
  /** Pacing and retry settings for Singapore Statutes Online (see sso.ts), replaced in tests so that they need not wait. `log` is the build's own. */
  sso?: Omit<NonNullable<LoadSourceOptions["sso"]>, "log">;
  /** The clock, for tests. */
  now?: () => Date;
  /** Progress lines: one per candidate, and one per part of a Singapore Statutes Online Act as it is fetched. */
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
  /** Claims the check removed, such as `provisions[2]` (an extractor that passes its tests should never lose one). */
  dropped: string[];
  /**
   * With `headlines`, for a landmark: "llm" (written and checked now), "cache", "dropped" (the checker or the format rule
   * rejected it, now or in the cache) or "failed" (a model call failed). The record is built without a headline in the last two.
   */
  headline?: "llm" | "cache" | "dropped" | "failed";
  reason?: string;
  /** True when a step threw (a bug in an extractor, say), as opposed to the content failing a check. */
  failed?: boolean;
  /**
   * Set on a built record whose candidate URL was constructed rather than seen (tenders aside): what its page opens with
   * (its first heading, else its first 80 characters), for a person to compare with the title.
   */
  opens?: string;
  /** The candidate's title, set together with `opens`. */
  title?: string;
}

export interface RunResult {
  manifest: Manifest;
  stats: RecordStat[];
  /** How the passages were split (R39): those in the committed file, those in the private file, and the records that are restricted. */
  passages?: { committed: number; private: number; restrictedRecords: number };
}

/**
 * The build refuses to write, because writing would replace a good committed snapshot with a mostly empty one.
 * `auth`: Groq answered HTTP 401 or 403 to a headline call. `partial`: more than 25% of the listed documents (GeBIZ tenders
 * aside) failed to load, or any landmark did; pass `allowPartial` (`--allow-partial`) to write anyway.
 */
export class SnapshotGuardError extends Error {
  constructor(
    readonly kind: "auth" | "partial",
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

/** Said when nothing could be reached: the usual causes are a proxy Node ignores, and the network itself. */
const NETWORK_HINT =
  "If this machine reaches the internet through a proxy, run with NODE_USE_ENV_PROXY=1 (Node's fetch ignores HTTP_PROXY and HTTPS_PROXY without it); otherwise check the network settings.";

/** True for the errors of a request that never got an answer: Node's "fetch failed" and the codes of the cause behind it. */
function isNetworkFailure(e: unknown): boolean {
  const cause = e instanceof Error ? (e.cause as { code?: unknown; message?: unknown } | undefined) : undefined;
  const text = `${errorMessage(e)} ${String(cause?.code ?? "")} ${String(cause?.message ?? "")}`;
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT/i.test(text);
}

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
const TendersSchema = z.array(z.object({ candidate: CandidateSchema, text: z.string().min(1), matched: z.array(z.string()).default([]) }));
type Tender = GebizTender;
/** The GeBIZ cache file: every tender the rule matched, and which rule that was. */
const TenderCacheSchema = z.object({ fingerprint: z.string(), tenders: TendersSchema });

/**
 * What decides which tenders match, and in what order: the dataset, the keywords (flat or by group), the exclude patterns,
 * the agency priority, the earliest award date and the smallest award. The quotas, the group topics and `max` are not
 * part of it. The cache holds every match, and they only say how many to keep.
 */
function ruleFingerprint(rule: GebizRule): string {
  return sha256Hex(
    JSON.stringify({
      datasetId: rule.datasetId,
      keywords: rule.keywords && [...rule.keywords].sort(),
      groups: rule.groups?.map((g) => ({ name: g.name, keywords: [...g.keywords].sort() })),
      exclude: rule.exclude && [...rule.exclude].sort(),
      agencyPriority: rule.agencyPriority,
      since: rule.since,
      minAwardSgd: rule.minAwardSgd,
    }),
  );
}

/**
 * The GeBIZ tenders to build: the rule's selection (see `selectTenders`), largest award first, at most `rule.max ?? 40`.
 * Every tender the rule matches is cached in `${rawDir}/gebiz-tenders.json` on the first fetch, together with a fingerprint
 * of the rule, and read from there while the rule is unchanged, so the output stays the same even though the live dataset
 * grows. A changed rule fetches again; a changed `max` or quota does not, because they only cut the cached list.
 * `refresh` (or deleting the file) takes a fresh selection.
 */
async function loadTenders(opts: BuildOptions): Promise<Tender[]> {
  const rule = opts.gebizRule ?? GEBIZ_RULE;
  const max = rule.max ?? DEFAULT_GEBIZ_MAX;
  if (!Number.isInteger(max) || max < 0) throw new Error(`The GeBIZ rule's max must be a whole number of at least 0, got ${max}`);
  const cachePath = join(opts.rawDir, "gebiz-tenders.json");
  const fingerprint = ruleFingerprint(rule);

  const cached = TenderCacheSchema.safeParse(opts.refresh ? undefined : await readJsonOrUndefined(cachePath));
  if (cached.success && cached.data.fingerprint === fingerprint) return selectTenders(rule, cached.data.tenders);

  let tenders: Tender[];
  try {
    tenders = await fetchGebizTenders(rule, opts.fetchImpl ?? fetch);
  } catch (e) {
    throw new Error(
      `GeBIZ tenders could not be fetched: ${errorMessage(e)}. Run with --no-gebiz to build without them.${isNetworkFailure(e) ? ` ${NETWORK_HINT}` : ""}`,
    );
  }
  await writeAtomic(cachePath, jsonText({ fingerprint, tenders }));
  return selectTenders(rule, tenders);
}

// ---------------------------------------------------------------------------------------------------------------------
// The date of a build that has not finished

const IN_PROGRESS = "in-progress.json";

/**
 * The snapshot date of an unfinished build, from `cacheDir/in-progress.json`, or undefined. A build saves its date there
 * when it starts and removes the file after it writes the snapshot. The date is part of every model cache key, so a
 * build that was stopped (by a guard, say) can only reuse the answers it already paid for under the same date: the
 * command defaults to this date when `--date` is not given.
 */
export async function readInProgressDate(cacheDir: string): Promise<string | undefined> {
  const file = await readJsonOrUndefined(join(cacheDir, IN_PROGRESS));
  const date = isRecord(file) ? file.snapshotDate : undefined;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && IsoDate.safeParse(date).success ? date : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// The build

const FetchedSchema = z.record(z.string(), z.object({ sha256: z.string(), fetched: z.string() }));
/**
 * A headline answer in the cache `cacheDir/headline/<sha256>.json`, one entry per record id. It is good for the same models
 * and the same summary (by hash); a rejected headline is cached too ("dropped"), so a re-run does not ask again.
 */
const HeadlineEntrySchema = z.object({
  version: z.number(),
  enrichModel: z.string(),
  verifyModel: z.string(),
  summaryHash: z.string(),
  outcome: z.enum(["kept", "dropped"]),
  headline: z.object({ value: z.string().min(1), support: z.array(z.string().min(1)).min(1) }).optional(),
});
const BuiltSchema = z.object({ contentHash: z.string(), builtAt: z.string() });

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string) => (text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1).trimEnd()}\u2026` : text);

/** What goes into the manifest when a step throws. The message itself goes to the console. */
const FAILED_REASON = { loading: "loading failed", extraction: "extraction failed" } as const;

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
};

type Done =
  | { kind: "built"; record: PolicyRecord; passages: Passage[]; text: string; stat: RecordStat }
  | {
      kind: "excluded";
      reason: string;
      stat: RecordStat;
      /** What really went wrong, for the console log only: the manifest gets the fixed `reason`. */
      detail?: string;
      /** True when the source document could not be loaded (a fetch, extraction or too-little-text failure). */
      loadFailed?: boolean;
    };

/** The Groq answer (HTTP 401 or 403) that stops a build, found while writing a headline. */
type AuthFailure = { status: number; message: string };

/**
 * Builds the snapshot and writes policies.json, passages.json, manifest.json and review.md to `outDir` (and the private passages
 * of restricted records to `privateDir`), and returns
 * the manifest. Throws, leaving `outDir` untouched, if the inputs are unusable (a bad candidates.md or reviewed.json, a
 * failed GeBIZ fetch), if the result fails `checkSnapshot`, or with a SnapshotGuardError (a rejected Groq key while writing
 * headlines, or too many documents that failed to load). Work already cached is kept, so a rerun after the cause is fixed
 * resumes where it stopped.
 */
export async function buildSnapshot(opts: BuildOptions): Promise<Manifest> {
  return (await runBuild(opts)).manifest;
}

/** `buildSnapshot`, plus what happened to every candidate (for the command's summary). */
export async function runBuild(opts: BuildOptions): Promise<RunResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => undefined);

  // Fail before the first fetch or model call, not after hours of them, if the manifest could not be written.
  if (!IsoDate.safeParse(opts.snapshotDate).success) throw new Error(`snapshotDate must be a real date written YYYY-MM-DD, got "${opts.snapshotDate}"`);
  if (opts.headlines && !(opts.llm && opts.models?.enrich.trim() && opts.models?.verify.trim())) {
    throw new Error("Headlines need both models (llm.enrich and llm.verify) and their names (models.enrich and models.verify)");
  }
  const models = opts.headlines ? { enrich: opts.models!.enrich.trim(), verify: opts.models!.verify.trim() } : NO_MODELS;

  const listed = parseCandidates(await readFile(opts.candidatesPath, "utf8")).filter((c) => c.include);
  // From here on the date is the build's: a rerun after a guard (or a crash) must use the same one.
  await writeAtomic(join(opts.cacheDir, IN_PROGRESS), jsonText({ snapshotDate: opts.snapshotDate }));
  const again = `run again with --date ${opts.snapshotDate}`;
  const tenders = opts.gebiz ? await loadTenders(opts) : [];
  const textFor = new Map(tenders.map((t) => [t.candidate.id, t.text]));
  const work = [...listed, ...tenders.map((t) => t.candidate)].sort(byId);
  for (let i = 1; i < work.length; i++) {
    if (work[i]!.id === work[i - 1]!.id) throw new Error(`Duplicate candidate id "${work[i]!.id}" (a GeBIZ tender has the id of a listed candidate)`);
  }
  // The California bills (read from the Legislature's bulk download), so that their histories are read together, once.
  const leginfoBills = [...new Set(work.flatMap((c) => parseLeginfoBillId(c.url)?.billId ?? []))].sort();
  const reviewed = await readReviewed(opts.reviewedPath);

  const headlineDir = join(opts.cacheDir, "headline");
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

  /**
   * The headline of a landmark (spec 5.4b): written by one call from its summary, checked by another against the passages the
   * summary cites, and cached by the document's hash under the models and the summary. A headline the checker rejects (or that
   * breaks the format rules) leaves the record without one, and so does a failed call; a rejected one is remembered, a failed
   * one is tried again on the next run. A rejected key (HTTP 401 or 403) is reported to the caller, which stops the build.
   */
  async function headlineOf(
    c: Candidate,
    summary: PolicyRecord["summary"],
    passages: Passage[],
    sha: string,
    stat: RecordStat,
  ): Promise<{ headline?: PolicyRecord["summary"]; auth?: AuthFailure }> {
    const llm = opts.llm!;
    const file = join(headlineDir, `${sha}.json`);
    const summaryHash = sha256Hex(summary.value);
    const cached = await readEntry(file, c.id, HeadlineEntrySchema);
    if (cached && cached.version === HEADLINE_VERSION && cached.enrichModel === models.enrich && cached.verifyModel === models.verify && cached.summaryHash === summaryHash) {
      stat.headline = cached.outcome === "kept" && cached.headline ? "cache" : "dropped";
      return cached.outcome === "kept" && cached.headline ? { headline: cached.headline } : {};
    }
    try {
      const written = await headlineFor(c, summary, llm.enrich);
      const accepted = written !== null && (await verifyHeadline(written, passages, llm.verify, { today: opts.snapshotDate }));
      await writeEntry(file, c.id, {
        version: HEADLINE_VERSION,
        enrichModel: models.enrich,
        verifyModel: models.verify,
        summaryHash,
        outcome: accepted ? "kept" : "dropped",
        ...(accepted ? { headline: written } : {}),
      });
      stat.headline = accepted ? "llm" : "dropped";
      return accepted ? { headline: written } : {};
    } catch (e) {
      stat.headline = "failed";
      log(`${c.id}: no headline (${oneLine(errorMessage(e))})`);
      if (e instanceof LlmError && (e.status === 401 || e.status === 403)) return { auth: { status: e.status, message: errorMessage(e) } };
      return {};
    }
  }

  async function buildOne(c: Candidate): Promise<{ done: Done; auth?: AuthFailure }> {
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
    const exclude = (reason: string, o: { failed?: boolean; detail?: string; load?: boolean } = {}): { done: Done } => ({
      done: {
        kind: "excluded",
        reason,
        stat: { ...stat, outcome: "excluded", reason, ...(o.failed ? { failed: true } : {}) },
        ...(o.detail ? { detail: o.detail } : {}),
        ...(o.load ? { loadFailed: true } : {}),
      },
    });

    let stage: keyof typeof FAILED_REASON = "loading";
    try {
      // A tender's text is a short structured description from the data.gov.sg API, so it skips the 150-word gate.
      const tenderText = textFor.get(c.id);
      const loaded =
        tenderText !== undefined
          ? ({ ok: true, text: tenderText, format: "text" } as const)
          : await loadSource(c, {
              rawDir: opts.rawDir,
              fetchImpl: opts.fetchImpl,
              browserbaseKey: opts.browserbaseKey,
              refresh: opts.refresh,
              now,
              leginfoBills,
              sso: { ...opts.sso, log },
            });
      if (!loaded.ok) return exclude(loaded.reason, { detail: loaded.detail, load: true });

      const text = loaded.text;
      const sha = sha256Hex(text);
      const passages = splitPassages(c.id, text);
      stat.words = wordCount(text);
      stat.passages = passages.length;
      if (passages.length === 0) return exclude("too little text", { detail: "no text to split into passages", load: true });
      const fetched = await fetchedFor(c.id, sha);

      stage = "extraction";
      const extracted = extractRecord(c, text, passages, {
        snapshotDate: opts.snapshotDate,
        format: loaded.format,
        ...("html" in loaded && loaded.html !== undefined ? { html: loaded.html } : {}),
      });
      // No official summary, or no official status: the document does not hold what a record needs. A content exclusion, not a failure.
      if (!extracted.ok) return exclude(extracted.reason);
      // R42: the public snapshot quotes a record that may not be redistributed in short pieces only (280 characters and an ellipsis).
      const where = publisherFor(c.url, hostOf(c.url));
      const checked = checkClaims(where.redistributionOk ? extracted.fields : shortenRestricted(extracted.fields, passages), passages, { restricted: !where.redistributionOk });
      stat.dropped = checked.dropped;
      if (checked.fatal) return exclude(checked.fatal);

      const f = withoutParts(checked.fields);
      const review = reviewFor(c.id, sha);
      stat.humanReviewed = review !== undefined;
      const base = {
        id: c.id,
        jurisdiction: c.jurisdiction,
        type: c.type,
        title: c.title,
        ...(f.shortTitle ? { shortTitle: f.shortTitle } : {}),
        issuer: where.publisher,
        status: f.status,
        ...(f.statusDate ? { statusDate: f.statusDate } : {}),
        timeline: f.timeline,
        summary: f.summary,
        provisions: f.provisions,
        affected: f.affected,
        topics: c.topics,
        related: [], // linked once every record is built (below)
        url: c.url,
        publisher: where.publisher,
        ...(f.published ? { published: f.published } : {}),
        fetched,
        sha256: sha,
        attribution: where.attribution,
        redistributionOk: where.redistributionOk,
        landmark: c.landmark,
        review: review
          ? { state: "human-reviewed" as const, reviewedAt: review.reviewedAt.slice(0, 10), reviewer: review.reviewer }
          : { state: "auto-checked" as const },
      };
      let valid = PolicyRecordSchema.safeParse(base);
      if (!valid.success) {
        const why = valid.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        return exclude(FAILED_REASON.extraction, { failed: true, detail: clip(`the assembled record is not valid: ${why}`) });
      }

      // The optional headline, for a landmark only. It never causes an exclusion.
      let auth: AuthFailure | undefined;
      if (opts.headlines && c.landmark) {
        const got = await headlineOf(c, valid.data.summary, passages, sha, stat);
        auth = got.auth;
        if (got.headline) valid = PolicyRecordSchema.safeParse({ ...base, headline: got.headline });
        if (!valid.success) return exclude(FAILED_REASON.extraction, { failed: true, detail: "the assembled record with its headline is not valid" });
      }

      // A constructed URL has never been opened by a person: show what the page begins with, to compare with the title.
      if (c.urlConfidence === "constructed" && tenderText === undefined) {
        stat.title = c.title;
        stat.opens = passages[0]!.heading ?? oneLine(passages[0]!.text).slice(0, OPENS_CHARS);
      }
      return { done: { kind: "built", record: valid.data, passages, text, stat: { ...stat, outcome: "built" } }, ...(auth ? { auth } : {}) };
    } catch (e) {
      // A thrown error (a bug in an extractor, say) costs this record, not the build.
      return exclude(FAILED_REASON[stage], { failed: true, detail: clip(`${stage} failed: ${oneLine(errorMessage(e))}`), load: stage === "loading" });
    }
  }

  const done: Done[] = [];
  for (const [i, c] of work.entries()) {
    const { done: result, auth } = await buildOne(c);
    done.push(result);
    const s = result.stat;
    // The console gets what really went wrong; the manifest only gets the short reason.
    const raw = result.kind === "excluded" && result.detail ? ` [${oneLine(result.detail)}]` : "";
    const headline = s.headline ? `, headline ${s.headline}` : "";
    const how = result.kind === "built" ? `built (${s.words} words, ${s.passages} passages${headline})` : `excluded: ${result.reason}${raw}`;
    log(`[${i + 1}/${work.length}] ${c.id}: ${how}`);

    // R14 (a): a rejected key fails every remaining headline the same way, so stop at once.
    if (auth) {
      throw new SnapshotGuardError(
        "auth",
        `Refusing to write the snapshot: Groq rejected the request with HTTP ${auth.status} on ${c.id}, after ${i + 1} of ${work.length} records (${clip(oneLine(auth.message))}). ` +
          `Check GROQ_API_KEY and the key's access to the models. Nothing was written; results already cached are kept, so ${again} once it is fixed.`,
      );
    }
  }

  // I5: documents that could not be loaded are missing from the snapshot. A few are normal (a site that is down today);
  // many, or any landmark, mean the committed snapshot should not be replaced without someone deciding so.
  if (!opts.allowPartial) {
    const listedDone = work.flatMap((c, i) => (textFor.has(c.id) ? [] : [{ c, d: done[i]! }]));
    const failed = listedDone.filter(({ d }) => d.kind === "excluded" && d.loadFailed);
    const landmarks = failed.filter(({ c }) => c.landmark);
    const tooMany = failed.length > listedDone.length * MAX_LOAD_FAILURE_SHARE;
    if (tooMany || landmarks.length > 0) {
      const share = Math.round((failed.length / listedDone.length) * 100);
      const unreachable = failed.every(({ d }) => d.kind === "excluded" && d.reason === "unreachable");
      throw new SnapshotGuardError(
        "partial",
        `Refusing to write the snapshot: ${failed.length} of the ${listedDone.length} listed documents (${share}%) failed to load` +
          (tooMany ? `, more than the ${MAX_LOAD_FAILURE_SHARE * 100}% allowed` : "") +
          (landmarks.length > 0 ? `; ${landmarks.length === 1 ? "this landmark" : "these landmarks"} failed to load: ${landmarks.map(({ c }) => c.id).join(", ")}` : "") +
          `. ${unreachable ? `${NETWORK_HINT} ` : ""}` +
          `Nothing was written; downloads and results already cached are kept, so fix the sources and ${again}, or add --allow-partial to write the snapshot without them.`,
      );
    }
  }

  // A related link may only point at a record that made it into the snapshot: they are linked from the built records alone.
  const builtDone = done.flatMap((d) => (d.kind === "built" ? [d] : []));
  const links = linkRelated(
    builtDone.map((d) => ({
      id: d.record.id,
      jurisdiction: d.record.jurisdiction,
      title: d.record.title,
      ...(d.record.shortTitle ? { shortTitle: d.record.shortTitle } : {}),
      text: d.text,
    })),
  );
  const records = builtDone.map((d) => ({ ...d.record, related: links.get(d.record.id) ?? [] })).sort(byId);
  const passages = builtDone
    .flatMap((d) => d.passages)
    .sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : a.seq - b.seq));
  const excluded = work.flatMap((c, i) => {
    const d = done[i]!;
    return d.kind === "excluded" ? [{ id: c.id, jurisdiction: c.jurisdiction, url: c.url, title: c.title, reason: d.reason }] : [];
  });

  const constructedChecks: ConstructedCheck[] = done.flatMap((d) =>
    d.kind === "built" && d.stat.opens !== undefined ? [{ id: d.record.id, opens: d.stat.opens }] : [],
  );

  const counts = {
    total: records.length,
    byJurisdiction: Object.fromEntries(JurisdictionSchema.options.map((j) => [j, records.filter((r) => r.jurisdiction === j).length])),
    byType: Object.fromEntries(RecordTypeSchema.options.map((t) => [t, records.filter((r) => r.type === t).length])),
  };

  // builtAt moves only when something else in the output does, so an unchanged re-run is byte-identical.
  const body = { snapshotDate: opts.snapshotDate, models, counts, excluded };
  const contentHash = sha256Hex(JSON.stringify([records, passages, body]));
  const builtPath = join(opts.cacheDir, "built.json");
  const prior = BuiltSchema.safeParse(await readJsonOrUndefined(builtPath));
  const builtAt = prior.success && prior.data.contentHash === contentHash ? prior.data.builtAt : now().toISOString();
  const manifest = ManifestSchema.parse({ ...body, builtAt });

  // R39: the passages of a record whose publisher does not allow redistribution are the full text of someone else's document.
  // They go to a git-ignored file; the committed passages.json holds the others. The policies keep their short attributed quotes.
  const split = splitPassagesByLicence(records, passages);
  const files = {
    "policies.json": jsonText(records),
    "passages.json": jsonText(split.open),
    "manifest.json": jsonText(manifest),
    "review.md": renderReview(records, passages, constructedChecks),
  };
  const privateFile = jsonText(split.restricted);
  // Check exactly what would be written, before writing it: a bad build must not replace a good committed snapshot.
  const problems = checkSnapshot({
    policies: JSON.parse(files["policies.json"]),
    passages: JSON.parse(files["passages.json"]),
    privatePassages: JSON.parse(privateFile),
    manifest: JSON.parse(files["manifest.json"]),
  });
  if (problems.length > 0) throw new Error(`The snapshot failed its own checks (nothing was written):\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  for (const [name, content] of Object.entries(files)) await writeAtomic(join(opts.outDir, name), content);
  await writeAtomic(join(opts.privateDir ?? privateDirOf(opts.outDir), "passages.json"), privateFile);
  await writeAtomic(builtPath, jsonText({ contentHash, builtAt }));
  await rm(join(opts.cacheDir, IN_PROGRESS), { force: true }); // the build is finished: the next one may use a new date

  return {
    manifest,
    stats: done.map((d) => d.stat),
    passages: { committed: split.open.length, private: split.restricted.length, restrictedRecords: records.filter((r) => !r.redistributionOk).length },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The command

const USAGE = "Usage: pnpm snapshot:build [--date YYYY-MM-DD] [--no-gebiz] [--refresh | --refresh-all] [--allow-partial] [--llm-headlines]\n  The build needs no key. --llm-headlines adds a one-sentence headline to each landmark and needs GROQ_API_KEY.";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function parseArgs(argv: string[]): { date?: string; gebiz: boolean; refresh?: "downloads" | "all"; allowPartial?: boolean; headlines?: boolean } {
  let date: string | undefined;
  let gebiz = true;
  let refresh: "downloads" | "all" | undefined;
  let allowPartial = false;
  let headlines = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--no-gebiz") gebiz = false;
    else if (arg === "--refresh") refresh ??= "downloads";
    else if (arg === "--refresh-all") refresh = "all";
    else if (arg === "--allow-partial") allowPartial = true;
    else if (arg === "--llm-headlines") headlines = true;
    else if (arg === "--date" || arg.startsWith("--date=")) {
      const value = arg === "--date" ? argv[++i] : arg.slice("--date=".length);
      if (value === undefined) throw new Error("--date needs a value such as --date 2026-10-15");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !IsoDate.safeParse(value).success) {
        throw new Error(`--date must be a real date written YYYY-MM-DD, got "${value}"`);
      }
      date = value;
    } else throw new Error(`Unknown argument "${arg}"`);
  }
  return { ...(date ? { date } : {}), gebiz, ...(refresh ? { refresh } : {}), ...(allowPartial ? { allowPartial } : {}), ...(headlines ? { headlines } : {}) };
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plural = (n: number, noun: string) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;

/** The text the command prints: counts, every excluded row with its reason, and the word count of every record. */
export function formatSummary({ manifest: m, stats, passages }: RunResult): string {
  const built = stats.filter((s) => s.outcome === "built");
  const landmarks = built.filter((s) => s.landmark);
  const failed = stats.filter((s) => s.failed);
  const listedExcluded = stats.filter((s) => s.outcome === "excluded" && s.type !== "tender");
  const constructed = built.filter((s) => s.opens !== undefined);
  const byType = Object.entries(m.counts.byType).filter(([, n]) => n > 0).map(([type, n]) => `${type} ${n}`);
  const withHeadlines = m.models.enrich !== NO_MODELS.enrich || m.models.verify !== NO_MODELS.verify;
  const headlines = (kind: NonNullable<RecordStat["headline"]>[]) => landmarks.filter((s) => s.headline && kind.includes(s.headline)).length;
  const lines = [
    `Snapshot as of ${m.snapshotDate} (built ${m.builtAt}).`,
    `Models: enrich ${m.models.enrich}, verify ${m.models.verify}.`,
    ...(withHeadlines
      ? [`Headlines: ${headlines(["llm", "cache"])} of ${landmarks.length} landmarks (${headlines(["dropped"])} dropped, ${headlines(["failed"])} failed).`]
      : []),
    `Records: ${m.counts.total} (${JurisdictionSchema.options.map((j) => `${j} ${m.counts.byJurisdiction[j]}`).join(", ")}). By type: ${byType.join(", ") || "none"}.`,
    ...(passages
      ? [`Passages: ${passages.committed + passages.private} (${passages.committed} committed, ${passages.private} private for ${plural(passages.restrictedRecords, "record")} that may not be redistributed).`]
      : []),
    `Landmarks: ${landmarks.length} (${landmarks.filter((s) => s.humanReviewed).length} human-reviewed).`,
    `Excluded: ${m.excluded.length}`,
    ...m.excluded.map((e) => `  ${e.id} (${e.jurisdiction}): ${e.reason}`),
    ...(failed.length > 0
      ? [`${plural(failed.length, "record")} failed in a step rather than on content. Run again with --date ${m.snapshotDate} after fixing the cause.`]
      : []),
    ...(listedExcluded.length > 0 && listedExcluded.every((s) => s.reason === "unreachable") ? [NETWORK_HINT] : []),
    ...(constructed.length > 0
      ? [
          "",
          "Constructed URLs (built from a pattern, never opened): check that each page opens with what its title says:",
          ...constructed.map((s) => `  ${s.id}: "${oneLine(s.title ?? "")}" opens with "${oneLine(s.opens!)}"`),
        ]
      : []),
    ...(built.length > 0
      ? [
          "",
          "Words extracted per record (a record with few words may be a contents page or a stub):",
          ...built.map((s) => {
            const dropped = s.dropped.length > 0 ? `, ${plural(s.dropped.length, "claim")} dropped (${s.dropped.join(", ")})` : "";
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
    return {}; // no .dev.vars: a key must then come from the environment
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

  // Only the headlines use a model, so only they need a key.
  let headlineOptions: Pick<BuildOptions, "headlines" | "llm" | "models"> = {};
  if (args.headlines) {
    const apiKey = env.GROQ_API_KEY?.trim();
    if (!apiKey) return fail("GROQ_API_KEY is not set. Add GROQ_API_KEY=... to .dev.vars in the repository root (or export it), then run again.");
    const models = resolveModels(env);
    headlineOptions = {
      headlines: true,
      models,
      llm: { enrich: groqLlm({ apiKey, model: models.enrich }), verify: groqLlm({ apiKey, model: models.verify }) },
    };
  }

  const dataDir = join(root, "photon/data/snapshot");
  const cacheDir = join(root, ".tmp-snapshot/cache");

  // Without --date, an unfinished build keeps its date, so a rerun after a guard produces the same snapshot.
  const resumed = args.date ? undefined : await readInProgressDate(cacheDir);
  if (resumed) {
    log(`Resuming the unfinished build dated ${resumed} (saved in ${join(cacheDir, IN_PROGRESS)}). Pass --date to start one with another date.`);
  }

  const options: BuildOptions = {
    candidatesPath: join(dataDir, "candidates.md"),
    outDir: dataDir,
    reviewedPath: join(dataDir, "reviewed.json"),
    rawDir: join(root, ".tmp-snapshot/raw"),
    cacheDir,
    snapshotDate: args.date ?? resumed ?? localDate(new Date()),
    ...headlineOptions,
    browserbaseKey: env.BROWSERBASE_API_KEY?.trim() || undefined,
    gebiz: args.gebiz,
    ...(args.refresh ? { refresh: args.refresh } : {}),
    ...(args.allowPartial ? { allowPartial: true } : {}),
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
