import assert from "node:assert/strict";
import { test } from "node:test";

import { groqLlm, type Llm } from "../../photon/src/llm/groq.ts";
import type { Passage } from "../../photon/src/data/schema.ts";
import type { Candidate } from "../../photon/scripts/snapshot/candidates.ts";
import { EnrichedSchema, enrichRecord } from "../../photon/scripts/snapshot/enrich.ts";

const candidate: Candidate = {
  include: true,
  id: "ca-sb-53-2025",
  jurisdiction: "US-CA",
  title: "SB 53 Transparency in Frontier Artificial Intelligence Act",
  type: "bill",
  topics: ["ai-governance"],
  status: "enacted (signed 2025-09-29)",
  landmark: true,
  url: "https://example.test/sb53",
  urlConfidence: "seen",
  why: "Frontier AI transparency law.",
};

const passages: Passage[] = [
  { id: "ca-sb-53-2025#1", recordId: "ca-sb-53-2025", seq: 1, heading: "Findings", text: "The Legislature finds that frontier models need oversight." },
  { id: "ca-sb-53-2025#2", recordId: "ca-sb-53-2025", seq: 2, text: "A large developer shall publish a frontier AI framework. The Governor approved this act on September 29, 2025." },
  { id: "ca-sb-53-2025#3", recordId: "ca-sb-53-2025", seq: 3, heading: "Definitions", text: "Frontier developer means a person who trains a frontier model." },
];

/** A model reply that is valid as written: nothing in it should be changed by enrichRecord. */
const goodReply = () => ({
  shortTitle: "SB 53",
  issuer: "California State Legislature",
  published: { value: "2025-09-29", support: ["ca-sb-53-2025#2"] },
  status: { value: "enacted", support: ["ca-sb-53-2025#2"] },
  statusDate: "2025-09-29",
  timeline: [{ date: "2025-09-29", event: "Signed by the Governor.", support: ["ca-sb-53-2025#2"] }],
  summary: { value: "Large AI developers must publish a safety framework.", support: ["ca-sb-53-2025#1", "ca-sb-53-2025#2"] },
  provisions: [
    { value: "Large developers must publish a frontier AI framework.", support: ["ca-sb-53-2025#2"] },
    { value: "A frontier developer is a person who trains a frontier model.", support: ["ca-sb-53-2025#3"] },
  ],
  affected: [{ value: "Developers of frontier AI models.", support: ["ca-sb-53-2025#3"] }],
  topics: ["ai-governance"],
  related: [{ id: "ca-sb-1047-2024", relation: "responds-to" }],
});

type Req = Parameters<Llm>[0];
function fakeLlm(reply: unknown) {
  const calls: Req[] = [];
  const llm = (async (req: Req) => {
    calls.push(req);
    return typeof reply === "function" ? (reply as () => unknown)() : reply;
  }) as Llm;
  return { llm, calls };
}


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

const ctx = { otherIds: ["ca-sb-1047-2024", "sg-pdpa-2012"] };
const run = (reply: unknown, p = passages, c = candidate) => enrichRecord(c, p, fakeLlm(reply).llm, ctx);

test("a valid output passes through unchanged and matches the PolicyRecord field shapes", async () => {
  const reply = goodReply();
  const { llm } = fakeLlm(structuredClone(reply));
  const out = await enrichRecord(candidate, passages, llm, ctx);
  assert.deepEqual(out, reply);
  assert.equal(EnrichedSchema.safeParse(out).success, true);
});

test("the wire schema the model is given accepts a valid reply, with null for absent optional fields", async () => {
  const { llm, calls } = fakeLlm(goodReply());
  await enrichRecord(candidate, passages, llm, ctx);
  const schema = calls[0]!.schema;
  assert.equal(schema.safeParse(goodReply()).success, true);
  assert.equal(schema.safeParse({ ...goodReply(), shortTitle: null, published: null, statusDate: null }).success, true);
  assert.equal(schema.safeParse({ ...goodReply(), status: { value: "weird", support: ["x"] } }).success, false);
});

test("a provision citing a passage that is not there (x#9) is removed", async () => {
  const reply = goodReply();
  reply.provisions.push({ value: "An invented penalty of $10M.", support: ["x#9"] });
  const out = await run(reply);
  assert.deepEqual(out.provisions, goodReply().provisions);
});

test("an unknown id is stripped from a claim, which keeps its remaining valid ids", async () => {
  const reply = goodReply();
  reply.summary.support = ["x#9", "ca-sb-53-2025#1", "ca-sb-53-2025#1"];
  reply.affected[0]!.support = ["ca-sb-53-2025#3", "nope#1"];
  const out = await run(reply);
  assert.deepEqual(out.summary.support, ["ca-sb-53-2025#1"]);
  assert.deepEqual(out.affected[0]!.support, ["ca-sb-53-2025#3"]);
});

