// Turns the snapshot (policies, passages, manifest) into the SQL that reloads the D1 tables.
// Pure functions with no I/O, used by the seed script and by tests.
import type { D1Value } from "./d1.ts";
import { lastActivity } from "./schema.ts";
import type { Manifest, Passage, PolicyRecord } from "./schema.ts";

export interface SeedStatement {
  sql: string;
  params: D1Value[];
}

// Children first. The snapshot is the source of truth, so every table is emptied before the inserts.
const WIPE = ["passages_fts", "passages", "timeline_events", "record_topics", "records", "meta"];

/** Statements that wipe all tables and then insert the whole snapshot. Throws if a passage has no record. */
export function snapshotStatements(policies: PolicyRecord[], passages: Passage[], manifest: Manifest): SeedStatement[] {
  const stmts: SeedStatement[] = WIPE.map((table) => ({ sql: `DELETE FROM ${table}`, params: [] }));
  const titles = new Map<string, string>();

  for (const r of policies) {
    titles.set(r.id, r.title);
    stmts.push({
      sql:
        "INSERT INTO records (id, jurisdiction, type, title, short_title, status, status_date, published, " +
        "last_activity, landmark, review_state, topics_json, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        r.id,
        r.jurisdiction,
        r.type,
        r.title,
        r.shortTitle ?? null,
        r.status.value,
        r.statusDate ?? null,
        r.published ?? null,
        lastActivity(r),
        r.landmark ? 1 : 0,
        r.review.state,
        JSON.stringify(r.topics),
        JSON.stringify(r),
      ],
    });
    for (const topic of new Set(r.topics)) {
      stmts.push({ sql: "INSERT INTO record_topics (record_id, topic) VALUES (?, ?)", params: [r.id, topic] });
    }
    for (const e of r.timeline) {
      stmts.push({
        sql: "INSERT INTO timeline_events (record_id, date, event) VALUES (?, ?, ?)",
        params: [r.id, e.date, e.event],
      });
    }
  }

  for (const p of passages) {
    const title = titles.get(p.recordId);
    if (title === undefined) throw new Error(`passage ${p.id} belongs to unknown record ${p.recordId}`);
    stmts.push({
      sql: "INSERT INTO passages (id, record_id, seq, heading, text) VALUES (?, ?, ?, ?, ?)",
      params: [p.id, p.recordId, p.seq, p.heading ?? null, p.text],
    });
    stmts.push({
      sql: "INSERT INTO passages_fts (passage_id, title, heading, text) VALUES (?, ?, ?, ?)",
      params: [p.id, title, p.heading ?? null, p.text],
    });
  }

  stmts.push({ sql: "INSERT INTO meta (key, value) VALUES (?, ?)", params: ["manifest", JSON.stringify(manifest)] });
  return stmts;
}

function literal(value: D1Value): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot inline a non-finite number (${value}) as SQL`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

/** Replaces each `?` outside a quoted literal with the next param. */
function inline(stmt: SeedStatement): string {
  let out = "";
  let used = 0;
  let quoted = false;
  for (const ch of stmt.sql) {
    if (ch === "'") quoted = !quoted;
    if (ch === "?" && !quoted) {
      if (used >= stmt.params.length) throw new Error(`statement has more placeholders than params: ${stmt.sql}`);
      out += literal(stmt.params[used++]);
    } else {
      out += ch;
    }
  }
  if (used !== stmt.params.length) {
    throw new Error(`statement has fewer placeholders (${used}) than params (${stmt.params.length}): ${stmt.sql}`);
  }
  return out;
}

/**
 * The statements as an SQL script for `wrangler d1 execute --file`, each ending in `;` and a newline,
 * with params inlined. It has no BEGIN/COMMIT, because D1 remote rejects them.
 */
export function toSqlFile(stmts: SeedStatement[]): string {
  return stmts.map((s) => `${inline(s)};\n`).join("");
}
