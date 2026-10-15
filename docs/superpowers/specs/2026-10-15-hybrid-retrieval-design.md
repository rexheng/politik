# Hybrid retrieval: design

Status: decided 2026-10-15 (the owner approved the hybrid architecture; this spec covers its layer 3 and its question-time use)
Builds on: the policy dataset (A) §6–7 and chat synthesis (B) §3.2–3.3. Architecture source: `CLAUDE.md` principle 6 and `docs/playbooks/llm-ready-database.md` §4.

## 1. Goal

Today `photon/src/chat/retrieve.ts` finds passages with FTS5 BM25 only: every term, then any term (ruling R7). That misses paraphrases ("asking people to agree before collecting their details" never says "consent"), ranks by term statistics instead of relevance, and gives a passage no hint of which law it belongs to.

Add layer 3 of the hybrid design: a passage index that combines keyword search, embeddings, rank fusion, a reranker, contextual headers and parent expansion. Nothing generative runs at build time. Nothing in `chat()` gets a new way to fail.

**Out of scope:** the router, compose and cite steps; the facts table; changes to passage splitting (A); query rewriting; GraphRAG.

## 2. Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Embeddings | `@cf/baai/bge-base-en-v1.5`, 768 dimensions, at build time (Workers AI REST) and question time (`AI` binding). |
| D2 | Pooling | `pooling: "cls"` at **every** call site. The API default is `mean`, and the two are incompatible [W3]. The local fallback uses `cls` too. |
| D3 | Embedding input | `header + "\n" + first 300 words`. The model takes 512 tokens at most [W2] and a 400-word passage is about 550. The composer shows at most `MAX_PASSAGE_CHARS` of a passage (900 in the working tree, 1,200 at HEAD), so the tail has little downstream value. FTS still covers the whole text. |
| D4 | Query side | The BAAI query instruction (`Represent this sentence for searching relevant passages: `) goes on queries only, never on passages. BAAI calls it optional for v1.5 and says to pick whichever scores better on your task [H1], so the eval A/Bs it. |
| D5 | Build credentials | `CLOUDFLARE_API_TOKEN` is a proxy-injected Network secret for `api.cloudflare.com`. The build uses the placeholder `proxy-injected`, as with Groq. `CLOUDFLARE_ACCOUNT_ID` is a plain env var (not a secret). |
| D6 | Fallback | No token: transformers.js `Xenova/bge-base-en-v1.5` (fp32, `cls`, normalised) [H2]. Cache entries record their backend and the two are never mixed (§4, §8). |
| D7 | Vector store | Vectorize index `politik-passages`, cosine, 768. Metadata: `recordId`, `jurisdiction`, `type`, `topics`, `lastActivity`. Metadata indexes on `jurisdiction` and `type` (strings), created **before** the first upload [V3]. |
| D8 | Loading | `wrangler vectorize upsert` with NDJSON of at most 5,000 vectors per file [V1]. Not `insert`: it keeps the first copy of an id, so an edited passage would never update. Vectors are not committed. They live in `.tmp-vectors/` (git-ignored) and are rebuilt from `passages.json`. |
| D9 | Cache key | Vector id = passage id (at most 64 bytes [V2]). Cache key = id + sha256(`model\|pooling\|input`). The header is in the input, so a status change re-embeds that record's passages and nothing else. |
| D10 | Context header | Deterministic, no LLM: `[SB 53 · Transparency in Frontier Artificial Intelligence Act · California · Bill · Enacted] SEC. 2`. The short title is left out when the record has none or it equals the title; the heading is left out when the passage has none. The same header goes in the embedding input, the FTS row and the reranker input. |
| D11 | FTS | Migration `0002` rebuilds `passages_fts` as `(passage_id UNINDEXED, context, text)`. `context` is the header, so it replaces the old `title` and `heading` columns. |
| D12 | Question time | FTS leg and vector leg in parallel, RRF (k=60), rerank up to 20 candidates with `@cf/baai/bge-reranker-base` (the 8 best lead the list, the rest keep their order), then parent expansion, where neighbours take the places of the weakest hits so compose still gets 8 sources. Vector query: top 20 (50 when a topic filter is set), filtered by jurisdiction and type. |
| D13 | Jev/TypeSafe | Orders a `brief` by significance, as now. For other intents it ranks by relevance only when the reranker did not run. A reranked order is not re-sorted, and compose keeps only the first 8 of it. |
| D14 | Eval | Retrieval recall@8 on `expect.cites`, read from a debug trace (§4) before compose. |

