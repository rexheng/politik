# Policy Dataset & Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Politik's invented and hardcoded data with a curated, cited snapshot of about 200 California and Singapore tech-policy records. The snapshot is stored in Cloudflare D1 and read through one data-access module.

**Architecture:**
- A Node-only build pipeline in `photon/scripts/snapshot/` turns an owner-approved `candidates.md` into three committed JSON files: records, passages and manifest. The steps are fetch → extract → split → Groq enrich → Groq verify. (R25: the default build is fetch → split → deterministic extract → deterministic check, with no LLM call. Groq enrich and verify run only for `--llm-headlines`, to add landmark headlines. See Task 8.)
- A seed script loads those files into D1, which has FTS5 full-text search.
- The Worker reads data only through `photon/src/data/store.ts`.

**Tech Stack:** TypeScript, tsx, `node:test`, zod 4, Cloudflare Workers + D1 (FTS5), wrangler 4 (`getPlatformProxy` for tests), Groq chat completions API, `unpdf` for PDF text.

**Spec:** `docs/superpowers/specs/2026-10-15-policy-dataset-design.md`. Read it before starting any task. Section numbers below (§n) refer to it.

> **Revised 2026-10-15 (ruling R25): extract, don't generate.** Task 8 replaces the LLM enrich and verify steps with deterministic extraction and a string check. Tasks 4 and 5 keep their text, but their LLM enrich/verify is now optional (`--llm-headlines`). Task 8 runs before Task 7's build (Task 7 Step 2).

## Global Constraints

- Jurisdictions are exactly `"US-CA" | "SG"`.
- Record types are exactly `bill | statute | regulation | executive-order | guidance | tender | press-release | hansard`.
- Topics are exactly `ai-governance | data-centres | privacy-data | cybersecurity | online-safety | gov-tech-procurement | digital-infrastructure`.
- Statuses are exactly as in spec §4.
- Passage id format is `${recordId}#${seq}`, with `seq` starting at 1. Passages target about 400 words.
- Snapshot outputs live in `photon/data/snapshot/`: `policies.json`, `passages.json`, `manifest.json`, `review.md`. Inputs are `candidates.md` and `reviewed.json`.
- Build caches live under `.tmp-snapshot/` (already git-ignored by `.tmp-*`).
- Secrets come only from the environment or `.dev.vars` (loaded with `dotenv` in Node scripts): `GROQ_API_KEY` (only for `--llm-headlines` and the chat), `BROWSERBASE_API_KEY`. Never write a key into any tracked file.
- Groq model names come from env `GROQ_ENRICH_MODEL` / `GROQ_VERIFY_MODEL`, never hardcoded in logic. Defaults live in one constant in `groq.ts`. After R25 they are used only with `--llm-headlines`.
- The default build makes zero LLM calls and needs no `GROQ_API_KEY`. Every text field of a record except the optional `headline` is a verbatim excerpt of a passage it cites (spec §5.3 and §5.4).
- Build code under `photon/scripts/snapshot/` is Node-only and must never be imported by `photon/src/**`.
- Worker code reads policy data only via `photon/src/data/store.ts`.
- No invented data may reach a user-facing surface. Fixtures live only under `tests/`.
- Package manager is pnpm. Tests are `node:test` + `node:assert/strict`, run with `pnpm test` (`tsx --test "tests/**/*.test.ts"`).
- Commit messages follow the repo style: one plain sentence ending in a period, then the attribution trailer lines the orchestrator gives you.

## Review Focus

1. **Hostile or odd search text:** quotes, `NEAR(`, `*`, `AND OR NOT`, emoji, CJK/Malay, a 2,000-character paste. `searchPassages` never throws; it returns `[]` or hits. Pinned in Task 2.
2. **Malformed LLM output:** bad JSON, missing fields, or support ids that don't exist. The record's claims are dropped or the record is excluded with a reason, and the build never crashes. Pinned in Task 4. After R25 this applies only to the optional headline path, where a bad answer just means no headline (Task 8).
3. **A source that returns 200 but is junk:** a login wall, an error page, or fewer than 150 words of text. The record is excluded with reason `"too little text"`. Pinned in Task 3.
4. **Re-running the build with unchanged sources:** zero LLM calls, and byte-identical output (stable ordering). Pinned in Task 5.
5. **Unseeded D1:** `/api/sources` and chat still respond. They show empty lists, and `getManifest` returns `null`. Pinned in Task 6.
6. **Extraction fidelity (R25):** every cited text value really occurs in a cited passage; a record with no official summary is excluded, not filled with something else; the default build never calls a model; a page's modified date is never used as its date. Pinned in Task 8.

## Before execution (orchestrator, not a subagent task)

