import assert from "node:assert/strict";
import { test } from "node:test";

import { groqLlm, type Llm } from "../../photon/src/llm/groq.ts";
import { StatusSchema, type Passage } from "../../photon/src/data/schema.ts";
import { STATUS_HELP, type Enriched } from "../../photon/scripts/snapshot/enrich.ts";
import { verifyHeadline, verifyRecord } from "../../photon/scripts/snapshot/verify.ts";

const passages: Passage[] = [
  { id: "r#1", recordId: "r", seq: 1, heading: "Purpose", text: "This Act protects personal data held by organisations." },
  { id: "r#2", recordId: "r", seq: 2, text: "Organisations must notify the Commission of a data breach within three days." },
  { id: "r#3", recordId: "r", seq: 3, heading: "Penalties", text: "A financial penalty may be imposed on an organisation that breaches this Act." },
];

const enriched = (): Enriched => ({
  issuer: "PDPC",
  status: { value: "in-force", support: ["r#1"] },
  statusDate: "2013-01-02",
  timeline: [{ date: "2013-01-02", event: "The Act came into force.", support: ["r#1"] }],
  summary: { value: "The Act protects personal data.", support: ["r#1"] },
  provisions: [
    { value: "Breaches must be notified within three days.", support: ["r#2"] },
    { value: "Penalties may be imposed.", support: ["r#3"] },
    { value: "Directors face prison.", support: ["r#3", "r#2"] },
  ],
  affected: [{ value: "Organisations that hold personal data.", support: ["r#1"] }],
  topics: ["privacy-data"],
  related: [],
});

type Req = Parameters<Llm>[0];
/** A fake verifier: `unsupported` lists the claim ids to mark false; `omit` lists the ones to leave out of the answer. */
function verifier(opts: { unsupported?: string[]; omit?: string[]; raw?: unknown } = {}) {
  const calls: Req[] = [];
  const llm = (async (req: Req) => {
    calls.push(req);
    if (opts.raw !== undefined) return opts.raw;
    // The claim ids the prompt lists, e.g. "- provisions[1]: ..." or "provisions[1] |".
    const ids = [...req.user.matchAll(/^CLAIM ([^\s:]+)/gm)].map((m) => m[1]!);
    return {
      results: ids
        .filter((id) => !(opts.omit ?? []).includes(id))
        .map((claimId) => ({ claimId, supported: !(opts.unsupported ?? []).includes(claimId) })),
    };
  }) as Llm;
  return { llm, calls };
}

test("when every claim is supported, nothing is dropped and the result equals the input", async () => {
  const e = enriched();
  const { llm, calls } = verifier();
  const out = await verifyRecord(e, passages, llm);
  assert.deepEqual(out.kept, enriched());
  assert.deepEqual(out.dropped, []);
  assert.equal(out.fatal, undefined);
  assert.equal(calls.length, 1, "one LLM call for all claims");
});

test("one provision marked unsupported is dropped and listed", async () => {
  const { llm } = verifier({ unsupported: ["provisions[2]"] });
  const out = await verifyRecord(enriched(), passages, llm);
  assert.deepEqual(out.kept.provisions.map((p) => p.value), ["Breaches must be notified within three days.", "Penalties may be imposed."]);
  assert.deepEqual(out.dropped, ["provisions[2]"]);
  assert.equal(out.fatal, undefined);
});

test("unsupported affected groups and timeline events are dropped too", async () => {
  const { llm } = verifier({ unsupported: ["affected[0]", "timeline[0]"] });
  const out = await verifyRecord(enriched(), passages, llm);
  assert.deepEqual(out.kept.affected, []);
  assert.deepEqual(out.kept.timeline, []);
  assert.deepEqual(out.dropped.sort(), ["affected[0]", "timeline[0]"]);
  assert.equal(out.fatal, undefined);
});

test("an unsupported summary is fatal", async () => {
  const { llm } = verifier({ unsupported: ["summary"] });
  const out = await verifyRecord(enriched(), passages, llm);
  assert.equal(out.fatal, "summary unsupported");
  assert.deepEqual(out.dropped, ["summary"]);
});

test("an unsupported status is fatal", async () => {
  const { llm } = verifier({ unsupported: ["status"] });
  const out = await verifyRecord(enriched(), passages, llm);
  assert.equal(out.fatal, "status unsupported");
  assert.deepEqual(out.dropped, ["status"]);
});

test("when both the summary and the status fail, the summary is reported", async () => {
  const { llm } = verifier({ unsupported: ["status", "summary"] });
  const out = await verifyRecord(enriched(), passages, llm);
  assert.equal(out.fatal, "summary unsupported");
  assert.deepEqual(out.dropped.sort(), ["status", "summary"]);
});

