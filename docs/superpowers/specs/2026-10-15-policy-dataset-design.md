# Policy dataset & database: design

Status: approved in brainstorming, 2026-10-15
Sub-project A of 3 (A dataset → B chatbot synthesis → C landing page)

**Revised 2026-10-15 (ruling R25): extract, don't generate.** The build no longer uses an LLM to write or verify records. Every field is filled from official structured data or verbatim official text and cites the passage it was copied from (§5.3). A deterministic string check replaces the verification pass (§5.4). An LLM is used only for optional landmark headlines, behind `--llm-headlines` (§5.4b). The earlier §5.3 and §5.4 (Groq enrich and verify) are replaced; the Groq enrich and verify code stays and now serves only the headlines.

## 1. Why

Politik is for real pilot users: policymakers who ask "what is going on?" on their phone. Today the app has no real policy data:

- 8 invented briefings (`photon/src/briefings.ts`)
- 10 California AG headlines whose text is boilerplate (`photon/src/catalog.ts`, `photon/src/select.ts:315-329`)
- a hardcoded "3,485 GeBIZ documents" count with no rows behind it
- no database

The chatbot (sub-project B) can only be as good as its data. This sub-project builds a real, cited, curated dataset and the store the chatbot reads from. Build cost is zero tokens and every field is verbatim official text (or official structured data mapped by fixed rules), and plain-English explanation happens at chat time, not in the dataset.

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

The types and their zod schemas live in `photon/src/data/schema.ts`. The schemas validate every record at build time and in `check:data`.

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

// Every claim names the passages it was copied from or derived from.
interface Supported<T> { value: T; support: string[] }   // passage ids

