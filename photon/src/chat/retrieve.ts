// Step 2 of the chat pipeline: from the Route, gather the passages and posts an answer may cite.
// What is gathered depends on the intent (docs/superpowers/specs/2026-10-15-chatbot-synthesis-design.md §3.2):
//   brief         the records with recent events, newest first, one passage each, plus any search matches (which keep their slots)
//   explain       the named record's cited passages, then search matches
//   implications  as explain, plus the passages behind `affected`
//   sentiment     public posts (Bluesky and the client's saved ones), plus a few policy passages for context
//   out-of-scope  a three-passage search, whose only job is to notice that the corpus does cover the question
//   greeting, clarify   nothing
// A passage found by a search is shown as the window around the words that matched (up to MAX_PASSAGE_CHARS), not
// the start of a long passage; a passage a record itself cites keeps its start.
// Policy data is read only through ../data/store.ts. This never throws on a Bluesky failure.
import type { SourceItem } from "../contracts.ts";
import type { D1Like } from "../data/d1.ts";
import { ftsTerms, toFtsQuery } from "../data/fts.ts";
import type { Filters, Manifest, Passage, PassageHit, PolicyRecord, RecordSummary } from "../data/schema.ts";
import { getPassages, getRecord, listRecords, recentChanges, searchPassages } from "../data/store.ts";
import { normaliseBill } from "./bills.ts";
import type { Route, Source } from "./types.ts";

export { normaliseBill };

/** The most sources one answer gets. */
export const MAX_SOURCES = 12;
/**
 * The longest passage (or post) text kept, in characters. 900 keeps a 12-source brief prompt small enough for Groq's
 * free tier (8,000 tokens a minute); the eval imports this same constant for what its judge may read.
 */
export const MAX_PASSAGE_CHARS = 900;
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
/** Passages read to count how many distinct records an out-of-scope question matches. */
const OUT_OF_SCOPE_POOL = 12;
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

/** How far before the first matched word a window starts, so the reader sees the sentence it sits in. */
const WINDOW_LEAD_CHARS = 120;

/**
 * Where a search term (or, for a longer term, its stem: "registries" finds "registry") starts a word in `text`. The full
 * text index stems with Porter, so a literal match would miss "regulator" for "regulators".
 */
