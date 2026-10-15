# Policy Dataset & Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Politik's invented and hardcoded data with a curated, cited snapshot of about 200 California and Singapore tech-policy records. The snapshot is stored in Cloudflare D1 and read through one data-access module.

**Architecture:**
- A Node-only build pipeline in `photon/scripts/snapshot/` turns an owner-approved `candidates.md` into three committed JSON files: records, passages and manifest. The steps are fetch → extract → split → Groq enrich → Groq verify.
- A seed script loads those files into D1, which has FTS5 full-text search.
- The Worker reads data only through `photon/src/data/store.ts`.

**Tech Stack:** TypeScript, tsx, `node:test`, zod 4, Cloudflare Workers + D1 (FTS5), wrangler 4 (`getPlatformProxy` for tests), Groq chat completions API, `unpdf` for PDF text.

**Spec:** `docs/superpowers/specs/2026-10-15-policy-dataset-design.md`. Read it before starting any task. Section numbers below (§n) refer to it.

## Global Constraints

- Jurisdictions are exactly `"US-CA" | "SG"`.
- Record types are exactly `bill | statute | regulation | executive-order | guidance | tender | press-release | hansard`.
- Topics are exactly `ai-governance | data-centres | privacy-data | cybersecurity | online-safety | gov-tech-procurement | digital-infrastructure`.
- Statuses are exactly as in spec §4.
- Passage id format is `${recordId}#${seq}`, with `seq` starting at 1. Passages target about 400 words.
- Snapshot outputs live in `photon/data/snapshot/`: `policies.json`, `passages.json`, `manifest.json`, `review.md`. Inputs are `candidates.md` and `reviewed.json`.
- Build caches live under `.tmp-snapshot/` (already git-ignored by `.tmp-*`).
- Secrets come only from the environment or `.dev.vars` (loaded with `dotenv` in Node scripts): `GROQ_API_KEY`, `BROWSERBASE_API_KEY`. Never write a key into any tracked file.
- Groq model names come from env `GROQ_ENRICH_MODEL` / `GROQ_VERIFY_MODEL`, never hardcoded in logic. Defaults live in one constant in `groq.ts`.
- Build code under `photon/scripts/snapshot/` is Node-only and must never be imported by `photon/src/**`.
- Worker code reads policy data only via `photon/src/data/store.ts`.
- No invented data may reach a user-facing surface. Fixtures live only under `tests/`.
- Package manager is pnpm. Tests are `node:test` + `node:assert/strict`, run with `pnpm test` (`tsx --test "tests/**/*.test.ts"`).
- Commit messages follow the repo style: one plain sentence ending in a period, then the attribution trailer lines the orchestrator gives you.

## Review Focus

1. **Hostile or odd search text:** quotes, `NEAR(`, `*`, `AND OR NOT`, emoji, CJK/Malay, a 2,000-character paste. `searchPassages` never throws; it returns `[]` or hits. Pinned in Task 2.
2. **Malformed LLM output:** bad JSON, missing fields, or support ids that don't exist. The record's claims are dropped or the record is excluded with a reason, and the build never crashes. Pinned in Task 4.
3. **A source that returns 200 but is junk:** a login wall, an error page, or fewer than 150 words of text. The record is excluded with reason `"too little text"`. Pinned in Task 3.
4. **Re-running the build with unchanged sources:** zero LLM calls, and byte-identical output (stable ordering). Pinned in Task 5.
5. **Unseeded D1:** `/api/sources` and chat still respond. They show empty lists, and `getManifest` returns `null`. Pinned in Task 6.

## Before execution (orchestrator, not a subagent task)

- Create the D1 database `politik` (via the Cloudflare MCP tool, with the owner's OK) and put its `database_id` into Task 2's `wrangler.jsonc` edit.
- Make `GROQ_API_KEY` available to subagents that run Task 7, as an environment variable or in `.dev.vars`.
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

### Task 7: Produce the real snapshot (operational; needs network, `GROQ_API_KEY`, and the owner-approved `candidates.md`)

**Files:**
- Create (generated): `photon/data/snapshot/policies.json`, `passages.json`, `manifest.json`, `review.md`
- Modify: `photon/scripts/snapshot/gebiz.ts`. Set the `GEBIZ_RULE` constants from the approved GeBIZ section.

- [ ] **Step 1: Pre-fetch blocked sources.** For every candidate whose URL host returns 403 from this container (e.g. `leginfo.legislature.ca.gov`, `sso.agc.gov.sg`):
  - The orchestrator fetches the page with the Firecrawl MCP scrape tool (markdown format) and saves it to `.tmp-snapshot/raw/<id>.md`.
  - `loadSource` then serves it from the cache.
- [ ] **Step 2: Build.** Run `pnpm snapshot:build --date <today>`. Expected: a printed summary. `excluded` lists only rows with concrete reasons.
- [ ] **Step 3: Check the data.** Run `pnpm check:data`. Expected: no errors, exit 0.
- [ ] **Step 4: Spot-check.**
  - Open 5 random records and 5 landmarks.
  - For each, confirm that the summary claims appear in the cited passages and that the URL points to the right document.
  - Report any mismatch to the orchestrator instead of hand-editing JSON.
- [ ] **Step 5: Seed.**
  - Run `pnpm seed:d1` (local) and smoke-test `/api/sources` as in Task 6.
  - The orchestrator runs `pnpm seed:d1 --remote` only after the owner's OK.
- [ ] **Step 6: Commit.** "Add the first curated California and Singapore tech-policy snapshot."
