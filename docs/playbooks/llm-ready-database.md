# Playbook: building a document database that LLMs can query

Use this when a new project needs a database of documents (laws, filings, tenders, reports, web pages) that people will question through an LLM.
It is generic. Politik, a tech-policy assistant for California and Singapore, is the worked example throughout.

The short version: **extract, don't generate.** Do the build with deterministic code. Let generative AI run only when someone asks a question.

## 1. Principles

1. **Do not run an LLM over every document by default.** At build time it is costly, slow and rate-limited, and it invents facts. Treat it as a last resort.
2. **Fill fields by extraction.** Take values from official structured data and from verbatim official text.
3. **Every field cites its source passage.** A deterministic substring check proves the value came from that passage. No LLM is needed to verify it.
4. **Use an LLM only for genuine gaps.** Put it behind an opt-in flag. Its output must still be cited and verified.
5. **Look for existing data before you write code.** See section 2.
6. **Estimate cost before any LLM batch job.** See section 8.

## 2. Step 0: check for existing data

Spend an hour here. It can save weeks.

- Look for official bulk downloads and APIs: a legislature's bulk archive, data.gov-style datasets, statute metadata feeds.
- Look for third-party aggregators with APIs, such as OpenStates or LegiScan for US legislation.
- Look for existing trackers or lists you can cross-check against. They also tell you which documents matter.
- Check whether the site blocks bots but publishes a bulk file. Bulk files often support HTTP Range reads, so you can fetch part of a large zip.
- Record the licence and the update schedule for every source.

## 3. Choose the extraction route per source

For each source, pick the cheapest route that is still official:

| Field | Where it should come from |
| --- | --- |
| Status, dates, timeline | Structured data: bulk tables, datasets, metadata elements, page publish dates |
| Summary | An official summary quoted verbatim: a digest, a long title, a lead paragraph |
| Provisions or key points | Official digest sentences or section headings |
| Identifier, jurisdiction, type | The source's own fields, normalized to a canonical ID |
| Topics | A fixed list matched by rules (keywords, headings), not free-text generation |

If a field has no deterministic source, leave it empty or flag it. Do not make a value up.

## 4. The architecture: five layers

Plain RAG (chunk, embed, take top-k, generate) works for fuzzy questions and fails on three common ones:
exact identifiers (bill numbers), time questions ("what changed"), and filter or count questions ("which were vetoed").
A hybrid design handles all of them.

### Layer 1: ingest and clean (no AI)

- Fetch the source, extract the main content, and split by the document's own structure (legal sections, articles, headings), not fixed-size chunks.
- Assign canonical IDs.
- Store provenance for every document: URL, fetched time, content hash. The hash lets an unchanged document skip all later work.

### Layer 2: a facts table (no AI)

- Put status, dates, timeline events, jurisdiction, type and topics in SQL columns.
- This layer answers "latest", "which" and "what is the status of" directly, and the answer is exact.

### Layer 3: a hybrid passage index (no generative AI)

- **Keyword search:** BM25 or full-text search (FTS) for exact terms and identifiers.
- **Embeddings:** computed once per passage, and again only when the passage hash changes.
- **Rank fusion:** merge the keyword and embedding lists with reciprocal rank fusion (RRF).
- **Reranker:** rerank the fused top results with a cross-encoder.
- **Context headers:** prepend a deterministic header to each passage (title, identifier, section path), built from metadata, not generated.
- **Small-to-big expansion:** match on small passages, then hand the model the parent section.

### Layer 4: question time (the only place generative AI runs)

1. A router decides: facts query, passage search, or both.
2. One LLM call writes the answer from the retrieved rows and passages, with numbered citation markers.
3. Code checks that every marker points to a passage that was actually retrieved. Unsupported claims are dropped or labelled.
4. Anything the model adds from its own knowledge goes in a separate, clearly labelled box.

### Layer 5: an eval loop

