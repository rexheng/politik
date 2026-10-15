// The only module that reads the policy dataset. The chatbot and the pages import from here and
// never query D1 directly. User-supplied values only ever reach SQL as bound parameters.
// A read on a D1 with no tables (not migrated yet) gives the same empty answer as an unseeded one: wrap every
// new read in `emptyIfUnmigrated`.
import type { D1Like, D1Value } from "./d1.ts";
import { toFtsQuery } from "./fts.ts";
import type {
  Filters,
  Jurisdiction,
  Manifest,
  Passage,
  PassageHit,
  PolicyRecord,
  RecordSummary,
  RecordType,
  Status,
} from "./schema.ts";

const DEFAULT_SEARCH_LIMIT = 12;
const DEFAULT_RECENT_LIMIT = 20;

/** Columns that build a RecordSummary from a `records r` row. The long text stays inside data_json. */
const SUMMARY_COLUMNS = `r.id AS id, r.jurisdiction AS jurisdiction, r.type AS type, r.title AS title,
  r.short_title AS short_title, r.status AS status, r.status_date AS status_date, r.published AS published,
  r.last_activity AS last_activity, r.landmark AS landmark, r.review_state AS review_state,
  json_extract(r.data_json, '$.summary.value') AS summary, json_extract(r.data_json, '$.url') AS url,
  json_extract(r.data_json, '$.publisher') AS publisher`;

interface SummaryRow {
  id: string;
  jurisdiction: Jurisdiction;
  type: RecordType;
  title: string;
  short_title: string | null;
  status: Status;
  status_date: string | null;
  published: string | null;
  last_activity: string;
  landmark: number;
  review_state: RecordSummary["reviewState"];
  summary: string;
  url: string;
  publisher: string;
}

function toSummary(row: SummaryRow): RecordSummary {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    type: row.type,
    title: row.title,
    ...(row.short_title !== null && { shortTitle: row.short_title }),
    status: row.status,
    ...(row.status_date !== null && { statusDate: row.status_date }),
    ...(row.published !== null && { published: row.published }),
    lastActivity: row.last_activity,
    summary: row.summary,
    url: row.url,
    publisher: row.publisher,
    landmark: row.landmark === 1,
    reviewState: row.review_state,
  };
}

const placeholders = (n: number) => Array(n).fill("?").join(", ");

/** True for what a read gets from a D1 whose migration has not been applied: "no such table: records" (or passages_fts, meta...). */
function isMissingTable(error: unknown): boolean {
  const messages = [error, error instanceof Error ? error.cause : undefined].map((e) => (e instanceof Error ? e.message : String(e ?? "")));
  return messages.some((message) => /no such table/i.test(message));
}

/**
 * Runs a read. A database that has not been migrated has no tables, which is the same as one that has not been seeded:
 * the read gives `empty`. Every other error still throws, so a real fault is not hidden behind an empty page.
 */
async function emptyIfUnmigrated<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isMissingTable(error)) return empty;
    throw error;
  }
}