test("an unsupported statusDate is dropped without failing the record", async () => {
  const { llm } = verifier({ unsupported: ["statusDate"] });
  const out = await verifyRecord(enriched(), passages, llm);
  assert.equal("statusDate" in out.kept, false);
  assert.deepEqual(out.dropped, ["statusDate"]);
  assert.equal(out.fatal, undefined);
  assert.equal(out.kept.status.value, "in-force");
});

test("a claim the model leaves out of its answer counts as unsupported", async () => {
  const { llm } = verifier({ omit: ["provisions[1]"] });
  const out = await verifyRecord(enriched(), passages, llm);
  assert.deepEqual(out.kept.provisions.map((p) => p.value), ["Breaches must be notified within three days.", "Directors face prison."]);
  assert.deepEqual(out.dropped, ["provisions[1]"]);
});

test("a summary the model leaves out of its answer is fatal", async () => {
  const { llm } = verifier({ omit: ["summary"] });
  const out = await verifyRecord(enriched(), passages, llm);
  assert.equal(out.fatal, "summary unsupported");
});

test("an empty or unrelated answer drops everything and is fatal", async () => {
  const { llm } = verifier({ raw: { results: [{ claimId: "made-up", supported: true }] } });
  const out = await verifyRecord(enriched(), passages, llm);
  assert.equal(out.fatal, "summary unsupported");
  assert.deepEqual(out.kept.provisions, []);
  assert.equal(out.dropped.length, 8);
});

test("if the model gives two verdicts for a claim, any 'unsupported' wins", async () => {
  const { llm } = verifier({
    raw: {
      results: [
        { claimId: "summary", supported: true },
        { claimId: "status", supported: true },
        { claimId: "statusDate", supported: true },
        { claimId: "timeline[0]", supported: true },
        { claimId: "provisions[0]", supported: true },
        { claimId: "provisions[0]", supported: false },
        { claimId: "provisions[1]", supported: true },
        { claimId: "provisions[2]", supported: true },
        { claimId: "affected[0]", supported: true },
      ],
    },
  });
  const out = await verifyRecord(enriched(), passages, llm);
  assert.deepEqual(out.dropped, ["provisions[0]"]);
});

test("the prompt lists every claim with its id, text and the cited passage text", async () => {
  const { llm, calls } = verifier();
  await verifyRecord(enriched(), passages, llm);
  const { user, system, name } = calls[0]!;
  assert.ok(name.length > 0);
  for (const id of ["summary", "status", "statusDate", "timeline[0]", "provisions[0]", "provisions[1]", "provisions[2]", "affected[0]"]) {
    assert.ok(user.includes(`CLAIM ${id}`), id);
  }
  assert.ok(user.includes("The Act protects personal data."));
  assert.ok(user.includes("Directors face prison."));
  assert.ok(user.includes("2013-01-02"));
  // Cited passages are shown, once each, as [id] heading + text blocks.
  assert.ok(user.includes("[r#1] Purpose\nThis Act protects personal data held by organisations."));
  assert.ok(user.includes("[r#2]\nOrganisations must notify the Commission"));
  assert.equal(user.split("[r#3] Penalties").length, 2, "a passage cited by several claims appears once");
  assert.match(system, /supported/i);
  assert.match(system, /outside knowledge|only the/i);
});

test("a passage nobody cites is not sent", async () => {
  const e = enriched();
  e.provisions = [{ value: "Breaches must be notified.", support: ["r#2"] }];
  e.affected = [];
  const { llm, calls } = verifier();
  await verifyRecord(e, passages, llm);
  assert.ok(!calls[0]!.user.includes("[r#3]"));
});

test("a claim whose cited passages are unknown is unsupported without being sent", async () => {
  const e = enriched();
  e.provisions.push({ value: "Cites a ghost.", support: ["ghost#1"] });
  const { llm, calls } = verifier();
  const out = await verifyRecord(e, passages, llm);
  assert.deepEqual(out.dropped, ["provisions[3]"]);
  assert.ok(!calls[0]!.user.includes("CLAIM provisions[3]"));
  assert.ok(!calls[0]!.user.includes("Cites a ghost."));
});

test("it does not mutate its input", async () => {
  const e = enriched();
  const { llm } = verifier({ unsupported: ["provisions[0]", "statusDate"] });
  await verifyRecord(e, passages, llm);
  assert.deepEqual(e, enriched());
});