- Keep a golden question set with expected sources and expected facts.
- Measure retrieval recall (did the right passage come back?) separately from answer quality (is it faithful to the passages?).
- Run it after every change to parsing, indexing or prompts.

## 5. What to skip at small scale

With a few hundred documents, skip GraphRAG and RAPTOR-style summary trees.
They spend heavy LLM compute at index time to solve scale problems you do not have.
Revisit them only if hybrid search plus a facts table measurably fails your golden set.

## 6. Tools to consider

Verify the current state of each one before adopting it. This space moves quickly.

- **Parsing:** Docling, Unstructured, trafilatura (main-content extraction from web pages).
- **Frameworks:** LlamaIndex, Haystack, RAGFlow. Often a small amount of your own code is enough.
- **Evaluation:** RAGAS.
- **Rerankers:** the bge reranker family.
- **Reading:** Anthropic's "Contextual Retrieval" write-up, which reports gains from combining contextual headers, hybrid search and a reranker.

## 7. Build checklist

1. List the sources and, for each, the bulk or API route (section 2).
2. For each field, write down its deterministic source (section 3).
3. Write the fetcher with provenance. Cache raw downloads.
4. Write the parser and splitter. Test it on three real documents per source.
5. Fill the facts table. Add a substring check that every extracted field appears in its cited passage.
6. Build the passage index and the context headers.
7. Write the golden questions before you write the router.
8. Add the question-time layer: router, one LLM call, citation check.
9. Run the eval. Fix retrieval before touching prompts.
10. Show the data's "as of" date anywhere the data is shown.

## 8. Cost and quota sense

- Before any LLM batch job, estimate tokens: documents times average tokens, times calls per document.
- Compare the estimate to the provider tier's tokens-per-minute and per-day limits. A job that fits the price may not fit the rate limit.
- Cache by content hash, so an unchanged document costs nothing on the next run.
- Prefer designs that need zero build-time generation. Then the only LLM spend is the questions people ask.

## 9. Worked example: Politik

Politik answers tech-policy questions about California and Singapore: 63 California bills, Singapore statutes, and Singapore government tenders (GeBIZ).

**The first attempt, and why it was dropped.** The first design enriched every document with an LLM: summaries, provisions, status.
It would have needed about 1.5 to 3.5 million tokens, and it could not run on a free tier.
The extract-first redesign needs zero build-time tokens.

**California bills.**
- The leginfo website blocks bots.
- The official pubinfo bulk zips do work, and they support HTTP Range reads.
- About 41 MB covers all 63 bills plus their dated action history, which gives status and the timeline with no AI.
- Pubinfo is also where the Legislative Counsel's Digest comes from. That digest is the official summary, quoted verbatim, and its sentences give the provisions.

**Singapore statutes.**
- Singapore Statutes Online needs `?WholeDoc=1` to get the whole Act, plus handling for lazy-loaded content.
- The metadata sits in specific elements: the long title (used as the summary) and the commencement dates.

**Singapore tenders.**
- GeBIZ tenders are fully structured on data.gov.sg.
- Every field comes straight from the dataset. No AI is needed at all.

**Mapping to the layers.**

| Layer | In Politik |
| --- | --- |
| 1. Ingest | Pubinfo zips, statute pages, GeBIZ dataset, with URL, fetched time and hash kept per document |
| 2. Facts | D1 tables with status, dates, jurisdiction, type and topics |
| 3. Passages | Sections and digest sentences, searchable by keyword and meaning |
| 4. Question time | Fast Groq model routes the question, a strong Groq model writes the cited answer |
| 5. Eval | Chat golden set (`pnpm eval:chat`) and data checks (`pnpm check:data`) |

## 10. Mistakes to avoid

- Starting with prompts before checking for a bulk download.
- Chunking by fixed size when the document has its own legal sections.
- Letting an LLM write status or dates that exist in structured data.
- Verifying LLM output with another LLM when a substring check will do.
- Showing data with no "as of" date.
- Printing or committing API keys, and seeding production data or deploying without the owner's OK.
