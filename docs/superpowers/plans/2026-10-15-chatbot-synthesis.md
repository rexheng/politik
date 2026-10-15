# Chatbot Policy Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Politik's template chat with a Groq-powered pipeline: route → retrieve from D1 → rank with Jev → compose a cited answer → validate the citations. The front end renders the citations.

**Architecture:**
- Small single-purpose modules in `photon/src/chat/`, joined by `chat()`. `ask.ts`, voice and Telegram call `chat()`.
- Every external dependency (LLM, TypeSafe scorer, Bluesky, clock) is injected, so the unit tests run with fakes against the dataset fixture loaded into local D1.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, Groq (shared client `photon/src/llm/groq.ts` from the dataset plan), `@typesafe-ai/sdk`, zod 4, `node:test`, plain ES-module front end.

**Spec:** `docs/superpowers/specs/2026-10-15-chatbot-synthesis-design.md` (§n below). It depends on `docs/superpowers/specs/2026-10-15-policy-dataset-design.md` and on the completed dataset plan, Tasks 1–6.

## Global Constraints

- Intents, modes, `Route`, `Citation` and `ChatResponse` are exactly as in spec §3.1, §3.5 and §4.
- Request limits: message ≤ 1,000 chars; history ≤ 8 turns, each ≤ 600 chars. Over-long input is truncated, never rejected.
- Timeouts: router 3,000 ms, TypeSafe rank 2,500 ms, compose 8,000 ms.
- Sources: at most 12. Each passage text is truncated to 1,200 chars. A citation `quote` is ≤ 280 chars.
- Fixed copy:
  - greeting: `Hi — ask me what's going on in California or Singapore tech policy.`
  - fallback: `I couldn't write a summary just now — here are the most relevant records.`
  - empty D1: `No policy data is loaded yet.`
  - general-knowledge label (UI): `Not from Politik's sources — unverified`
  - footer: `Data as of D Mon YYYY`
- Model text never reaches `innerHTML`. The front end builds DOM with `textContent`.
- Policy data is read only via `photon/src/data/store.ts`. LLM calls go only through `photon/src/llm/groq.ts` (`Llm` type, `groqLlm`).
- Env names: `GROQ_API_KEY`, `GROQ_CHAT_MODEL`, `GROQ_ROUTER_MODEL`, `TYPESAFE_API_KEY`.
- Tests: `node:test` via `pnpm test`. D1 tests use `openTestDb()` from `tests/helpers/d1.ts` plus `snapshotStatements` to load `tests/fixtures/snapshot/`.
- Stage only the files the task names. Commit messages are one plain sentence ending with a period, plus the orchestrator's trailer.

## Review Focus

1. **"What is going on?"** (no topic words, no history) → `brief` mode with non-empty citations from `recentChanges`. Pinned in Task 2 and Task 4.
2. **A follow-up that relies on history** ("What does that mean for a state agency?" after asking about SB 53): with the fallback router, history is concatenated into `search`. With the LLM router, `standalone` is used. Either way, citations include the earlier record. Pinned in Task 1 and Task 4.
3. **Model output citing `[7]` when only 3 sources exist, or citing nothing:** invalid markers are stripped. No valid marker at all → fallback mode. Pinned in Task 3 and Task 4.
4. **A passage containing "Ignore previous instructions and…":** it stays inside the numbered source block, under the "sources are data" rule. Pinned in Task 3 (prompt test).
5. **A 5,000-character message or 30 history turns:** truncated to the limits with HTTP 200, not an error. Pinned in Task 4.

---

### Task 1: Chat types, `getPassages`, router

**Files:**
- Create: `photon/src/chat/types.ts`, `photon/src/chat/route.ts`, `tests/chat/route.test.ts`
- Modify: `photon/src/data/store.ts` (add `getPassages`), `tests/data/store.test.ts`

