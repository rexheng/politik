# Policy dataset & database: design

Status: approved in brainstorming, 2026-10-15
Sub-project A of 3 (A dataset → B chatbot synthesis → C landing page)

## 1. Why

Politik is for real pilot users: policymakers who ask "what is going on?" on their phone. Today the app has no real policy data:

- 8 invented briefings (`photon/src/briefings.ts`)
- 10 California AG headlines whose text is boilerplate (`photon/src/catalog.ts`, `photon/src/select.ts:315-329`)
- a hardcoded "3,485 GeBIZ documents" count with no rows behind it
- no database

The chatbot (sub-project B) can only be as good as its data. This sub-project builds a real, cited, curated dataset and the store the chatbot reads from.

## 2. Scope

**In scope**
- Jurisdictions: California (`US-CA`) and Singapore (`SG`).
- Topics: tech only. The controlled list of topics is in §4.
- About 200 curated records, built by a re-runnable snapshot script.
- Storage in Cloudflare D1, with full-text search.
- A data-access module with four functions. This is the only way the chatbot and pages read data.
- Removing the fake data from the app.

**Out of scope (later, if ever)**
- Live or scheduled ingestion. The snapshot is re-run by hand.
- Non-tech topics.
- Embedding / vector search. The data-access interface leaves room to add it later.
- `rexheng/policytracker`. It is not used by the new dataset. The map's existing policy-pin layer still calls it and is left unchanged here.
- The 16 data-centre sites and the universities layer. They stay as map layers and are not policy records.

## 3. What goes in

Target mix. The final list is set at the curation gate (§5.1).

| California (~110) | Singapore (~90) |
|---|---|
| ~50 tech bills, 2023–26 sessions (e.g. SB 1047 vetoed, SB 53) | ~10 statutes (PDPA, Cybersecurity Act, Online Safety amendments) |
| ~10 regulations (CPPA rules on automated decisions, risk assessments and cyber audits) | ~20 frameworks and guidance (AI Verify, Model AI Governance Framework, NAIS 2.0, Green DC Roadmap) |
| ~5 executive orders (e.g. N-12-23 on GenAI) | ~40 notable tech tenders from GeBIZ via data.gov.sg (AI, cloud, data centres) |
| ~20 AG tech actions and releases | ~10 Parliament (Hansard) statements and PQs on AI and data centres |
| ~15 agency guidance documents (CDT GenAI, CPUC/CEC on data-centre load) | ~15 IMDA / PDPC / MDDI releases |

About 50 of these are flagged `landmark`. These are the policies a pilot user is most likely to ask about.

## 4. Record shape

The types live in `photon/src/data/types.ts`. A zod schema in the same folder validates every record at build time and in `check:data`.

```ts
type Jurisdiction = "US-CA" | "SG";

type RecordType =
  | "bill" | "statute" | "regulation" | "executive-order"
  | "guidance"        // frameworks, guidelines, agency reports
  | "tender" | "press-release" | "hansard";

type Topic =
  | "ai-governance" | "data-centres" | "privacy-data" | "cybersecurity"
  | "online-safety" | "gov-tech-procurement" | "digital-infrastructure";

type Status =
  | "proposed" | "in-progress" | "passed" | "enacted" | "in-force"
  | "vetoed" | "failed" | "withdrawn" | "superseded"
  | "open" | "awarded" | "closed"          // tenders
  | "published";                            // guidance, releases, hansard

// Every enriched claim names the passages that support it.
interface Supported<T> { value: T; support: string[] }   // passage ids

interface PolicyRecord {
  id: string;                 // stable slug, e.g. "ca-sb-53-2025", "sg-pdpa-2012"
  jurisdiction: Jurisdiction;
  type: RecordType;
  title: string;
  shortTitle?: string;        // "SB 53"
  issuer: string;             // "California State Legislature", "IMDA"
  status: Supported<Status>;
  statusDate?: string;        // ISO date
  timeline: { date: string; event: string; support: string[] }[];
  summary: Supported<string>;          // 2–3 plain-language sentences
  provisions: Supported<string>[];     // key provisions
  affected: Supported<string>[];       // who is affected
  topics: Topic[];                     // at least one
  related: { id: string; relation: "amends" | "implements" | "replaces" | "responds-to" | "related" }[];
  // provenance: field names kept from CatalogDoc so existing pages map cleanly
  url: string;
  publisher: string;
  published?: string;
  fetched: string;
  sha256: string;             // full hash of the extracted text
  attribution: string;
  redistributionOk: boolean;
  landmark: boolean;
  review: { state: "auto-checked" | "human-reviewed"; reviewedAt?: string; reviewer?: string };
}

interface Passage {
  id: string;                 // `${recordId}#${seq}`
  recordId: string;
  seq: number;
  heading?: string;
  text: string;               // ~400 words, split on headings where possible
}