test("a claim with empty support, or an empty value, is removed", async () => {
  const reply = goodReply();
  reply.provisions.push({ value: "Cites nothing.", support: [] }, { value: "   ", support: ["ca-sb-53-2025#1"] });
  reply.affected.push({ value: "Also cites nothing.", support: [] });
  reply.timeline.push({ date: "2026-01-01", event: "Takes effect.", support: [] });
  const out = await run(reply);
  assert.deepEqual(out.provisions, goodReply().provisions);
  assert.deepEqual(out.affected, goodReply().affected);
  assert.deepEqual(out.timeline, goodReply().timeline);
});

test("related: [{ id: 'unknown' }] is removed, as is a self reference; a bad relation becomes 'related'", async () => {
  const reply = goodReply() as any;
  reply.related = [{ id: "unknown" }, { id: "ca-sb-53-2025", relation: "related" }, { id: "sg-pdpa-2012", relation: "cites" }, { id: "ca-sb-1047-2024", relation: "amends" }];
  const out = await run(reply);
  assert.deepEqual(out.related, [
    { id: "sg-pdpa-2012", relation: "related" },
    { id: "ca-sb-1047-2024", relation: "amends" },
  ]);
});

test("a duplicate related id keeps only its first entry", async () => {
  const reply = goodReply() as any;
  reply.related = [{ id: "sg-pdpa-2012", relation: "implements" }, { id: "sg-pdpa-2012", relation: "amends" }];
  assert.deepEqual((await run(reply)).related, [{ id: "sg-pdpa-2012", relation: "implements" }]);
});

test('topic "weather" is removed, valid topics are kept once', async () => {
  const reply = goodReply();
  reply.topics = ["weather", "ai-governance", "privacy-data", "ai-governance"];
  const out = await run(reply);
  assert.deepEqual(out.topics, ["ai-governance", "privacy-data"]);
});

test("when no valid topic is left, the curator's topics from the candidate list are used", async () => {
  const reply = goodReply();
  reply.topics = ["weather"];
  const out = await run(reply, passages, { ...candidate, topics: ["privacy-data", "cybersecurity"] });
  assert.deepEqual(out.topics, ["privacy-data", "cybersecurity"]);
  assert.equal(EnrichedSchema.safeParse(out).success, true);
});

test("datetimes are normalised to YYYY-MM-DD and events with unparseable dates are dropped", async () => {
  const reply = goodReply() as any;
  reply.published = { value: "2025-09-29T00:00:00Z", support: ["ca-sb-53-2025#2"] };
  reply.statusDate = "2025-09-29T23:30:00-08:00";
  reply.timeline = [
    { date: "2025-09-29T00:00:00.000Z", event: "Signed.", support: ["ca-sb-53-2025#2"] },
    { date: "sometime in 2026", event: "Takes effect.", support: ["ca-sb-53-2025#2"] },
    { date: "2025-02-30", event: "Impossible date.", support: ["ca-sb-53-2025#2"] },
    { date: "", event: "No date.", support: ["ca-sb-53-2025#2"] },
  ];
  const out = await run(reply);
  assert.deepEqual(out.published, { value: "2025-09-29", support: ["ca-sb-53-2025#2"] });
  assert.equal(out.statusDate, "2025-09-29");
  assert.deepEqual(out.timeline, [{ date: "2025-09-29", event: "Signed.", support: ["ca-sb-53-2025#2"] }]);
  assert.equal(EnrichedSchema.safeParse(out).success, true);
});

test("an unparseable published or statusDate is omitted rather than invented", async () => {
  const reply = goodReply() as any;
  reply.published = { value: "late 2025", support: ["ca-sb-53-2025#2"] };
  reply.statusDate = "2025-13-01";
  const out = await run(reply);
  assert.equal("published" in out, false);
  assert.equal("statusDate" in out, false);
});

test("timeline events are sorted by date, oldest first", async () => {
  const reply = goodReply();
  reply.timeline = [
    { date: "2026-01-01", event: "Takes effect.", support: ["ca-sb-53-2025#2"] },
    { date: "2025-09-29", event: "Signed.", support: ["ca-sb-53-2025#2"] },
    { date: "2025-09-29", event: "Chaptered.", support: ["ca-sb-53-2025#2"] },
  ];
  const out = await run(reply);
  assert.deepEqual(
    out.timeline.map((e) => e.event),
    ["Signed.", "Chaptered.", "Takes effect."],
  );
});

test("null or blank optional fields are left out of the result", async () => {
  const reply = { ...goodReply(), shortTitle: null, published: null, statusDate: "  " } as any;
  const out = await run(reply);
  assert.equal("shortTitle" in out, false);
  assert.equal("published" in out, false);
  assert.equal("statusDate" in out, false);
  assert.equal(EnrichedSchema.safeParse(out).success, true);
});

test("a summary left with no valid citation fails the record with a clear reason", async () => {
  const reply = goodReply();
  reply.summary.support = ["x#9"];
  await assert.rejects(run(reply), /summary/);
});

test("a status left with no valid citation fails the record with a clear reason", async () => {
  const reply = goodReply();
  reply.status.support = [];
  await assert.rejects(run(reply), /status/);
});