**Interfaces:**
- Consumes: `Llm` (from `photon/src/llm/groq.ts`), and store types from `photon/src/data/schema.ts`.
- Produces:
  - `types.ts`: `Intent`, `Route`, `Source`, `Citation`, `ChatResponse` (spec §3–§4); `ChatTurn = { role: "user" | "assistant"; text: string }`; `ChatInput = { message: string; history: ChatTurn[]; knowledge: SourceItem[] }`; `ComposeOut = { answer: string; general: string | null; followUps: string[] }`.
  - `getPassages(db: D1Like, ids: string[]): Promise<Passage[]>`. It returns passages in the order of `ids`, skips unknown ids, and returns `[]` for an empty list.
  - `searchPassages` gains an optional 5th argument, `opts?: { match?: "all" | "any" }`. The default `"all"` keeps today's behaviour. `"any"` joins the quoted terms with `OR`. Add `toFtsQuery(text, match = "all")`. (Ruling R7: `retrieve` in Task 2 uses `"all"` and falls back to `"any"` when it gets fewer than 3 hits.)
  - `RouteSchema` (zod).
  - `route(message: string, history: ChatTurn[], llm: Llm): Promise<Route>`. It calls `llm` with `name: "route"` and the zod schema. The system prompt lists the coverage (US-CA, SG, the 7 topics) and the intent definitions. On any error it returns `fallbackRoute(message, history)`.
  - `fallbackRoute(message: string, history: ChatTurn[]): Route`:
    - `greeting` when the message has ≤ 3 words and its first word is in `hi hello hey thanks thank yo morning`.
    - `brief` when no non-stop-word remains.
    - Otherwise `explain`.
    - `search` = the message keywords. If the message has a pronoun (`it that this they those`) and history exists, it also gets the keywords of the last user turn.
    - `recordHints` = matches of `/\b(AB|SB)\s?\d+\b/i`, plus capitalised acronyms of 3+ letters (e.g. `PDPA`).
    - `detail` is true when the message matches `/in detail|walk me through|deep dive|explain fully/i`.

- [ ] **Step 1: Write failing tests.**
  - `getPassages`: it returns the 2 passages of `ca-sb-53-2025` in the given order and skips `"nope#1"`. `[]` → `[]`.
  - `toFtsQuery("frontier consent", "any")` → `'"frontier" OR "consent"'`.
  - `searchPassages(db, "frontier consent")` → `[]` (AND). With `{ match: "any" }`, hits come from both the CA bills and `sg-pdpa-2012`.
  - `fallbackRoute("hi")` → `greeting`.
  - `fallbackRoute("What is going on?")` → `brief` with `search === ""`.
  - `fallbackRoute("Explain SB 53 in detail")` → `explain`, `detail: true`, `recordHints` includes `"SB 53"`.
  - `fallbackRoute("what does that mean for agencies", [{role:"user",text:"Tell me about SB 53"}, …])`: `search` contains `"sb"` and `"53"`.
  - `route` with a fake LLM returning a valid Route → returns it as is.
  - `route` with a fake LLM that throws → equals `fallbackRoute(...)`.
  - The fake LLM receives a system prompt containing `"US-CA"`, `"SG"` and all 7 topic ids.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL (missing modules).
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** "Add chat types, passage lookup and the question router."

---

### Task 2: Retrieval and ranking