interface PolicyRecord {
  id: string;                 // stable slug, e.g. "ca-sb-53-2025", "sg-pdpa-2012"
  jurisdiction: Jurisdiction;
  type: RecordType;
  title: string;
  shortTitle?: string;        // "SB 53"
  issuer: string;             // the publishing body, from the publishers table (§5.3)
  status: Supported<Status>;
  statusDate?: string;        // ISO date
  timeline: { date: string; event: string; support: string[] }[];
  summary: Supported<string>;          // the official summary, verbatim (§5.3)
  headline?: Supported<string>;        // optional one-sentence plain-English line; landmarks only, only with --llm-headlines (§5.4b)
  provisions: Supported<string>[];     // verbatim official sentences or headings (§5.3)
  affected: Supported<string>[];       // usually []; filled only by deterministic rules (§5.3)
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
  models: { enrich: string; verify: string };   // "none" for both unless built with --llm-headlines
  counts: { total: number; byJurisdiction: Record<Jurisdiction, number>; byType: Record<RecordType, number> };
  excluded: { id: string; jurisdiction: Jurisdiction; url: string; title: string; reason: string }[];
}
```

How each field is filled, and from which source, is set out in §5.3. Every field except `headline` is copied from official text or structured data; `headline` is the only model-written field in the dataset.

Rules:
- Every `support` array is non-empty, and every passage id in it exists.
- Every `related[].id` exists in the snapshot.
- Timeline dates are ISO dates, sorted ascending.

## 5. How it is built

All build code is Node/TypeScript run with `tsx`, in `photon/scripts/snapshot/`. It never runs in the Worker. The default build makes no LLM calls and needs no API key.

### 5.1 Curation gate
1. A research step (a subagent with web search) writes `photon/data/snapshot/candidates.md`. It is a table with one row per candidate: proposed id, title, type, jurisdiction, source URL, landmark yes/no, and one line on why it is included.
2. **The owner approves or edits `candidates.md` before any fetching or extraction.** The approved table is the build's input list.

### 5.2 Fetch & extract
- Fetch each URL with plain `fetch`. Extract text from HTML and from PDF (e.g. `unpdf`).
- Sites that block automated access fall back to the existing Browserbase/Stagehand setup (`BROWSERBASE_API_KEY`). Singapore Statutes Online is the exception: an Act loads most of its text by script after the page opens, so a browser session that reads the page at its load event would return only the first part, which looks like a whole Act. An Act is therefore assembled by `sso.ts` from the site's own part requests (paced, with waits for the firewall's challenge pages), cached whole, and never sent to the Browserbase fallback. An Act with any part that cannot be loaded ends as `loading failed` (or `HTTP n`, `unreachable`).
- GeBIZ tenders come from the data.gov.sg dataset API, not scraping.
- Split the text into ~400-word passages, keeping headings. Hash the full text (`sha256`).
- Raw downloads are cached under `.tmp-snapshot/`, which git already ignores via `.tmp-*`.
- A hand-placed `.md` (a Firecrawl capture) is a fallback, not an override: the live page is read first (a Next.js page such as imda.gov.sg or pdpc.gov.sg has its text decoded from its script payload), and the capture stands in only when the live page cannot be read; no browser session is paid for when a capture exists. A hand-placed `.txt` still overrides everything. A capture of a Statutes Online or leginfo page is used as it is.
- The loader also returns the source's `format` (`html`, `pdf` or `text`) and, for an HTML page, its raw HTML, because the extractors in §5.3 read meta tags and a few site-specific elements from it.
- Some facts sit outside the visible body, so a record could not cite them. The loader adds them to the document text as short sections of the publisher's own words: an HTML page's meta description (when it is at least 15 words and not already in the body) becomes a "Page description" section, and a Singapore Statutes Online Act's table of contents (when the body lacks it) becomes a "Contents" section.

### 5.3 Extract (deterministic)

No model is called. For each candidate, one extractor per source type reads the document text (and, for an HTML page, its raw HTML) and fills the record. The same input always gives the same record, so re-runs need no cache.

Every text value is copied from the document as written. Whitespace is collapsed and nothing else changes: no paraphrase, no rewording. Each value cites the passages it was copied from. A value that is a label chosen by a fixed rule (a status) or a sentence built from dataset fields (a tender summary) cites the passages that hold the facts it was built from.

| Field | Source |
|---|---|
| `summary` | The official summary, verbatim, chosen by source type (below). |
| `status`, `statusDate`, `timeline` | Structured official data per source type, with statuses mapped onto the §4 enum by fixed rules (below). |
| `provisions` | California bills: the digest's sentences that say what the bill would do (verbatim, up to 6, in digest order): those that begin "This bill would" or "The bill would" ("also" and ", among other things," included; a "(2)" item number is not part of the sentence), and any sentence in which the bill "would require", "would prohibit" or "would authorize" something. Statutes: Part headings from the Act's contents (verbatim, up to 8). Other types, regulations included: up to 4 verbatim list items or section headings from the document, or `[]` if none qualify; releases, Hansard records and tenders often have none, and a link to a download (an item that ends in a file size) is not a provision. |
| `affected` | `[]`, unless a deterministic rule applies. Today only tenders have one: the agency and the supplier. The chat derives affected parties at query time. |
| `topics`, `type`, `landmark`, `title` | The approved `photon/data/snapshot/candidates.md` row. |
| `issuer`, `publisher`, `attribution`, `redistributionOk` | The publishers table (`publishers.ts`), keyed by the source URL's host. A host that is not in the table gives its hostname as issuer and publisher. |
| `related` | Ids of other snapshot records, in the same jurisdiction, whose bill number ("SB 1047", "Senate Bill 1047") or Act short title ("Personal Data Protection Act", without its year) appears in this document's text. The relation is always `related`. |
| `shortTitle` | From the id or the bill number: "SB 53" for a bill, "N-12-23" for an executive order, "PDPA" for `sg-pdpa-2012` (a 2-to-6-letter acronym segment). Otherwise omitted. |
| `published` | A structured date: the page's meta date or `<time>` element, a bill's introduction date, a tender's award date, a statute's assent date, a Hansard sitting date. Modified dates (`dateModified`, `article:modified_time`) are never used. Omitted if none is found. |

**Summary, by source type.** The first rule that gives text wins.

| Source type | Summary |
|---|---|
| California bills | What the bill would do (R38): the digest text from the first "This bill would" / "The bill would" sentence to the end of that paragraph, capped at 150 words (never an "Existing law" sentence, never the subject line). A digest with no such sentence keeps its first paragraph. |
| Singapore statutes (SSO) | The Act's long title. |
| Releases, guidance, frameworks, regulations, executive orders (HTML) | `<meta name="description">`, else `og:description`, when it is at least 15 words. Otherwise the lead paragraph: the first paragraph of the main content with at least 25 words, skipping boilerplate such as a "this article has been migrated" notice. When the description is cut off (it ends in an ellipsis) and is the start of a body paragraph, that whole paragraph is used. |
| PDFs | The first paragraph of a section headed "Executive summary", "Overview" or "Introduction" (also "Informative Digest" for a regulation notice), if present. Otherwise the first paragraph with at least 25 words. |
| Hansard | The first substantive paragraph (at least 25 words) of the minister's statement, without the speaker label. |
| GeBIZ tenders | A template sentence built only from dataset fields: "<agency> awarded tender <no> (<description>) to <supplier> for S$<amount> on <date>." |

A paragraph longer than 150 words is cut after its last complete sentence that fits in 150 words (a first sentence longer than that is kept whole). The result is still a verbatim excerpt.

**Status, `statusDate` and `timeline`, by source type.**

| Source type | Rule |
|---|---|
| California bills | From the bill's legislative history (the Legislature's own `BILL_HISTORY_TBL` actions, which sit in the document text). The latest decisive action decides: "Chaptered by Secretary of State" gives `enacted`, "Vetoed by the Governor" gives `vetoed`, and no decisive action gives `in-progress`. A chaptered bill is `enacted` until the date it takes effect, and `in-force` from it (on or before the snapshot date). That date is, in this order: (1) the latest operative date its own sections state, when the date is what the clause says ("This act shall become operative on January 1, 2026"). A clause of the act that gives no date right after it ("on the date the department certifies ..., but not before January 1, 2026") or makes it conditional ("only if Senate Bill 1381 is enacted", "upon", "contingent on", "if and when") leaves the date unknown: the bill stays `enacted`, and neither rule below applies; (2) the chaptering date, for an urgency statute (the digest says "This bill would declare that it is to take effect immediately as an urgency statute"; an "Existing law" sentence does not count); (3) otherwise California's default, 1 January of the year after chaptering (Cal. Const. art. IV, section 8(c)). The status cites the chaptering row, and the operative or urgency sentence when one was used; the default has no sentence of its own. `statusDate` is the date of the deciding action (the effective date for `in-force`, the last action's date for `in-progress`). The timeline holds the milestone actions (introduced, passed a house, enrolled and presented to the Governor, approved, vetoed, chaptered), each with the history's own wording, a "Takes effect" event on the effective date of an `in-force` bill when the date comes from a rule (the default or an urgency statute; its `parts` are empty) or from a "take effect on" clause, and an "Operative" event on a stated operative date. An `in-force` bill also gets an "Operative" event, citing the sentence, for each sentence of the code it quotes that says it "shall become operative on <date>" with a date later than the effective date ("This title shall become operative on January 1, 2027"); the status stays `in-force` from the effective date. A Senate bill's introduction is its "Introduced. ..." row; an Assembly bill's is its first "Read first time. To print." row. |
| Tenders | `awarded`, dated by the award date. One timeline event, "Awarded". |
| Statutes | `in-force`, dated by the Act's commencement date, when the page shows one on or before the snapshot date. An Act that has an assent date and no commencement date (a Singapore Act commences by notification, so the page may show none yet), or whose commencement date is after the snapshot date, is `enacted`, dated by the assent. An Act with no dates at all is `in-force` with no `statusDate`. Timeline: "Assented" (when shown) and "Commenced". |
| Releases, guidance and Hansard | `published`, dated by the publish (or sitting) date. One timeline event, "Published". |
| Executive orders | `in-force`, dated by the signing date (the date in the order's closing clause, else the publish date). One timeline event, "Signed". |
| Regulations | A stated effective date on or before the snapshot date gives `in-force`; a later one gives `enacted` (adopted, not yet in effect), with a "Takes effect" timeline event. A date that is only conditional or expected ("would take effect on ...") gives `proposed`, with no `statusDate`. With no stated date: `published`, dated by the publish date. |

When no date is found, `statusDate` is omitted and the timeline is `[]`. A bill with no legislative history has no status source (below).

**When a source is missing.** A record with no summary source is excluded with the reason `no official summary found`. A bill with no legislative history is excluded with `no official status found`. Every other type always has the fallback status `published`. Both exclusions go to `manifest.excluded` like any other.

California bill data comes from the Legislature's own pubinfo tables. OpenStates and LegiScan read the same tables, so they add no independent facts and are not used.

### 5.4 Check (deterministic)

The check replaces the LLM verification pass. It runs inside the build, after extraction and before the record is assembled, and it is a string comparison, not a model.

- A claim is a value, the passages it cites, and optionally `parts`: the strings that must be found in those passages. By default `parts` is the value itself. A template sentence (a tender summary) lists the dataset fields it was built from; a fixed-label timeline event ("Published") has no parts.
- Both sides are normalised first: runs of whitespace become one space and the ends are trimmed. A passage is searched as its heading followed by its text.
- A claim passes when every part occurs in at least one of the passages it cites. A record that may not be redistributed (§5.6) has short quotes: a value that ends in one "…" is checked by the text before the ellipsis, which must be a verbatim piece of a cited passage that starts at a word boundary. Nothing else is forgiven, and the other records get no such allowance.
- If `summary` fails, or the record has no summary source, the record is excluded with the reason `no official summary found`. If a provision, affected group or timeline event fails, it is dropped and named in the build summary; an extractor that passes its own tests should never trigger this.
- `status` is a label and cannot be compared as text. It must still cite passages that exist, which `check:data` enforces (§10).
- `review.state` stays `auto-checked` unless a human has reviewed the record (§5.5).

### 5.4b Optional LLM headlines

The LLM is optional and off by default. `pnpm snapshot:build --llm-headlines` adds a one-sentence plain-English `headline` to landmark records (about 50) and to nothing else. It needs `GROQ_API_KEY`.

- One call per landmark, to the model in `GROQ_ENRICH_MODEL`. The input is the record's official summary (and its title), and the prompt asks for one sentence of at most 30 words that adds no facts. The headline cites the passages that support the summary.
- The existing verify pass (`GROQ_VERIFY_MODEL`) then checks the headline against those passages. If it is unsupported, or the call fails, the record is kept without a headline. A headline never causes an exclusion.
- Answers are cached by `sha256`, models and summary, so a re-run makes no calls. Without the flag, any cached headline is ignored and the output has none.
- The manifest records `models: { enrich: "none", verify: "none" }` unless the flag is used; with it, the two model names.
- `headline` is the only model-written field, so it is not covered by the §5.4 string check. Pages that show it should label it as a machine-written summary of the official one.

### 5.5 Human review of landmarks
- The build writes `photon/data/snapshot/review.md`, which lists each landmark's summary, status, timeline and provisions with source links (and its headline, labelled machine-written, when it has one). The reviewer's job is now to check the extraction against the source page.
- A reviewer marks records as checked in `photon/data/snapshot/reviewed.json`, a list of `{ id, reviewer, reviewedAt }`. The next build sets `review.state = "human-reviewed"` for those ids, as long as their `sha256` is unchanged.
- Nothing blocks on review. Unreviewed records show as "auto-checked".

### 5.6 Output (committed to git, the source of truth, except the restricted passages)
- `photon/data/snapshot/policies.json` contains `PolicyRecord[]`: every record, with its summary and provisions (short attributed quotes), its `attribution` and its source link.
- `photon/data/snapshot/passages.json` contains `Passage[]` of the records that may be redistributed (`redistributionOk: true`) only.
- `photon/data/snapshot-private/passages.json` (git-ignored, never committed) contains the `Passage[]` of the records that may not (`redistributionOk: false`). See "What `redistributionOk: false` means" below.
- `photon/data/snapshot/manifest.json` contains the `Manifest`.

**What `redistributionOk: false` means.** The record's publisher (the publishers table, keyed by host) has not said that its text may be republished. This is the default for a host that is not in the table, and it is the case for most Singapore government pages. The repository is public, so:
- The full text (the passages) of such a record is never committed. The build writes it to `photon/data/snapshot-private/passages.json`, and `check:data` fails if a restricted record's passage is in the committed `passages.json`.
- The record itself stays in `policies.json`: its metadata, and its summary and provisions (and affected groups) cut to short quotes with the record's `attribution` and `url`. A value longer than 280 characters is cut at a word boundary to at most 280 characters and an ellipsis (R42, at most 281 in all); it keeps its citations. §5.4's check accepts such a value only for a record that may not be redistributed: the text before its one trailing ellipsis must be a verbatim piece of a cited passage that starts at a word boundary (not in the middle of a word); an ellipsis anywhere else, a changed word, or a piece of another passage fails. For any other record a trailing "…" is an ordinary character that the source text itself must contain. `check:data` errors on a restricted summary, provision or affected value of more than 281 characters. The full text stays in the private passages.
- `pnpm seed:d1` loads both files when the private one is on the machine, so D1 (a private store) holds the text for search. Without it, those records are seeded without passages, which `seed:d1` and `check:data` say as a warning.
- The app shows such a record only as a quote of at most 280 characters, always with its attribution and a link to the source: the citations of `/api/ask` (also behind voice and Telegram) are cut to 280 characters, carry `attribution` and `redistributionOk`, and a written reply that copies more than 280 characters in a row from a restricted record is replaced by the fallback list of short quotes. The Sources page lists documents by title and link, never text. Anything else that shows passage text (the landing page's document tiles) must use `redistributablePassages(records, passages)` (`photon/src/data/redistribution.ts`), or `getPassages(db, ids, { redistributableOnly: true })`, which leave restricted records out.
- On a fresh machine the private file is rebuilt by running `pnpm snapshot:build` again: it re-fetches the sources (`NODE_USE_ENV_PROXY=1` in a sandbox) and writes both files, the committed ones unchanged.

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
// `since` compares against a record's lastActivity = max(published, statusDate, latest timeline date)
interface Filters { jurisdiction?: Jurisdiction; types?: RecordType[]; topics?: Topic[]; since?: string }

interface RecordSummary {
  id: string; jurisdiction: Jurisdiction; type: RecordType; title: string; shortTitle?: string;
  status: Status; statusDate?: string; published?: string; lastActivity: string;
  summary: string; url: string; publisher: string; landmark: boolean;
  reviewState: "auto-checked" | "human-reviewed";
}

interface PassageHit { passage: Passage; record: RecordSummary; score: number }

searchPassages(db: D1Database, query: string, filters?: Filters, limit?: number): Promise<PassageHit[]>
getRecord(db: D1Database, id: string): Promise<PolicyRecord | null>
recentChanges(db: D1Database, filters: Filters & { since: string }, limit?: number):
  Promise<{ date: string; event: string; record: RecordSummary }[]>   // newest first
listRecords(db: D1Database, filters?: Filters): Promise<RecordSummary[]>
getManifest(db: D1Database): Promise<Manifest | null>     // null when D1 has not been seeded
```