**Where research changed the brief**
1. A 550-token passage exceeds the model's 512-token input (D3).
2. `pooling` defaults to `mean` (D2).
3. `wrangler vectorize insert` does not overwrite, so the loader uses `upsert` (D8).
4. Vectorize's Free plan stores 5M dimensions, which is 6,510 vectors at 768. 10–20k passages need Workers Paid (§6).
5. The composer's per-passage window is in flux. At HEAD `retrieve.ts` clips each passage to its first `MAX_PASSAGE_CHARS = 1200` characters. An uncommitted edit by another agent sets it to 900 and adds `windowText`, which shows search hits as the window around the matched terms (a hit with no matched term still shows its start). `MAX_SOURCES = 12` throughout. This design imports the constants and never hard-codes 900 or 1,200 (§4).
6. Compose is shown only the best `MAX_COMPOSE_SOURCES = 8` of the 12 retrieved sources (another uncommitted edit; Groq's free tier allows 8,000 tokens a minute). Anything after the 8th never reaches the model, so expansion cannot append to a full list: neighbours take the places of the weakest hits (§4).
7. An `ai` binding makes `getPlatformProxy` and `wrangler dev` open a remote session, which fails without a Cloudflare token (measured on wrangler 4.139.0). D1 tests therefore use a D1-only config (§7).

## 3. Data flow

**Build** (manual, after `snapshot:build`; needs no generative AI)

```
policies.json + passages.json
  ├─ contextHeader(record, passage.heading)
  │    └─► seed:d1 ─► passages_fts(passage_id, context, text)
  └─► embed:build   input = header + "\n" + first 300 words
        cache hit (id + hash, same backend) ─► skip
        miss ─► Workers AI REST, batches of 50, pooling "cls"   (or local transformers.js)
        └─► .tmp-vectors/embeddings.jsonl
  vectors:upload ─► NDJSON ≤ 5,000 ─► wrangler vectorize upsert politik-passages
```

**Question** (inside `retrieve`, wherever it searches today)

```
Route (search, jurisdiction, topics)
  ├─ FTS leg: strict AND, then OR, top 20 (unchanged logic)                   ┐ parallel
  └─ vector leg (hard stop 350 ms): embed query ─► Vectorize top 20          │
       filter {jurisdiction, type} ─► ids ─► D1 hydrate with full Filters ─┘
  ▼ RRF k=60 over the two ranked id lists ─► up to 20 candidates
  ▼ explain and implications: the named record's own cited passages join the candidates, first
  ▼ rerank header+text (hard stop 400 ms) ─► the 8 best lead, the rest keep their order
  ▼ parent expansion (explain and implications): seq±1 of the top 3, up to 3 neighbours,
       placed after the hits and taking the weakest hits' places: still 8 sources
  ▼ Source[] (≤ 12 held) ─► rank (Jev) ─► first 8 to compose ─► cite
```

Which searches use it: `explain` and `implications` (one rerank over the cited passages plus the fused hits, then expansion), the `brief` keyword search (limit 50: its first 6 are the matches and the rest pick each record's best passage, so the reranker leads that list), and `sentiment` policy context (top 3, RRF only). `out-of-scope` stays FTS-only because it asks "does any passage contain every term", and a vector search always returns something.

## 4. Components and interfaces

Worker-side code is in `photon/src/retrieval/` and uses no Node APIs. Build code is in `photon/scripts/embed/` and is never imported by `photon/src/**`.

| File | Purpose and exports |
|---|---|
| `data/context.ts` | `contextHeader(r: ContextFields, heading?: string): string`, `retrievalText(header: string, text: string, maxWords = EMBED_MAX_WORDS): string`, `EMBED_MAX_WORDS = 300`. Used by seed, the embed build and the reranker. |
| `retrieval/types.ts` | `AiLike { run(model, inputs): Promise<unknown> }` and `VectorIndexLike { query(vector, { topK, filter?, returnMetadata? }): Promise<{ matches: { id; score }[] }> }`. Structural, so tests pass fakes and the real bindings fit. |
| `retrieval/embed.ts` | `EMBED_MODEL`, `EMBED_DIMENSIONS`, `EMBED_POOLING`, `QUERY_INSTRUCTION`, `embeddingFrom(output, count, dimensions?)`, `embedQuery(ai, text)`. |
| `retrieval/vectorize.ts` | `vectorFilter(filters)` builds `{ jurisdiction, type: { $in } }`; topics and `since` are applied when hydrating from D1. `vectorSearch(index, vector, filters, topK)`. |
| `retrieval/rrf.ts` | `rrf(lists, k = 60)`: `score(d) = Σ 1/(k + rank)`, rank 1-based, a repeated id counts once per list. Ties break on best rank, then id. |
| `retrieval/fts.ts` | `ftsSearch(db, query, filters, limit)`: the strict-then-loose search moved out of `retrieve.ts`. |
| `retrieval/rerank.ts` | `rerankInput(hit)`, `rerankScores(ai, query, texts): Promise<number[]>`, `orderByScores`. `RERANK_KEEP = 8`, pinned equal to `MAX_COMPOSE_SOURCES` by a test. |
| `retrieval/expand.ts` | `expandParents(db, hits, { taken, slots, charBudget, passageChars })`. |
| `retrieval/hybrid.ts` | `createHybrid(env, db, opts?): Hybrid \| undefined`. `Hybrid.search(query, filters, { limit, rerank }): Promise<PassageHit[]>`, `Hybrid.rerank(query, hits): Promise<PassageHit[] \| null>` (null when the reranker is unavailable or fails) and `Hybrid.runs: HybridRun[]` (stage, reranked, per-stage ms). Memoises query embeddings per request. |
| `data/store.ts` | Adds `getPassageHits(db, ids, filters?)`: hydrates ids into `PassageHit[]` in id order with the record filters applied. This is the second change to A's contract after `getPassages`. |
| `chat/retrieve.ts` | `RetrieveDeps.hybrid?`; `Retrieved.reranked`; expansion in `recordSources`. With no `hybrid` the behaviour is byte-identical to today. |
| `chat/index.ts` | `ChatEnv` gains `AI?`, `VECTORS?`, `RETRIEVAL_MODE?`, `CHAT_TRACE?`. Jev runs per D13. `ChatResponse.trace?` is added only when `CHAT_TRACE === "1"`. |
| `embed/*.ts` | `embeddingInputs`, `planEmbeddings`, `workersAiBackend`, `localBackend`, `buildEmbeddings`, `toVectorRecords`, upload CLI. |

**Binding names.** `wrangler.jsonc` gets `"ai": { "binding": "AI" }` [W4] and `"vectorize": [{ "binding": "VECTORS", "index_name": "politik-passages", "remote": true }]` [V4]. Wrangler warns that Vectorize has no local mode and says to set `remote: true`.

**API shapes.**
- Embeddings: input `{ text: string | string[] (≤ 100), pooling: "mean" | "cls" }`. Output `{ shape, data: number[][], pooling }`. The REST API wraps it as `{ result: {…}, success, errors }` [W2].
- Reranker: input `{ query: string, contexts: { text: string }[], top_k?: number }`. Output `{ response: { id: number, score: number }[] }`, where `id` is the index in `contexts` and the score is a logit (a sigmoid maps it to 0–1) [W5]. Only the order is used.
- Vectorize query: `topK` up to 100 without values or metadata, 50 with [V2]. The query asks for `returnMetadata: "none"` and gets the rest from D1.

**Parent expansion budget.** Compose is shown at most `MAX_COMPOSE_SOURCES` (8) sources of `MAX_PASSAGE_CHARS` (900 in the working tree) each, so 8 × 900 = 7,200 characters is the whole budget and expansion shares it with the hits. Only `explain` and `implications` expand. Take the top 3 reranked hits and add `seq − 1` then `seq + 1` of each (ids are `${recordId}#${seq}`, read with `getPassages`): at most `EXPAND_SLOTS = 3` neighbours and `3 × MAX_PASSAGE_CHARS` characters, where a neighbour costs `min(length, MAX_PASSAGE_CHARS)`. With n neighbours found, the answer keeps the best `8 − n` hits followed by the n neighbours, so the total never exceeds 8 and the top hits stay. Each neighbour is its own source with its own passage id, so every citation and the faithfulness judge still point at the text they quote.

**Trace.** `ChatTrace { retrieval: "hybrid" | "fts"; reranked: boolean; top: { recordId; passageId }[]; ms: { fts?; vector?; rerank? } }`. `top` is the policy sources among the first 8 handed to compose. It exists so the eval can measure recall before compose. It is off unless `CHAT_TRACE=1`, which is set in `.dev.vars` and never in production.

## 5. Failure behaviour

`chat()` still never throws. Every hybrid call is wrapped, and the FTS leg is the same code as today.

| Condition | Behaviour |
|---|---|
| `AI` or `VECTORS` binding missing, or `RETRIEVAL_MODE=fts` | `createHybrid` returns `undefined`. FTS-only, exactly as today, with Jev relevance ranking as today. |
| Embedding call or Vectorize query throws, times out (350 ms) or returns the wrong shape | The vector leg is dropped. The FTS list is returned unchanged (`runs[0].stage = "fts"`, not reranked). |
| Vectorize returns no matches (empty or never-uploaded index) | Fusion with an empty list: the FTS order is kept, and the reranker still runs on it. |
| Reranker throws, times out (400 ms) or returns an incomplete list | The candidate order stands (cited passages, then RRF) and expansion still runs. `reranked = false`, so Jev relevance runs as today. |
| Workers AI daily allocation used up (error 3036, HTTP 429) [W6] | Same as an embedding error at question time. At build time the run saves its cache, prints how many passages remain and exits 3; rerun after 00:00 UTC. |
| D1 hydration of vector ids fails | Treated as a vector-leg failure. A D1 failure in the FTS leg is handled as today. |
| Vector ids with no passage row (stale index) | Dropped silently by `getPassageHits`. |
| Late result after a timeout | Ignored. The call may still be billed. |
| Cache holds an entry from the other backend | Re-embedded unless `--keep-local` is passed. |
| Metadata indexes missing at upload | `vectors:upload` refuses and prints the two `create-metadata-index` commands. |

## 6. Cost and limits

**Workers AI** [W1]: 10,000 neurons per day free, $0.011 per 1,000 neurons above that, resets 00:00 UTC. On the Free plan, calls past the allocation fail with 3036; on Paid they are billed. Embeddings: bge-base 6,058 neurons per M input tokens ($0.067). Reranker: 283 neurons per M tokens ($0.003). Rate limit: 3,000 embedding requests per minute [W7].

| Job | Calculation | Neurons | Money |
|---|---|---|---|
| Embed 15k passages × ~550 tokens | 8.25M × 6,058 / 1M | **≈ 50.0k** | ≈ $0.55 |
| The same with the ~30-token header | 8.70M tokens | ≈ 52.7k (upper bound) | ≈ $0.58 |
| The same, capped at 512 tokens | 7.68M tokens | ≈ 46.5k | ≈ $0.51 |
| Free days to embed 15k | 52.7k / 10k | ≈ 5.3 days (about 2,800 passages per day) | $0 |
| One question | embed ~40 tokens ≈ 0.25; rerank 20 × ~475 tokens ≈ 2.7 | **≈ 3** | ≈ $0.00003 |
| Questions per day on the free allocation | 10,000 / 3 | ≈ 3,300 | $0 |

Embedding is not generation: this is a one-off, deterministic job, and a re-run only pays for changed passages. If the free allocation is short, the build resumes the next day because the hash cache keeps finished work.

**Vectorize** [V1, V2]: queried dimensions = (stored vectors + queries) × dimensions, per month.

| | Free | Paid ($5/month Workers plan [W8]) |
|---|---|---|
| Stored dimensions | 5M (6,510 vectors at 768) | 10M included, then $0.05 per 100M |
| Queried dimensions | 30M per month | 50M included, then $0.01 per M |
| 10k passages | 7.68M stored: **over the free limit** | included |
| 15k passages | 11.52M stored: **over** | 1.52M over ≈ $0.0008 per month |
| 20k passages | 15.36M stored: **over** | 5.36M over ≈ $0.003 per month |
| Queries at 15k vectors | ≤ 24,000 per month | ≤ 50,000 per month, then $0.0000077 each |

Other limits: 20M vectors per index; 10 metadata indexes; 10 KiB metadata per vector; indexed string metadata keeps its first 64 bytes; upsert batches of 1,000 (Workers) or 5,000 (REST); the docs say to keep NDJSON files at or below 5,000 vectors.

**Latency budget (target under about 800 ms):** the vector leg has a 350 ms stop (embed + Vectorize + D1 hydrate) and the rerank a 400 ms stop. FTS runs in parallel with the vector leg. The worst case is therefore about 750 ms plus fusion, and a stage that is slow degrades to the previous stage instead of waiting. No latency was measured; the trace records per-stage milliseconds so the eval reports p50 and p95.

## 7. Testing

- **Fakes, no network, no token.** `tests/helpers/fakes.ts` has `fakeAi` (a hashing-trick embedder with a concept map, e.g. consent / agree / permission, and a scripted reranker) and `fakeIndex` (in-memory cosine that honours `$eq` and `$in` filters and records its calls).
- **Unit:** header format; migration columns; embedding input and hash rules (a change after word 300 does not re-embed); cache planning (reuse, stale, backend mixing); REST client (URL, header, body, batching, retry on 3040, stop on 3036, no token in messages); NDJSON and chunking; upload guards; RRF maths and ties; filters; the reranker response mapping; expansion limits.
- **Pipeline:** a paraphrase that FTS cannot match finds `sg-pdpa-2012` through the vector leg. A throwing, hanging or malformed AI or index leaves `chat()` answering from FTS. With no bindings, every existing retrieve and chat test passes unedited. Jev runs for `brief`, not for a reranked `explain`, and runs again when the reranker failed. An `explain` returns at most 8 sources and its neighbours never displace the top `8 − n` hits.
- **D1 helper:** `tests/helpers/d1.ts` applies every migration in order and reads a D1-only config, so `pnpm test` passes offline even though the root `wrangler.jsonc` has `ai` and `vectorize`.
- **Eval:** `pnpm eval:chat` prints retrieval recall@8 over cases with `expect.cites` (any-of), the retrieval mode seen, and p50 and p95 of each stage. Run it twice, with `RETRIEVAL_MODE=fts` for the baseline. It needs a `wrangler dev` that can reach Cloudflare (a logged-in wrangler or a real token). Pure parts (`recallAtK`, report rendering) are unit tested.
- **Parity (operational, needs network):** `pnpm embed:parity` embeds 20 passages with both backends and fails below a minimum cosine of 0.98 (a judgment threshold, not a documented number).

## 8. Risks

| Risk | Mitigation |
|---|---|
| Free Vectorize tier is too small | Stay on or move to Workers Paid, or index fewer passages. This is an owner decision (§6). |
| The tail of long passages is not in the vector | FTS covers it, the composer shows only a `MAX_PASSAGE_CHARS` window, and neighbours add context. If recall misses are tail misses, split the embedding into windows (`id`, `id~2`). |
| Local and Workers AI vectors differ (pooling, quantisation, tokeniser) | Both use `cls`; the local one is fp32 and normalised. The cache records the backend, so a fallback build is replaced when a token appears. The parity check measures the gap. Unmeasured. |
| Model or pooling changes later | The model and pooling are in the hash, so a change re-embeds everything. The index must be recreated if dimensions change. |
| Header terms ("Bill", "Enacted") skew BM25 | Common words have a low IDF. The eval compares against the FTS-only baseline. |
| Vectors uploaded before the metadata indexes exist are not filterable | `vectors:upload` checks first; the fix is to re-upsert. |
| A stale index serves vectors for deleted or edited passages | `upload --prune` deletes ids that left `passages.json`; hydration drops unknown ids. |
| Binding changes break offline tests and the eval | D1-only test config; the eval documents what it needs. |
| Prompt injection through passages | Unchanged. Neighbours are data inside `<sources>` like any passage. |
| `retrieve.ts` and `chat/index.ts` are being edited by another change set (`windowText`, 900 chars, `MAX_COMPOSE_SOURCES`, a one-search brief) | The plan anchors on function names, not lines, and each task starts by reading the file as it stands. |
| Reranker is not trained on legal text | The eval shows whether it helps; `RETRIEVAL_MODE` and the fallbacks let it be switched off. |

## 9. Unconfirmed

- Whether Workers AI truncates or rejects input above 512 tokens (the docs do not say), and whether truncated tokens are billed.
- The reranker's own maximum input. 512 tokens is the figure in the AI Search model table [W9].
- Cosine agreement between Workers AI `cls` and transformers.js `cls`. Not run.
- Real latencies for embedding, Vectorize and the reranker.
- What Vectorize does past the Free stored-dimension limit (not in the pages read).
- Whether metadata arrays are allowed. Topics are stored as a comma-joined string.
- The field that holds the vector count in `wrangler vectorize info --json`; the largest accepted `delete-vectors` or `delete_by_ids` batch.
- The exact API-token permission names for Vectorize, and whether a remote `wrangler dev` session works through the proxy-injected placeholder token.
- Which Hugging Face hosts the local fallback needs allow-listed.

## Sources

Workers AI: [W1] https://developers.cloudflare.com/workers-ai/platform/pricing/ (updated Oct 9, 2026) · [W2] https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/ · [W3] https://developers.cloudflare.com/changelog/post/2025-04-11-new-models-faster-inference/ · [W4] https://developers.cloudflare.com/workers/wrangler/configuration/ · [W5] https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/ · [W6] https://developers.cloudflare.com/workers-ai/platform/errors/ · [W7] https://developers.cloudflare.com/workers-ai/platform/limits/ · [W8] https://developers.cloudflare.com/workers/platform/pricing/ · [W9] https://developers.cloudflare.com/ai-search/configuration/models/supported-models/

Vectorize: [V1] https://developers.cloudflare.com/vectorize/platform/pricing/ and https://developers.cloudflare.com/vectorize/best-practices/insert-vectors/ · [V2] https://developers.cloudflare.com/vectorize/platform/limits/ and https://developers.cloudflare.com/vectorize/reference/client-api/ · [V3] https://developers.cloudflare.com/vectorize/reference/metadata-filtering/ · [V4] https://developers.cloudflare.com/vectorize/reference/wrangler-commands/ (the `remote: true` advice is wrangler 4.139.0's own warning)

Models: [H1] https://huggingface.co/BAAI/bge-base-en-v1.5 · [H2] https://huggingface.co/Xenova/bge-base-en-v1.5 (its example uses `pooling: 'mean'`; this design uses `cls`)

REST: https://developers.cloudflare.com/workers-ai/get-started/rest-api/ · https://developers.cloudflare.com/api/resources/vectorize/subresources/indexes/methods/upsert/ · https://developers.cloudflare.com/api/resources/vectorize/subresources/indexes/methods/delete_by_ids/