**Files:**
- Create: `photon/src/chat/retrieve.ts`, `photon/src/chat/rank.ts`, `tests/chat/retrieve.test.ts`, `tests/chat/rank.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `getPassages`, and store `searchPassages`, `recentChanges`, `listRecords`, `getRecord`, `getManifest`.
- Produces:
  - `retrieve(route: Route, db: D1Like, deps: { manifest: Manifest | null; bluesky?: (q: string) => Promise<SourceItem[]>; knowledge?: SourceItem[] }): Promise<{ sources: Source[]; promoted: boolean }>`.
    - It implements the table in spec §3.2.
    - "Recent" means `since = snapshotDate − (route.sinceDays ?? 120) days`, as an ISO date.
    - It dedupes by record (one best passage per record for `brief`), caps at 12, and truncates passage text to 1,200 chars.
    - Every `searchPassages` call uses `match: "all"` first, then retries with `match: "any"` when it gets fewer than 3 hits (R7).
    - It never throws on Bluesky failure.
    - For `out-of-scope`, if `searchPassages(search, {}, 3, { match: "all" })` returns at least 1 hit, it returns those hits with `promoted: true`, and the caller treats the question as `explain`. Every query term must appear, so this signal doesn't depend on the corpus. A raw bm25 threshold is not portable from the 6-record fixture to the ~240-record snapshot (final-review M10). In every other case `promoted` is `false`.
  - `type Scorer = (question: string, candidates: { id: string; text: string }[]) => Promise<Record<string, number>>`.
  - `typesafeScorer(apiKey: string): Scorer`, using the `systemOne` pattern from `photon/src/orchestrate.ts:76-123` with the judgement text from spec §3.3.
  - `rank(route: Route, sources: Source[], scorer?: Scorer, timeoutMs = 2500): Promise<Source[]>`. It sorts by score descending (stable), and returns the input order when there is no scorer, a timeout or an error. It never adds or drops sources.

- [ ] **Step 1: Write failing tests** (fixture D1):
  - The `brief` route with `search ""` → non-empty, records only, each record once, ordered by event date descending.
  - `brief` with `jurisdiction: "SG"` → only SG records.
  - `explain` with `recordHints ["SB 53"]` → the first source is `ca-sb-53-2025`, and its passages are the ones cited in its summary/provisions.
  - `implications` → includes passages that support `affected`.
  - `sentiment` with a fake bluesky returning 2 posts → 2 `post` sources plus ≤ 3 policy sources.
  - `sentiment` with bluesky throwing → policy sources only, no throw.
  - `greeting` → `[]`.
  - `out-of-scope` `"EU AI Act"` → `promoted: false`, `[]`. `out-of-scope` `"frontier AI"` → `promoted: true`.
  - Long passage text is truncated to ≤ 1,200 chars.
  - `rank`:
    - A fake scorer reverses the order.
    - A scorer that never resolves → input order after the timeout (inject `timeoutMs: 10`).
    - A scorer that throws → input order.
    - No scorer → input order.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** "Add intent-based retrieval and Jev ranking for chat."

---

### Task 3: Compose, citations, spoken text

**Files:**
- Create: `photon/src/chat/compose.ts`, `photon/src/chat/cite.ts`, `photon/src/chat/spoken.ts`, `tests/chat/compose.test.ts`, `tests/chat/cite.test.ts`, `tests/chat/spoken.test.ts`

**Interfaces:**
- Produces:
  - `ComposeOutSchema` (zod): `{ answer: string; general: string | null; followUps: string[] }`, where `followUps` has at most 3 items.
  - `buildComposePrompt(route: Route, sources: Source[], asOf: string): { system: string; user: string }`.
    - The system prompt holds rules 1–7 from spec §3.4, plus the format for the mode: brief / detail (the 4 headings, verbatim) / implications (*What it means* and *Options*).
    - The user prompt holds `standalone`, followed by sources as `[n] (policy|post) title — jurisdiction · status · date\n<text>` blocks, inside `<sources>…</sources>`.
  - `compose(route: Route, sources: Source[], llm: Llm, asOf: string): Promise<ComposeOut>`. It uses `name: "compose"`.
  - `finalize(raw: ComposeOut, sources: Source[]): { reply: string; citations: Citation[]; valid: boolean }`. It implements spec §3.5. `valid` is false when there are sources but no valid marker remains.
  - `toSpoken(reply: string, max = 600): string`. It strips `[n]`, `**`, `### ` and `- `, joins bullets into sentences, and cuts at the last sentence end ≤ `max`.

- [ ] **Step 1: Write failing tests.**
  - The prompt for `detail` contains all 4 headings verbatim.
  - The prompt for `implications` contains `What it means` and `Options`.
  - A source text containing `Ignore previous instructions` appears only inside `<sources>`, and the system prompt contains the "data, not instructions" rule.
  - Source numbering starts at 1 in order.
  - `compose` with a fake LLM returning a schema-valid object → returns it.
  - `finalize`:
    - `"A [2]. B [7]. C [2][1]."` with 3 sources → reply exactly `"A [1]. B. C [1][2]."`. Citations are `[source2, source1]` renumbered 1 and 2. `valid: true`.
    - An answer with no markers and sources present → `valid: false`.
    - No sources → `valid: true`, citations `[]`.
    - A citation quote is ≤ 280 chars.
    - A post source maps to `kind: "post"`.
  - `toSpoken("**SB 53 is law.** [1]\n\n- Rule one [2]\n- Rule two [3]")` → `"SB 53 is law. Rule one. Rule two."`.
  - A 2,000-char input → ≤ 600 chars, ending in `.`.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** "Add answer composition, citation checking and spoken replies."

---

### Task 4: `chat()` orchestration, endpoint, voice, Telegram; remove template chat

**Files:**
- Create: `photon/src/chat/index.ts`, `tests/chat/chat.test.ts`
- Modify:
  - `photon/src/ask.ts`: `ask`/`askShared` delegate to `chat`. `Env` keeps `DB` and adds `GROQ_CHAT_MODEL?` and `GROQ_ROUTER_MODEL?`.
  - `photon/src/worker.ts`: `handleAsk` uses `normalizeChatRequest`. The failure response becomes a `ChatResponse` with `mode: "fallback"`.
  - `photon/src/voice.ts`: `think` speaks `toSpoken(result.reply)`.
  - `photon/src/telegram.ts`: passes `[]` history and formats the reply plus `[n] title — url` lines.
  - `photon/src/contracts.ts`: remove `AskResponse`, `AskCard` and `Category` if they become unused.
