// Step 2 of the chat pipeline: from the Route, gather the passages and posts an answer may cite.
// What is gathered depends on the intent (docs/superpowers/specs/2026-10-15-chatbot-synthesis-design.md §3.2):
//   brief         the records with recent events, newest first, one passage each, plus any search matches
//   explain       the named record's cited passages, then search matches
//   implications  as explain, plus the passages behind `affected`
//   sentiment     public posts (Bluesky and the client's saved ones), plus a few policy passages for context
//   out-of-scope  a three-passage search, whose only job is to notice that the corpus does cover the question
//   greeting, clarify   nothing
// Policy data is read only through ../data/store.ts. This never throws on a Bluesky failure.
import type { SourceItem } from "../contracts.ts";
import type { D1Like } from "../data/d1.ts";
import { toFtsQuery } from "../data/fts.ts";
import type { Filters, Manifest, Passage, PassageHit, PolicyRecord, RecordSummary } from "../data/schema.ts";
import { getPassages, getRecord, listRecords, recentChanges, searchPassages } from "../data/store.ts";
import type { Route, Source } from "./types.ts";

/** The most sources one answer gets. */
export const MAX_SOURCES = 12;
/** The longest passage (or post) text kept, in characters. */
export const MAX_PASSAGE_CHARS = 1200;
/** How far back "recent" reaches when the router did not say. */
export const DEFAULT_SINCE_DAYS = 120;
/** How long a Bluesky search may take before the answer goes ahead without posts. */
export const BLUESKY_TIMEOUT_MS = 3000;

/** The most posts (live and saved together) one answer gets. */
const MAX_POSTS = 6;
/** Search matches added after a brief's recent records, after an explain's own passages, and as a sentiment answer's context. */
const SEARCH_TOP = 6;
const CONTEXT_TOP = 3;
const OUT_OF_SCOPE_TOP = 3;
/** Fewer hits than this from a search that needs every term means the question is worded loosely: try any term (ruling R7). */
const MIN_ALL_HITS = 3;
/** A record has several events, so more are read than records wanted. */
const EVENT_POOL = 48;
/** How many matching passages are read to pick each recent record's best one. */
const BEST_PASSAGE_POOL = 50;
/** Records an explain is about, and the passages of those records it reads in all. */
const MAX_RECORDS = 2;
const RECORD_PASSAGE_BUDGET = 8;
/** The most a "recent" window can reach (100 years); it only keeps the date arithmetic in range. */
const MAX_SINCE_DAYS = 36_500;
const DAY_MS = 86_400_000;
/** Earlier than any event, for a brief that finds nothing in its window. */
const EARLIEST = "0001-01-01";
/** Client-supplied post lists are read only this far. */
const MAX_POSTS_SCANNED = 50;
/** A hint shorter than this must equal a title; it may not just sit inside one ("SB" is not "SB 53"). */
const MIN_PHRASE_CHARS = 5;
const MIN_SHORT_TITLE_CHARS = 4;

export interface RetrieveDeps {
  /** The snapshot manifest, for the date "recent" counts back from. */
  manifest: Manifest | null;
  /** Searches Bluesky for public posts. */
  bluesky?: (q: string) => Promise<SourceItem[]>;
  /** Posts the client already holds (from /saying). */
  knowledge?: SourceItem[];
  blueskyTimeoutMs?: number;
}

export interface Retrieved {
  sources: Source[];
  /** True only for an `out-of-scope` question the corpus does cover: the caller then treats it as `explain`. */
  promoted: boolean;
}

export async function retrieve(route: Route, db: D1Like, deps: RetrieveDeps): Promise<Retrieved> {
  switch (route.intent) {
    case "brief":
      return found(await briefSources(route, db, deps.manifest));
    case "explain":
      return found(await recordSources(route, db, false));
    case "implications":
      return found(await recordSources(route, db, true));
    case "sentiment":
      return found(await sentimentSources(route, db, deps));
    case "out-of-scope":
      return outOfScope(route, db);
    default:
      return { sources: [], promoted: false };
  }
}

const found = (sources: Source[]): Retrieved => ({ sources: sources.slice(0, MAX_SOURCES), promoted: false });

// ---- text and sources ------------------------------------------------------------------------------------------

/** `text` cut to `max` characters, at a word boundary where one is near, ending in "…". It never leaves half a surrogate pair. */
function clipText(text: string, max = MAX_PASSAGE_CHARS): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  let cut = text.slice(0, end);
  const space = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"), cut.lastIndexOf("\t"));
  if (space >= cut.length - 80) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

function policySource(record: RecordSummary, passage: Passage): Source {
  return { kind: "policy", record, passage: { ...passage, text: clipText(passage.text) } };
}

/** A post from a SourceItem, or null when it is not shaped like one. The URL is kept only if it is http(s). */
function postSource(item: unknown): Source | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const text = [o.plain, o.title].find((t): t is string => typeof t === "string" && t.trim() !== "");
  if (text === undefined) return null;
  return {
    kind: "post",
    post: {
      text: clipText(text.trim()),
      url: httpUrl(o.url),
      author: typeof o.author === "string" ? o.author.trim() : "",
      at: typeof o.happenedAt === "string" ? o.happenedAt : "",
    },
  };
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? value.trim() : "";
  } catch {
    return "";
  }
}

