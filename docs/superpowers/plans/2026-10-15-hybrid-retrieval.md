# Hybrid Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the hybrid passage index to Politik's retrieval: contextual headers in the full-text index, embeddings computed once and kept in a Cloudflare Vectorize index, and at question time keyword search plus vector search fused with RRF, reranked, and expanded to neighbouring passages. Every failure falls back to today's FTS-only search, and retrieval recall@8 joins `pnpm eval:chat`.

**Architecture:**
- Build (Node only, `photon/scripts/embed/`): `embed:build` turns `policies.json` and `passages.json` into 768-dimension vectors through a hash-keyed cache, and `vectors:upload` upserts them into the index `politik-passages`. Vectors are never committed.
- Question time (Worker, `photon/src/retrieval/`): `createHybrid(env, db)` gives `retrieve.ts` a searcher that runs an FTS leg and a vector leg in parallel, then RRF, rerank and expansion. `chat()` never throws.
- Every Cloudflare dependency (`AI`, `VECTORS`, `fetch`, `wrangler`) is injected, so tests use fakes and need no network and no token.

**Tech Stack:** TypeScript, Cloudflare Workers AI (`@cf/baai/bge-base-en-v1.5`, `@cf/baai/bge-reranker-base`), Cloudflare Vectorize, D1 FTS5, wrangler 4.139, zod 4, `node:test`; optional `@huggingface/transformers` for the no-token fallback.

**Spec:** `docs/superpowers/specs/2026-10-15-hybrid-retrieval-design.md` (§n below). It builds on `2026-10-15-policy-dataset-design.md` §6–7 and `2026-10-15-chatbot-synthesis-design.md` §3.2–3.3.

## Global Constraints

- Model constants are exactly `@cf/baai/bge-base-en-v1.5` (768 dimensions, `pooling: "cls"` at **every** call site: REST, binding and local), `@cf/baai/bge-reranker-base`, index `politik-passages` (cosine), bindings `AI` and `VECTORS`.
- Context header, exactly: `[SB 53 · Transparency in Frontier Artificial Intelligence Act · California · Bill · Enacted] SEC. 2`. Parts are joined by ` · `. The short title is omitted when absent or equal to the title (case-insensitive). The heading follows the `]` after one space and is omitted when absent.
- Embedding input is `header + "\n" + first 300 words of the text`. Only queries get `QUERY_INSTRUCTION`; passages never do. The reranker reads the same `header + "\n" + first 300 words` for a passage and the plain query.
- Vector id is the passage id and must be at most 64 bytes. Cache key is the id plus sha256 of `model|pooling|input`. Cache and upload files live in `.tmp-vectors/` (git-ignored by `.tmp-*`). Never commit a vector.
- Question time: RRF `k = 60`; vector top 20 (50 when `filters.topics` is set); rerank candidates 20; the 8 best reranked lead the list and the rest keep their order (`RERANK_KEEP = 8`, pinned equal to `MAX_COMPOSE_SOURCES` by a test). Stops: vector leg 350 ms, rerank 400 ms. Expansion: top 3 hits, `seq ± 1`, at most `EXPAND_SLOTS = 3` neighbours and `3 × MAX_PASSAGE_CHARS` characters, and the neighbours take the places of the weakest hits so compose never gets more than `MAX_COMPOSE_SOURCES` sources. Import `MAX_SOURCES` and `MAX_PASSAGE_CHARS` from `retrieve.ts` and `MAX_COMPOSE_SOURCES` from `compose.ts`. Never write 900, 1,200 or 12 for them in new code. `MAX_COMPOSE_SOURCES = 8` and `MAX_PASSAGE_CHARS = 900` are uncommitted edits by another change set when this plan was written. Check they are in the tree before Task 5, and ask the orchestrator if they are not.
- `chat()` never throws. A missing, failing, hanging or malformed `AI` or `VECTORS` gives exactly today's FTS-only result. Setting `RETRIEVAL_MODE=fts` turns the hybrid path off.
- Policy data is read only through `photon/src/data/store.ts`. This plan adds one function to it, `getPassageHits`.
- `photon/src/retrieval/**` uses no `node:` import and works in workerd. `photon/scripts/embed/**` is Node-only and is never imported from `photon/src/**`.
- Secrets: `CLOUDFLARE_API_TOKEN` (the placeholder `proxy-injected` in cloud sessions; the proxy injects the real value for `api.cloudflare.com`) and `CLOUDFLARE_ACCOUNT_ID` (not a secret). Never print, log or commit either. Error messages must not contain the token. In cloud sessions run build scripts with `NODE_USE_ENV_PROXY=1`.
- Tests: `node:test` through `pnpm test`, with fakes from `tests/helpers/fakes.ts`. No test may touch the network or need a Cloudflare token. Run one file with `pnpm exec tsx --test tests/<dir>/<file>.test.ts`.
- `photon/src/chat/retrieve.ts` and `tests/chat/retrieve.test.ts` are being edited by another change set (`windowText`, a one-search brief, `MAX_PASSAGE_CHARS`). Before each task that touches them, run `git status` and read the files as they stand. This plan names functions, not lines. Do not revert anyone else's edit.
- Never run `pnpm seed:d1 --remote`, `wrangler vectorize create` or `wrangler deploy` without the owner's OK.
- Stage only the files a task names (never `git add -A`). Commit messages are one plain sentence ending in a period, plus the orchestrator's trailer.

## Review Focus