test("the answer schema accepts a well-formed answer and rejects a malformed one", async () => {
  const { llm, calls } = verifier();
  await verifyRecord(enriched(), passages, llm);
  const schema = calls[0]!.schema;
  assert.equal(schema.safeParse({ results: [{ claimId: "summary", supported: true }] }).success, true);
  assert.equal(schema.safeParse({ results: [{ claimId: "summary", supported: "yes" }] }).success, false);
  assert.equal(schema.safeParse([{ claimId: "summary", supported: true }]).success, false);
});

/** The request body groqLlm would send for this call, with a strict-capable model. */
async function sentFormat(call: (llm: Llm) => Promise<unknown>) {
  let format: any;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    format = JSON.parse(String(init?.body)).response_format;
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200 });
  }) as typeof fetch;
  await call(groqLlm({ apiKey: "k", model: "openai/gpt-oss-120b", fetchImpl, maxRetries: 0 })).catch(() => undefined);
  return format;
}

test("the schema sent to Groq qualifies for strict mode", async () => {
  const format = await sentFormat((llm) => verifyRecord(enriched(), passages, llm));
  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.strict, true);
});

// --- status definitions and the snapshot date (R13b) ---

test("the system prompt defines every status the way the enrich prompt does, so a correct status is not marked unsupported", async () => {
  assert.deepEqual(Object.keys(STATUS_HELP).sort(), [...StatusSchema.options].sort());
  const { llm, calls } = verifier();
  await verifyRecord(enriched(), passages, llm, { today: "2026-10-15" });
  const { system } = calls[0]!;
  for (const [status, help] of Object.entries(STATUS_HELP)) {
    assert.ok(system.includes(`${status}: ${help}`), `the definition of ${status}`);
  }
});

test("the system prompt states the snapshot date and how it settles in-force versus enacted", async () => {
  const { llm, calls } = verifier();
  await verifyRecord(enriched(), passages, llm, { today: "2026-10-15" });
  const { system } = calls[0]!;
  assert.ok(system.includes("2026-10-15"));
  assert.match(system, /in-force/);
  assert.match(system, /effective date/i);
});

test("without a date the prompt still carries the definitions but names no date", async () => {
  const { llm, calls } = verifier();
  await verifyRecord(enriched(), passages, llm);
  const { system } = calls[0]!;
  assert.ok(system.includes(`in-force: ${STATUS_HELP["in-force"]}`));
  assert.doesNotMatch(system, /\b\d{4}-\d{2}-\d{2}\b/);
  const withEmptyCtx = verifier();
  await verifyRecord(enriched(), passages, withEmptyCtx.llm, {});
  assert.equal(withEmptyCtx.calls[0]!.system, system);
});

test("passing the context does not change which claims are checked or how verdicts are applied", async () => {
  const { llm } = verifier({ unsupported: ["provisions[2]"] });
  const out = await verifyRecord(enriched(), passages, llm, { today: "2026-10-15" });
  assert.deepEqual(out.dropped, ["provisions[2]"]);
  assert.equal(out.fatal, undefined);
});

// --- I2: identity, I3: published, M4: untrusted claims ---

const withPublished = (): Enriched => ({ ...enriched(), published: { value: "2013-01-02", support: ["r#2"] } });
const TITLE = "Personal Data Protection Act 2012";

test("I2: with a title, one extra claim `identity` is checked in the same single call", async () => {
  const { llm, calls } = verifier();
  const out = await verifyRecord(enriched(), passages, llm, { title: TITLE });
  assert.equal(calls.length, 1, "still one LLM call");
  const { user } = calls[0]!;
  assert.ok(user.includes(`CLAIM identity: These passages are from the document named "${TITLE}" (wording may differ; a later amended version of the same bill/instrument counts).`));
  assert.deepEqual(out.dropped, []);
  assert.equal(out.fatal, undefined);
  assert.deepEqual(out.kept, enriched());
});

test("I2: the identity claim cites the first passages, and only those are added to the passages sent (R23: at least three)", async () => {
  const e = enriched();
  e.provisions = [];
  e.affected = [];
  e.timeline = [];
  e.status.support = ["r#1"];
  e.summary.support = ["r#1"];
  const { llm, calls } = verifier();
  await verifyRecord(e, passages, llm, { title: TITLE });
  const { user } = calls[0]!;
  assert.match(user, /CLAIM identity:[^\n]*\nCited passages: r#1, r#2, r#3\n/);
  assert.ok(user.includes("[r#1] Purpose") && user.includes("[r#2]") && user.includes("[r#3] Penalties"));
});

/** n passages of `size` words each, `r#1`..`r#n`. A word is `p<seq>w<i>`; `extra` is added to the text of the passage with that seq. */
const sized = (n: number, size: number, extra: Record<number, string> = {}): Passage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `r#${i + 1}`,
    recordId: "r",
    seq: i + 1,
    text: `${extra[i + 1] ?? ""} ${Array.from({ length: size }, (_, w) => `p${i + 1}w${w}`).join(" ")}`.trim(),
  }));