/** WHERE clauses on `records r` for the given filters, with their bound params. Empty arrays mean no filter. */
function recordFilters(f: Filters): { clauses: string[]; params: D1Value[] } {
  const clauses: string[] = [];
  const params: D1Value[] = [];
  if (f.jurisdiction) {
    clauses.push("r.jurisdiction = ?");
    params.push(f.jurisdiction);
  }
  if (f.types?.length) {
    clauses.push(`r.type IN (${placeholders(f.types.length)})`);
    params.push(...f.types);
  }
  if (f.topics?.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM record_topics t WHERE t.record_id = r.id AND t.topic IN (${placeholders(f.topics.length)}))`,
    );
    params.push(...f.topics);
  }
  if (f.since) {
    clauses.push("r.last_activity >= ?");
    params.push(f.since);
  }
  return { clauses, params };
}

/** A usable row limit: the default when absent or not a number, else a whole number of at least 0. */
function rowLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.max(0, Math.floor(limit));
}

/**
 * Best matches first. Raw text is turned into a safe query, so odd input gives `[]` or hits, never an error.
 * An unmigrated database gives `[]`.
 */
export async function searchPassages(
  db: D1Like,
  query: string,
  filters: Filters = {},
  limit?: number,
): Promise<PassageHit[]> {
  const match = toFtsQuery(query);
  const max = rowLimit(limit, DEFAULT_SEARCH_LIMIT);
  if (match === null || max === 0) return [];
  return emptyIfUnmigrated(() => runSearch(db, match, filters, max), []);
}

async function runSearch(db: D1Like, match: string, filters: Filters, max: number): Promise<PassageHit[]> {
  const { clauses, params } = recordFilters(filters);
  const where = ["passages_fts MATCH ?", ...clauses].join(" AND ");
  const { results } = await db
    .prepare(
      `SELECT p.id AS p_id, p.record_id AS p_record_id, p.seq AS p_seq, p.heading AS p_heading, p.text AS p_text,
        bm25(passages_fts) AS bm, ${SUMMARY_COLUMNS}
       FROM passages_fts
       JOIN passages p ON p.id = passages_fts.passage_id
       JOIN records r ON r.id = p.record_id
       WHERE ${where}
       ORDER BY bm, p.id
       LIMIT ?`,
    )
    .bind(match, ...params, max)
    .all<
      SummaryRow & { p_id: string; p_record_id: string; p_seq: number; p_heading: string | null; p_text: string; bm: number }
    >();

  return results.map((row) => {
    const passage: Passage = {
      id: row.p_id,
      recordId: row.p_record_id,
      seq: row.p_seq,
      ...(row.p_heading !== null && { heading: row.p_heading }),
      text: row.p_text,
    };
    return { passage, record: toSummary(row), score: -row.bm };
  });
}

/** The full record, or null when there is no record with this id (or the database is unmigrated). */
export async function getRecord(db: D1Like, id: string): Promise<PolicyRecord | null> {
  return emptyIfUnmigrated(async () => {
    const row = await db.prepare("SELECT data_json FROM records WHERE id = ?").bind(id).first<{ data_json: string }>();
    return row ? (JSON.parse(row.data_json) as PolicyRecord) : null;
  }, null);
}

/** Timeline events dated on or after `filters.since`, newest first. An unmigrated database gives `[]`. */
export async function recentChanges(
  db: D1Like,
  filters: Filters & { since: string },
  limit?: number,
): Promise<{ date: string; event: string; record: RecordSummary }[]> {
  const max = rowLimit(limit, DEFAULT_RECENT_LIMIT);
  if (max === 0) return [];
  return emptyIfUnmigrated(() => runRecentChanges(db, filters, max), []);
}

async function runRecentChanges(
  db: D1Like,
  filters: Filters & { since: string },
  max: number,
): Promise<{ date: string; event: string; record: RecordSummary }[]> {
  // The event date is the cut-off here, so the record-level `since` clause is left out.
  const { clauses, params } = recordFilters({ ...filters, since: undefined });
  const where = ["e.date >= ?", ...clauses].join(" AND ");
  const { results } = await db
    .prepare(
      `SELECT e.date AS event_date, e.event AS event, ${SUMMARY_COLUMNS}
       FROM timeline_events e
       JOIN records r ON r.id = e.record_id
       WHERE ${where}
       ORDER BY e.date DESC, e.record_id, e.rowid
       LIMIT ?`,
    )
    .bind(filters.since, ...params, max)
    .all<SummaryRow & { event_date: string; event: string }>();

  return results.map((row) => ({ date: row.event_date, event: row.event, record: toSummary(row) }));
}

/** Every record matching the filters, most recent activity first. An unmigrated database gives `[]`. */
export async function listRecords(db: D1Like, filters: Filters = {}): Promise<RecordSummary[]> {
  const { clauses, params } = recordFilters(filters);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return emptyIfUnmigrated(async () => {
    const { results } = await db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM records r ${where} ORDER BY r.last_activity DESC, r.id`)
      .bind(...params)
      .all<SummaryRow>();
    return results.map(toSummary);
  }, []);
}

/** The snapshot manifest, or null when D1 has not been seeded (or not migrated). */
export async function getManifest(db: D1Like): Promise<Manifest | null> {
  return emptyIfUnmigrated(async () => {
    const row = await db.prepare("SELECT value FROM meta WHERE key = 'manifest'").first<{ value: string }>();
    return row ? (JSON.parse(row.value) as Manifest) : null;
  }, null);
}