1. **Nothing new can break an answer:** with no bindings the existing `retrieve` and `chat` tests pass unedited, and a throwing, hanging or malformed `AI` or Vectorize leaves `chat()` answering from FTS. Pinned in Tasks 4 and 5.
2. **Embedding parity:** the same model, `cls` pooling, header and 300-word cut at build and question time; the query instruction on queries only; a cache that never mixes backends. Pinned in Tasks 1, 2 and 4.
3. **Index hygiene:** metadata indexes exist before the first `upsert` (never `insert`), ids are at most 64 bytes, and stale ids are pruned. Pinned in Task 3.
4. **Prompt budget and citations:** compose gets at most `MAX_COMPOSE_SOURCES` sources of `MAX_PASSAGE_CHARS`; up to 3 neighbours replace the weakest hits and never the top ones; each neighbour cites its own passage id. Pinned in Task 5.
5. **Offline tests with new bindings:** the root `wrangler.jsonc` gains `ai` and `vectorize`, which force a remote session; D1 tests use a D1-only config and pass with no Cloudflare token. Pinned in Task 4.

## Before execution (owner actions, not subagent tasks)

1. **Plan check.** The Vectorize Free plan stores 5M dimensions, which is 6,510 vectors at 768. About 10–20k passages need Workers Paid ($5 a month). Confirm the plan, or agree to index fewer passages (spec §6).
2. **API token.** Create a token with Workers AI Read and Edit and the Vectorize edit permission (the exact permission name is unconfirmed; pick the Vectorize entry in the token screen). Add it as a Network secret for `api.cloudflare.com`. Put `CLOUDFLARE_ACCOUNT_ID=<id>` in `.dev.vars` or the environment. Cloud sessions set `CLOUDFLARE_API_TOKEN=proxy-injected`.
3. **Create the index, then its metadata indexes, before the first upload** (vectors upserted earlier are not filterable):
   ```
   pnpm exec wrangler vectorize create politik-passages --dimensions=768 --metric=cosine
   pnpm exec wrangler vectorize create-metadata-index politik-passages --propertyName jurisdiction --type string
   pnpm exec wrangler vectorize create-metadata-index politik-passages --propertyName type --type string
   ```