- An unseeded D1 must not crash the app. `listRecords` returns `[]`, `getManifest` returns `null`, and the pages show an empty state.

- `searchPassages` turns user text into a safe FTS5 query: it quotes terms and drops FTS operators, so raw input can never cause a syntax error. An empty or all-stop-word query returns `[]` without throwing.
- `getManifest` is a fifth, read-only helper. The pages and the bot use it for the "as of" date and the counts.

## 8. Changes to the existing app

- Remove `photon/src/briefings.ts` and its use in the chat pool.
- Drop the hardcoded `LATEST`, counts and the GeBIZ "3,485" from `photon/src/catalog.ts`. `/api/sources` builds the same `Catalog` response shape from D1 via `listRecords` and `getManifest`, so `sources.js` keeps working. Blocked sources come from `manifest.excluded`.
- The Sources page shows "Data as of {snapshotDate}".
- Chat behaviour itself is not changed here. That is sub-project B. Until B lands, the chat pool reads records through `listRecords` instead of `briefings.ts` and `catalog.ts`.

## 9. Configuration & owner actions

Secrets (in `.dev.vars` locally, and `wrangler secret put` in production; never committed):
- `GROQ_API_KEY`, needed only for `--llm-headlines` (§5.4b) and for the chatbot in B. The default snapshot build does not need it.
- `BROWSERBASE_API_KEY`, already present.