test("an empty issuer fails the record", async () => {
  const reply = goodReply();
  reply.issuer = "  ";
  await assert.rejects(run(reply), /issuer/);
});

test("no passages means nothing to cite, so it fails without calling the model", async () => {
  const { llm, calls } = fakeLlm(goodReply());
  await assert.rejects(enrichRecord(candidate, [], llm, ctx), /passage/i);
  assert.equal(calls.length, 0);
});

test("the prompt shows passages as [id] heading + text blocks, the topics, and the related ids", async () => {
  const { llm, calls } = fakeLlm(goodReply());
  await enrichRecord(candidate, passages, llm, ctx);
  assert.equal(calls.length, 1);
  const { system, user, name } = calls[0]!;
  assert.equal(typeof name, "string");
  assert.ok(name.length > 0);
  assert.ok(user.includes("[ca-sb-53-2025#1] Findings\nThe Legislature finds that frontier models need oversight."));
  assert.ok(user.includes("[ca-sb-53-2025#2]\nA large developer shall publish"), "a passage without a heading has no heading text");
  assert.ok(user.includes("[ca-sb-53-2025#3] Definitions\nFrontier developer means"));
  assert.ok(user.includes(candidate.title));
  assert.ok(user.includes("ca-sb-1047-2024") && user.includes("sg-pdpa-2012"));
  for (const topic of ["ai-governance", "data-centres", "privacy-data", "cybersecurity", "online-safety", "gov-tech-procurement", "digital-infrastructure"]) {
    assert.ok(system.includes(topic), topic);
  }
  for (const status of ["proposed", "in-force", "superseded", "awarded", "published"]) assert.ok(system.includes(status), status);
  assert.match(system, /passage id/i);
  assert.match(system, /YYYY-MM-DD/);
  assert.match(system, /only/i);
});

test("with no other records to link to, the prompt says so", async () => {
  const { llm, calls } = fakeLlm({ ...goodReply(), related: [] });
  await enrichRecord(candidate, passages, llm, { otherIds: [] });
  assert.match(calls[0]!.user, /none/i);
});

test("it does not mutate the model's reply or the passages", async () => {
  const reply = goodReply();
  const copy = structuredClone(reply);
  reply.provisions.push({ value: "Bad", support: ["x#9"] });
  copy.provisions.push({ value: "Bad", support: ["x#9"] });
  const frozen = structuredClone(passages);
  await run(reply);
  assert.deepEqual(reply, copy);
  assert.deepEqual(passages, frozen);
});

test("the schema sent to Groq qualifies for strict mode: closed objects, every field required, no format/pattern/min keywords", async () => {
  const format = await sentFormat((llm) => enrichRecord(candidate, passages, llm, ctx));
  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.strict, true);
  assert.deepEqual(format.json_schema.schema.required.sort(), Object.keys(format.json_schema.schema.properties).sort());
});

// --- I3: `published` is a cited claim ---

test("I3: published is a claim with a value and the passages that state it, and the wire schema requires both", async () => {
  const { llm, calls } = fakeLlm(goodReply());
  const out = await enrichRecord(candidate, passages, llm, ctx);
  assert.deepEqual(out.published, { value: "2025-09-29", support: ["ca-sb-53-2025#2"] });
  const schema = calls[0]!.schema;
  assert.equal(schema.safeParse({ ...goodReply(), published: null }).success, true);
  assert.equal(schema.safeParse({ ...goodReply(), published: "2025-09-29" }).success, false, "a bare date is no longer accepted");
  assert.equal(schema.safeParse({ ...goodReply(), published: { value: "2025-09-29" } }).success, false);
  assert.match(calls[0]!.system, /- published:[^\n]*\bcitation\b/i, "the prompt asks for a citation");
});

test("I3: a published date with no support ids, or only ids that do not exist, is dropped before verification", async () => {
  for (const support of [[], ["x#9"], ["ca-sb-53-2025#9", "nope#1"]]) {
    const out = await run({ ...goodReply(), published: { value: "2025-09-29", support } });
    assert.equal("published" in out, false, JSON.stringify(support));
    assert.equal(EnrichedSchema.safeParse(out).success, true);
  }
});

test("I3: unknown ids are stripped from published, which keeps its remaining valid ids", async () => {
  const out = await run({ ...goodReply(), published: { value: "2025-09-29", support: ["x#9", "ca-sb-53-2025#1", "ca-sb-53-2025#1"] } });
  assert.deepEqual(out.published, { value: "2025-09-29", support: ["ca-sb-53-2025#1"] });
});

test("I3: an Enriched whose published is a bare string no longer parses", () => {
  const { published: _cited, ...rest } = goodReply();
  assert.equal(EnrichedSchema.safeParse({ ...rest, published: "2025-09-29" }).success, false);
  assert.equal(EnrichedSchema.safeParse({ ...rest, published: { value: "2025-09-29", support: [] } }).success, false);
  assert.equal(EnrichedSchema.safeParse(rest).success, true, "published stays optional");
});