- Create the D1 database `politik` (via the Cloudflare MCP tool, with the owner's OK) and put its `database_id` into Task 2's `wrangler.jsonc` edit.
- `GROQ_API_KEY` is no longer needed for Task 7 (R25). Make it available only to a subagent that runs the optional `--llm-headlines` build, as an environment variable or in `.dev.vars`.
- Run `pnpm install` once in the worktree.

---

### Task 1: Schema, snapshot checker, fixtures

**Files:**
- Create: `photon/src/data/schema.ts`
- Create: `scripts/check-data.ts`
- Create: `tests/fixtures/snapshot/policies.json`, `tests/fixtures/snapshot/passages.json`, `tests/fixtures/snapshot/manifest.json`
- Create: `tests/data/check-data.test.ts`
- Modify: `package.json` (scripts `test`, `check:data`; devDeps if needed), `tsconfig.json` (`include` adds `"photon/src/data"`, `"photon/scripts/snapshot"`, `"tests"`)

**Interfaces:**
- Produces, from `photon/src/data/schema.ts`:
  - zod schemas `JurisdictionSchema`, `RecordTypeSchema`, `TopicSchema`, `StatusSchema`, `PassageSchema`, `PolicyRecordSchema`, `ManifestSchema`.
  - The inferred types `Jurisdiction`, `RecordType`, `Topic`, `Status`, `Supported<T>`, `PolicyRecord`, `Passage`, `Manifest`. Field names are exactly as in spec §4.
  - The plain types `Filters` and `RecordSummary`, exactly as in spec §7.
  - `PassageHit = { passage: Passage; record: RecordSummary; score: number }`.
  - The constant `TOPICS: readonly Topic[]`.
  - `lastActivity(r: PolicyRecord): string`, returning the max of `published`, `statusDate` and the latest timeline date (ISO date string).
- Produces, from `scripts/check-data.ts`:
  - `checkSnapshot(input: { policies: unknown; passages: unknown; manifest: unknown }): string[]`. It returns human-readable errors; an empty array means valid.
  - A CLI that reads `photon/data/snapshot/*.json`, prints the errors and exits 1 if there are any.

The fixture contains 6 records. It is test data only:
- `ca-sb-53-2025`: bill, `enacted`, `ai-governance`, landmark, human-reviewed, 2 timeline events.
- `ca-sb-1047-2024`: bill, `vetoed`, `ai-governance`, `related` → `ca-sb-53-2025`.
- `ca-cppa-admt-2025`: regulation, `privacy-data`.
- `sg-pdpa-2012`: statute, `privacy-data`, `in-force`.
- `sg-mgf-genai-2024`: guidance, `ai-governance`, `published`.
- `sg-gebiz-dc-2025`: tender, `awarded`, topics `gov-tech-procurement` and `data-centres`.

Each record has 2 passages. The word "frontier" appears only in passages of the two CA bills. "consent" appears only in `sg-pdpa-2012`. "data centre" appears only in `sg-gebiz-dc-2025`.

The fixture manifest has `snapshotDate: "2026-10-01"` and one `excluded` entry: `{ id: "sg-sso-osa-2022", jurisdiction: "SG", url: "https://sso.agc.gov.sg/", title: "Online Safety (Miscellaneous Amendments) Act 2022", reason: "HTTP 403" }`.

- [ ] **Step 1: Write the failing tests** in `tests/data/check-data.test.ts`:
  - `valid fixture has no errors`: `checkSnapshot(fixture)` deep-equals `[]`.
  - `unknown support id is reported`: set one provision's support to `["ca-sb-53-2025#99"]`. Errors include a string containing `ca-sb-53-2025#99`.
  - `empty support is reported`: `summary.support = []` produces an error containing `summary`.
  - `unknown related id is reported`: `related: [{ id: "nope", relation: "related" }]` produces an error containing `nope`.
  - `unsorted timeline is reported`: swap the two events, and expect an error containing `timeline`.
  - `record without topics is reported`.
  - `duplicate record id is reported`.
  - `bad enum is reported`: `jurisdiction: "US-NY"` produces at least one error.
  - `manifest counts must match records`: set `counts.total` to 7, and expect an error containing `counts`.
  - `lastActivity picks the newest date` across published / statusDate / timeline.
- [ ] **Step 2: Run and confirm failure.** Run `pnpm test`. Expected: FAIL, cannot find module `../../scripts/check-data.ts`.
- [ ] **Step 3: Implement `schema.ts` and `checkSnapshot`.** Use zod parsing for shape errors (format each issue as `path: message`), then hand-written cross-checks for the spec §4 rules plus manifest counts (`total`, `byJurisdiction`, `byType`).
- [ ] **Step 4: Run and confirm pass.** Run `pnpm test`. Expected: all `check-data` tests pass.
- [ ] **Step 5: Commit.** "Add the policy record schema, snapshot checker and test fixtures."

---

### Task 2: D1 migration, seed statements, search helpers, store

**Files:**
- Create: `migrations/0001_snapshot.sql`
- Create: `photon/src/data/d1.ts`. This is a minimal local declaration of only the D1 members used (`prepare`, `bind`, `all`, `first`, `run`, `batch`). It means Node-side tests and `tsc` don't need `@cloudflare/workers-types`.
- Create: `photon/src/data/fts.ts`, `photon/src/data/seed.ts`, `photon/src/data/store.ts`
- Create: `tests/data/fts.test.ts`, `tests/data/store.test.ts`, `tests/data/seed.test.ts`, `tests/helpers/d1.ts`
- Modify: `wrangler.jsonc`. Add `"d1_databases": [{ "binding": "DB", "database_name": "politik", "database_id": "<id from orchestrator>", "migrations_dir": "migrations" }]`.

**Interfaces:**
- Consumes: Task 1 types and the fixture.
- Produces:
  - `toFtsQuery(text: string): string | null` in `fts.ts`.
  - `snapshotStatements(policies: PolicyRecord[], passages: Passage[], manifest: Manifest): { sql: string; params: (string | number | null)[] }[]` in `seed.ts`. It wipes all tables, then inserts.
  - `toSqlFile(stmts): string` in `seed.ts`. It inlines params as SQL literals: strings single-quoted with `'` doubled, `null` → `NULL`, numbers as-is. It uses no `BEGIN`/`COMMIT`, because D1 remote rejects them.
  - In `store.ts`, `searchPassages`, `getRecord`, `recentChanges`, `listRecords` and `getManifest`, with the exact signatures in spec §7. The `db` parameter is typed with `D1Like` from `d1.ts`.
  - `openTestDb(): Promise<{ db: D1Like; dispose(): Promise<void> }>` in `tests/helpers/d1.ts`. It uses wrangler `getPlatformProxy({ persist: false })`, applies `migrations/0001_snapshot.sql` (split on `;`, run in a batch) and loads nothing else.
- Schema (spec §6), plus a `last_activity TEXT` column on `records`, filled from `lastActivity()`. FTS table:
  ```sql
  CREATE VIRTUAL TABLE passages_fts USING fts5(passage_id UNINDEXED, title, heading, text, tokenize='porter unicode61');
  ```
- Ordering:
  - `listRecords` sorts by `last_activity` DESC, then `id`.
  - `recentChanges` sorts by event `date` DESC, then `record_id`.
  - `searchPassages` sorts by `bm25(passages_fts)` ascending (best first), and `score = -bm25`.
  - Default limits: search 12, recent 20, list unlimited.

- [ ] **Step 1: Write failing tests.**
  - `fts.test.ts`:
    - `toFtsQuery('frontier AI')` equals `'"frontier" "ai"'`. Each term is quoted and lowercased, and stop-words are removed.
    - `toFtsQuery('"; DROP')` contains no unquoted `"`, `;` or `*`.
    - `toFtsQuery('NEAR(a b) * AND OR NOT')` returns only quoted plain terms.
    - `toFtsQuery('')`, `toFtsQuery('the of and')` and `toFtsQuery('🙂🙂')` return `null`.
    - `toFtsQuery('数据 中心')` returns a non-null string.
    - A 2,000-character input yields at most 32 terms.
  - `seed.test.ts`:
    - `toSqlFile` renders `O'Brien` as `'O''Brien'` and `null` as `NULL`.
    - The output has no `BEGIN`.
  - `store.test.ts` (fixture loaded via `snapshotStatements` + `db.batch`):
    - `searchPassages(db, "frontier")` returns hits only from the two CA bills, sorted by score descending.
    - `searchPassages(db, "frontier", { jurisdiction: "SG" })` returns `[]`.
    - `searchPassages(db, "consent")`: the top hit's `record.id` is `sg-pdpa-2012`.
    - `searchPassages(db, "data centre", { topics: ["data-centres"] })` returns hits only from `sg-gebiz-dc-2025`.
    - `types: ["tender"]` and `since` filters work.
    - The `limit` argument is honoured.
    - Each hostile input from Review Focus #1 resolves without throwing.
    - `getRecord(db, "ca-sb-53-2025")` deep-equals the fixture record. `getRecord(db, "missing")` returns `null`.
    - `recentChanges(db, { since: "2024-01-01" })` is non-empty and sorted by date descending. Each item carries `record.id`. `jurisdiction: "SG"` restricts it.
    - `listRecords(db)` has length 6 and is sorted by `lastActivity` descending. The `topics` filter works.
    - `getManifest(db)` deep-equals the fixture manifest.
    - On a fresh unseeded db (migration only): `listRecords` returns `[]`, `getManifest` returns `null`, and `searchPassages(db, "x")` returns `[]`.
- [ ] **Step 2: Run and confirm failure.** Run `pnpm test`. Expected: FAIL, modules missing.
- [ ] **Step 3: Implement** the migration, `d1.ts`, `fts.ts`, `seed.ts` and `store.ts`. Filters are built with bound parameters only, never string-concatenated user input. `RecordSummary.summary` is `record.summary.value`.
- [ ] **Step 4: Run and confirm pass.** Run `pnpm test`. Expected: all pass.
- [ ] **Step 5: Commit.** "Add the D1 schema and the policy data store with full-text search."

---

### Task 3: Candidates parser, text extraction, passage splitting, source loading

**Files:**
- Create: `photon/scripts/snapshot/candidates.ts`, `extract.ts`, `passages.ts`, `fetch.ts`, `gebiz.ts`
- Create: `tests/snapshot/candidates.test.ts`, `extract.test.ts`, `passages.test.ts`, `fetch.test.ts`, `gebiz.test.ts`
- Create fixtures:
  - `tests/fixtures/sources/candidates.md` (4 rows, one with `include` = `no`)
  - `tests/fixtures/sources/bill.html` (has `<nav>`, `<script>`, `<h2>` sections and about 900 words)
  - `tests/fixtures/sources/login-wall.html` (about 40 words)
  - `tests/fixtures/sources/one-page.pdf` (any tiny text PDF)
  - `tests/fixtures/sources/gebiz.json` (a data.gov.sg datastore response with 3 rows)
- Modify: `package.json` (add `unpdf` dependency)

**Interfaces:**
- Produces:
  - `Candidate = { include: boolean; id: string; jurisdiction: Jurisdiction; title: string; type: RecordType; topics: Topic[]; status: string; landmark: boolean; url: string; urlConfidence: "seen" | "constructed"; why: string }`.
  - `parseCandidates(markdown: string): Candidate[]`.
    - It reads every markdown table whose header row starts `| include | id |`, in the column order of spec §5.1 / `candidates.md`: `include, id, title, type, topics, status, landmark, url, url_confidence, why`.
    - `topics` is comma-separated.
    - `jurisdiction` comes from the id prefix: `ca-` → `US-CA`, `sg-` → `SG`. Any other prefix throws, naming the row.
  - `htmlToText(html: string): string`. It drops `script, style, nav, header, footer, noscript`, turns `h1`–`h4` into lines prefixed `# `, collapses whitespace, and keeps paragraph breaks.
  - `pdfToText(bytes: Uint8Array): Promise<string>`, implemented with `unpdf` `extractText` with `mergePages`.
  - `splitPassages(recordId: string, text: string, targetWords = 400): Passage[]`.
    - It starts a new passage at each `# ` heading line and records that heading.
    - It packs paragraphs up to `targetWords`, and hard-splits any paragraph over `1.5 × targetWords` on sentence boundaries.
    - Passage ids are `${recordId}#1..n`.
  - `sha256Hex(text: string): string`, using `node:crypto`.
  - `loadSource(c: Candidate, opts: { rawDir: string; fetchImpl?: typeof fetch; browserbaseKey?: string }): Promise<{ ok: true; text: string; via: "cache" | "fetch" | "browserbase" } | { ok: false; reason: string }>`.
    - It reads the cache first: `${rawDir}/${id}.txt|.md|.html|.pdf`, in that order.
    - Otherwise it fetches with a desktop-browser `User-Agent`, using `content-type` to choose HTML or PDF extraction, and writes the raw bytes into the cache.
    - On HTTP 403/429 or a network error, if `browserbaseKey` is set, it retries via the existing Stagehand reader pattern (`photon/src/sources/browserbase.ts`). Otherwise it returns `{ ok: false, reason: "HTTP 403" }` (or the actual status or error).
    - If the extracted text has fewer than 150 words, it returns `{ ok: false, reason: "too little text" }`.
  - `GEBIZ_RULE = { datasetId, keywords: string[], since: string, minAwardSgd: number }`. The values are taken from the owner-approved GeBIZ section of `candidates.md` and written as constants.
  - `fetchGebizTenders(rule, fetchImpl?): Promise<{ candidate: Candidate; text: string }[]>`. It pages through the data.gov.sg datastore API, filters by keyword in the description and by award ≥ `minAwardSgd`, and builds one `tender` candidate per row.
    - Id: `sg-gebiz-<tender_no lowercased>`.
    - Text: description, agency, supplier, award amount and date.

- [ ] **Step 1: Write failing tests.**
  - The candidates fixture parses to 4 rows. The row with `no` has `include === false`. Topics split correctly. A bad prefix throws, naming the row id.
  - `htmlToText(bill.html)` has no `<`, contains `# ` heading lines and none of the nav/script text.
  - `pdfToText(one-page.pdf)` contains the fixture's known sentence.
  - `splitPassages` on about 900 words gives 3 passages with ids `x#1..x#3`, each ≤ 600 words, and headings carried. On empty text it gives `[]`.
  - `sha256Hex("abc")` equals `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
  - `loadSource`:
    - A cached `.html` returns `via: "cache"` and never calls `fetchImpl`.
    - A fake fetch returning 403 with no browserbase key gives `{ ok: false, reason: "HTTP 403" }`.
    - A fake fetch returning `login-wall.html` with status 200 gives `{ ok: false, reason: "too little text" }`.
    - A fake fetch returning the bill writes the cache file and returns `via: "fetch"`.
  - `fetchGebizTenders` with a fake fetch serving `gebiz.json` keeps only rows matching keywords and threshold, and ids are lowercased.
- [ ] **Step 2: Run and confirm failure.** Run `pnpm test`. Expected: FAIL, modules missing.
- [ ] **Step 3: Implement** the five modules. Pick the HTML parsing approach yourself (a small regex/tokenizer pass, or a light dependency such as `node-html-parser`).
- [ ] **Step 4: Run and confirm pass.** Run `pnpm test`.
- [ ] **Step 5: Commit.** "Add the snapshot source loader, text extraction and passage splitting."

---

### Task 4: Groq client, enrichment, verification

> **R25: now optional (`--llm-headlines`).** The default build no longer calls `enrichRecord` or `verifyRecord`; Task 8 replaces them with deterministic extraction and a string check. This code and its tests stay, and Task 8 adds `headlineFor` and `verifyHeadline` beside them for the opt-in landmark headlines. The text below is the original design.

**Files:**
- Create: `photon/scripts/snapshot/groq.ts`, `enrich.ts`, `verify.ts`
- Create: `tests/snapshot/groq.test.ts`, `enrich.test.ts`, `verify.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `Passage`, schema types.
- Produces:
  - `type Llm = <T>(req: { system: string; user: string; schema: z.ZodType<T>; name: string }) => Promise<T>`.
  - `groqLlm(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch; maxRetries?: number }): Llm`.
    - It POSTs to `https://api.groq.com/openai/v1/chat/completions` with `temperature: 0` and `response_format: { type: "json_schema", json_schema: { name, schema: z.toJSONSchema(schema) } }`.
    - If Groq rejects `json_schema` for the model, it falls back to `{ type: "json_object" }` with the JSON schema embedded in the system prompt.
    - It retries 429/5xx up to `maxRetries` (default 4) with exponential backoff starting at 2s, honouring `retry-after`.
    - On zod validation failure, it makes exactly one repair call that includes the validation errors, then throws.
  - `DEFAULT_MODELS = { enrich: string; verify: string }` in `groq.ts`. Choose current Groq production models that support structured output, after checking `GET https://api.groq.com/openai/v1/models` and Groq's structured-output docs. Env vars `GROQ_ENRICH_MODEL` / `GROQ_VERIFY_MODEL` override them.
  - `Enriched` is the subset of `PolicyRecord` the model writes: `shortTitle?, issuer, published?, status, statusDate?, timeline, summary, provisions, affected, topics, related`.
  - `enrichRecord(c: Candidate, passages: Passage[], llm: Llm, ctx: { otherIds: string[] }): Promise<Enriched>`.
    - Passages are shown to the model as `[id] heading\ntext` blocks.
    - The prompt tells the model to cite passage ids for every claim, use only the listed topics, and use `related` ids only from `ctx.otherIds`.
    - After the call, it deterministically removes any support id not in `passages`, any claim left with empty support, any `related` id not in `otherIds`, and any topic not in `TOPICS`.
  - `verifyRecord(e: Enriched, passages: Passage[], llm: Llm): Promise<{ kept: Enriched; dropped: string[]; fatal?: string }>`.
    - It makes one LLM call listing every claim (`summary`, `status`, each provision, each affected group, each timeline event) with its cited passage text, and gets back `{ claimId, supported: boolean }[]`.
    - Unsupported claims are dropped and named in `dropped`.
    - `fatal` is set to `"summary unsupported"` or `"status unsupported"` when those fail.
    - A claim missing from the model's answer counts as unsupported.

- [ ] **Step 1: Write failing tests**, using fake `fetchImpl` and fake `Llm`:
  - `groq`:
    - Two 429s then 200 → the call resolves, after 3 fetches (inject a zero-delay sleeper).
    - Invalid JSON content twice → it throws after exactly 2 calls (original + 1 repair).
    - A 400 mentioning `json_schema` → retries with `json_object`.
    - The request body has `temperature: 0`.
  - `enrich`:
    - The fake LLM returns a provision citing `x#9` (not present) → the provision is removed.
    - `related: [{ id: "unknown" }]` is removed.
    - Topic `"weather"` is removed.
    - A valid output passes through unchanged.
  - `verify`:
    - One provision marked unsupported → it's dropped and listed.
    - Summary unsupported → `fatal === "summary unsupported"`.
    - The model omits a claim → it's dropped.
- [ ] **Step 2: Run and confirm failure.** Run `pnpm test`.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run and confirm pass.** Run `pnpm test`.
- [ ] **Step 5: Commit.** "Add Groq enrichment and claim verification for snapshot records."

---

### Task 5: Build orchestrator, landmark review, CLI

> **R25: its LLM enrich/verify steps are now optional (`--llm-headlines`).** Task 8 changes `buildSnapshot` so the default path is extract → check, with `llm` and `models` optional. Caching, excluded handling, ordering, `reviewed.json` and `review.md` stay as written below. The text below is the original design.

**Files:**
- Create: `photon/scripts/snapshot/build.ts`, `photon/scripts/snapshot/review.ts`
- Create: `tests/snapshot/build.test.ts`, plus fixture `tests/fixtures/sources/build-candidates.md` (3 rows)
- Modify: `package.json` (script `"snapshot:build": "tsx photon/scripts/snapshot/build.ts"`)

**Interfaces:**
- Consumes: Tasks 1, 3 and 4.
- Produces:
  - `buildSnapshot(opts: { candidatesPath: string; outDir: string; rawDir: string; cacheDir: string; reviewedPath: string; snapshotDate: string; llm: { enrich: Llm; verify: Llm }; models: { enrich: string; verify: string }; fetchImpl?: typeof fetch; browserbaseKey?: string; gebiz?: boolean }): Promise<Manifest>`.
    - Steps: included candidates (plus GeBIZ tenders when `gebiz` is true) → `loadSource` → `splitPassages` → `sha256Hex`.
    - Enrich is cached at `${cacheDir}/enrich/${sha}.json`, and verify at `${cacheDir}/verify/${sha}.json`.
    - It assembles each `PolicyRecord` (provenance from the candidate plus `fetched` = time of first fetch, kept in the cache; `review` from `reviewed.json`).
    - It writes the outputs, then runs `checkSnapshot` on them and throws if there are errors.
  - Every candidate ends in exactly one of `policies.json` or `manifest.excluded` (with `id`, `jurisdiction`, `url`, `title`, `reason`).
  - Output arrays are sorted by `id`, and passages by `id` then `seq`. JSON is written with 2-space indent and a trailing newline, so re-runs are byte-identical.
  - `reviewed.json` is `{ id: string; reviewer: string; reviewedAt: string; sha256: string }[]`. A record is `human-reviewed` only if its current `sha256` matches.
  - `renderReview(records: PolicyRecord[], passages: Passage[]): string` in `review.ts`. It renders landmarks only: summary, status, timeline, provisions, affected, each with its source link and a `- [ ] reviewed` line.
  - CLI: `pnpm snapshot:build [--date YYYY-MM-DD] [--no-gebiz]`.
    - It loads `.dev.vars` via dotenv, requires `GROQ_API_KEY`, and uses the default paths from Global Constraints.
    - It prints counts and every excluded row with its reason.

- [ ] **Step 1: Write failing tests** with fake `Llm`s and a fake fetch:
  - The 3-row build produces 1 record, plus 2 excluded rows: reason `HTTP 403`, and reason `summary unsupported`.
  - `policies.json` passes `checkSnapshot`.
  - A second run with the same inputs makes 0 LLM calls (count calls on the fakes) and produces byte-identical files.
  - A `reviewed.json` entry with a matching sha gives `review.state === "human-reviewed"`. With a stale sha it gives `"auto-checked"`.
  - `review.md` contains only landmark ids and one `- [ ] reviewed` per landmark.
- [ ] **Step 2: Run and confirm failure.** Run `pnpm test`.
- [ ] **Step 3: Implement** `build.ts` and `review.ts`.
- [ ] **Step 4: Run and confirm pass.** Run `pnpm test`.
- [ ] **Step 5: Commit.** "Add the snapshot build command with caching and landmark review."

---

### Task 6: Seed D1 and wire the app to the store; remove fake data

**Files:**
- Create: `photon/scripts/snapshot/seed-d1.ts`, `tests/data/catalog.test.ts`, `tests/fixtures/legacy-pool.ts`
- Modify:
  - `package.json`: add the script `"seed:d1": "tsx photon/scripts/snapshot/seed-d1.ts"`.
  - `photon/src/catalog.ts`: becomes `loadCatalog(db: D1Like): Promise<Catalog>`. `Catalog` gains `snapshotDate: string`. Delete the `LATEST` and `CATALOG` constants.
  - `photon/src/worker.ts`: `/api/sources` calls `loadCatalog(env.DB)`.
  - `photon/src/ask.ts`: add `DB: D1Like` and `GROQ_API_KEY?: string` to `Env`. The pool becomes `[...recordItems(await listRecords(env.DB)), ...siteItems(), ...known, ...taggedSources]`.
  - `photon/src/select.ts`: replace `catalogItems()` with `recordItems(records: RecordSummary[]): SourceItem[]`.
  - `photon/src/contracts.ts`: add `"policy"` to `SourceName`.
  - `photon/src/telegram.ts` (if it builds a pool).
  - `photon/public/sources.html`, `photon/public/sources.js`, `photon/public/sw.js` (bump `politik-shell-v23` → `v24`).
  - `scripts/check-select.ts`: build its pool from `tests/fixtures/legacy-pool.ts`, and import `ChatTurn` from `photon/src/contracts.ts`.
  - `.dev.vars.example`: add `GROQ_API_KEY=`.
  - `README.md`: one short "Data" section with the build/seed commands and the "as of" rule.
- Delete: `photon/src/briefings.ts`. Its 8 items, plus the 10 CA AG items as `SourceItem`s, move verbatim into `tests/fixtures/legacy-pool.ts` as `legacyPool(): SourceItem[]`, so `check:select` keeps testing the current chat logic unchanged.

**Interfaces:**
- Consumes: `listRecords`, `getRecord`, `getManifest` (Task 2), and `snapshotStatements` / `toSqlFile` (Task 2).
- Produces:
  - `loadCatalog(db)` mapping:
    - `jurisdictions` = `manifest.counts.byJurisdiction`, as `{ id, label: id, documents }`.
    - `sources` = records grouped by `publisher`: `{ id: publisher, documents, redistributionOk, attribution }`, taking `attribution`/`redistributionOk` from the first record via `getRecord`.
    - `latest` = the 10 records with the newest `published`, mapped to `CatalogDoc` (`kind` = record `type`, `sourceId` = `publisher`).
    - `blocked` = `manifest.excluded`, mapped to `BlockedSource` (`live: false`, `ended: manifest.builtAt`, `error: reason`, `attribution: ""`, `officialText: false`).
    - `snapshotDate` = `manifest.snapshotDate`.
    - With no manifest, every list is `[]` and `snapshotDate` is `""`.
  - `recordItems` maps a `RecordSummary` to a `SourceItem`: `{ id, source: "policy", title, plain: summary, url, happenedAt: published ?? statusDate, jurisdiction }`.
  - Seed CLI: `pnpm seed:d1 [--remote] [--dir <path>]` (default dir `photon/data/snapshot`).
    - It reads `<dir>/*.json`, runs `checkSnapshot` (aborting on errors), writes `.tmp-seed.sql` via `toSqlFile(snapshotStatements(...))`, and runs `wrangler d1 migrations apply politik` then `wrangler d1 execute politik --file .tmp-seed.sql`, each with `--local` or `--remote`.
  - Sources page: add `<p id="asof" class="meta"></p>` directly after the `<nav>`. `sources.js` sets it to `Data as of 15 Oct 2026` (format `D Mon YYYY` from `snapshotDate`), or `No policy data loaded yet` when `snapshotDate` is empty.

- [ ] **Step 1: Write failing tests** in `tests/data/catalog.test.ts`:
  - With the fixture seeded:
    - `jurisdictions` equals `[{id:"US-CA",label:"US-CA",documents:3},{id:"SG",label:"SG",documents:3}]` (any order).
    - `latest` has ≤ 10 rows sorted by `published` descending.
    - `blocked[0].id === "sg-sso-osa-2022"` and `blocked[0].error === "HTTP 403"`.
    - `snapshotDate === "2026-10-01"`.
  - Unseeded: all lists are empty and `snapshotDate === ""`.
  - `recordItems` maps the fixture `ca-sb-53-2025` summary to `plain` with `source === "policy"`.
- [ ] **Step 2: Run and confirm failure.** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the modifications and the seed CLI. Delete `briefings.ts` and create `legacy-pool.ts`.
- [ ] **Step 4: Run all checks.**
  - `pnpm test` → all pass.
  - `pnpm check:select` → passes, unchanged assertions.
  - `grep -rn "briefings\|3485\|LATEST" photon/src` → no matches.
  - `pnpm exec wrangler deploy --dry-run --outdir .tmp-dry` → bundles with no errors.
- [ ] **Step 5: Smoke test locally.**
  - Seed the fixture into local D1: `pnpm seed:d1 --dir tests/fixtures/snapshot`.
  - Run `pnpm exec wrangler dev`, then `curl -s localhost:8787/api/sources | head -c 400`. The output shows `"snapshotDate":"2026-10-01"`.
  - `curl -s -X POST localhost:8787/api/ask -d '{"message":"What is the AI transparency bill?"}'` returns 200 JSON.
- [ ] **Step 6: Commit.** "Serve sources and chat from the D1 policy store and remove the invented briefings."

---

### Task 7: Produce the real snapshot (operational; needs network and the owner-approved `candidates.md`; no Groq key)

> **R25:** the full build makes no LLM calls and needs no `GROQ_API_KEY`. Do Task 8 first: Step 2 below runs the extract → check build that Task 8 creates. Step 1 (pre-fetching blocked sources) can go ahead before Task 8.

**Files:**
- Create (generated): `photon/data/snapshot/policies.json`, `passages.json`, `manifest.json`, `review.md`
- Modify: `photon/scripts/snapshot/gebiz.ts`. Set the `GEBIZ_RULE` constants from the approved GeBIZ section.

- [ ] **Step 1: Pre-fetch blocked sources.** For every candidate whose URL host returns 403 from this container (e.g. `leginfo.legislature.ca.gov`, `sso.agc.gov.sg`):
  - The orchestrator fetches the page with the Firecrawl MCP scrape tool (markdown format) and saves it to `.tmp-snapshot/raw/<id>.md`.
  - R25: a `.md` capture has no HTML, so the extractors fall back to text patterns (the long-title paragraph, the lead paragraph) and find no meta dates. Where the page can be fetched as HTML (Singapore Statutes Online with a full Chrome `User-Agent`, or the Browserbase fallback), prefer that.
  - `loadSource` then serves it from the cache.
- [ ] **Step 2: Build.** Run `pnpm snapshot:build --date <today>`. No API key is needed. Expected: a printed summary that says `Models: enrich none, verify none.` `excluded` lists only rows with concrete reasons (`no official summary found` and `no official status found` are concrete, and each names a document whose extractor needs a look).
- [ ] **Step 3: Check the data.** Run `pnpm check:data`. Expected: no errors, exit 0.
- [ ] **Step 4: Spot-check.**
  - Open 5 random records and 5 landmarks.
  - For each, confirm that the summary is the page's own official text (the digest's first paragraph, the long title, the page's description or lead paragraph), that the status and dates match the source, and that the URL points to the right document. (That the text occurs in the cited passages is already checked by the build.)
  - Report any mismatch to the orchestrator instead of hand-editing JSON. A wrong summary or date is an extractor bug: fix it in `extract/` with a new fixture test.
  - Optional: for the landmarks, run `pnpm snapshot:build --date <same date> --llm-headlines` (needs `GROQ_API_KEY`) to add headlines. It changes nothing else.
- [ ] **Step 5: Seed.**
  - Run `pnpm seed:d1` (local) and smoke-test `/api/sources` as in Task 6.
  - The orchestrator runs `pnpm seed:d1 --remote` only after the owner's OK.
- [ ] **Step 6: Commit.** "Add the first curated California and Singapore tech-policy snapshot."

---

### Task 8: Deterministic extraction replaces LLM enrichment

**Ruling R25, "extract, don't generate".** Spec §5.3 (extract), §5.4 (check) and §5.4b (optional headlines) are the contract; read them first. After this task the default `pnpm snapshot:build` makes zero LLM calls and needs no `GROQ_API_KEY`. The Groq enrich/verify code from Tasks 4 and 5 stays and serves only `--llm-headlines`.

**Depends on:** Tasks 1 to 6 and the Task 7 source-loading fixes, in particular the California bill text layout (`LEGINFO_TEXT_LAYOUT = "2"`: a `# Bill:` header, the Legislative Counsel's Digest, a `# Legislative history` section of `YYYY-MM-DD — action` paragraphs, then the bill's sections). **Run before Task 7 Step 2.**

**Files:**
- Create: `photon/scripts/snapshot/extract/index.ts`, `common.ts`, `bill.ts`, `statute.ts`, `html.ts`, `pdf.ts`, `hansard.ts`, `tender.ts`, `related.ts`.
  - `photon/scripts/snapshot/extract.ts` (Task 3's HTML/PDF to text) stays where it is. The new directory sits beside it. Imports spell the extension, so `./extract.ts` is the text extraction and `./extract/index.ts` is the record extraction; they do not clash.
- Create: `photon/scripts/snapshot/meta.ts` (page meta and Singapore Statutes Online readers, shared by `fetch.ts` and `extract/`), `photon/scripts/snapshot/check.ts`.
- Modify:
  - `photon/scripts/snapshot/fetch.ts`: see "What `loadSource` returns" below.
  - `photon/scripts/snapshot/leginfo.ts`: add `parseLegislativeHistory`.
  - `photon/scripts/snapshot/passages.ts`: export `toSections` (the section and paragraph grouping the extractors reuse).
  - `photon/scripts/snapshot/enrich.ts`: add `headlineFor`. `photon/scripts/snapshot/verify.ts`: add `verifyHeadline`. `enrichRecord`, `verifyRecord` and their tests are untouched.
  - `photon/scripts/snapshot/build.ts`, `photon/scripts/snapshot/review.ts`: see "`build.ts` changes" below.
  - `photon/src/data/schema.ts`: add `headline: supported(NonEmpty).optional()` to `PolicyRecordSchema`. `scripts/check-data.ts`: check `headline.support` like `summary.support`. No `store.ts` or Worker change: `headline` rides inside `data_json`.
  - `package.json`: add one small HTML parser for selector queries (`node-html-parser`, exact version pinned). Only `meta.ts` uses it.
  - `README.md` (Data section: the build needs no key; `--llm-headlines` needs `GROQ_API_KEY`) and `.dev.vars.example` (comment on `GROQ_API_KEY`).
- Create tests: `tests/snapshot/extract-common.test.ts`, `extract-bill.test.ts`, `extract-statute.test.ts`, `extract-html.test.ts`, `extract-pdf.test.ts`, `extract-hansard.test.ts`, `extract-tender.test.ts`, `extract-related.test.ts`, `meta.test.ts`, `check.test.ts`. Modify: `tests/snapshot/fetch.test.ts`, `leginfo.test.ts`, `enrich.test.ts`, `verify.test.ts`, `build.test.ts`, `tests/data/check-data.test.ts`.
- Create fixtures in `tests/fixtures/extract/`. Each is a trimmed copy of a real page's shape, authored to the expected values in Step 1:
  - `bill-enacted.txt`, `bill-vetoed.txt`, `bill-in-progress.txt` (the Task 7 layout; variants such as "no digest" are made inside the tests by cutting a section).
  - `sso-revised-act.html`, `sso-original-act.html`, `sso-act-capture.md` (a Firecrawl-style capture with no HTML).
  - `release-oag.html`, `release-isomer.html`, `release-imda-next.html`, `hub-pdpc.html`, `eo.html`, `regulation.html`.
  - `framework.txt`, `report-no-heading.txt`, `notice-digest.txt` (all shaped like `pdfToText` output), `hansard-sprs.html`, `speech-ministry.html`.
  - `tender.txt`, `tender-multi.txt` (shaped like the text `gebiz.ts` builds).

**What `loadSource` returns (the structured inputs).** Besides `text`, `LoadResult` (ok) gains:
- `format: "html" | "pdf" | "text"`. `text` covers hand-placed `.txt`/`.md` files (such as Firecrawl captures), California bills and anything cached as text. A tender (which skips `loadSource`) is passed as `"text"`.
- `html?: string`: the page's decoded raw HTML, present when the source was an HTML page (fetched, cached `.html`, or Browserbase).
- The Browserbase fallback now caches the rendered page as `${id}.html` (it cached the extracted text as `${id}.txt`), so a cache hit still has the HTML. An older `.txt` Browserbase cache is still read, as `format: "text"`.
- For an HTML page, `text` is `pageBlocks(html, body) + "\n\n" + body`, where `body` is `htmlToText(html)`. `pageBlocks` returns the sections that make facts outside the visible body citable (spec §5.2): `# Page description` plus the description, and, for an SSO Act, `# Contents` plus one paragraph per table-of-contents entry. A block is left out when its text already occurs in `body`. The 150-word gate still counts `body` only.
- California bills need nothing new: the history is read back from the text with `parseLegislativeHistory(text): { date: string; action: string }[]` in `leginfo.ts`, the inverse of `legislativeHistoryText`. The round trip is tested, so a layout change breaks a test.

**Interfaces:**
- Produces, from `extract/index.ts`:
  ```ts
  type Cited = { value: string; support: string[]; parts?: string[] };   // parts: strings that must each occur in a cited passage; default [value]
  type Extracted = {
    shortTitle?: string; published?: string;
    status: { value: Status; support: string[] }; statusDate?: string;
    timeline: { date: string; event: string; support: string[]; parts?: string[] }[];
    summary: Cited; provisions: Cited[]; affected: Cited[];
  };
  type ExtractMeta = { snapshotDate: string; format: "html" | "pdf" | "text"; html?: string };
  type ExtractResult = { ok: true; fields: Extracted } | { ok: false; reason: "no official summary found" | "no official status found" };
  extractRecord(c: Candidate, text: string, passages: Passage[], meta: ExtractMeta): ExtractResult
  ```
  - It is pure: no I/O, no clock, no network. `parts` exists only while building and is stripped before the record is assembled.
  - Dispatch on `c.type`: `bill` → `bill.ts`, `statute` → `statute.ts`, `tender` → `tender.ts`, `hansard` → `hansard.ts`; `press-release`, `guidance`, `regulation` and `executive-order` → `pdf.ts` when `meta.format === "pdf"`, else `html.ts` (which also reads a `text` capture). `type`, `title`, `topics`, `landmark` are not extracted: they come from the candidate.
- `extract/common.ts`:
  - `normalise(s)` collapses whitespace and trims.
  - `parseDate(s)` returns an ISO date from `January 5, 2026`, `5 January 2026`, `5 Jan 2026` or `2026-01-05T09:56:34-08:00` (the date as written, no timezone conversion), and `undefined` for an impossible date such as 30 February.
  - `splitSentences(text)` splits after `.`, `!` or `?` followed by a capital, except after `Sec.`, `Secs.`, `No.`, `Nos.`, `Ch.`, `U.S.`, `Cal.`, `Inc.`, `Dept.`, `Gov.`.
  - `capSentences(text, maxWords = 150)` keeps whole leading sentences within the limit (a first sentence over the limit is kept whole).
  - `cite(passages, needle)` returns the ids of the passages whose heading and text contain `needle` (normalised), or `[passages[0].id]` when none do.
  - `leadParagraph(sections)` takes the output of `toSections` and returns the first paragraph of at least 25 words, skipping boilerplate (a paragraph that begins "This article has been migrated", "Skip to", or "We use cookies").
  - `listProvisions(sections, max = 4)` returns list items of at least 6 words (when there are at least 2), else headings of at least 2 words that are not generic (`Overview`, `Contents`, `Introduction`, `Background`, `Related`, `Share`, `Contact`, `Resources`, `References`, `Summary`).
  - Constants `SUMMARY_MAX_WORDS = 150`, `LEAD_MIN_WORDS = 25`, `DESCRIPTION_MIN_WORDS = 15`, and the fixed event labels `Published`, `Signed`, `Effective`, `Assented`, `Commenced`, `Operative`, `Awarded`, `Sitting`.
- `meta.ts` (the only module that queries a DOM):
  - `pageMeta(html): { description?: string; published?: string }`.
    - `description`: the first of `meta[name=description]` and `meta[property=og:description]` that has at least 15 words after entities are decoded and whitespace is collapsed (attribute order and quote style do not matter).
    - `published`, first valid of: `meta[property=article:published_time]`; `meta[name=date|dcterms.date|DC.date.issued|publish-date|pubdate]` and `meta[itemprop=datePublished]`; JSON-LD `datePublished` (also inside `@graph`); `.field-name-field-release-date .date-display-single[content]` (oag.ca.gov); `"publish_date":"25 May 2022"` in a Next.js payload (imda.gov.sg); the first `<p>` after the `<h1>` whose text is `D Month YYYY` (the Isomer template of mddi.gov.sg and csa.gov.sg); the first `<time datetime>`.
    - Never used: `dateModified`, `article:modified_time`, `og:updated_time`, and `span.page-banner__date` on pdpc.gov.sg (that is the hub page's date, not the document's).
  - `ssoFacts(html): { longTitle?: string; longTitleParts: string[]; commencement?: { date: string; written: string }; assent?: { date: string; written: string }; toc: { kind: "part" | "section"; text: string }[] } | null`. It is `null` when the page has none of these elements. Selectors (research, checked live 2026-10-15 on the Personal Data Protection Act 2012, a revised edition, and the Online Safety (Relief and Accountability) Act 2025, original format):
    - Long title: `td.longTitle`, with the nested `div.amendNote` amendment cites (such as `[22/2016]`) removed. `longTitleParts` are the pieces between the removed cites, so each piece is verbatim.
    - Commencement: the first `td.cDate` (revised edition, text `2 January 2013: Parts I, II, ...`), else `div.cDateL` (original format, `Date of Commencement: 29 June 2026 ...`).
    - Assent: `td.PADate` (`... assented to by the President on 25 November 2025`), else `div.sigDate`. A revised edition shows no assent date.
    - Contents: Parts from `a.nav-link[href^="#P"] > b` (`Part 4 COLLECTION, USE AND DISCLOSURE OF PERSONAL DATA`; skip empty ones), sections from `a.nav-link[href^="#pr"][data-part] span` (`13 Consent required`).
    - SSO is lazy-loaded: `?WholeDoc=1` inlines only Part 1 and sections 1 to 4, but the front matter and the whole table of contents are inline. The extractor therefore reads the contents, not the body. Fetching the full body is the Task 7 loader's job, not this task's.
  - `pageBlocks(html, body): string`, as described above.
- `extract/related.ts`: `linkRelated(items: { id: string; jurisdiction: Jurisdiction; title: string; shortTitle?: string; text: string }[]): Map<string, { id: string; relation: "related" }[]>`. Called once, after the build knows which records were built.
- `check.ts`: `checkClaims(f: Extracted, passages: Passage[]): { fields: Extracted; dropped: string[]; fatal?: "no official summary found" }`. A passage is searched as `heading + "\n\n" + text`, normalised. `dropped` names claims like `provisions[2]` and `timeline[0]`.
- `enrich.ts`: `headlineFor(c: Candidate, summary: Supported<string>, llm: Llm): Promise<Supported<string> | null>`.
  - One call, with the title and the summary text only. The reply schema is `{ headline: string }`.
  - `support` is `summary.support`. It returns `null` for an empty headline, one over 30 words, or one with two sentences.
- `verify.ts`: `verifyHeadline(headline: Supported<string>, passages: Passage[], llm: Llm, ctx?: { today?: string }): Promise<boolean>`. It reuses the existing system prompt and `Verdicts` schema, with one claim (`headline`) and its cited passages. A claim the model omits is `false`.

**Rules per extractor** (the spec's tables in §5.3 are the source of truth; this pins what the tests check):
- `bill.ts`:
  - `shortTitle` is the bill type and number from the `# Bill: SB 53 (2025-2026) — ...` header, else from the id (`ca-sb-53-2025` gives `SB 53`).
  - `summary` is the first paragraph under `# Legislative Counsel's Digest` that is not the subject line. No digest gives `no official summary found`.
  - `provisions` are the digest sentences beginning `This bill would`, verbatim, up to 6.
  - `published` is the date of the first history action. No history gives `no official status found`.
  - Status: the latest history action matching `Vetoed by the Governor` gives `vetoed`; matching `Chaptered by Secretary of State` gives `enacted`; neither gives `in-progress`.
  - Operative date: a chaptered bill is `in-force` when the latest date in a sentence of its own sections that begins `This act`, `This section` or `Section N of this act` and says `become(s) operative on` or `take(s) effect on` is on or before the snapshot date. Dates in the digest and in quoted code text do not count.
  - Timeline: the history rows matching `BILL_MILESTONES` (`^Introduced`, `Read third time. Passed`, `^Enrolled and presented to the Governor`, `^Approved by the Governor`, `^Vetoed by the Governor`, `^Chaptered by Secretary of State`), in history order, with the action's wording as the event and `parts: [date, action]`. `in-force` adds an `Operative` event.
- `statute.ts`:
  - `summary` is `ssoFacts.longTitle`, with `parts: longTitleParts`. Without HTML (a capture): the first paragraph that begins `An Act to|for|relating|respecting`, case-insensitive. No long title gives `no official summary found`.
  - `provisions` are up to 8 `Part N TITLE` contents entries. An Act with fewer than 3 Parts gives up to 8 section entries instead. Without HTML: a line `Part N` and the paragraph after it, joined by a space.
  - Status: `in-force`, `statusDate` = commencement date, else assent date, else omitted. A commencement date after the snapshot date gives `enacted`.
  - `published` is the assent date when shown. Timeline: `Assented` (when shown) and `Commenced`, with `parts: [written date]`.
- `html.ts`, `pdf.ts`:
  - HTML summary: `pageMeta.description`, expanded to the whole body paragraph when the description ends in an ellipsis and is the start of a paragraph, else the lead paragraph.
  - PDF summary: the first paragraph under a bare line `Executive summary`, `Overview`, `Introduction` (optionally numbered, `1. Introduction`) or, for a regulation, `Informative Digest`; else the first paragraph of at least 25 words. A paragraph is the lines up to a blank line, joined by single spaces, as `splitPassages` joins them.
  - Dates: `published` from `pageMeta` (HTML) or none (PDF). Executive order: signing date is the closing clause `this 6th day of September 2023`, else `published`. Regulation: the first `take(s) effect on <date>` or `effective <date>` in the text.
  - Status, `statusDate` and timeline follow spec §5.3 by `c.type`. `provisions` use `listProvisions` (HTML) or lines beginning `•`, `-` or `–` of at least 6 words, else numbered headings (PDF).
- `hansard.ts`:
  - On an SPRS page (a `Sitting Date: DD-MM-YYYY` row): `published` is the sitting date (else the `_YYYYMMDD_` token in the candidate URL). The statement is the text after the header rows.
  - The summary is the first paragraph of at least 25 words, with a leading speaker label `<Office> (<Name>):` and a salutation such as `Mr Speaker, Sir,` removed (what remains is still verbatim).
  - A ministry speech page (mddi.gov.sg, csa.gov.sg) has no header rows and follows the `html.ts` lead-paragraph rule. Status is `published` either way, with a `Sitting` timeline event for SPRS pages and `Published` otherwise.
- `tender.ts`:
  - Reads the `Tender number`, `Description`, `Agency`, `Supplier(s)`, `Awarded amount` or `Largest single award`, and `Award date` lines of the text `gebiz.ts` builds.
  - `summary` is `"<agency> awarded tender <no> (<description>) to <supplier> for <amount> on <date>."`. For several suppliers: `"... to <the Suppliers line> for a largest single award of <amount> on <date>."`. `parts` are the interpolated field values, so the check proves each is in the tender's passage.
  - `affected` is the agency and the supplier name(s), each verbatim. Status `awarded` and `published` are the award date. `provisions` is `[]`. A missing field gives `no official summary found`.

**`build.ts` changes** (the default path is extract → check; `--llm-headlines` adds headlines):
- `BuildOptions.llm` and `models` become optional, and `headlines?: boolean` is added. `headlines` without `llm` and non-empty model names throws before any work. Default `models` is `{ enrich: "none", verify: "none" }` and is what the manifest records.
- Per candidate: load → `splitPassages` → `extractRecord` → `checkClaims` → assemble. `issuer` and `publisher` both come from `publisherFor`. `parts` is dropped from every claim. `no official summary found` and `no official status found` are content exclusions (not `failed`). The enrich and verify caches, `enrichMaxWords` and `relatedCandidateIds` leave the build path.
- `related`: after all candidates are done, call `linkRelated` over the built records' texts. Links can only point at built records.
- With `headlines` on, for each landmark only: `headlineFor` on the record's summary, then `verifyHeadline` against the summary's passages. Cached at `${cacheDir}/headline/${sha}.json` under the models and the summary's hash.
  - A rejected or failed headline leaves the record built without one (`stat.headline` = `"dropped"` or `"failed"`).
  - HTTP 401/403 from Groq still throws `SnapshotGuardError("auth")` after the current record.
  - Remove the `llm-failures` guard (no LLM error can exclude a record any more) and its tests. Keep `auth` and `partial`.
- `parseArgs` accepts `--llm-headlines`. `main` reads `GROQ_API_KEY` and creates the Groq clients only with that flag. With the flag and no key it exits 1 with the existing message. Update `USAGE` and `formatSummary` (the models line stays; add a headline count when the flag is on; the per-record line no longer shows enrich/verify cache state).
- `review.ts`: `renderReview` prints a record's headline under its summary, marked "machine-written".

- [ ] **Step 1: Write failing tests.** Authoring a fixture means writing the page so the expected values below come out; write the test, then the fixture.
  - **`extract-common.test.ts`:**
    - `normalise("a \n\t b  ")` equals `"a b"`.
    - `parseDate`: `"January 5, 2026"`, `"5 January 2026"`, `"5 Jan 2026"` and `"2026-01-05T09:56:34-08:00"` all give `"2026-01-05"`; `"February 30, 2026"` gives `undefined`.
    - `splitSentences("Sec. 22757.12 applies. This bill would add X. It also does Y.")` has 3 items and does not split after `Sec.`.
    - `capSentences` on 200 words in 10 sentences returns a prefix of the input that ends on a sentence end and has at most 150 words. One 200-word sentence is returned unchanged.
    - `cite` returns every passage that holds the needle, finds a needle that is a passage's `heading`, and falls back to the first passage.
    - `listProvisions` prefers bullets (at least 2 of 6+ words), falls back to non-generic headings, and caps at 4.
  - **`check.test.ts`:**
    - A value that differs from its passage only in whitespace passes. A value equal to a passage heading passes.
    - A value found only in a passage that is not in `support` fails.
    - `parts: [agency, supplier]` passes when both occur and fails when one does not. `parts: []` passes; an unknown support id fails.
    - A failing summary gives `fatal: "no official summary found"`. A failing `provisions[1]` is dropped, the other provisions keep their order, and `dropped` equals `["provisions[1]"]`. A failing timeline event is dropped as `timeline[0]`.
  - **`meta.test.ts`:**
    - Description: the attribute order swapped and single quotes; `&amp;` and `&#8217;` decoded; 14 words gives `undefined`; a short `name=description` falls through to a long `og:description`; a lone `" "` gives `undefined`.
    - Published: `article:published_time` `2026-01-16T09:56:34-08:00` gives `"2026-01-16"`; JSON-LD `datePublished` is used and `dateModified` is ignored; a page with only `article:modified_time` gives `undefined`; `release-imda-next.html` gives `"2022-05-25"`; `release-isomer.html` gives `"2024-10-01"`; `hub-pdpc.html` (a `Published on 03 Nov 2023` banner) gives `undefined`; the OAG release-date span gives its `content` date.
    - `ssoFacts(sso-revised-act.html)`: the long title has no `[22/2016]` and `longTitleParts` has 2 pieces; commencement is `{ date: "2013-01-02", written: "2 January 2013" }`; assent is `undefined`; `toc` has 10 Parts and the Part 4 text equals `Part 4 COLLECTION, USE AND DISCLOSURE OF PERSONAL DATA` (adapt to the fixture). `ssoFacts(sso-original-act.html)`: assent `2025-11-25`, commencement `2026-06-29`. A page with none returns `null`.
    - `pageBlocks`: a description not in the body gives a `# Page description` block; one already in the body gives none; an SSO page gives a `# Contents` block of one paragraph per entry, and none when the body already holds them.
  - **`fetch.test.ts` (added):**
    - A fetched HTML page whose description is not in the body returns `format: "html"`, `html`, and `text` that starts with `# Page description`.
    - A cache hit returns the same `text` and `html`.
    - A 14-word description adds no block.
    - A PDF gives `format: "pdf"` and no `html`. A hand-placed `.md` gives `format: "text"`. A leginfo bill gives `format: "text"`.
    - The Browserbase fallback caches `${id}.html`, returns `html` and `format: "html"`, and a second call is a cache hit.
    - The 150-word gate counts the body only: a page with a long description and a 40-word body is still `too little text`.
  - **`leginfo.test.ts` (added):** `parseLegislativeHistory(legislativeHistoryText(history))` returns the same dates and actions. A history with a double space in an action keeps it as written. The `Current status:` line is not returned as an action. A text with no history section gives `[]`.
  - **`extract-bill.test.ts`** (snapshot date `2026-10-15` unless stated):
    - `bill-enacted.txt`: `summary.value` is the digest's first paragraph and not the subject line; `shortTitle` is `"SB 900"`; `published` is the first history date; `status.value` is `"in-force"` and `statusDate` is the operative date from the bill's last section. With the snapshot date earlier than that, `"enacted"` and the chaptering date. A `becomes operative` date in the digest changes nothing.
    - `provisions`: with 8 `This bill would` sentences in the digest, exactly the first 6, in order, verbatim. A `Sec.` abbreviation inside a sentence does not split it. A sentence that begins `This bill would also` counts.
    - Timeline: only milestone rows, ascending, each `event` equal to the action's wording with whitespace collapsed (`Chaptered by Secretary of State. Chapter 138, Statutes of 2025.`). Every claim passes `checkClaims` against `splitPassages` of the same text.
    - `bill-vetoed.txt`: `vetoed`, `statusDate` is the veto date, and the last milestone is the veto. `bill-in-progress.txt`: `in-progress`, `statusDate` is the last action's date, and there is no `enacted`.
    - Removing the digest section gives `{ ok: false, reason: "no official summary found" }`. Removing the history section gives `no official status found`.
    - `support` of the status cites the passage that holds the deciding history row. A digest paragraph of 220 words gives a summary of at most 150 words that ends on a sentence end.
  - **`extract-statute.test.ts`:**
    - `sso-revised-act.html` (text from `pageBlocks + htmlToText`): `summary.value` is the long title without amendment cites and `summary.parts` are its 2 pieces; status `in-force`, `statusDate` `2013-01-02`; timeline `[{ date: "2013-01-02", event: "Commenced" }]`; `published` is `undefined`; `shortTitle` is `"PDPA"` for id `sg-pdpa-2012`; `provisions` are the first 8 of 10 Part headings.
    - An Act with 2 Parts gives section headings, up to 8. `sso-original-act.html`: `published` and the `Assented` event are `2025-11-25`; with snapshot date `2026-01-01` the status is `enacted` (commencement `2026-06-29` is later), and with `2026-10-15` it is `in-force`.
    - `sso-act-capture.md` (no HTML): the summary is the `An Act to ...` paragraph, there is no `statusDate`, and `provisions` come from `Part N` lines.
    - No long title gives `no official summary found`. Every claim passes `checkClaims`.
  - **`extract-html.test.ts`:**
    - `release-oag.html`: the meta description is cut with `…` in the middle of the lead; the summary is the whole lead paragraph (at most 150 words). `published` is the date part of `article:published_time`; status `published`, `statusDate` equal, timeline `[Published]`.
    - `release-isomer.html`: a blank description and a "this article has been migrated" notice of 30 words; the summary is the first body paragraph after the notice. `published` is `2024-10-01`.
    - A 15-word description is the summary; a 14-word one is not. A description that is not in the body is cited to the `Page description` passage.
    - A page with no date: `published` status, no `statusDate`, timeline `[]`. A page with only short paragraphs and no description gives `no official summary found`.
    - `eo.html`: `in-force`, `statusDate` `2023-09-06` from the closing clause, timeline `[Signed]`, `shortTitle` `"N-12-23"` for id `ca-eo-n-12-23`.
    - `regulation.html`: `take effect on January 1, 2026` gives `in-force` and `2026-01-01`; the same sentence with 2027 gives `proposed`; no date gives `published`.
    - `provisions`: 3 list items of 6+ words give those 3; 1 list item and 4 headings give 4 non-generic headings; none gives `[]`.
    - `hub-pdpc.html` does not take the banner date. Every claim passes `checkClaims`.
  - **`extract-pdf.test.ts`:**
    - `framework.txt` (an `Executive summary` line, then wrapped lines): the summary is that section's first paragraph with the lines joined by single spaces. `1. Introduction` works.
    - `report-no-heading.txt`: the first paragraph of 25+ words, skipping the title and cover lines. `notice-digest.txt` (regulation): the `Informative Digest` paragraph.
    - Lines beginning `•` give up to 4 provisions. No paragraph of 25+ words gives `no official summary found`.
    - `published` is `undefined`. The result passes `checkClaims` after `splitPassages`.
  - **`extract-hansard.test.ts`:**
    - `hansard-sprs.html`: `published` is `2012-10-15` from `Sitting Date: 15-10-2012`; a 10-word procedural paragraph is skipped; the summary is the next paragraph with the `The Minister for ... (Name):` label and `Mr Speaker, Sir,` removed; timeline `[Sitting]`; status `published`.
    - With the `Sitting Date` row cut, the date comes from the `_20121015_` token in the candidate URL.
    - `speech-ministry.html`: the lead-paragraph rule, event `Published`.
  - **`extract-tender.test.ts`:**
    - `tender.txt`: the summary equals the template sentence exactly (for example `Ministry of Digital Development and Information awarded tender GBZ000123 (Supply of cloud services) to Example Pte Ltd for S$1,234,567 on 2025-03-04.`), `parts` has 6 entries, and `checkClaims` passes.
    - `affected` is `[agency, supplier]`. Status `awarded`, `statusDate` and `published` are the award date, timeline `[Awarded]`.
    - `tender-multi.txt`: the multi-supplier template and a `Suppliers:` line used verbatim. A missing `Agency:` line gives `no official summary found`.
  - **`extract-related.test.ts`:**
    - Records: CA bill SB 1047 (text mentions `SB 53`), CA bill SB 53, SG statute `Personal Data Protection Act 2012`, and an SG guidance text mentioning that Act. SB 1047 links to SB 53 with relation `related`.
    - `SB 530` does not match `SB 53`. `Senate Bill 53` does. A CA text mentioning the Act gets no SG link (other jurisdiction). The Act's short title matches without its year, and the guidance links to the statute. A record never links to itself, and links are sorted by id.
  - **`extract/index` dispatch** (inside `extract-common.test.ts` or its own file): a `press-release` with `format: "pdf"` goes to the PDF rules and with `"html"` to the HTML rules. Output holds no `parts` after the build strips them.
  - **`enrich.test.ts` / `verify.test.ts` (added):**
    - `headlineFor` sends the title and the summary text and no other passage text. It returns `support` equal to the summary's. A 35-word reply, an empty reply and a two-sentence reply each give `null`.
    - `verifyHeadline` returns `true` when the fake model says supported, `false` when it says unsupported, and `false` when it omits the claim.
  - **`check-data.test.ts` (added):** a record with `headline` passes. A headline whose support names `ca-sb-53-2025#99` is reported with the id and the word `headline`. An empty `headline.support` is reported. An unknown extra key is still rejected.
  - **`build.test.ts`** (rewrite the cases that drove the build through enrich and verify; keep loading, partial-guard, ordering, `reviewed.json`, `review.md`, GeBIZ and constructed-URL cases):
    - The 3-row fixture builds with no `llm` option and a `fetchImpl`. `manifest.models` equals `{ enrich: "none", verify: "none" }`. A row with no summary source is excluded with `no official summary found`, and a bill with no history with `no official status found`.
    - With `llm` fakes that fail the test if they are called, and `headlines` unset, the build completes: the default build makes no model call.
    - A second run with the same inputs and a `fetchImpl` that throws writes byte-identical files.
    - `related` links only to built records: an excluded record's id never appears.
    - With `headlines: true` and fake LLMs: only landmarks get a `headline`, and its `support` equals the summary's. A non-landmark makes 0 calls and a landmark at most 2 (write, verify). `manifest.models` holds the given names.
    - A headline the verifier rejects leaves the record built without one. A non-401 `LlmError` does the same and is logged. A 401 throws `SnapshotGuardError` of kind `auth`. A second run makes 0 calls, and a run without `headlines` ignores the cached headline.
    - `main`: without `--llm-headlines` and with no `GROQ_API_KEY`, the (stubbed) build runs and the exit code is 0. With the flag and no key it exits 1 and the message names `GROQ_API_KEY`.
- [ ] **Step 2: Run and confirm failure.** Run `pnpm test`. Expected: the new tests FAIL (missing modules and options); the existing tests are unchanged until Step 3 touches their code.
- [ ] **Step 3: Implement**, in this order, running `pnpm test` after each item:
  1. Schema and `check-data` (`headline`).
  2. `meta.ts`, then the `fetch.ts` changes, then `leginfo.ts` `parseLegislativeHistory` and the `passages.ts` export.
  3. `extract/common.ts`, `check.ts`, then each extractor with its tests: `tender.ts`, `bill.ts`, `html.ts`, `pdf.ts`, `statute.ts`, `hansard.ts`, then `related.ts` and `index.ts`.
  4. `headlineFor`, `verifyHeadline`, then `build.ts`, `review.ts` and the CLI.
  - Constants (`SUMMARY_MAX_WORDS`, `LEAD_MIN_WORDS`, `DESCRIPTION_MIN_WORDS`, `BILL_MILESTONES`, the generic-heading and boilerplate lists) sit at the top of their module. Tune them against the fixtures, not against the tests' expectations.
  - SSO element selectors: confirm live (Step 4) before finalizing `ssoFacts`. The spec rules do not change if a selector does.
- [ ] **Step 4: Check against real pages (needs network; otherwise do it in Task 7 Step 4).** For one source of each type (SB 53, SB 1047, the Personal Data Protection Act 2012, an oag.ca.gov release, a gov.ca.gov executive-order page, an mddi.gov.sg release, an imda.gov.sg page, a pdpc.gov.sg page, an SPRS page, one tender), load it through `loadSource` into the raw cache and run `extractRecord`. Compare each field with the page by eye and fix any selector that is wrong.
  - SSO needs a full Chrome `User-Agent` and is slow: retry.
  - imda.gov.sg and pdpc.gov.sg keep their body in a Next.js payload, not in the HTML. If a plain fetch has no body, the loader's existing Browserbase fallback or a Firecrawl capture supplies it; this task does not decode the payload.
  - Replace the hand-authored fixtures with trimmed copies of the real pages where that is practical.
- [ ] **Step 5: Run all checks.**
  - `pnpm test` → all pass.
  - `pnpm exec tsc --noEmit` → no errors.
  - `grep -rn "enrichRecord\|verifyRecord" photon/scripts/snapshot/build.ts` → no matches (the default build no longer calls them).
- [ ] **Step 6: Commit.** "Extract records from official text instead of generating them with a model."