// ---- search ---------------------------------------------------------------------------------------------------

/**
 * Passages matching `query`: every term must appear, and when that finds fewer than three the search is retried with
 * any term (ruling R7). A one-word query has nothing to loosen, so it is not run twice.
 */
async function search(db: D1Like, query: string, filters: Filters, limit: number): Promise<PassageHit[]> {
  const strict = await searchPassages(db, query, filters, limit, { match: "all" });
  if (strict.length >= MIN_ALL_HITS || toFtsQuery(query, "any") === toFtsQuery(query, "all")) return strict;
  return searchPassages(db, query, filters, limit, { match: "any" });
}

/** The items with the first of each record id kept, in order. */
function onePerRecord<T>(items: T[], idOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const id = idOf(item);
    if (seen.has(id)) continue;
    seen.add(id);
    kept.push(item);
  }
  return kept;
}

/** The first (best) hit of each record, in hit order. */
const bestPerRecord = (hits: PassageHit[]): PassageHit[] => onePerRecord(hits, (hit) => hit.record.id);

// ---- brief -----------------------------------------------------------------------------------------------------

/** The days a router asked for, or undefined when it gave none that can be used. */
function askedDays(sinceDays: number | undefined): number | undefined {
  return typeof sinceDays === "number" && Number.isFinite(sinceDays) && sinceDays >= 1 ? Math.min(Math.floor(sinceDays), MAX_SINCE_DAYS) : undefined;
}

/** The ISO date `days` before the snapshot date (or before today, with no manifest). */
function daysBefore(manifest: Manifest | null, days: number): string {
  const snapshot = manifest ? Date.parse(`${manifest.snapshotDate}T00:00:00Z`) : Number.NaN;
  const from = Number.isFinite(snapshot) ? snapshot : Date.now();
  return new Date(from - days * DAY_MS).toISOString().slice(0, 10);
}

async function briefSources(route: Route, db: D1Like, manifest: Manifest | null): Promise<Source[]> {
  const scope: Filters = { jurisdiction: route.jurisdiction, topics: route.topics };
  const asked = askedDays(route.sinceDays);
  const since = daysBefore(manifest, asked ?? DEFAULT_SINCE_DAYS);
  // The router may leave `search` empty (a plain "what is going on") or keep scope words in it ("california ai policy").
  const keywords = route.search.trim();
  const question = route.standalone.trim() || keywords;

  const [events, pool, matches] = await Promise.all([
    recentChanges(db, { ...scope, since }, EVENT_POOL),
    question ? search(db, question, scope, BEST_PASSAGE_POOL) : [],
    keywords ? search(db, keywords, scope, SEARCH_TOP) : [],
  ]);
  // A quiet stretch still has a "latest": when the router named no window and nothing falls in the default one, look further back.
  const changes = events.length === 0 && asked === undefined ? await recentChanges(db, { ...scope, since: EARLIEST }, EVENT_POOL) : events;

  const recent = onePerRecord(changes.map((c) => c.record), (r) => r.id);
  const recentIds = new Set(recent.map((r) => r.id));
  const added = bestPerRecord(matches).filter((hit) => !recentIds.has(hit.record.id));
  const records = [...recent.slice(0, MAX_SOURCES - added.length), ...added.map((hit) => hit.record)];

  // A record's passage: the one its search found, else the best for the question, else its first.
  const passages = new Map<string, Passage>();
  for (const hit of [...bestPerRecord(matches), ...bestPerRecord(pool)]) if (!passages.has(hit.record.id)) passages.set(hit.record.id, hit.passage);
  const lacking = records.filter((r) => !passages.has(r.id));
  for (const passage of await getPassages(db, lacking.map((r) => `${r.id}#1`))) passages.set(passage.recordId, passage);

  return records.flatMap((record) => {
    const passage = passages.get(record.id);
    return passage ? [policySource(record, passage)] : [];
  });
}

// ---- explain and implications ----------------------------------------------------------------------------------

const normalise = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const hasPhrase = (haystack: string, phrase: string) => ` ${haystack} `.includes(` ${phrase} `);

/** How well a hint names a record: 3 is its short title or title, 2 a whole phrase inside its title, 1 its short title inside the hint, 0 no match. */
function hintStrength(hint: string, record: RecordSummary): number {
  const short = record.shortTitle ? normalise(record.shortTitle) : "";
  const names = [short, normalise(record.title)].filter(Boolean);
  if (names.includes(hint)) return 3;
  if (hint.length >= MIN_PHRASE_CHARS && names.some((name) => hasPhrase(name, hint))) return 2;
  if (short.length >= MIN_SHORT_TITLE_CHARS && hasPhrase(hint, short)) return 1;
  return 0;
}