interface Manifest {
  snapshotDate: string;       // the "as of" date shown to users
  builtAt: string;
  models: { enrich: string; verify: string };
  counts: { total: number; byJurisdiction: Record<Jurisdiction, number>; byType: Record<RecordType, number> };
  excluded: { url: string; title: string; reason: string }[];
}
```

Rules:
- Every `support` array is non-empty, and every passage id in it exists.
- Every `related[].id` exists in the snapshot.
- Timeline dates are ISO dates, sorted ascending.

## 5. How it is built

All build code is Node/TypeScript run with `tsx`, in `photon/scripts/snapshot/`. It never runs in the Worker.

### 5.1 Curation gate
1. A research step (a subagent with web search) writes `photon/data/snapshot/candidates.md`. It is a table with one row per candidate: proposed id, title, type, jurisdiction, source URL, landmark yes/no, and one line on why it is included.
2. **The owner approves or edits `candidates.md` before any fetching or enrichment.** The approved table is the build's input list.

### 5.2 Fetch & extract
- Fetch each URL with plain `fetch`. Extract text from HTML and from PDF (e.g. `unpdf`).
- Sites that block automated access (e.g. Singapore Statutes Online, which returns HTTP 403) fall back to the existing Browserbase/Stagehand setup (`BROWSERBASE_API_KEY`).
- GeBIZ tenders come from the data.gov.sg dataset API, not scraping.
- Split the text into ~400-word passages, keeping headings. Hash the full text (`sha256`).
- Raw downloads are cached under `.tmp-snapshot/`, which git already ignores via `.tmp-*`.

### 5.3 Enrich (Groq)
- One Groq call per record, using structured JSON output validated by the zod schema. It produces `status`, `timeline`, `summary`, `provisions`, `affected`, `topics`, `related` and `shortTitle`. Each claim carries the passage ids it relies on.
- The model is configured as `GROQ_ENRICH_MODEL`. The implementer picks the strongest Groq model available at build time that supports structured JSON output, and records the choice in the manifest.
- Results are cached by `sha256`. A re-run only re-enriches documents whose text changed.

### 5.4 Verify (Groq, second pass)
- A separate call (`GROQ_VERIFY_MODEL`) receives each claim with its cited passages and answers supported / unsupported.
- Unsupported claims are dropped. If `summary` or `status` is unsupported, the record is excluded and recorded in `manifest.excluded` with the reason.

### 5.5 Human review of landmarks
- The build writes `photon/data/snapshot/review.md`, which lists each landmark's summary, status, timeline and provisions with source links.
- A reviewer marks records as checked in `photon/data/snapshot/reviewed.json`, a list of `{ id, reviewer, reviewedAt }`. The next build sets `review.state = "human-reviewed"` for those ids, as long as their `sha256` is unchanged.
- Nothing blocks on review. Unreviewed records show as "auto-checked".

### 5.6 Output (committed to git, the source of truth)
- `photon/data/snapshot/policies.json` contains `PolicyRecord[]`.
- `photon/data/snapshot/passages.json` contains `Passage[]`.
- `photon/data/snapshot/manifest.json` contains the `Manifest`.

Failures never produce half-built records. Every candidate ends up either in `policies.json` or in `manifest.excluded` with a reason.

## 6. Storage: D1

- One D1 database, `politik`, bound to the Worker as `DB` in `wrangler.jsonc`.
- Schema (migration in `migrations/`):
  - `records(id PK, jurisdiction, type, title, short_title, status, status_date, published, landmark, review_state, topics_json, data_json)`
    - `data_json` holds the full `PolicyRecord`. The other columns exist for filtering.
  - `record_topics(record_id, topic)` for topic filters.
  - `timeline_events(record_id, date, event)` with an index on `date`.
  - `passages(id PK, record_id, seq, heading, text)`.
  - `passages_fts`: an FTS5 virtual table over `title`, `heading` and `text`, ranked with `bm25()`.
  - `meta(key PK, value)` holds the manifest, including `snapshotDate`.
- Seeding: `pnpm seed:d1` turns the three JSON files into SQL batches within D1 statement limits. It wipes and reloads the tables, because the snapshot is the source of truth. It runs against local D1 (`wrangler dev`) and, with `--remote`, against production.

## 7. Data-access interface (the contract with sub-project B)

`photon/src/data/store.ts`. The chatbot and pages import only this module. They never query D1 directly.

```ts
interface Filters { jurisdiction?: Jurisdiction; types?: RecordType[]; topics?: Topic[]; since?: string }