- Delete: the chat-only code in `photon/src/select.ts` and `photon/src/orchestrate.ts`, `photon/src/categoriser.ts` (if no other importers), `scripts/check-select.ts`, `scripts/check-jev.ts` (the stock Stripe example), the `check:select`/`check:jev` package scripts, and `tests/fixtures/legacy-pool.ts`.
  - Before deleting, run `grep -rn "from \"./select\|orchestrate\|categoriser" photon/src`. Anything still imported by `map.ts`, `saying.ts` or the bsky code stays, moved if needed into the module that uses it.

**Interfaces:**
- Produces:
  - `normalizeChatRequest(body: unknown): ChatInput`. It applies the limits from Global Constraints. Non-string or missing message → `""`.
  - `ChatEnv = { DB: D1Like; GROQ_API_KEY?: string; GROQ_CHAT_MODEL?: string; GROQ_ROUTER_MODEL?: string; TYPESAFE_API_KEY?: string }`.
  - `ChatDeps = { router?: Llm; composer?: Llm; scorer?: Scorer; bluesky?: (q: string) => Promise<SourceItem[]> }`. Production builds them from env via `groqLlm` and `typesafeScorer`. `groqLlm`'s defaults (60 s × 5 attempts) are for batch builds, so the Worker must pass `{ timeoutMs: 3000, maxRetries: 0 }` for the router and `{ timeoutMs: 8000, maxRetries: 1 }` for compose.
  - `chat(input: ChatInput, env: ChatEnv, deps?: ChatDeps): Promise<ChatResponse>`, following spec §3 and §5:
    - manifest null → empty-D1 reply.
    - `greeting`/`clarify` → no compose.
    - out-of-scope not promoted → compose with no sources, keeping `general`.
    - Compose error, timeout or `valid: false` → fallback with the top 3 retrieved records.
    - `asOf` comes from the manifest.
    - `mode`: `detail` if `route.detail`; `brief` for `brief`/`explain`; otherwise the intent; `fallback` on failure.
    - With no `GROQ_API_KEY` and no injected LLMs: `fallbackRoute` and the fallback compose path, with no network call.