const identityCited = (user: string) => /CLAIM identity:[^\n]*\nCited passages: ([^\n]*)\n/.exec(user)![1]!.split(", ");
/** An enriched record that cites only passage 1, so every other cited passage in the prompt comes from the identity claim. */
const citesOnlyFirst = (): Enriched => {
  const { statusDate: _dropped, ...rest } = enriched();
  return { ...rest, status: { value: "in-force", support: ["r#1"] }, timeline: [], provisions: [], affected: [] };
};

test("R23: the identity claim cites every passage that holds the first 600 words, and at least the first three", async () => {
  const cited = async (list: Passage[]) => {
    const { llm, calls } = verifier();
    await verifyRecord(citesOnlyFirst(), list, llm, { title: TITLE });
    return identityCited(calls[0]!.user);
  };
  assert.deepEqual(await cited(sized(8, 400)), ["r#1", "r#2", "r#3"], "400-word passages: words 1-600 are in two, but three is the least");
  assert.deepEqual(await cited(sized(8, 150)), ["r#1", "r#2", "r#3", "r#4"], "150-word passages: words 1-600 are in four");
  assert.deepEqual(await cited(sized(8, 100)), ["r#1", "r#2", "r#3", "r#4", "r#5", "r#6"], "100-word passages: six");
  assert.deepEqual(await cited(sized(2, 100)), ["r#1", "r#2"], "a document with fewer passages cites them all");
  assert.deepEqual(await cited([...sized(1, 600), ...sized(3, 400).map((p) => ({ ...p, id: `r#${p.seq + 1}`, seq: p.seq + 1 }))]), ["r#1", "r#2", "r#3"], "one long passage still gets three");
});

test("R23: a bill whose title appears only in passage 3 still passes the identity check", async () => {
  // Passages 1 and 2 are legislative history (no bill number, no subject); the digest, with the title, starts passage 3.
  const history = sized(2, 380);
  const digest: Passage = { id: "r#3", recordId: "r", seq: 3, heading: "Legislative Counsel's Digest", text: `Safe and Secure Innovation for Frontier Artificial Intelligence Models Act. ${"Existing law covers things. ".repeat(60)}` };
  const list = [...history, digest, ...sized(5, 400).map((p) => ({ ...p, id: `r#${p.seq + 3}`, seq: p.seq + 3 }))];
  // A verifier that, like a real one, can only call the identity supported if the passages it was sent show the title.
  const calls: string[] = [];
  const llm = (async (req: Req) => {
    calls.push(req.user);
    const sawTitle = req.user.includes("Safe and Secure Innovation for Frontier Artificial Intelligence Models Act.");
    const ids = [...req.user.matchAll(/^CLAIM ([^\s:]+)/gm)].map((m) => m[1]!);
    return { results: ids.map((claimId) => ({ claimId, supported: claimId === "identity" ? sawTitle : true })) };
  }) as Llm;
  const out = await verifyRecord(citesOnlyFirst(), list, llm, { title: "SB 1047 Safe and Secure Innovation for Frontier Artificial Intelligence Models Act" });
  assert.equal(out.fatal, undefined, "with two passages the title was never shown");
  assert.deepEqual(identityCited(calls[0]!), ["r#1", "r#2", "r#3"]);
  assert.ok(calls[0]!.includes("[r#3] Legislative Counsel's Digest"));
  assert.ok(!calls[0]!.includes("[r#4]"), "and no more than the first 600 words' passages go to the verifier");
});

test("I2: an unsupported identity is fatal with exactly 'source does not match the listed document'", async () => {
  const { llm } = verifier({ unsupported: ["identity"] });
  const out = await verifyRecord(enriched(), passages, llm, { title: TITLE });
  assert.equal(out.fatal, "source does not match the listed document");
  assert.deepEqual(out.dropped, ["identity"]);
});

test("I2: an identity the model leaves out of its answer is fatal too", async () => {
  const { llm } = verifier({ omit: ["identity"] });
  const out = await verifyRecord(enriched(), passages, llm, { title: TITLE });
  assert.equal(out.fatal, "source does not match the listed document");
});

test("I2: a wrong document is reported as such even when the summary also fails", async () => {
  const { llm } = verifier({ unsupported: ["identity", "summary", "status"] });
  const out = await verifyRecord(enriched(), passages, llm, { title: TITLE });
  assert.equal(out.fatal, "source does not match the listed document");
});