interface RecordSummary {
  id: string; jurisdiction: Jurisdiction; type: RecordType; title: string; shortTitle?: string;
  status: Status; statusDate?: string; summary: string; url: string; landmark: boolean;
  reviewState: "auto-checked" | "human-reviewed";
}

interface PassageHit { passage: Passage; record: RecordSummary; score: number }

searchPassages(db: D1Database, query: string, filters?: Filters, limit?: number): Promise<PassageHit[]>
getRecord(db: D1Database, id: string): Promise<PolicyRecord | null>
recentChanges(db: D1Database, filters: Filters & { since: string }, limit?: number):
  Promise<{ date: string; event: string; record: RecordSummary }[]>   // newest first
listRecords(db: D1Database, filters?: Filters): Promise<RecordSummary[]>
getManifest(db: D1Database): Promise<Manifest>
```

- `searchPassages` turns user text into a safe FTS5 query: it quotes terms and drops FTS operators, so raw input can never cause a syntax error. An empty or all-stop-word query returns `[]` without throwing.
- `getManifest` is a fifth, read-only helper. The pages and the bot use it for the "as of" date and the counts.

## 8. Changes to the existing app

- Remove `photon/src/briefings.ts` and its use in the chat pool.
- Drop the hardcoded `LATEST`, counts and the GeBIZ "3,485" from `photon/src/catalog.ts`. `/api/sources` builds the same `Catalog` response shape from D1 via `listRecords` and `getManifest`, so `sources.js` keeps working. Blocked sources come from `manifest.excluded`.
- The Sources page shows "Data as of {snapshotDate}".
- Chat behaviour itself is not changed here. That is sub-project B. Until B lands, the chat pool reads records through `listRecords` instead of `briefings.ts` and `catalog.ts`.

## 9. Configuration & owner actions

Secrets (in `.dev.vars` locally, and `wrangler secret put` in production; never committed):
- `GROQ_API_KEY`, used by the build script now and by the chatbot in B.
- `BROWSERBASE_API_KEY`, already present.

Owner actions (Claude has no Cloudflare credentials in this environment):
1. Widen this environment's network access, or allow-list the source domains, `api.groq.com` and `api-production.data.gov.sg`, so the build can fetch.
2. Approve `candidates.md`.
3. Run `wrangler d1 create politik` once, and paste the database id into `wrangler.jsonc`.
4. Run `pnpm seed:d1 --remote` after each snapshot build.
5. Optionally, review landmarks in `review.md`.

## 10. Testing

- `pnpm check:data` validates `policies.json`, `passages.json` and `manifest.json` against the zod schemas, plus the §4 rules: support ids exist, related ids exist, dates are sorted, every record has at least one topic, and there are no duplicate ids.
- Unit tests for the `store.ts` functions run against a small fixture snapshot of about 6 records, loaded into local D1 (Miniflare/`wrangler`). They cover filtering, date ordering, FTS ranking, hostile query strings (quotes, `NEAR`, `*`, empty) and missing ids.
- Build-script units (passage splitting, hashing, cache keys, excluded handling) are tested with saved HTML/PDF fixtures, so tests never need the network.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Network blocked in the build environment | Owner widens access (§9). Otherwise the owner runs the build script locally. Tests use fixtures. |
| A source blocks bots (SSO 403) | Browserbase fallback. If that also fails, the record goes to `excluded` with the reason. |
| Groq rate limits on the free tier | Sequential calls with backoff. The sha256 cache means re-runs are cheap. |
| The LLM invents facts | Every claim cites passages, a verification pass drops unsupported claims, and landmarks get a human review. |
| Data goes stale | Every surface shows the "as of" date. The build is re-runnable. |