4. **AI binding.** No dashboard step: Task 4 adds `"ai": { "binding": "AI" }` to `wrangler.jsonc`. Local `wrangler dev` then runs AI (and the Vectorize binding, with `remote: true`) against the real account and can incur usage charges.
5. **Free allocation.** Embedding 15k passages costs about 50k neurons against 10,000 free per day (spec §6). Either accept about $0.55 on the Paid plan, or run `embed:build` once a day for about 5 days. It resumes where it stopped.
6. **Fallback only:** to embed locally, allow the Hugging Face hosts that `@huggingface/transformers` downloads from (which hosts is unconfirmed) and approve the new dev dependency.
7. **The real snapshot** (`photon/data/snapshot/passages.json`) must exist before Tasks 2 and 3 are run for real. Seeding D1 with the new FTS table (`pnpm seed:d1`, and `--remote` with the owner's OK) must follow Task 1.
8. **For the Task 6 eval run:** a shell where wrangler is logged in or holds a real token, so `wrangler dev` can reach Workers AI and Vectorize.

---

### Task 1: Context headers and the contextual FTS index

**Files:**
- Create: `photon/src/data/context.ts`, `migrations/0002_contextual_fts.sql`, `tests/data/context.test.ts`
- Modify: `photon/src/data/seed.ts`, `tests/helpers/d1.ts` (apply every migration, in name order), `tests/data/seed.test.ts`, `tests/data/store.test.ts`, `tests/chat/retrieve.test.ts` (only if a ranking pin changes, with the reason)

**Interfaces:**
- Produces, from `context.ts` (pure, no I/O):
  - `interface ContextFields { title: string; shortTitle?: string; jurisdiction: Jurisdiction; type: RecordType; status: Status }`. A `RecordSummary` fits as is.
  - `contextFieldsOf(r: PolicyRecord): ContextFields` (maps `status.value` to `status`).
  - `contextHeader(r: ContextFields, heading?: string): string`. Labels: `US-CA` → `California`, `SG` → `Singapore`; types `Bill`, `Statute`, `Regulation`, `Executive order`, `Guidance`, `Tender`, `Press release`, `Hansard`; a status is capitalised with hyphens as spaces (`in-force` → `In force`). Whitespace in title and heading is collapsed to single spaces.
  - `EMBED_MAX_WORDS = 300` and `retrievalText(header: string, text: string, maxWords = EMBED_MAX_WORDS): string` returning `header + "\n" + the first maxWords words of text`, words joined by single spaces.
- Migration `0002_contextual_fts.sql`: `DROP TABLE passages_fts;` then `CREATE VIRTUAL TABLE passages_fts USING fts5(passage_id UNINDEXED, context, text, tokenize='porter unicode61');`. No semicolons inside comments or strings (the test helper splits on them).
- `snapshotStatements` inserts `passages_fts (passage_id, context, text)` with `context = contextHeader(contextFieldsOf(record), passage.heading)`. The `searchPassages` SQL is unchanged.

- [ ] **Step 1: Write failing tests.**
  - `contextHeader` for `ca-sb-53-2025` with heading `Chaptered text and findings` → `[SB 53 · Transparency in Frontier Artificial Intelligence Act · California · Bill · Enacted] Chaptered text and findings`.
  - No heading → the string ends at `]` with no trailing space.
  - `sg-gebiz-dc-2025` (no short title), heading `Tender notice` → `[Provision of Colocation Data Centre Services for Government Agencies · Singapore · Tender · Awarded] Tender notice`.
  - A short title equal to the title, ignoring case, appears once.
  - Labels: `executive-order` → `Executive order`, `in-force` → `In force`, `in-progress` → `In progress`, `press-release` → `Press release`.
  - Heading `"A\n  B"` → `A B`.
  - `retrievalText(h, "a b c d", 2)` → `h\na b`; fewer words than the cap keeps all; runs of whitespace collapse.
  - After applying all migrations, `SELECT name FROM pragma_table_info('passages_fts')` lists `passage_id`, `context`, `text` and no `title` or `heading`.
  - `snapshotStatements` on the fixture: the FTS insert for `ca-sb-53-2025#1` has params `[id, <the header above>, <text>]`.
  - Seeded fixture: pick a term that is in a passage's header but not in its text (assert `!text.toLowerCase().includes(term)` first, for example `vetoed` for `ca-sb-1047-2024#2` or `tender` for a GeBIZ passage). `searchPassages(db, term)` returns that passage. A header-only short title such as `PDPA` finds `sg-pdpa-2012` passages whose text lacks it.
- [ ] **Step 2:** Run `pnpm test`. Expected: the new tests FAIL (missing module and migration).
- [ ] **Step 3: Implement.** Update `tests/helpers/d1.ts` so `migrationStatements()` reads every `migrations/*.sql` in name order.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS. If an existing ranking pin in `store.test.ts` or `retrieve.test.ts` changed, show that the cause is a header term (`california`, `bill`, a status word) and re-pin it with a comment saying so. Do not loosen an assertion to make it pass.
- [ ] **Step 5: Commit.** "Add deterministic context headers to the passage index."

---

### Task 2: Embedding builder with a hash cache (Workers AI REST and a local fallback)

**Files:**
- Create: `photon/scripts/embed/inputs.ts`, `photon/scripts/embed/cache.ts`, `photon/scripts/embed/backends.ts`, `photon/scripts/embed/build.ts`, `photon/scripts/embed/parity.ts`
- Create: `tests/embed/inputs.test.ts`, `tests/embed/cache.test.ts`, `tests/embed/backends.test.ts`, `tests/embed/build.test.ts`
- Modify: `package.json` (scripts `embed:build`, `embed:parity`), `tsconfig.json` (`include` adds `photon/src/retrieval`, `photon/scripts/embed`), `.dev.vars.example` (`CLOUDFLARE_ACCOUNT_ID=`, `CLOUDFLARE_API_TOKEN=`), `CLAUDE.md` (one line under Environment notes: `CLOUDFLARE_API_TOKEN=proxy-injected` where a token is required, plus `CLOUDFLARE_ACCOUNT_ID`)

**Interfaces:**
- `inputs.ts`:
  - `interface VectorMetadata { recordId: string; jurisdiction: Jurisdiction; type: RecordType; topics: string; lastActivity: string }` (`topics` is the record's topics joined by `,`).
  - `interface EmbedItem { id: string; input: string; hash: string; metadata: VectorMetadata }`.
  - `embeddingInputs(policies: PolicyRecord[], passages: Passage[]): EmbedItem[]`, sorted by id, `input = retrievalText(contextHeader(contextFieldsOf(record), passage.heading), passage.text)`, `hash = sha256Hex(`${EMBED_MODEL}|${EMBED_POOLING}|${input}`)`. It throws, listing every offender, when an id is longer than 64 bytes (`Buffer.byteLength`) or a passage has no record.
  - Constants come from `photon/src/retrieval/embed.ts` (`EMBED_MODEL`, `EMBED_POOLING`, `EMBED_DIMENSIONS`). Create that file now with only the constants; Task 4 adds the functions.
- `cache.ts`:
  - `interface CacheEntry { id: string; hash: string; backend: "workers-ai" | "local"; vector: number[] }`.
  - `loadCache(path: string): Map<string, CacheEntry>` (a missing file is an empty cache; a bad line is skipped), `saveCache(path: string, entries: Iterable<CacheEntry>): void` (JSONL, sorted by id, written to a temp file then renamed).
  - `planEmbeddings(items: EmbedItem[], cache: Map<string, CacheEntry>, backend: Backend, opts?: { keepLocal?: boolean }): { reuse: CacheEntry[]; todo: EmbedItem[]; stale: string[] }`. An entry is reused when its hash matches and its backend equals `backend`, or is `"local"` with `keepLocal`. `stale` lists cache ids with no item.
- `backends.ts`:
  - `type Backend = "workers-ai" | "local"`; `interface EmbedBackend { name: Backend; embed(texts: string[]): Promise<number[][]> }`; `class QuotaError extends Error` (Workers AI error 3036).
  - `workersAiBackend(opts: { accountId: string; apiToken: string; fetch?: typeof fetch; batchSize?: number /* 50 */; maxRetries?: number /* 4 */; sleep?: (ms: number) => Promise<void> }): EmbedBackend`. It POSTs `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/baai/bge-base-en-v1.5` with `Authorization: Bearer ${apiToken}` and body `{ text: string[], pooling: "cls" }`, and reads `result.data`.
  - `localBackend(load?: () => Promise<Extractor>): EmbedBackend`, where `Extractor = (texts: string[], opts: { pooling: "cls"; normalize: true }) => Promise<{ tolist(): number[][] }>`. The default loader does a dynamic `import("@huggingface/transformers")` and `pipeline("feature-extraction", "Xenova/bge-base-en-v1.5", { dtype: "fp32" })`.
  - `chooseBackend(env: Record<string, string | undefined>, want: "auto" | Backend, deps?: { fetch?; load? }): { backend: EmbedBackend; note?: string }`. `auto` means Workers AI when both env vars are set, else local with a note. A token with no account id throws `CLOUDFLARE_ACCOUNT_ID is not set`. `workers-ai` with either missing throws.
  - `estimateNeurons(tokens: number): number` (`tokens / 1e6 × 6058`) and `approxTokens(input: string): number` (`ceil(words × 1.4)`, labelled an estimate).
- `build.ts`:
  - `buildEmbeddings(args: { items: EmbedItem[]; cachePath: string; backend: EmbedBackend; keepLocal?: boolean; maxNeurons?: number; dryRun?: boolean; log?: (line: string) => void }): Promise<{ total: number; reused: number; embedded: number; remaining: number; neurons: number; complete: boolean }>`. It saves the cache after every batch of 50. `main(argv, deps): Promise<number>` returns 0 when complete, 3 when stopped by quota or `--max-neurons`, and 1 for errors.
  - CLI: `pnpm embed:build [--dir photon/data/snapshot] [--backend auto|workers-ai|local] [--max-neurons N] [--keep-local] [--dry-run]`. Cache path `.tmp-vectors/embeddings.jsonl`.
- `parity.ts`: `pnpm embed:parity [--n 20] [--dir ...]` embeds a spread of passages with both backends and prints the minimum and mean cosine. It exits 1 below 0.98, which is a judgment threshold and not a documented number. It needs network and the Hugging Face download, so it has no unit test beyond a pure `cosine(a, b)` check.

- [ ] **Step 1: Write failing tests** (all with fakes and temp directories; none touch the network).
  - `embeddingInputs` on the fixture: 12 items; `ca-sb-53-2025#1` starts with the Task 1 header and a newline; each hash is 64 hex characters; changing `ca-sb-53-2025`'s status changes the hashes of its two passages only; a passage of 400 words keeps its hash when word 350 changes and changes it when word 10 changes; an id of 65 bytes throws and names it; a passage with an unknown record throws.
  - `planEmbeddings`: a full cache gives `todo = []`; one edited passage gives that one in `todo`; a cache id that left the snapshot is in `stale`; a `"local"` entry is in `todo` for `workers-ai`, in `reuse` for `local`, and in `reuse` for `workers-ai` with `keepLocal`.
  - `loadCache`/`saveCache`: round trip is byte-identical on a second save; a corrupt line is skipped; the output is sorted by id.
  - `workersAiBackend` with a fake `fetch`: exact URL, `Authorization: Bearer tok`, body `{ text: [...], pooling: "cls" }`; 120 texts make 3 requests of 50, 50 and 20 and the results keep their order; a response with `pooling: "mean"` throws; a vector of 767 numbers throws; error code 3040 (HTTP 429) is retried with the fake `sleep` and then succeeds; error 3036 throws `QuotaError` at once with no retry; HTTP 401 throws an error whose message contains the status and not the string `tok`; `maxRetries` exhausted throws.
  - `localBackend` with a fake extractor: it is called with `{ pooling: "cls", normalize: true }` and the `tolist()` rows are returned; a wrong dimension throws.
  - `chooseBackend`: both vars set gives `workers-ai`; neither gives `local` plus a note naming the parity risk; only the token throws; `want = "local"` ignores the token.
  - `buildEmbeddings` with a fake backend and a temp cache: the first run embeds all items (counted by the fake); the second run makes 0 calls; after editing one passage only that one is embedded; a `QuotaError` on the third batch leaves the first two batches in the cache and returns `complete: false` with `remaining` set; `maxNeurons` smaller than one batch's estimate stops before that batch; `dryRun` makes no backend call and writes no cache; the log never contains a vector.
  - `main` exit codes: 0, 3 (quota), 1 (unknown flag, missing snapshot file).
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `@huggingface/transformers` only if the owner chose the fallback: `pnpm add -D @huggingface/transformers@3.8.1` (this version exists on npm; do not use `latest`). If pnpm blocks a build script, ask the owner before changing `onlyBuiltDependencies`. The tests must pass with the package absent.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** "Add the embedding builder with a content-hash cache."
- [ ] **Step 6 (operational; needs the real snapshot, network and `NODE_USE_ENV_PROXY=1`):** `pnpm embed:build --dry-run` and report the counts and the neuron estimate. Then `pnpm embed:build` (with `--max-neurons 9000` on the Free plan, once a day) until it exits 0. If both backends are available, run `pnpm embed:parity` and report the numbers. A fallback-built cache is replaced later by `embed:build --backend workers-ai`.

---

### Task 3: Vectorize upload CLI

**Files:**
- Create: `photon/scripts/embed/upload.ts`, `tests/embed/upload.test.ts`
- Modify: `package.json` (script `vectors:upload`)

**Interfaces:**
- Consumes: `embeddingInputs`, `loadCache`, `VectorMetadata` (Task 2).
- Produces, from `upload.ts`:
  - `interface VectorRecord { id: string; values: number[]; metadata: VectorMetadata }`.
  - `toVectorRecords(items: EmbedItem[], cache: Map<string, CacheEntry>): { records: VectorRecord[]; missing: string[] }`. A record needs a cache entry with the item's current hash. Records are sorted by id.
  - `toNdjson(records: VectorRecord[]): string` (one JSON object per line, a final newline), `chunk<T>(items: T[], size: number): T[][]`, `UPLOAD_BATCH = 5000`.
  - `metadataIndexNames(output: string): Set<string>`: reads `wrangler vectorize list-metadata-index --json`; the exact shape is unconfirmed, so accept an array of objects with `propertyName` (or `property_name`) and ignore anything else.
  - `main(argv: string[], deps?: { root?: string; exec?: (args: string[]) => { status: number; stdout: string }; log?; error? }): Promise<number>`.
- CLI: `pnpm vectors:upload [--index politik-passages] [--dir photon/data/snapshot] [--dry-run] [--prune] [--allow-partial]`. It:
  1. reads the snapshot and `.tmp-vectors/embeddings.jsonl`; with items missing from the cache it exits 1 telling the user to run `pnpm embed:build`, unless `--allow-partial` uploads the embedded ones;
  2. runs `wrangler vectorize list-metadata-index <index> --json` and exits 1 if `jurisdiction` or `type` is missing, printing the two `create-metadata-index` commands;
  3. writes `.tmp-vectors/upload/part-001.ndjson` and so on (at most 5,000 vectors each) and runs `pnpm exec wrangler vectorize upsert <index> --file <part>` for each (never `insert`);
  4. with `--prune`, runs `wrangler vectorize delete-vectors <index> --ids <id>...` in chunks of 100 for ids in the previous `.tmp-vectors/uploaded-ids.json` that are not in this run;
  5. writes `uploaded-ids.json` only after every upsert succeeded, then runs `wrangler vectorize info <index>` and says that vectors can take seconds to minutes to become queryable.

- [ ] **Step 1: Write failing tests** (fake `exec`, temp directory, 768-number fake vectors).
  - `toNdjson` has one parseable object per line and ends with a newline; `values.length === 768`; metadata is `{ recordId, jurisdiction, type, topics: "privacy-data", lastActivity }` for the CPPA fixture record and `topics: "gov-tech-procurement,data-centres"` for the GeBIZ one.
  - `toVectorRecords` omits an item whose cache hash is stale and lists it in `missing`.
  - `chunk` of 12,001 records by 5,000 gives 5,000, 5,000 and 2,001, and `main` writes three part files.
  - A missing `type` metadata index: exit 1, no `upsert` call, and the output contains `create-metadata-index politik-passages --propertyName type --type string`.
  - Items missing from the cache: exit 1 and no upload; with `--allow-partial`, only the embedded ones are written.
  - `--dry-run` writes nothing and runs no `upsert`.
  - Every `exec` call is `vectorize upsert` and never `vectorize insert`.
  - `--prune` with a previous list `[a, b, c]` and a current run `[a, b]` calls `delete-vectors ... --ids c`; without `--prune` it does not.
  - A failing `upsert` (status 1) makes `main` return 1 and leaves `uploaded-ids.json` unchanged.
  - Output never contains a vector value or the token.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** "Add the Vectorize upload command."
- [ ] **Step 6 (operational; after the owner created the index and its metadata indexes):** `NODE_USE_ENV_PROXY=1 pnpm vectors:upload --dry-run`, then without `--dry-run`. Report the vector count that `wrangler vectorize info` shows, and run `wrangler vectorize query politik-passages --vector ...` or a Worker call once to confirm a known passage is returned.

---

### Task 4: Question-time vector search, RRF and the fallback

**Files:**
- Create: `photon/src/retrieval/types.ts`, `embed.ts` (extend the Task 2 stub), `vectorize.ts`, `rrf.ts`, `fts.ts`, `timeout.ts`, `hybrid.ts`
- Create: `tests/helpers/fakes.ts`, `tests/helpers/wrangler.test.jsonc`, `tests/retrieval/embed.test.ts`, `vectorize.test.ts`, `rrf.test.ts`, `hybrid.test.ts`
- Modify: `photon/src/data/store.ts` (`getPassageHits`), `tests/data/store.test.ts`, `photon/src/chat/retrieve.ts`, `photon/src/chat/index.ts`, `photon/src/ask.ts`, `wrangler.jsonc`, `tests/helpers/d1.ts` (read `wrangler.test.jsonc`), `tests/chat/retrieve.test.ts`, `tests/chat/chat.test.ts`, `.dev.vars.example` (`RETRIEVAL_MODE=`)

**Interfaces:**
- `types.ts`: `interface AiLike { run(model: string, inputs: Record<string, unknown>): Promise<unknown> }`; `interface VectorIndexLike { query(vector: number[], options: { topK: number; filter?: Record<string, unknown>; returnMetadata?: "none" | "indexed" | "all" }): Promise<{ matches: { id: string; score: number }[] }> }`.
- `embed.ts`: `EMBED_MODEL`, `EMBED_DIMENSIONS = 768`, `EMBED_POOLING = "cls"`, `QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "`; `embeddingFrom(output: unknown, count: number, dimensions = EMBED_DIMENSIONS): number[][]` accepts the binding shape `{ data }` and the REST shape `{ result: { data } }` and throws on a wrong count or dimension; `embedQuery(ai: AiLike, text: string): Promise<number[]>` runs `ai.run(EMBED_MODEL, { text: [QUERY_INSTRUCTION + text], pooling: "cls" })`.
- `vectorize.ts`: `vectorFilter(filters: Filters): Record<string, unknown> | undefined` gives `{ jurisdiction }` and `{ type: { $in: types } }` (both when both are set) and `undefined` otherwise (Vectorize rejects an empty filter; topics and `since` are applied in D1); `vectorSearch(index, vector, filters, topK): Promise<{ id: string; score: number }[]>` calls `index.query(vector, { topK, filter, returnMetadata: "none" })`.
- `rrf.ts`: `RRF_K = 60`; `rrf(lists: readonly (readonly string[])[], k = RRF_K): { id: string; score: number }[]`.
- `fts.ts`: `ftsSearch(db: D1Like, query: string, filters: Filters, limit: number): Promise<PassageHit[]>`: the body of today's `search()` in `retrieve.ts` (`match: "all"`, then `"any"` when fewer than `MIN_ALL_HITS` results and the two queries differ), moved unchanged.
- `timeout.ts`: `withTimeout<T>(work: () => Promise<T>, ms: number, label: string): Promise<T>` rejects with `Error(`${label} did not answer within ${ms} ms`)` and clears its timer.
- `store.ts`: `getPassageHits(db: D1Like, ids: string[], filters?: Filters): Promise<PassageHit[]>` returns hits in `ids` order with the record filters (`recordFilters`) applied, skips unknown or filtered ids, uses `score: 0`, and returns `[]` on an unmigrated database.
- `hybrid.ts`:
  ```ts
  export const VECTOR_TOP = 20, VECTOR_TOP_TOPICS = 50, CANDIDATES = 20;
  export const VECTOR_TIMEOUT_MS = 350, RERANK_TIMEOUT_MS = 400;
  export interface HybridEnv { AI?: AiLike; VECTORS?: VectorIndexLike; RETRIEVAL_MODE?: string }
  export interface HybridRun { stage: "hybrid" | "fts"; reranked: boolean; ms: { fts: number; vector?: number; rerank?: number }; error?: string }
  export interface Hybrid {
    readonly runs: HybridRun[];
    search(query: string, filters: Filters, opts: { limit: number; rerank: boolean }): Promise<PassageHit[]>;
  }
  export function createHybrid(env: HybridEnv, db: D1Like, opts?: { now?: () => number; vectorTimeoutMs?: number; rerankTimeoutMs?: number }): Hybrid | undefined;
  ```
  `search`: run `ftsSearch(db, query, filters, max(limit, CANDIDATES))` and the vector leg in parallel. The vector leg is `withTimeout`: memoised `embedQuery` per query string, `vectorSearch` with `topK = filters.topics?.length ? VECTOR_TOP_TOPICS : max(VECTOR_TOP, limit)` (at most 100), then `getPassageHits(db, ids, filters)`. If the vector leg fails, return the FTS list cut to `limit` with `stage: "fts"`. Otherwise fuse with `rrf` and return the fused list cut to `limit`. This task ignores `opts.rerank`; Task 5 adds it. `createHybrid` returns `undefined` without both bindings or when `RETRIEVAL_MODE === "fts"`. It never throws.
- `retrieve.ts`: `RetrieveDeps.hybrid?: Hybrid`. Replace the local `search(db, query, filters, limit)` by a `Searcher = (query, filters, limit, opts?: { rerank?: boolean }) => Promise<PassageHit[]>` built once in `retrieve()` (`deps.hybrid ? deps.hybrid.search(...) : ftsSearch(db, ...)`) and handed to the brief, explain and sentiment builders. `sentimentSources` passes `rerank: false`. `outOfScope` keeps calling `searchPassages` directly (FTS-only). With no `hybrid`, every result is identical to today's.
- `chat/index.ts` and `ask.ts`: `ChatEnv` and `Env` gain `AI?`, `VECTORS?`, `RETRIEVAL_MODE?`. `chat()` builds `createHybrid(env, env.DB)` inside its `try` and passes it to `retrieve`. `ChatDeps.hybrid?` overrides it for tests.
- `wrangler.jsonc` adds `"ai": { "binding": "AI" }` and `"vectorize": [{ "binding": "VECTORS", "index_name": "politik-passages", "remote": true }]`. `tests/helpers/wrangler.test.jsonc` is D1-only (`name`, `compatibility_date`, the same `d1_databases` entry; no `main`), and `openTestDb` reads it.
- `tests/helpers/fakes.ts`: `fakeAi(opts?: { embed?: (text: string) => number[]; rerank?: (query: string, text: string) => number; fail?: "embed" | "rerank" | "both"; hang?: ... })` with a `calls` log; `hashEmbed(text: string, concepts?: Record<string, string[]>): number[]` (a 768-dimension hashing-trick bag of words, L2-normalised, with a concept map such as `{ consent: ["consent", "agree", "agreeing", "permission"] }`); `fakeIndex(vectors: { id: string; values: number[]; metadata?: Record<string, string> }[])` with in-memory cosine, `$eq` and `$in` filter support, and a `calls` log of `{ topK, filter }`.

- [ ] **Step 1: Write failing tests.**
  - `rrf`: `[["a","b","c"],["b","a","d"]]` → `a, b, c, d` (a and b tie on score and on best rank, so id order; c and d tie on score, so id order); `rrf([["x"],["x"]])[0].score === 2/61`; an id in both lists beats an id first in only one (`[["a","b"],["c","b"]]` → `b` first); a repeated id inside one list counts once; no lists → `[]`; a custom `k` changes the scores.
  - `vectorFilter`: jurisdiction only; types only (`{ type: { $in: ["bill"] } }`); both; neither, topics alone and `since` alone → `undefined`.
  - `embeddingFrom`: binding shape and REST shape both work; count 2 with one row throws; 767 numbers throws. `embedQuery` sends `{ text: [QUERY_INSTRUCTION + "q"], pooling: "cls" }` to `EMBED_MODEL`.
  - `getPassageHits`: ids `["sg-pdpa-2012#2","ca-sb-53-2025#1"]` come back in that order with a record each; `{ jurisdiction: "SG" }` keeps only the first; `{ topics: ["data-centres"] }` on the CA ids → `[]`; unknown ids are skipped; an unmigrated database gives `[]`.
  - `hybrid.search` on the fixture with `fakeAi` and a `fakeIndex` built from `retrievalText(header, text)` of the 12 passages:
    - a paraphrase with no shared word (`"asking people to agree before collecting their details"`): first assert `ftsSearch` returns `[]` for it (choose different words if the fixture makes it match), then `search` returns `sg-pdpa-2012#1` first;
    - a query FTS and vectors both find ranks that passage above one found by a single leg;
    - `{ jurisdiction: "SG" }` is passed to the index as `filter: { jurisdiction: "SG" }` and only SG hits come back;
    - `{ topics: ["data-centres"] }` returns only `sg-gebiz-dc-2025` passages and the index saw `topK: 50`;
    - a query embedded twice runs the embedding once;
    - `limit: 3` returns at most 3.
  - Fallbacks, each asserting the result equals `ftsSearch`'s result exactly (same ids, same order) and `runs[0].stage === "fts"`: `ai.run` throws; `index.query` throws; the vector leg never resolves (use `vectorTimeoutMs: 20` and assert it returns within 500 ms); the embedding has 767 numbers; `getPassageHits` fails (a db whose `prepare` throws only for the hydrate statement).
  - `createHybrid({}, db)`, `({ AI }, db)`, `({ VECTORS }, db)` and `({ AI, VECTORS, RETRIEVAL_MODE: "fts" }, db)` → `undefined`.
  - `retrieve(explain, search "asking people to agree before collecting their details")` with `hybrid` includes `sg-pdpa-2012#1`; the same call without `hybrid` returns no policy source.
  - `chat(input, { DB, AI, VECTORS }, { composer, router })` for that question cites `sg-pdpa-2012`; with `AI` throwing it still returns a response and does not throw.
  - Offline D1: with `CLOUDFLARE_API_TOKEN` unset, `openTestDb()` works although `wrangler.jsonc` now has `ai` and `vectorize`.
  - **No regression:** run the whole suite. `tests/chat/retrieve.test.ts`, `tests/chat/chat.test.ts` and `tests/data/store.test.ts` need no edits except new tests.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Do the `ftsSearch` extraction first and run the existing retrieve tests before adding any hybrid code (a pure refactor, no behaviour change). Then the rest.
- [ ] **Step 4:** Run `pnpm test` with `CLOUDFLARE_API_TOKEN` unset. Expected: PASS.
- [ ] **Step 5: Commit.** "Add vector search and rank fusion to retrieval, with an FTS-only fallback."

---

### Task 5: Reranker, parent expansion and Jev's new scope

**Files:**
- Create: `photon/src/retrieval/rerank.ts`, `photon/src/retrieval/expand.ts`, `tests/retrieval/rerank.test.ts`, `tests/retrieval/expand.test.ts`
- Modify: `photon/src/retrieval/hybrid.ts`, `photon/src/chat/retrieve.ts`, `photon/src/chat/index.ts`, `tests/helpers/fakes.ts`, `tests/chat/retrieve.test.ts`, `tests/chat/chat.test.ts`, `tests/retrieval/hybrid.test.ts`

**Interfaces:**
- `rerank.ts`:
  - `RERANK_MODEL = "@cf/baai/bge-reranker-base"`, `RERANK_KEEP = 8`.
  - `rerankInput(hit: PassageHit): string` = `retrievalText(contextHeader(hit.record, hit.passage.heading), hit.passage.text)`.
  - `rerankScores(ai: AiLike, query: string, texts: string[]): Promise<number[]>` runs `ai.run(RERANK_MODEL, { query, contexts: texts.map((text) => ({ text })), top_k: texts.length })` and maps `{ response: [{ id, score }] }` to scores aligned with `texts`. It returns `[]` for no texts without a call. It throws when `response` is not an array, an `id` is out of range or repeated, a score is not finite, or any text has no score.
  - `orderByScores<T>(items: T[], scores: number[]): T[]`: best score first, ties in input order.
- `expand.ts`: `EXPAND_TOP = 3`, `EXPAND_SLOTS = 3`; `expandParents(db: D1Like, hits: PassageHit[], opts: { taken: ReadonlySet<string>; slots: number; charBudget: number; passageChars: number }): Promise<PassageHit[]>`. For each of the first `EXPAND_TOP` hits it considers `seq − 1` then `seq + 1` (ids `${recordId}#${seq}`, `seq ≥ 1`), read with `getPassages`. It skips ids in `taken` or already added, and stops at `slots`. A neighbour costs `min(text.length, passageChars)`; one that does not fit the remaining `charBudget` is skipped and the next is tried. Each result carries the parent's record and `score: 0`, in the order considered.
- `hybrid.ts`: add `Hybrid.rerank(query: string, hits: PassageHit[]): Promise<PassageHit[] | null>`. It reranks the first `CANDIDATES` (20) hits with `rerankScores` under `withTimeout(..., RERANK_TIMEOUT_MS)` and returns the `RERANK_KEEP` best by score followed by every other hit in input order. It returns `null` (and does not throw) when there are fewer than 2 hits, the reranker is missing, throws, hangs or answers wrongly. A success records `reranked: true` in `runs` (so `runs.some((r) => r.reranked)` holds). `search(..., { rerank: true })` fuses and then calls `rerank` on the fused list, cut to `limit`; on `null` it returns the fused order.
- `retrieve.ts`:
  - `Retrieved.reranked: boolean`, true when `hybrid.runs.some((r) => r.reranked)`; false with no hybrid.
  - The brief's keyword search passes `rerank: true`. It does not expand.
  - `recordSources`, when a hybrid is present and its `query` is not empty (with an empty `query` it behaves as today): the pool is the named record's cited passages as `PassageHit`s (first, with their records and `score: 0`), then `search(query, { jurisdiction }, CANDIDATES, { rerank: false })`, without duplicate passage ids, cut to `CANDIDATES`. `ordered = (await hybrid.rerank(query, pool)) ?? pool`. `top = ordered.slice(0, RERANK_KEEP)`. `neighbours = await expandParents(db, top, { taken: ids of top, slots: Math.min(EXPAND_SLOTS, MAX_COMPOSE_SOURCES − 1), charBudget: 3 × MAX_PASSAGE_CHARS, passageChars: MAX_PASSAGE_CHARS })`. The sources are `top.slice(0, MAX_COMPOSE_SOURCES − neighbours.length)` followed by the neighbours. A passage a record itself cites keeps `policySource(record, passage)` (its start); a found hit or a neighbour uses `policySource(record, passage, terms)`.
- `chat/index.ts`: `const ranked = route.intent === "brief" || !retrieved.reranked ? await rank(route, retrieved.sources, deps.scorer) : retrieved.sources;`, followed by the existing slice to `MAX_COMPOSE_SOURCES`.

- [ ] **Step 1: Write failing tests.**
  - `rerankScores`: the request has `query`, `contexts: [{ text }, ...]` and `top_k: n`; a response `[{ id: 1, score: 0.2 }, { id: 0, score: -3 }]` for two texts gives `[-3, 0.2]`; a missing id, an out-of-range id, a repeated id, a `NaN` score and a non-array `response` each throw; zero texts makes no call.
  - `rerankInput` starts with the header and has at most 300 words of text. The query sent to the reranker is the plain query (no `QUERY_INSTRUCTION`).
  - `orderByScores`: ties keep input order.
  - `RERANK_KEEP === MAX_COMPOSE_SOURCES`, so a change on either side fails a test.
  - `hybrid.rerank` with a scripted reranker that reverses the input: the result follows it; it sends `min(20, n)` texts; with 12 hits the 8 best lead and the other 4 follow in input order; a reranker that throws, hangs past `rerankTimeoutMs: 20`, or returns the wrong count gives `null` and no throw; one hit gives `null` without a call. `search(..., { rerank: true })` reorders and `{ rerank: false }` makes no reranker call.
  - `expandParents`: a hit `x#2` gets `x#1` then `x#3`; a neighbour in `taken` is skipped; `x#1` does not ask for `x#0`; an unknown neighbour is skipped; `slots: 2` with hits `x#2`, `y#2` returns only `x#1` and `x#3`; `charBudget: 1500` with `passageChars: 1000` admits one 5,000-character neighbour and skips the next; a fourth hit never gets neighbours; each result carries its parent's record.
  - `retrieve(explain)` with a hybrid and records of 5 passages built in the test (the fixture records have only 2), no record hint: at most `MAX_COMPOSE_SOURCES` sources; the first `8 − n` are the reranker's top hits in its order and the last `n ≤ 3` are neighbours; no passage appears twice; the neighbours' texts sum to at most `3 × MAX_PASSAGE_CHARS` after `policySource`; `reranked` is true.
  - A named record plus hits: the cited passages and the found hits are ordered together by the reranker (a hit the script scores highest comes before the record's cited passages); a cited passage still shows its start, not a window.
  - The reranker failing: the order is the cited passages then the RRF hits, still at most 8 with neighbours, and `reranked` is false.
  - No hybrid: no neighbour and `reranked` false. A `brief` has no neighbours.
  - `chat()` with a fake `scorer`: an `explain` question with a working reranker never calls the scorer; a `brief` calls it; an `explain` with `AI` throwing calls it (today's behaviour).
  - A neighbour is cited with its own `passageId` and `recordId` after `finalize`.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS, including every Task 4 test unchanged.
- [ ] **Step 5: Commit.** "Rerank retrieved passages, add neighbouring passages within the compose budget, and limit Jev to briefs when the reranker ran."

---

### Task 6: Retrieval recall in the golden-set eval

**Files:**
- Modify: `photon/src/chat/types.ts` (`ChatTrace`, `ChatResponse.trace?`), `photon/src/chat/index.ts`, `scripts/eval-chat.ts`, `tests/eval/eval-checks.test.ts`, `tests/chat/chat.test.ts`, `.dev.vars.example` (comment: `CHAT_TRACE=1` for local eval only)

**Interfaces:**
- `ChatTrace { retrieval: "hybrid" | "fts"; reranked: boolean; top: { recordId: string; passageId: string }[]; ms: { fts?: number; vector?: number; rerank?: number } }`. `ChatResponse.trace?: ChatTrace`.
- `chat()` adds `trace` only when `env.CHAT_TRACE === "1"` and retrieval ran. `top` holds the policy sources among the first `MAX_COMPOSE_SOURCES` handed to compose (after `rank` and the slice), so neighbours that displaced weak hits are counted as what the model saw. `retrieval` is `"hybrid"` when a `Hybrid` ran with `stage: "hybrid"` and `"fts"` otherwise. The fields come from `hybrid.runs`: `reranked` is true if any run reranked, and `ms` takes the largest value of each stage. `ChatEnv` gains `CHAT_TRACE?: string`. The key is absent when the variable is unset, so the response shape is unchanged in production.
- `eval-chat.ts`:
  - `RECALL_K = 8` (a test pins it equal to `MAX_COMPOSE_SOURCES`), `RECALL_GATE_PERCENT = 90`.
  - `recallAtK(items: { c: GoldenCase; res?: ChatResponse }[], k = RECALL_K): { measured: number; hits: number; misses: { id: string; expected: string[]; got: string[] }[] }`. A case counts when `c.expect.cites?.length` is set and `res?.trace` exists. It is a hit when any expected id is among the distinct `recordId`s of the first `k` entries of `trace.top` (the golden `cites` are any-of lists).
  - `renderReport` adds the row `| Retrieval recall@8 | N of M cases (P%) | at least 90% |`, a `Retrieval` line (`hybrid` or `fts` as seen in the traces, and whether reranked), p50 and p95 of each trace stage that has values, and a `Retrieval misses` table (case, expected, got). With no trace anywhere the row says `not measured (start the Worker with CHAT_TRACE=1)` and no gate is applied.
  - The exit code is 1 also when recall was measured and is below the gate. Latency stays reported, not gated.

- [ ] **Step 1: Write failing tests.**
  - `chat()` with `CHAT_TRACE` unset has no `trace` key (compare `Object.keys`). With `CHAT_TRACE: "1"`, hybrid fakes and an `explain` question, `trace.retrieval === "hybrid"`, `trace.top.length <= 8`, and `trace.top` equals the policy sources among the first 8 shown to the composer (read their order from the composer's prompt). With `AI` throwing it is `"fts"` and `reranked` is false. A greeting has no `trace`. The shape helper in `chat.test.ts` allows `trace` only in these tests.
  - `recallAtK`: `expect [a]`, top `[b, a]` → hit; `expect [x, y]`, top `[y]` → hit; `expect [z]`, top `[q]` → miss with `got: ["q"]`; a case with no `cites` and a case with no trace are not counted; with `k = 1` and top `[b, a]` for `expect [a]` → miss; duplicate records in `top` count once.
  - `renderReport` shows `3 of 4 cases (75.0%)` and the miss row for that input; shows `not measured` when no case has a trace; the exit code is 1 for 75% and 0 for 100% with the other gates passing, and unchanged (0) when nothing was measured.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** "Add retrieval recall at 8 to the chat evaluation."
- [ ] **Step 6 (operational; needs the real snapshot seeded locally with the 0002 migration, the vectors uploaded, and a shell that can reach Cloudflare; see Before execution item 8):**
  1. Set `CHAT_TRACE=1` in `.dev.vars`, start `pnpm exec wrangler dev`, and run `pnpm eval:chat --no-judge`. Save the report.
  2. Set `RETRIEVAL_MODE=fts` in `.dev.vars`, restart, and run it again for the baseline.
  3. Report both recall@8 numbers, the per-stage p50 and p95 (the budget is about 800 ms for embedding, Vectorize and rerank together), and the misses. A first run below the 90% gate is a finding to report, not a reason to tune inside this task.
  4. Optionally, edit `embedQuery` locally to drop `QUERY_INSTRUCTION`, rerun, and compare recall@8 (spec D4). Revert that edit; do not commit it.