function termStarts(text: string, term: string): number[] {
  const stem = term.length >= 6 ? term.slice(0, Math.max(5, term.length - 3)) : term;
  const safe = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const end = term.length <= 3 ? String.raw`(?![\p{L}\p{N}])` : "";
  const found = text.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}])${safe}${end}`, "giu"));
  const starts: number[] = [];
  for (const m of found) {
    starts.push(m.index);
    if (starts.length === 60) break;
  }
  return starts;
}

/** `start` moved on to the next word start (within a few characters), and past half a surrogate pair. */
function snapToWord(text: string, start: number): number {
  let at = start;
  if (at > 0 && /\S/.test(text[at - 1]!)) {
    const gap = text.slice(at, at + 40).search(/\s/);
    if (gap !== -1) at += gap + 1;
  }
  const code = text.charCodeAt(at);
  return code >= 0xdc00 && code <= 0xdfff ? at + 1 : at;
}

/**
 * The part of `text` (at most `max` characters) around the words of a search. Of the places a window could start (the
 * start of the text, and just before each match) it takes the one that holds the most different search terms, the
 * earliest on a tie, so a match in the first `max` characters leaves the text as `clipText` would. A window that does not
 * start at the beginning (or stop at the end) begins (or ends) with an ellipsis. With no term found in the text itself
 * (the match was in the title or heading) it is the start of the text.
 */
export function windowText(text: string, terms: string[], max = MAX_PASSAGE_CHARS): string {
  if (text.length <= max) return text;
  const found = terms.map((term) => ({ length: term.length, starts: termStarts(text, term) }));
  if (found.every((f) => f.starts.length === 0)) return clipText(text, max);

  const starts = new Set<number>([0]);
  for (const f of found) for (const at of f.starts) starts.add(snapToWord(text, Math.max(0, at - WINDOW_LEAD_CHARS)));
  let best = { start: 0, covered: -1 };
  for (const start of [...starts].sort((a, b) => a - b)) {
    const room = max - (start > 0 ? 1 : 0) - 1;
    // A term counts only when all of it fits, with a character to spare: the cut backs off to the last space, so a word that
    // ends exactly at the edge is dropped with the partial word it would have been.
    const covered = found.filter((f) => f.starts.some((at) => at >= start && at + f.length < start + room)).length;
    if (covered > best.covered) best = { start, covered };
  }
  if (best.start === 0) return clipText(text, max);

  let end = Math.min(text.length, best.start + max - 2);
  if (end < text.length) {
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    const space = Math.max(text.lastIndexOf(" ", end - 1), text.lastIndexOf("\n", end - 1), text.lastIndexOf("\t", end - 1));
    if (space > end - 80 && space > best.start) end = space;
  }
  const body = text.slice(best.start, end).trim();
  return `…${body}${end < text.length ? "…" : ""}`;
}

/** A policy source. With `terms` (a search's words) a long passage is shown as the window around them, else from its start. */
function policySource(record: RecordSummary, passage: Passage, terms?: string[]): Source {
  const shown = terms?.length ? windowText(passage.text, terms) : clipText(passage.text);
  return { kind: "policy", record, passage: { ...passage, text: shown } };
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
  // Only `search` is looked for in the passages: the standalone question is worded for a reader, not for the index.
  const keywords = route.search.trim();
  const terms = ftsTerms(keywords);

  const [events, pool] = await Promise.all([
    recentChanges(db, { ...scope, since }, EVENT_POOL),
    keywords ? search(db, keywords, scope, BEST_PASSAGE_POOL) : [],
  ]);
  const matches = pool.slice(0, SEARCH_TOP);
  // A quiet stretch still has a "latest": when the router named no window and nothing falls in the default one, look further back.
  const changes = events.length === 0 && asked === undefined ? await recentChanges(db, { ...scope, since: EARLIEST }, EVENT_POOL) : events;

  // Slots: every record the search found (up to 6) is kept, whether or not it is also recent, and the newest of the
  // other recent records fill what is left. Order: the recent ones newest event first (hits among them in their
  // place), then the hits that are not recent, in match order.
  const recent = onePerRecord(changes.map((c) => c.record), (r) => r.id);
  const hits = bestPerRecord(matches).map((hit) => hit.record);
  const hitIds = new Set(hits.map((r) => r.id));
  const fillers = recent.filter((r) => !hitIds.has(r.id)).slice(0, MAX_SOURCES - hits.length);
  const keptIds = new Set([...hitIds, ...fillers.map((r) => r.id)]);
  const recentIds = new Set(recent.map((r) => r.id));
  const records = [...recent.filter((r) => keptIds.has(r.id)), ...hits.filter((r) => !recentIds.has(r.id))];

  // A record's passage: the one its search found (as the window around the match), else the one its own summary cites first.
  const found = new Map<string, Passage>();
  for (const hit of bestPerRecord(pool)) found.set(hit.record.id, hit.passage);
  const cited = await summaryPassages(db, records.filter((r) => !found.has(r.id)));
  return records.flatMap((record) => {
    const hit = found.get(record.id);
    if (hit) return [policySource(record, hit, terms)];
    const passage = cited.get(record.id);
    return passage ? [policySource(record, passage)] : [];
  });
}

/** How many of a summary's own citations are tried before the record's first passage. */
const SUMMARY_SUPPORT_TRIED = 3;

/**
 * For each record, the passage its summary cites first (`summary.support`), else its first passage. A record that
 * cannot be read gets its first passage; a record with no passage at all gets none.
 */
async function summaryPassages(db: D1Like, records: RecordSummary[]): Promise<Map<string, Passage>> {
  const result = new Map<string, Passage>();
  if (records.length === 0) return result;
  // A record that cannot be read just has no citations to follow: it gets its first passage.
  const full = await Promise.all(records.map((record) => getRecord(db, record.id).catch(() => null)));
  const preferred = records.map((record, i) => [...supportOf(full[i]?.summary).slice(0, SUMMARY_SUPPORT_TRIED), `${record.id}#1`]);
  const byId = new Map((await getPassages(db, preferred.flat())).map((p) => [p.id, p]));
  records.forEach((record, i) => {
    const id = preferred[i]!.find((candidate) => byId.has(candidate));
    if (id) result.set(record.id, byId.get(id)!);
  });
  return result;
}

// ---- explain and implications ----------------------------------------------------------------------------------

const normalise = (text: string) => normaliseBill(text).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
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
    const terms = ftsTerms(query);
    for (const hit of await search(db, query, { jurisdiction: route.jurisdiction }, SEARCH_TOP)) {
      if (!have.has(hit.passage.id)) {
        have.add(hit.passage.id);
        sources.push(policySource(hit.record, hit.passage, terms));
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
  const terms = ftsTerms(keywords);
  return [...posts, ...context.map((hit) => policySource(hit.record, hit.passage, terms))];
}

// ---- out of scope ----------------------------------------------------------------------------------------------

/** True when every search term is a word of the record's title or short title (a question that names the record). */
function namesRecord(terms: string[], record: RecordSummary): boolean {
  if (terms.length === 0) return false;
  const words = new Set(normalise(`${record.title} ${record.shortTitle ?? ""}`).split(" "));
  return terms.every((term) => words.has(term));
}

/**
 * The router thinks the question is outside Politik's coverage. The corpus covers it only if a passage has every one of
 * its terms AND either a hit's record is named by the question (every term is a word of its title or short title) or
 * two distinct records match. One passing mention ("the EU AI Act" inside a California bill) does not make a California
 * answer to a question about the EU. Needing every term works the same on the 6-record fixture and the full snapshot; a
 * bm25 score would not. Covered, the hits are returned and the caller treats the question as an `explain`.
 */
async function outOfScope(route: Route, db: D1Like): Promise<Retrieved> {
  const hits = await searchPassages(db, route.search, {}, OUT_OF_SCOPE_POOL, { match: "all" });
  const terms = ftsTerms(route.search);
  const named = hits.filter((hit) => namesRecord(terms, hit.record));
  const covered = named.length > 0 || new Set(hits.map((hit) => hit.record.id)).size >= 2;
  if (!covered) return { sources: [], promoted: false };
  const ordered = [...named, ...hits.filter((hit) => !named.includes(hit))];
  return { sources: ordered.slice(0, OUT_OF_SCOPE_TOP).map((hit) => policySource(hit.record, hit.passage, terms)), promoted: true };
}