Owner actions (Claude has no Cloudflare credentials in this environment):
1. Widen this environment's network access, or allow-list the source domains and `api-production.data.gov.sg`, so the build can fetch. `api.groq.com` is needed only if the build runs with `--llm-headlines`.
2. Approve `candidates.md`.
3. Run `wrangler d1 create politik` once, and paste the database id into `wrangler.jsonc`.
4. Run `pnpm seed:d1 --remote` after each snapshot build.
5. Optionally, review landmarks in `review.md`.

## 10. Testing

- `pnpm check:data` validates `policies.json`, `passages.json`, the private passages when the file is there, and `manifest.json` against the zod schemas, plus the §4 rules: support ids exist (in the two passage files together), related ids exist, dates are sorted, every record has at least one topic, and there are no duplicate ids. A restricted record's passage in the committed file is an error; a missing private file is a warning (the restricted records' claims are then not checked against their passages).
- Unit tests for the `store.ts` functions run against a small fixture snapshot of about 6 records, loaded into local D1 (Miniflare/`wrangler`). They cover filtering, date ordering, FTS ranking, hostile query strings (quotes, `NEAR`, `*`, empty) and missing ids.
- Build-script units (passage splitting, hashing, cache keys, excluded handling) are tested with saved HTML/PDF fixtures, so tests never need the network.
- Each extractor (§5.3) is tested on a saved fixture of its source type, with exact expected values for summary, status, dates, provisions and citations. The §5.4 check has its own tests, including a value that is not in its cited passage. The headline path is tested with a fake model, and a test pins that the default build makes no model call.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Network blocked in the build environment | Owner widens access (§9). Otherwise the owner runs the build script locally. Tests use fixtures. |
| A source blocks bots | Browserbase fallback; if that also fails, the record goes to `excluded` with the reason. Singapore Statutes Online Acts never use the fallback (a browser would return a partial Act): `sso.ts` assembles them, and a blocked or partial Act ends as `loading failed` in `excluded`. |
| Groq rate limits | Only `--llm-headlines` calls Groq, for about 50 landmarks, sequentially with backoff and cached by sha256. The default build makes no calls. |
| Summaries read formally (a legal digest or press-release prose, not plain English) | Mitigated by chat-time plain-English synthesis (sub-project B) and the optional landmark headline (§5.4b). |
| An extractor picks the wrong paragraph, or a site changes its markup | A fixture test per source type; the §5.4 string check; a record with no summary source is excluded with a visible reason; landmarks get a human review. |
| Data goes stale | Every surface shows the "as of" date. The build is re-runnable. |