test("I2: without a title there is no identity claim (a tender's text is the row its title came from)", async () => {
  const { llm, calls } = verifier();
  const out = await verifyRecord(enriched(), passages, llm, { today: "2026-10-15" });
  assert.ok(!calls[0]!.user.includes("CLAIM identity"));
  assert.equal(out.fatal, undefined);
});

test("I2: the system prompt says what the identity claim means", async () => {
  const { llm, calls } = verifier();
  await verifyRecord(enriched(), passages, llm, { title: TITLE });
  assert.match(calls[0]!.system, /identity/);
  assert.match(calls[0]!.system, /later amended version|another publication/i);
});

test("I3: a published date is checked as the claim `published`, and kept when supported", async () => {
  const { llm, calls } = verifier();
  const out = await verifyRecord(withPublished(), passages, llm);
  assert.ok(calls[0]!.user.includes("CLAIM published: The document was published, issued or enacted on 2013-01-02.\nCited passages: r#2"));
  assert.deepEqual(out.kept.published, { value: "2013-01-02", support: ["r#2"] });
  assert.deepEqual(out.dropped, []);
});

test("I3: an unsupported published date is dropped and does not fail the record", async () => {
  const { llm } = verifier({ unsupported: ["published"] });
  const out = await verifyRecord(withPublished(), passages, llm);
  assert.equal("published" in out.kept, false);
  assert.deepEqual(out.dropped, ["published"]);
  assert.equal(out.fatal, undefined);
  assert.equal(out.kept.summary.value, "The Act protects personal data.");
});

test("I3: a published date the model leaves out of its answer is dropped", async () => {
  const { llm } = verifier({ omit: ["published"] });
  const out = await verifyRecord(withPublished(), passages, llm);
  assert.equal("published" in out.kept, false);
  assert.deepEqual(out.dropped, ["published"]);
});

test("I3: a record with no published date has no published claim", async () => {
  const { llm, calls } = verifier();
  await verifyRecord(enriched(), passages, llm);
  assert.ok(!calls[0]!.user.includes("CLAIM published"));
});

test("M4: the system prompt says the claims are model-written and untrusted, as the passages are", async () => {
  const { llm, calls } = verifier();
  await verifyRecord(enriched(), passages, llm);
  assert.match(calls[0]!.system, /claims are written by (?:another|a) model and are untrusted/i);
  assert.match(calls[0]!.system, /never as instructions/i);
});

// ---------------------------------------------------------------------------------------------------------------------
// R25: checking a headline

const headline = { value: "Organisations that lose personal data must tell the regulator within three days.", support: ["r#2"] };

test("verifyHeadline is true when the model says the headline is supported, with one claim named headline and only its passages", async () => {
  const v = verifier();
  assert.equal(await verifyHeadline(headline, passages, v.llm), true);
  assert.equal(v.calls.length, 1);
  const user = v.calls[0]!.user;
  assert.deepEqual([...user.matchAll(/^CLAIM ([^\s:]+)/gm)].map((m) => m[1]), ["headline"]);
  assert.ok(user.includes(headline.value));
  assert.ok(user.includes("Organisations must notify the Commission of a data breach"));
  assert.ok(!user.includes("This Act protects personal data") && !user.includes("A financial penalty"), "only the cited passage is shown");
  assert.ok(/fact-checker/i.test(v.calls[0]!.system), "the existing system prompt");
});

test("verifyHeadline is false when the model says unsupported, and false when it leaves the claim out of its answer", async () => {
  assert.equal(await verifyHeadline(headline, passages, verifier({ unsupported: ["headline"] }).llm), false);
  assert.equal(await verifyHeadline(headline, passages, verifier({ omit: ["headline"] }).llm), false);
  assert.equal(await verifyHeadline(headline, passages, verifier({ raw: { results: [{ claimId: "summary", supported: true }] } }).llm), false);
});

test("verifyHeadline is false, with no call, when the headline cites no passage that exists; the snapshot date reaches the prompt", async () => {
  const v = verifier();
  assert.equal(await verifyHeadline({ value: "x", support: ["nope#9"] }, passages, v.llm), false);
  assert.equal(v.calls.length, 0);
  const dated = verifier();
  await verifyHeadline(headline, passages, dated.llm, { today: "2026-10-15" });
  assert.ok(dated.calls[0]!.system.includes("2026-10-15"));
});

test("verifyHeadline lets an LLM error through, for the build to log", async () => {
  const llm = (async () => {
    throw new Error("Groq API error 429");
  }) as Llm;
  await assert.rejects(verifyHeadline(headline, passages, llm), /429/);
});
