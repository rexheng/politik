# Politik

Politik is a Cloudflare Worker plus a plain-JS PWA that answers tech-policy questions about California and Singapore.
Data lives in D1. Chat gives cited answers written by Groq models, and every claim points to a source passage.
Use pnpm. Run tests with `pnpm test` (node:test via tsx). Use wrangler for the Worker and D1.

## Data and AI principles (owner directive, 2026-10-15)

1. **Think before launching an LLM over every document.** Running generative AI across the whole corpus at build time is a last resort. It is costly, slow and rate-limited, and it invents facts. Most of the work is already a solved, deterministic problem.
2. **Extract, don't generate.** Fill record fields from official structured data and verbatim official text.
   - Status and dates come from structured sources: legislature bulk data, procurement datasets, statute metadata, page publish dates.
   - Summaries are official summaries quoted verbatim: a legislative digest, a long title, a lead paragraph.
   - Provisions come from official digest sentences or section headings.
3. **Cite every field.** Each field records the passage it was copied from. A deterministic substring check verifies it. An LLM does not.
4. **LLM only for genuine gaps.** Put it behind an opt-in flag. Its output must be cited and verified.
5. **Check for existing data first.** Before writing scrapers or prompts, look for official bulk downloads and APIs (legislature pubinfo archives, data.gov datasets, OpenStates, LegiScan) and for existing trackers to cross-check against.
6. **Prefer a hybrid architecture to plain RAG.** Ingest with no AI. Keep a facts table in SQL for status, dates and "which / how many" questions. Build a hybrid passage index (FTS keyword search, embeddings computed once, rank fusion, reranker, section context headers, parent-section expansion). Run generative AI only at question time, after a router, with checked citation markers. Keep an eval loop (golden questions and retrieval recall).
7. **Skip GraphRAG and RAPTOR-style summary trees** at a few hundred documents. They cost heavy LLM compute at index time.
8. **Estimate before spending.** Count tokens before any LLM batch job. Check the provider tier's tokens-per-minute and per-day limits. Prefer designs that need zero build-time generation.

## Where things are

- Specs: `docs/superpowers/specs/`. Plans: `docs/superpowers/plans/`.
- Playbook for building an LLM-queryable document database, using Politik as the example: `docs/playbooks/llm-ready-database.md`.
- Read the relevant spec and plan before changing the dataset, the build, or chat.

## Environment notes

- In cloud sessions Node's `fetch` ignores the proxy unless `NODE_USE_ENV_PROXY=1` is set. Example: `NODE_USE_ENV_PROXY=1 pnpm snapshot:build`.
- Groq auth is injected by the network proxy. Set `GROQ_API_KEY=proxy-injected` where a key is required.
- Never print or commit keys.
- Never seed remote D1 (`pnpm seed:d1 --remote`) or deploy without the owner's OK.