/** The records the hints name, in the order of the hints, at most two. Of the records one hint matches, only the best-matching are kept. */
function resolveHints(hints: string[], records: RecordSummary[]): RecordSummary[] {
  const resolved: RecordSummary[] = [];
  for (const raw of hints) {
    const hint = typeof raw === "string" ? normalise(raw) : "";
    if (!hint) continue;
    const scored = records.map((record) => ({ record, strength: hintStrength(hint, record) }));
    const best = Math.max(0, ...scored.map((s) => s.strength));
    if (best === 0) continue;
    for (const { record, strength } of scored) {
      if (strength === best && !resolved.some((r) => r.id === record.id)) resolved.push(record);
    }
  }
  return resolved.slice(0, MAX_RECORDS);
}

const supportOf = (claim: { support?: unknown } | undefined): string[] =>
  Array.isArray(claim?.support) ? claim.support.filter((id): id is string => typeof id === "string") : [];

/** The passage ids a record's own claims cite, most central first. `affected` comes early only when asked for. */
function citedPassageIds(record: PolicyRecord, withAffected: boolean): string[] {
  const provisions = (record.provisions ?? []).map(supportOf);
  const timeline = (record.timeline ?? []).map(supportOf);
  const affected = (record.affected ?? []).map(supportOf);
  const groups = withAffected
    ? [supportOf(record.summary), ...affected, ...provisions, supportOf(record.status), ...timeline]
    : [supportOf(record.summary), supportOf(record.status), ...provisions, ...timeline];
  return [...new Set(groups.flat())];
}

async function recordSources(route: Route, db: D1Like, withAffected: boolean): Promise<Source[]> {
  const hints = route.recordHints.filter((h) => typeof h === "string" && h.trim() !== "");
  const named = hints.length ? resolveHints(hints, await listRecords(db)) : [];

  const sources: Source[] = [];
  const have = new Set<string>();
  if (named.length) {
    const perRecord = Math.floor(RECORD_PASSAGE_BUDGET / named.length);
    const full = await Promise.all(named.map((record) => getRecord(db, record.id)));
    const wanted = full.map((record) => (record ? citedPassageIds(record, withAffected).slice(0, perRecord) : []));
    const byId = new Map((await getPassages(db, wanted.flat())).map((p) => [p.id, p]));
    named.forEach((record, i) => {
      for (const id of wanted[i]!) {
        const passage = byId.get(id);
        if (passage && !have.has(id)) {
          have.add(id);
          sources.push(policySource(record, passage));
        }
      }
    });
  }

  // With no record found, a router that left `search` blank is still asked about something: use its question.
  const query = route.search.trim() || (sources.length ? "" : route.standalone.trim());
  if (query) {
    for (const hit of await search(db, query, { jurisdiction: route.jurisdiction }, SEARCH_TOP)) {
      if (!have.has(hit.passage.id)) {
        have.add(hit.passage.id);
        sources.push(policySource(hit.record, hit.passage));
      }
    }
  }
  return sources;
}

// ---- sentiment -------------------------------------------------------------------------------------------------

/** Bluesky's posts for `query`: none when there is no search function, it fails, it answers oddly or it is too slow. */
async function livePosts(bluesky: RetrieveDeps["bluesky"], query: string, timeoutMs: number): Promise<unknown[]> {
  if (!bluesky || !query) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = (async () => bluesky(query))();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Bluesky did not answer within ${timeoutMs} ms`)), timeoutMs);
    });
    const items = await Promise.race([answer, deadline]);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function sentimentSources(route: Route, db: D1Like, deps: RetrieveDeps): Promise<Source[]> {
  const keywords = route.search.trim();
  const [live, context] = await Promise.all([
    livePosts(deps.bluesky, keywords || route.standalone.trim(), deps.blueskyTimeoutMs ?? BLUESKY_TIMEOUT_MS),
    keywords ? search(db, keywords, { jurisdiction: route.jurisdiction }, CONTEXT_TOP) : [],
  ]);
  const saved = Array.isArray(deps.knowledge) ? deps.knowledge.slice(0, MAX_POSTS_SCANNED) : [];

  const seen = new Set<string>();
  const posts: Source[] = [];
  for (const item of [...live.slice(0, MAX_POSTS_SCANNED), ...saved]) {
    const source = postSource(item);
    if (!source) continue;
    const key = source.post!.url || source.post!.text;
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push(source);
    if (posts.length === MAX_POSTS) break;
  }
  return [...posts, ...context.map((hit) => policySource(hit.record, hit.passage))];
}

// ---- out of scope ----------------------------------------------------------------------------------------------

/**
 * The router thinks the question is outside Politik's coverage. If any passage contains every one of its terms, the
 * corpus does cover it, so those passages are returned and the caller treats the question as an `explain`.
 * Needing every term works the same on the 6-record fixture and the full snapshot; a bm25 score would not.
 */
async function outOfScope(route: Route, db: D1Like): Promise<Retrieved> {
  const hits = await searchPassages(db, route.search, {}, OUT_OF_SCOPE_TOP, { match: "all" });
  return { sources: hits.map((hit) => policySource(hit.record, hit.passage)), promoted: hits.length > 0 };
}