- [ ] **Step 1: Write failing tests** (fixture D1, fakes):
  - `"What is going on?"` with fake LLMs → `mode: "brief"`, ≥ 1 citation, `asOf "2026-10-01"`.
  - The 2-turn follow-up (Review Focus #2) cites `ca-sb-53-2025`.
  - A compose fake returning `[9]`-only markers → `mode: "fallback"`, 3 citations, the fallback copy.
  - A compose fake that never resolves (inject a short timeout via deps or a constant override) → fallback.
  - No key and no deps → `mode` is `fallback` or `greeting`, no throw, and no `fetch` (stub `globalThis.fetch` to throw).
  - Unseeded D1 → the empty-D1 copy, `asOf ""`.
  - Unmigrated D1 (`openTestDb({ migrate: false })`) → the empty-D1 copy, HTTP-safe, no throw.
  - The production deps built from env pass the tight Groq options above. Assert this through an injected `groqLlm` factory, or by inspecting the options.
  - `"hi"` → the greeting copy, 0 citations, 3 `followUps`.
  - `out-of-scope` `"What is the EU AI Act?"` → `general` non-null, 0 policy citations.
  - `normalizeChatRequest` with a 5,000-char message and 30 turns → a 1,000-char message and 8 turns of ≤ 600 chars.
  - The response object has exactly the `ChatResponse` keys.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then delete the dead code, after the grep check.
- [ ] **Step 4: Run all checks.**
  - `pnpm test` → PASS.
  - `pnpm exec wrangler deploy --dry-run --outdir .tmp-dry` → bundles with no errors.
  - `grep -rn "discuss\|wantsPolicy\|loadBriefings" photon/src` → nothing.
- [ ] **Step 5: Commit.** "Answer chat with routed retrieval and cited Groq synthesis, and remove the template replies."

---

### Task 5: Front end: cited answers, sources, general-knowledge box; remove onboarding

**Files:**
- Create: `photon/public/format.js` (ES module), `tests/chat/format.test.ts`
- Modify: `photon/public/app.js` (load as `<script type="module">`), `photon/public/app.css`, `photon/public/index.html`, `photon/public/sw.js` (bump the shell cache version and drop the onboard assets), `photon/public/manifest.webmanifest` (only if it references onboard)
- Delete: `photon/public/onboard.html`, `onboard.js`, `onboard.css`

**Interfaces:**
- Produces, from `format.js` (pure, no DOM):
  - `parseAnswer(md: string): Block[]`, where `Block = { type: "heading" | "para" | "bullets"; items?: Inline[][]; inline?: Inline[] }` and `Inline = { type: "text" | "bold" | "cite"; text?: string; n?: number }`.
  - `formatAsOf(iso: string): string`. `"2026-10-15"` → `"Data as of 15 Oct 2026"`; `""` → `""`.
  - `historyTurn(role, text)`. It truncates `text` to 600 chars.
- `app.js`:
  - Renders `Block[]` with `createElement` and `textContent` only. Each `cite` is a `<button class="cite">` that scrolls to and highlights `#src-n`.
  - Renders the source cards per spec §6, the general-knowledge box with the label from Global Constraints, the follow-up chips, the as-of footer, and the 3 empty-state chips (spec §6, verbatim).
  - Sends `history` as `{role, text}` only.
  - Removes the onboarding redirect, `readWho`, `who` and assistant `titles`.
  - Keeps the voice widget wiring, using `reply` for display.

- [ ] **Step 1: Write failing tests** for `format.js`:
  - `parseAnswer("**Yes.** [1]\n\n- a [2]\n- b\n\n### Status\ntext [1][3]")` → the exact block/inline structure: bold, then cite 1; bullets with cite 2; a heading; a para with cites 1 and 3.
  - `parseAnswer("<img src=x onerror=alert(1)>")` → a single `text` inline containing the literal string.
  - `formatAsOf` cases.
  - `historyTurn` truncation.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `format.js`, then update `app.js`, `app.css`, `index.html` and `sw.js`, and delete the onboard files.
- [ ] **Step 4: Browser smoke test (Playwright, from `.tmp-smoke/`).**
  - Start `pnpm exec wrangler dev` with the local D1 seeded from the fixture (`pnpm seed:d1 --dir tests/fixtures/snapshot`) and no Groq key.
  - Load `/`.
  - Assert there is no redirect to `/onboard`.
  - Assert the 3 empty-state chips are visible.
  - Click the first chip. Assert a reply block appears with ≥ 1 source card and an as-of footer.
  - Assert no console errors.
  - Save a screenshot at 390×844 into `.tmp-smoke/`.
- [ ] **Step 5: Commit.** "Show cited answers, sources and general-knowledge notes in the chat, and drop the onboarding form."

---

### Task 6: Golden-set evaluation harness

**Files:**
- Create: `tests/eval/chat-golden.json`, `scripts/eval-chat.ts`, `tests/eval/eval-checks.test.ts`
- Modify: `package.json` (add the script `"eval:chat": "tsx scripts/eval-chat.ts"`)

**Interfaces:**
- Golden case: `{ id: string; turns: string[]; expect: { mode?: string[]; cites?: string[] /* record ids, any-of */; general?: boolean; maxCitations?: number } }`. There are about 30 cases with the spec §9 mix. Ids come from `photon/data/snapshot/candidates.md` landmark rows (e.g. `ca-sb-53-2025`).
- `checkCase(c: GoldenCase, res: ChatResponse): string[]` is a pure function; an empty array means it passed. It checks mode, cites, general, invalid markers (any `[n]` with n > citations.length) and the greeting shape.
- `judgeFaithfulness(res: ChatResponse, llm: Llm): Promise<{ supported: number; total: number }>`. One Groq call per response gets back, for each cited sentence, whether its quotes support it.
- CLI: `pnpm eval:chat [--base http://localhost:8787]`.
  - It POSTs each case's turns to `/api/ask` in sequence, passing history.
  - It runs `checkCase` and `judgeFaithfulness`.
  - It writes `.tmp-eval/report.md` with per-case results, overall pass rate, faithfulness %, and latency p50/p95.
  - It exits non-zero if the pass rate < 90% or faithfulness < 90%.

- [ ] **Step 1: Write failing tests** for `checkCase`:
  - Pass case.
  - Missing expected cite.
  - Invalid marker `[4]` with 3 citations.
  - Greeting with a citation.
  - Out-of-scope without `general`.
- [ ] **Step 2:** Run `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the checks, the CLI and the golden set.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** "Add the chat golden-set evaluation."
- [ ] **Step 6 (operational, key-bearing session, after the real snapshot is seeded locally):** Run `pnpm eval:chat`. Report the pass rate, faithfulness and latency to the orchestrator. Tuning prompts to fix failures is a follow-up dispatch, not part of this task.
