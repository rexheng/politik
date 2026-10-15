import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { checkSnapshot } from "../../scripts/check-data.ts";
import { ManifestSchema, type Manifest, type Passage, type PolicyRecord } from "../../photon/src/data/schema.ts";
import { LlmError, type Llm } from "../../photon/src/llm/groq.ts";
import {
  buildSnapshot,
  formatSummary,
  main,
  parseArgs,
  runBuild,
  PIPELINE_VERSION,
  SnapshotGuardError,
  type BuildOptions,
  type RunResult,
} from "../../photon/scripts/snapshot/build.ts";
import { htmlToText } from "../../photon/scripts/snapshot/extract.ts";
import type { GebizRule } from "../../photon/scripts/snapshot/gebiz.ts";
import { sha256Hex } from "../../photon/scripts/snapshot/passages.ts";
import { renderReview } from "../../photon/scripts/snapshot/review.ts";

const SNAPSHOT_DATE = "2026-10-15";
const FIXTURE_CANDIDATES = new URL("../fixtures/sources/build-candidates.md", import.meta.url);
const GEBIZ_FIXTURE = await readFile(new URL("../fixtures/sources/gebiz.json", import.meta.url), "utf8");

// ---------------------------------------------------------------------------------------------------------------------
// Test doubles

/** `n` distinct words, so two documents never share a hash by accident. */
const words = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
const tagOf = (id: string) => id.replace(/[^a-z0-9]/g, "");

/** An HTML page whose text is `h1` plus one paragraph per entry of `paragraphs` (each entry is a word count). */
const page = (id: string, paragraphs: number[] = [200]) =>
  `<!doctype html><html><head><title>${id}</title></head><body><main><h1>Heading of ${id}</h1>${paragraphs
    .map((n, i) => `<p>${words(`${tagOf(id)}p${i}w`, n)}</p>`)
    .join("")}</main></body></html>`;

/** A fake fetch. A route's value is the HTML to serve, or an HTTP status to answer with. Anything else is a 404. */
function fakeWeb(routes: Record<string, string | number>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (typeof route === "string") return new Response(route, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("nope", { status: route ?? 404 });
  }) as typeof fetch;
  return { impl, calls };
}

type Req = Parameters<Llm>[0];
type Related = { id: string; relation: string }[];

/** Fake enrich and verify models that count their calls. Every reply is valid unless a per-record option says otherwise. */
function fakeLlms(
  opts: {
    enrichThrows?: Record<string, Error>;
    verifyThrows?: Record<string, Error>;
    unsupported?: Record<string, string[]>;
    /** Claim ids the checker leaves out of its answer, per record. */
    omit?: Record<string, string[]>;
    related?: Record<string, Related>;
    issuer?: string;
    /** Per record: the `published` the enricher returns (default: 2025-09-29 citing passage 1); null for none. */
    published?: Record<string, { value: string; support: string[] } | null>;
  } = {},
) {
  const enrichCalls: Req[] = [];
  const verifyCalls: Req[] = [];
  const enrich = (async (req: Req) => {
    enrichCalls.push(req);
    const id = /^Id: (.+)$/m.exec(req.user)![1]!;
    const thrown = opts.enrichThrows?.[id];
    if (thrown) throw thrown;
    const cite = [`${id}#1`];
    return {
      shortTitle: null,
      issuer: opts.issuer ?? "Example Legislature",
      published: opts.published && id in opts.published ? opts.published[id] : { value: "2025-09-29", support: cite },
      status: { value: "enacted", support: cite },
      statusDate: "2025-09-29",
      timeline: [{ date: "2025-09-29", event: "Signed by the Governor.", support: cite }],
      summary: { value: `Summary of ${id}.`, support: cite },
      provisions: [{ value: `A provision of ${id}.`, support: cite }],
      affected: [{ value: `Those covered by ${id}.`, support: cite }],
      topics: ["ai-governance"],
      related: opts.related?.[id] ?? [],
    };
  }) as Llm;
  const verify = (async (req: Req) => {
    verifyCalls.push(req);
    const id = /\[([a-z0-9-]+)#\d+\]/.exec(req.user)![1]!;
    const thrown = opts.verifyThrows?.[id];
    if (thrown) throw thrown;
    const claimIds = [...req.user.matchAll(/^CLAIM ([^\s:]+)/gm)].map((m) => m[1]!);
    return {
      results: claimIds
        .filter((claimId) => !(opts.omit?.[id] ?? []).includes(claimId))
        .map((claimId) => ({ claimId, supported: !(opts.unsupported?.[id] ?? []).includes(claimId) })),
    };
  }) as Llm;
  return {
    llm: { enrich, verify },
    enrichCalls,
    verifyCalls,
    total: () => enrichCalls.length + verifyCalls.length,
  };
}

let root: string;
let counter = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "politik-build-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Fresh output, raw-download and cache directories, and a candidates file (the 3-row fixture unless given text). */
async function makeEnv(candidatesMd?: string) {
  const dir = join(root, `case-${++counter}`);
  await mkdir(dir, { recursive: true });
  const candidatesPath = join(dir, "candidates.md");
  if (candidatesMd === undefined) await copyFile(FIXTURE_CANDIDATES, candidatesPath);
  else await writeFile(candidatesPath, candidatesMd);
  const paths = {
    candidatesPath,
    outDir: join(dir, "out"),
    rawDir: join(dir, "raw"),
    cacheDir: join(dir, "cache"),
    reviewedPath: join(dir, "reviewed.json"),
  };
  const clock = { now: new Date("2026-10-15T09:00:00.000Z") };
  const opts = (over: Partial<BuildOptions> & Pick<BuildOptions, "llm">): BuildOptions => ({
    ...paths,
    snapshotDate: SNAPSHOT_DATE,
    models: { enrich: "enrich-model", verify: "verify-model" },
    now: () => clock.now,
    ...over,
  });
  const read = async (name: string) => readFile(join(paths.outDir, name), "utf8");
  const readJson = async <T>(name: string) => JSON.parse(await read(name)) as T;
  return { dir, paths, clock, opts, read, readJson };
}

const candidatesMd = (...rows: string[]) =>
  `| include | id | title | type | topics | status (best known) | landmark | url | url_confidence | why |\n|---|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
const row = (id: string, o: { include?: string; landmark?: string; url?: string; type?: string; title?: string } = {}) =>
  `| ${o.include ?? "yes"} | ${id} | ${o.title ?? `Title of ${id}`} | ${o.type ?? "bill"} | ai-governance | enacted | ${o.landmark ?? "no"} | ${o.url ?? `https://example.test/${id}`} | seen | why |`;
const siteFor = (...ids: string[]) => Object.fromEntries(ids.map((id) => [`https://example.test/${id}`, page(id)]));

const GOOD_ID = "ca-sb-900-2025";
const GOOD_PAGE = page(GOOD_ID, [250, 250]); // 500 words of body text: two passages

/** The 3-row fixture's web: one good page, one 403, one good page that the checker will reject. */
const fixtureWeb = () =>
  fakeWeb({
    "https://example.test/bills/sb-900": GOOD_PAGE,
    "https://example.test/pdpc/advisory": 403,
    "https://example.test/bills/ab-100": page("ca-ab-100-2024"),
  });
const fixtureLlms = () => fakeLlms({ unsupported: { "ca-ab-100-2024": ["summary"] } });


// ---------------------------------------------------------------------------------------------------------------------
// The 3-row build

test("the 3-row build produces one record and two excluded rows, each with its reason", async () => {
  const env = await makeEnv();
  const manifest = await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));

  const policies = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(policies.map((p) => p.id), [GOOD_ID]);
  assert.deepEqual(manifest.excluded, [
    { id: "ca-ab-100-2024", jurisdiction: "US-CA", url: "https://example.test/bills/ab-100", title: "Example deepfake disclosure (AB 100)", reason: "summary unsupported" },
    { id: "sg-pdpc-advisory-2024", jurisdiction: "SG", url: "https://example.test/pdpc/advisory", title: "Advisory Guidelines on use of personal data in AI systems", reason: "HTTP 403" },
  ]);
  assert.deepEqual(await env.readJson<Manifest>("manifest.json"), manifest);
  assert.equal(manifest.snapshotDate, SNAPSHOT_DATE);
  assert.deepEqual(manifest.models, { enrich: "enrich-model", verify: "verify-model" });
  assert.equal(manifest.counts.total, 1);
  assert.equal(manifest.counts.byJurisdiction["US-CA"], 1);
  assert.equal(manifest.counts.byJurisdiction.SG, 0);
  assert.equal(manifest.counts.byType.bill, 1);
  assert.equal(manifest.counts.byType.guidance, 0);
  assert.equal(manifest.builtAt, "2026-10-15T09:00:00.000Z");
  assert.ok(ManifestSchema.safeParse(manifest).success);
});

test("every candidate ends in exactly one of policies.json or manifest.excluded", async () => {
  const env = await makeEnv();
  const manifest = await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  const built = (await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id);
  const excluded = manifest.excluded.map((e) => e.id);
  assert.deepEqual([...built, ...excluded].sort(), ["ca-ab-100-2024", GOOD_ID, "sg-pdpc-advisory-2024"]);
});

test("policies.json, passages.json and manifest.json pass checkSnapshot", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  const errors = checkSnapshot({
    policies: await env.readJson("policies.json"),
    passages: await env.readJson("passages.json"),
    manifest: await env.readJson("manifest.json"),
  });
  assert.deepEqual(errors, []);
});

test("a built record carries its provenance, the enriched fields and the full-text hash", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  const text = htmlToText(GOOD_PAGE);
  assert.equal(record!.sha256, sha256Hex(text));
  assert.equal(record!.url, "https://example.test/bills/sb-900");
  assert.equal(record!.title, "Example frontier model transparency (SB 900)");
  assert.equal(record!.type, "bill");
  assert.equal(record!.jurisdiction, "US-CA");
  assert.equal(record!.landmark, true);
  assert.equal(record!.fetched, "2026-10-15T09:00:00.000Z");
  assert.equal(record!.issuer, "Example Legislature");
  // example.test is not a known publisher host, so the publisher is the issuer and nothing is assumed redistributable.
  assert.equal(record!.publisher, "Example Legislature");
  assert.equal(record!.attribution, "Example Legislature");
  assert.equal(record!.redistributionOk, false);
  assert.equal(record!.status.value, "enacted");
  assert.equal(record!.published, "2025-09-29");
  assert.deepEqual(record!.review, { state: "auto-checked" });
  assert.deepEqual(record!.topics, ["ai-governance"]);
});

test("a known publisher host gets its publisher, attribution and redistribution flag", async () => {
  const url = "https://oag.ca.gov/news/press-releases/example";
  const env = await makeEnv(candidatesMd(row("ca-oag-example-2025", { url, type: "press-release" })));
  await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: fakeWeb({ [url]: page("ca-oag-example-2025") }).impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.equal(record!.publisher, "California Department of Justice, Office of the Attorney General");
  assert.match(record!.attribution, /Attorney General/);
  assert.equal(record!.redistributionOk, true);
});

test("all of a document's passages are stored, and the JSON is 2-space indented with a trailing newline", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  const passages = await env.readJson<Passage[]>("passages.json");
  assert.ok(passages.length >= 2);
  assert.ok(passages.every((p) => p.recordId === GOOD_ID));
  for (const name of ["policies.json", "passages.json", "manifest.json"]) {
    const text = await env.read(name);
    assert.ok(text.endsWith("}\n") || text.endsWith("]\n"), name);
    assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`, name);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Caching and re-runs

const OUTPUTS = ["policies.json", "passages.json", "manifest.json", "review.md"];
const snapshotOf = async (env: Awaited<ReturnType<typeof makeEnv>>) => Object.fromEntries(await Promise.all(OUTPUTS.map(async (n) => [n, await env.read(n)])));

test("a second run with the same inputs makes no LLM calls and writes byte-identical files", async () => {
  const env = await makeEnv();
  const llms = fixtureLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fixtureWeb().impl }));
  const first = await snapshotOf(env);
  assert.equal(llms.enrichCalls.length, 2, "one enrich call per document that loaded");
  assert.equal(llms.verifyCalls.length, 2, "one verify call per enriched document");

  env.clock.now = new Date("2026-10-16T18:30:00.000Z"); // a later wall clock must not leak into the output
  const before = llms.total();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fixtureWeb().impl }));
  assert.equal(llms.total() - before, 0, "zero LLM calls on the re-run");
  assert.deepEqual(await snapshotOf(env), first);
});

test("the caches live at cacheDir/enrich/<sha>.json and cacheDir/verify/<sha>.json", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  const sha = sha256Hex(htmlToText(GOOD_PAGE));
  assert.ok((await stat(join(env.paths.cacheDir, "enrich", `${sha}.json`))).isFile());
  assert.ok((await stat(join(env.paths.cacheDir, "verify", `${sha}.json`))).isFile());
});

test("a verdict that excluded a record (summary unsupported) is cached too, so the re-run does not ask again", async () => {
  const env = await makeEnv();
  const llms = fixtureLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fixtureWeb().impl }));
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fixtureWeb().impl }));
  assert.equal(llms.enrichCalls.length, 2);
  assert.equal(llms.verifyCalls.length, 2);
  assert.ok(manifest.excluded.some((e) => e.reason === "summary unsupported"));
});

test("only a document whose text changed is enriched again, and its fetched time moves", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025")));
  const web = fakeWeb(siteFor("ca-a-2025", "ca-b-2025"));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  const first = await env.readJson<PolicyRecord[]>("policies.json");

  // A hand-placed .txt in the raw directory overrides the downloaded page; here it stands in for a changed source.
  await writeFile(join(env.paths.rawDir, "ca-a-2025.txt"), `${words("changed", 300)}\n`);
  env.clock.now = new Date("2026-10-20T00:00:00.000Z");
  const calls = llms.total();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(llms.total() - calls, 2, "one enrich and one verify call, for the changed document only");
  const second = await env.readJson<PolicyRecord[]>("policies.json");
  const [a1, b1] = first;
  const [a2, b2] = second;
  assert.notEqual(a2!.sha256, a1!.sha256);
  assert.equal(a2!.fetched, "2026-10-20T00:00:00.000Z");
  assert.deepEqual(b2, b1, "the unchanged document is untouched");
  assert.equal(b2!.fetched, "2026-10-15T09:00:00.000Z");
});

test("a different model is a cache miss, and a verdict is reused only for the same enriched value and verifier", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb(siteFor("ca-a-2025"));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));

  // A new enrich model is asked again. It gave the same answer, so the verdict on that answer still stands.
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, models: { enrich: "other-enrich", verify: "verify-model" } }));
  assert.equal(llms.enrichCalls.length, 2);
  assert.equal(llms.verifyCalls.length, 1);

  // A new verify model is asked again, and the enrichment is not.
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, models: { enrich: "other-enrich", verify: "other-verify" } }));
  assert.equal(llms.enrichCalls.length, 2);
  assert.equal(llms.verifyCalls.length, 2);

  // A new enrich model that answers differently has its answer verified.
  let n = 0;
  const changing: Llm = (async (req: Req) => {
    const reply: any = await llms.llm.enrich(req);
    if (++n === 1) reply.summary.value += " (a different answer)";
    return reply;
  }) as Llm;
  await buildSnapshot(env.opts({ llm: { enrich: changing, verify: llms.llm.verify }, fetchImpl: web.impl, models: { enrich: "third-enrich", verify: "other-verify" } }));
  assert.equal(llms.verifyCalls.length, 3);
  assert.equal((await env.readJson<PolicyRecord[]>("policies.json"))[0]!.summary.value, "Summary of ca-a-2025. (a different answer)");
});

test("builtAt is kept while nothing else changes, and moves when the content does", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb(siteFor("ca-a-2025"));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  env.clock.now = new Date("2026-11-01T00:00:00.000Z");
  const same = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(same.builtAt, "2026-10-15T09:00:00.000Z");
  const changed = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, snapshotDate: "2026-11-01" }));
  assert.equal(changed.builtAt, "2026-11-01T00:00:00.000Z");
});

test("two candidates that share one source text each keep their own citations and both re-run from cache", async () => {
  const shared = "https://example.test/shared";
  const env = await makeEnv(candidatesMd(row("ca-a-2025", { url: shared }), row("ca-b-2025", { url: shared })));
  const web = fakeWeb({ [shared]: page("shared") });
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  const policies = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(policies.map((p) => p.summary.support), [["ca-a-2025#1"], ["ca-b-2025#1"]]);
  assert.equal(policies[0]!.sha256, policies[1]!.sha256);

  const calls = llms.total();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(llms.total() - calls, 0);
  assert.deepEqual(await env.readJson<PolicyRecord[]>("policies.json"), policies);
});

test("a failed enrichment is not cached, so the next run retries it", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb(siteFor("ca-a-2025"));
  const broken = fakeLlms({ enrichThrows: { "ca-a-2025": new Error("Groq API error 503: overloaded") } });
  const first = await buildSnapshot(env.opts({ llm: broken.llm, fetchImpl: web.impl }));
  assert.equal(first.counts.total, 0);
  const healthy = fakeLlms();
  const second = await buildSnapshot(env.opts({ llm: healthy.llm, fetchImpl: web.impl }));
  assert.equal(second.counts.total, 1);
  assert.equal(second.excluded.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// Human review

const reviewedEntry = (over: Partial<Record<string, string>> = {}) => ({
  id: GOOD_ID,
  reviewer: "Dana Reviewer",
  reviewedAt: "2026-10-16",
  sha256: sha256Hex(htmlToText(GOOD_PAGE)),
  ...over,
});

test("a reviewed.json entry whose sha256 matches makes the record human-reviewed", async () => {
  const env = await makeEnv();
  await writeFile(env.paths.reviewedPath, JSON.stringify([reviewedEntry()]));
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(record!.review, { state: "human-reviewed", reviewedAt: "2026-10-16", reviewer: "Dana Reviewer" });
  assert.deepEqual(checkSnapshot({ policies: await env.readJson("policies.json"), passages: await env.readJson("passages.json"), manifest: await env.readJson("manifest.json") }), []);
});

test("a reviewed.json entry with a stale sha256 leaves the record auto-checked", async () => {
  const env = await makeEnv();
  await writeFile(env.paths.reviewedPath, JSON.stringify([reviewedEntry({ sha256: "0".repeat(64) })]));
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(record!.review, { state: "auto-checked" });
});

test("a missing reviewed.json is fine, entries for unknown ids are ignored, and a datetime keeps its date", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  assert.equal((await env.readJson<PolicyRecord[]>("policies.json"))[0]!.review.state, "auto-checked");

  await writeFile(env.paths.reviewedPath, JSON.stringify([reviewedEntry({ id: "no-such-record" }), reviewedEntry({ reviewedAt: "2026-10-16T08:30:00Z" })]));
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json"))[0]!.review, {
    state: "human-reviewed",
    reviewedAt: "2026-10-16",
    reviewer: "Dana Reviewer",
  });
});

test("a malformed reviewed.json stops the build with a message naming the file", async () => {
  const env = await makeEnv();
  const run = () => buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  await writeFile(env.paths.reviewedPath, "{ not json");
  await assert.rejects(run(), /reviewed\.json/);
  await writeFile(env.paths.reviewedPath, JSON.stringify({ id: GOOD_ID }));
  await assert.rejects(run(), /reviewed\.json/);
  await writeFile(env.paths.reviewedPath, JSON.stringify([{ id: GOOD_ID, reviewer: "", reviewedAt: "yesterday", sha256: "x" }]));
  await assert.rejects(run(), /reviewed\.json/);
});

test("review.md lists only landmark records, with one unticked box each", async () => {
  const env = await makeEnv(
    candidatesMd(
      row("ca-landmark-one-2025", { landmark: "yes" }),
      row("ca-plain-one-2025"),
      row("sg-landmark-two-2025", { landmark: "yes", type: "guidance" }),
      row("sg-plain-two-2025"),
    ),
  );
  const web = fakeWeb(siteFor("ca-landmark-one-2025", "ca-plain-one-2025", "sg-landmark-two-2025", "sg-plain-two-2025"));
  await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl }));
  const md = await env.read("review.md");
  assert.ok(md.includes("ca-landmark-one-2025"));
  assert.ok(md.includes("sg-landmark-two-2025"));
  assert.ok(!md.includes("ca-plain-one-2025"));
  assert.ok(!md.includes("sg-plain-two-2025"));
  assert.equal(md.split("- [ ] reviewed").length - 1, 2);
});

test("an excluded landmark is not in review.md", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  const md = await env.read("review.md");
  assert.ok(md.includes(GOOD_ID));
  assert.ok(!md.includes("ca-ab-100-2024"), "a landmark that the checker rejected has no record to review");
  assert.equal(md.split("- [ ] reviewed").length - 1, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// R12: errors, today, and the enrich word limit

test("a thrown enrichment error excludes that record with a short, fixed reason and the build carries on", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025")));
  const llms = fakeLlms({ enrichThrows: { "ca-a-2025": new LlmError("Groq API error 413: Request too large for model", 413) } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025", "ca-b-2025")).impl }));
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), ["ca-b-2025"]);
  assert.equal(manifest.excluded.length, 1);
  assert.equal(manifest.excluded[0]!.id, "ca-a-2025");
  assert.equal(manifest.excluded[0]!.reason, "enrichment failed: HTTP 413");
});

test("a thrown verification error excludes that record too", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025")));
  const bad = new LlmError("Groq output for \"claim_verification\" was still invalid after one repair.");
  bad.kind = "invalid-output";
  const llms = fakeLlms({ verifyThrows: { "ca-b-2025": bad } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025", "ca-b-2025")).impl }));
  assert.deepEqual(manifest.excluded.map((e) => [e.id, e.reason]), [["ca-b-2025", "verification failed: invalid model output"]]);
});

test("a step that throws something other than an LlmError keeps the error's own message", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025")));
  const llms = fakeLlms({ enrichThrows: { "ca-a-2025": new Error("the summary is empty or has no valid citation") } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025", "ca-b-2025")).impl }));
  assert.equal(manifest.excluded[0]!.reason, "enrichment failed: the summary is empty or has no valid citation");
});

test("a multi-line or very long error message is folded into one short line", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const llms = fakeLlms({ enrichThrows: { "ca-a-2025": new Error(`first line\nsecond line ${"x".repeat(2000)}`) } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025")).impl }));
  const { reason } = manifest.excluded[0]!;
  assert.ok(!reason.includes("\n"));
  assert.ok(reason.includes("first line second line"));
  assert.ok(reason.length <= 400, `reason is ${reason.length} characters`);
});

test("an error that is not an Error object still becomes a reason", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const llm = { enrich: (async () => { throw "plain string failure"; }) as Llm, verify: fakeLlms().llm.verify };
  const manifest = await buildSnapshot(env.opts({ llm, fetchImpl: fakeWeb(siteFor("ca-a-2025")).impl }));
  assert.match(manifest.excluded[0]!.reason, /plain string failure/);
});

test("the snapshot date goes to both models as today's date", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025")).impl, snapshotDate: "2026-03-04" }));
  assert.ok(llms.enrichCalls[0]!.system.includes("Today is 2026-03-04"));
  assert.ok(llms.verifyCalls[0]!.system.includes("2026-03-04"));
});

test("enrichment sees only the first passages up to enrichMaxWords, but every passage is stored", async () => {
  const env = await makeEnv(candidatesMd(row("ca-long-2025")));
  const url = "https://example.test/ca-long-2025";
  const web = fakeWeb({ [url]: page("ca-long-2025", [300, 300, 300, 300, 300]) });
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, enrichMaxWords: 650 }));

  const sent = llms.enrichCalls[0]!.user;
  assert.ok(sent.includes("[ca-long-2025#1]"));
  assert.ok(sent.includes("[ca-long-2025#2]"));
  assert.ok(!sent.includes("[ca-long-2025#3]"), "600 words fit in 650, a third passage would not");
  const passages = await env.readJson<Passage[]>("passages.json");
  assert.deepEqual(passages.map((p) => p.seq), [1, 2, 3, 4, 5]);
});

test("enrichMaxWords defaults to 6000, and a limit smaller than one passage still sends the first passage", async () => {
  const env = await makeEnv(candidatesMd(row("ca-long-2025")));
  const url = "https://example.test/ca-long-2025";
  const web = fakeWeb({ [url]: page("ca-long-2025", [300, 300, 300, 300, 300]) });
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.ok(llms.enrichCalls[0]!.user.includes("[ca-long-2025#5]"), "1500 words are well under the default limit");

  const small = await makeEnv(candidatesMd(row("ca-long-2025")));
  const smallLlms = fakeLlms();
  await buildSnapshot(small.opts({ llm: smallLlms.llm, fetchImpl: web.impl, enrichMaxWords: 10 }));
  assert.ok(smallLlms.enrichCalls[0]!.user.includes("[ca-long-2025#1]"));
  assert.ok(!smallLlms.enrichCalls[0]!.user.includes("[ca-long-2025#2]"));
});

test("verification is sent only the passages that the claims cite", async () => {
  const env = await makeEnv(candidatesMd(row("ca-long-2025")));
  const url = "https://example.test/ca-long-2025";
  const web = fakeWeb({ [url]: page("ca-long-2025", [300, 300, 300]) });
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, enrichMaxWords: 400 }));
  const user = llms.verifyCalls[0]!.user;
  assert.ok(user.includes("[ca-long-2025#1]"), "the passage the claims cite is sent");
  assert.ok(user.includes("[ca-long-2025#2]"), "so is the second, which the identity claim cites with the first");
  assert.ok(!user.includes("[ca-long-2025#3]"), "an uncited passage is not");
});

// ---------------------------------------------------------------------------------------------------------------------
// R14: refuse to overwrite the snapshot when Groq calls fail wholesale

const SEEDED = {
  "policies.json": '[\n  "old policies"\n]\n',
  "passages.json": '[\n  "old passages"\n]\n',
  "manifest.json": '{\n  "old": "manifest"\n}\n',
  "review.md": "# old review\n",
};
/** Puts recognisable files in outDir, standing in for a good committed snapshot. */
async function seedOutputs(env: Awaited<ReturnType<typeof makeEnv>>) {
  await mkdir(env.paths.outDir, { recursive: true });
  for (const [name, content] of Object.entries(SEEDED)) await writeFile(join(env.paths.outDir, name), content);
  return { ...SEEDED };
}
const exists = (path: string) => stat(path).then(() => true, () => false);

const three = () => candidatesMd(row("ca-a-2025"), row("ca-b-2025"), row("ca-c-2025"));
const threeWeb = () => fakeWeb(siteFor("ca-a-2025", "ca-b-2025", "ca-c-2025"));
const unauthorised = (status = 401) => new LlmError(`Groq API error ${status}: Invalid API Key`, status);
const exhausted = () => new LlmError("Groq API error 429: Rate limit reached for model (retries exhausted)", 429);

test("R14: a 401 from Groq stops the build at once, names the cause and counts, and leaves the outputs untouched", async () => {
  const env = await makeEnv(three());
  const seeded = await seedOutputs(env);
  const llms = fakeLlms({ enrichThrows: { "ca-a-2025": unauthorised() } });
  await assert.rejects(buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl })), (e: unknown) => {
    assert.ok(e instanceof SnapshotGuardError);
    assert.equal(e.kind, "auth");
    assert.match(e.message, /HTTP 401/);
    assert.match(e.message, /ca-a-2025/);
    assert.match(e.message, /GROQ_API_KEY/);
    assert.match(e.message, /1 of 3 records/);
    assert.match(e.message, /nothing was written/i);
    return true;
  });
  assert.deepEqual(await snapshotOf(env), seeded, "the existing files are byte-for-byte what they were");
  assert.equal(llms.enrichCalls.length, 1, "no more calls are wasted once the key is known to be bad");
  assert.equal(await exists(join(env.paths.cacheDir, "built.json")), false);
});

test("R14: a 403 from Groq, or a 401 while verifying, is an auth failure too", async () => {
  for (const llmOpts of [
    { enrichThrows: { "ca-a-2025": unauthorised(403) } },
    { verifyThrows: { "ca-a-2025": unauthorised(401) } },
  ]) {
    const env = await makeEnv(three());
    const seeded = await seedOutputs(env);
    await assert.rejects(
      buildSnapshot(env.opts({ llm: fakeLlms(llmOpts).llm, fetchImpl: threeWeb().impl })),
      (e: unknown) => e instanceof SnapshotGuardError && e.kind === "auth" && /HTTP 40[13]/.test(e.message),
    );
    assert.deepEqual(await snapshotOf(env), seeded);
  }
});

test("R14: work finished before the failure stays cached, so a rerun after fixing the key resumes cheaply", async () => {
  const env = await makeEnv(three());
  const web = threeWeb();
  const broken = fakeLlms({ enrichThrows: { "ca-b-2025": unauthorised() } });
  await assert.rejects(buildSnapshot(env.opts({ llm: broken.llm, fetchImpl: web.impl })), SnapshotGuardError);
  const shaA = sha256Hex(htmlToText(page("ca-a-2025")));
  assert.ok(await exists(join(env.paths.cacheDir, "enrich", `${shaA}.json`)), "the first record's enrichment was kept");
  assert.ok(await exists(join(env.paths.cacheDir, "verify", `${shaA}.json`)), "and its verdict");
  assert.equal(await exists(env.paths.outDir), false, "nothing was written to outDir");

  const healthy = fakeLlms();
  const manifest = await buildSnapshot(env.opts({ llm: healthy.llm, fetchImpl: web.impl }));
  assert.equal(manifest.counts.total, 3);
  assert.equal(healthy.enrichCalls.length, 2, "only the two records that were not finished");
  assert.equal(healthy.verifyCalls.length, 2);
});

test("R14: when most records fail with a 429 that outlasted its retries, the build refuses to write", async () => {
  const env = await makeEnv(three());
  const seeded = await seedOutputs(env);
  const llms = fakeLlms({ enrichThrows: { "ca-a-2025": exhausted(), "ca-b-2025": exhausted() } });
  await assert.rejects(buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl })), (e: unknown) => {
    assert.ok(e instanceof SnapshotGuardError);
    assert.equal(e.kind, "llm-failures");
    assert.match(e.message, /2 of the 3 records/);
    assert.match(e.message, /more than half/i);
    assert.match(e.message, /429/, "the first error is quoted");
    assert.match(e.message, /nothing was written/i);
    return true;
  });
  assert.deepEqual(await snapshotOf(env), seeded);
  assert.ok(await exists(join(env.paths.cacheDir, "enrich", `${sha256Hex(htmlToText(page("ca-c-2025")))}.json`)), "the record that did finish is cached");
});

test("R14: one LLM error in three is just an excluded record", async () => {
  const env = await makeEnv(three());
  const llms = fakeLlms({ enrichThrows: { "ca-b-2025": exhausted() } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl }));
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), ["ca-a-2025", "ca-c-2025"]);
  assert.deepEqual(manifest.excluded.map((e) => e.id), ["ca-b-2025"]);
  assert.match(manifest.excluded[0]!.reason, /429/);
});

test("R14: exactly half is not more than half", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025"), row("ca-c-2025"), row("ca-d-2025")));
  const llms = fakeLlms({ enrichThrows: { "ca-a-2025": exhausted() }, verifyThrows: { "ca-b-2025": new LlmError("Groq API error 503: overloaded", 503) } });
  const web = fakeWeb(siteFor("ca-a-2025", "ca-b-2025", "ca-c-2025", "ca-d-2025"));
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.deepEqual(manifest.excluded.map((e) => e.id), ["ca-a-2025", "ca-b-2025"]);
});

test("R14: records that fail to fetch do not count toward the threshold", async () => {
  const env = await makeEnv(three());
  const web = fakeWeb({ ...siteFor("ca-c-2025"), "https://example.test/ca-a-2025": 403, "https://example.test/ca-b-2025": 403 });
  const manifest = await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl }));
  assert.deepEqual(manifest.excluded.map((e) => [e.id, e.reason]), [["ca-a-2025", "HTTP 403"], ["ca-b-2025", "HTTP 403"]]);
  assert.equal(manifest.counts.total, 1);
});

test("R14: records with too little text, and verification fatals, do not count either", async () => {
  const thin = "<html><body><p>Please log in.</p></body></html>";
  const env = await makeEnv(three());
  const web = fakeWeb({ ...siteFor("ca-b-2025", "ca-c-2025"), "https://example.test/ca-a-2025": thin });
  const llms = fakeLlms({ unsupported: { "ca-b-2025": ["summary"], "ca-c-2025": ["status"] } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.deepEqual(manifest.excluded.map((e) => e.reason), ["too little text", "summary unsupported", "status unsupported"]);
  assert.equal(manifest.counts.total, 0, "an empty but legitimate snapshot is still written");
});

test("R14: a plain Error from the enrichment step (a bad answer, not a failed call) is not an LLM error", async () => {
  const env = await makeEnv(three());
  const llms = fakeLlms({ enrichThrows: { "ca-a-2025": new Error("the status has no valid citation"), "ca-b-2025": new Error("the summary is empty or has no valid citation") } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl }));
  assert.deepEqual(manifest.excluded.map((e) => e.id), ["ca-a-2025", "ca-b-2025"]);
});

test("R14: records served from the cache count as having reached enrichment", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025")));
  const web = threeWeb();
  await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl }));
  // A third record is added and its call fails: 1 failure among 3 records that reached enrichment, not 1 of 1.
  await writeFile(env.paths.candidatesPath, three());
  const llms = fakeLlms({ enrichThrows: { "ca-c-2025": exhausted() } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(manifest.counts.total, 2);
  assert.deepEqual(manifest.excluded.map((e) => e.id), ["ca-c-2025"]);
});

test("R14: a failed rerun leaves the files of the last good run exactly as they were", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  const good = await snapshotOf(env);
  const failing = fakeLlms({ enrichThrows: { [GOOD_ID]: exhausted(), "ca-ab-100-2024": exhausted() } });
  await assert.rejects(
    buildSnapshot(env.opts({ llm: failing.llm, fetchImpl: fixtureWeb().impl, models: { enrich: "new-model", verify: "verify-model" } })),
    SnapshotGuardError,
  );
  assert.deepEqual(await snapshotOf(env), good);
});

test("R14: the command exits non-zero with the reason when the guard trips, and the outputs stay as they were", async () => {
  const dir = await mkdtemp(join(root, "cli-"));
  const dataDir = join(dir, "photon/data/snapshot");
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "candidates.md"), three());
  for (const [name, content] of Object.entries(SEEDED)) await writeFile(join(dataDir, name), content);
  const llms = fakeLlms({ enrichThrows: { "ca-a-2025": unauthorised() } });
  const io = sink();
  const code = await main([], {
    env: { GROQ_API_KEY: "k" },
    root: dir,
    run: (options) => runBuild({ ...options, llm: llms.llm, fetchImpl: threeWeb().impl, gebiz: false }),
    ...io,
  });
  assert.equal(code, 1);
  assert.match(io.logged.err.join("\n"), /HTTP 401/);
  assert.match(io.logged.err.join("\n"), /nothing was written/i);
  for (const [name, content] of Object.entries(SEEDED)) assert.equal(await readFile(join(dataDir, name), "utf8"), content, name);
});

// ---------------------------------------------------------------------------------------------------------------------
// R15: the snapshot date is part of the cache key

test("R15: the same snapshot date re-runs with no LLM calls and byte-identical files", async () => {
  const env = await makeEnv(three());
  const web = threeWeb();
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, snapshotDate: "2026-11-20" }));
  const first = await snapshotOf(env);
  const calls = llms.total();
  env.clock.now = new Date("2026-12-01T00:00:00.000Z");
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, snapshotDate: "2026-11-20" }));
  assert.equal(llms.total() - calls, 0);
  assert.deepEqual(await snapshotOf(env), first);
});

test("R15: a later snapshot date asks enrich and verify again for every record, so a status that has since taken effect is re-judged", async () => {
  const env = await makeEnv(three());
  const web = threeWeb();
  const llms = fakeLlms();
  // The enricher calls an instrument "enacted" before 2026-11-01 and "in-force" after, as the real prompt asks it to.
  const byDate: Llm = (async (req: Req) => {
    const reply: any = await llms.llm.enrich(req);
    if (req.system.includes("Today is 2026-11-20")) reply.status.value = "in-force";
    return reply;
  }) as Llm;
  const llm = { enrich: byDate, verify: llms.llm.verify };

  await buildSnapshot(env.opts({ llm, fetchImpl: web.impl, snapshotDate: "2026-10-15" }));
  assert.ok((await env.readJson<PolicyRecord[]>("policies.json")).every((p) => p.status.value === "enacted"));
  assert.equal(llms.enrichCalls.length, 3);
  assert.equal(llms.verifyCalls.length, 3);

  const manifest = await buildSnapshot(env.opts({ llm, fetchImpl: web.impl, snapshotDate: "2026-11-20" }));
  assert.equal(llms.enrichCalls.length, 6, "enrich ran again for all three");
  assert.equal(llms.verifyCalls.length, 6, "and so did verify");
  assert.equal(manifest.snapshotDate, "2026-11-20");
  assert.ok((await env.readJson<PolicyRecord[]>("policies.json")).every((p) => p.status.value === "in-force"));
  assert.ok(llms.verifyCalls.slice(3).every((c) => c.system.includes("2026-11-20")));

  // Going back to an earlier date is also a new question: the cache holds the answer for the date it was asked on.
  await buildSnapshot(env.opts({ llm, fetchImpl: web.impl, snapshotDate: "2026-10-15" }));
  assert.equal(llms.enrichCalls.length, 9);
});

test("R15: a verdict is not reused for a different date even when the enrichment came out the same", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb(siteFor("ca-a-2025"));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, snapshotDate: "2026-10-15" }));
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, snapshotDate: "2026-10-16" }));
  assert.equal(llms.enrichCalls.length, 2);
  assert.equal(llms.verifyCalls.length, 2);
});

// ---------------------------------------------------------------------------------------------------------------------
// R17: the committed exclusion reasons never carry provider text

const RAW_429 = "Groq API error 429: Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01hxyzsecret` service tier `on_demand`";

test("R17: a 429 LlmError is recorded as exactly 'enrichment failed: HTTP 429', with no provider text in any output", async () => {
  const env = await makeEnv(three());
  const llms = fakeLlms({ enrichThrows: { "ca-b-2025": new LlmError(RAW_429, 429) } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl }));
  assert.deepEqual(manifest.excluded.map((e) => [e.id, e.reason]), [["ca-b-2025", "enrichment failed: HTTP 429"]]);
  for (const name of OUTPUTS) assert.ok(!(await env.read(name)).includes("org_01hxyzsecret"), name);
});

test("R17: the reason is one of a few fixed phrases, whatever the provider said", async () => {
  const cases: Array<{ stage: "enrich" | "verify"; error: LlmError; reason: string }> = [];
  const make = (message: string, status?: number, kind?: LlmError["kind"]) => {
    const e = new LlmError(message, status);
    if (kind) e.kind = kind;
    return e;
  };
  cases.push(
    { stage: "enrich", error: make(RAW_429, 429), reason: "enrichment failed: HTTP 429" },
    { stage: "verify", error: make("Groq API error 503: org_01hxyzsecret overloaded", 503), reason: "verification failed: HTTP 503" },
    { stage: "enrich", error: make("Groq request failed: timed out after 60000ms", undefined, "timeout"), reason: "enrichment failed: timed out" },
    { stage: "verify", error: make("Groq request failed: timed out after 60000ms", undefined, "timeout"), reason: "verification failed: timed out" },
    { stage: "enrich", error: make("Groq request failed: getaddrinfo ENOTFOUND api.groq.com", undefined, "network"), reason: "enrichment failed: unreachable" },
    { stage: "verify", error: make("Groq request failed: connect ECONNREFUSED 127.0.0.1:443", undefined, "network"), reason: "verification failed: unreachable" },
    { stage: "enrich", error: make('Groq output for "policy_enrichment" was still invalid after one repair. {"x": "org_01hxyzsecret"}', undefined, "invalid-output"), reason: "enrichment failed: invalid model output" },
    { stage: "verify", error: make("Groq output for \"claim_verification\" was still invalid after one repair.", undefined, "invalid-output"), reason: "verification failed: invalid model output" },
  );
  for (const { stage, error, reason } of cases) {
    const env = await makeEnv(three());
    const llms = fakeLlms(stage === "enrich" ? { enrichThrows: { "ca-b-2025": error } } : { verifyThrows: { "ca-b-2025": error } });
    const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl }));
    assert.equal(manifest.excluded[0]!.reason, reason);
    assert.ok(!(await env.read("manifest.json")).includes("org_01hxyzsecret"));
  }
});

test("R17: the console log keeps the full raw message", async () => {
  const env = await makeEnv(three());
  const llms = fakeLlms({ enrichThrows: { "ca-b-2025": new LlmError(RAW_429, 429) } });
  const lines: string[] = [];
  const { manifest } = await runBuild(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl, log: (line) => void lines.push(line) }));
  const line = lines.find((l) => l.includes("ca-b-2025"))!;
  assert.ok(line.includes("enrichment failed: HTTP 429"));
  assert.ok(line.includes(RAW_429), "the raw provider message is in the console line");
  assert.ok(!manifest.excluded[0]!.reason.includes("org_01hxyzsecret"));
});

test("R17: when most records fail with HTTP 413 the guard message says to lower ENRICH_MAX_WORDS", async () => {
  const env = await makeEnv(three());
  const tooLarge = () => new LlmError("Groq API error 413: Request too large for model (TPM limit 8000)", 413);
  const llms = fakeLlms({ enrichThrows: { "ca-a-2025": tooLarge(), "ca-b-2025": tooLarge() } });
  await assert.rejects(buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl })), (e: unknown) => {
    assert.ok(e instanceof SnapshotGuardError);
    assert.equal(e.kind, "llm-failures");
    assert.match(e.message, /lower ENRICH_MAX_WORDS/);
    return true;
  });
});

test("R17: other Groq failures do not get the ENRICH_MAX_WORDS hint", async () => {
  const env = await makeEnv(three());
  const llms = fakeLlms({ enrichThrows: { "ca-a-2025": exhausted(), "ca-b-2025": exhausted() } });
  await assert.rejects(buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl })), (e: unknown) => {
    assert.ok(e instanceof SnapshotGuardError);
    assert.doesNotMatch(e.message, /ENRICH_MAX_WORDS/);
    return true;
  });
  const ok = await makeEnv(three());
  const result = await runBuild(ok.opts({ llm: fakeLlms({ enrichThrows: { "ca-a-2025": exhausted() } }).llm, fetchImpl: threeWeb().impl }));
  assert.doesNotMatch(formatSummary(result), /ENRICH_MAX_WORDS/);
});

test("R17: the summary says to lower ENRICH_MAX_WORDS when any record failed with HTTP 413", async () => {
  const env = await makeEnv(three());
  const llms = fakeLlms({ enrichThrows: { "ca-c-2025": new LlmError("Groq API error 413: Request too large", 413) } });
  const result = await runBuild(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl }));
  assert.equal(result.manifest.excluded[0]!.reason, "enrichment failed: HTTP 413");
  const text = formatSummary(result);
  assert.match(text, /lower ENRICH_MAX_WORDS/);
  assert.match(text, /ca-c-2025 \(US-CA\): enrichment failed: HTTP 413/);
});

// ---------------------------------------------------------------------------------------------------------------------
// I2: the fetched document must be the one the title names

const IDENTITY_REASON = "source does not match the listed document";

test("I2: a document whose identity the checker does not support is excluded with the fixed reason", async () => {
  const env = await makeEnv(three());
  const llms = fakeLlms({ unsupported: { "ca-b-2025": ["identity"] } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl }));
  assert.deepEqual(manifest.excluded.map((e) => [e.id, e.reason]), [["ca-b-2025", IDENTITY_REASON]]);
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), ["ca-a-2025", "ca-c-2025"]);
});

test("I2: an identity the checker leaves out of its answer excludes the record too", async () => {
  const env = await makeEnv(three());
  const llms = fakeLlms({ omit: { "ca-c-2025": ["identity"] } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: threeWeb().impl }));
  assert.deepEqual(manifest.excluded.map((e) => [e.id, e.reason]), [["ca-c-2025", IDENTITY_REASON]]);
});

test("I2: the identity claim names the candidate's title and rides in the one verify call", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025", { title: "The Example Act 2025" })));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025")).impl }));
  assert.equal(llms.verifyCalls.length, 1);
  assert.ok(llms.verifyCalls[0]!.user.includes('CLAIM identity: These passages are from the document named "The Example Act 2025"'));
});

test("I2: a verdict is cached with the title it was given, so a changed title is checked again (without enriching again)", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025", { title: "The Example Act 2025" })));
  const web = fakeWeb(siteFor("ca-a-2025"));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(llms.total(), 2, "the same title re-runs from the cache");

  await writeFile(env.paths.candidatesPath, candidatesMd(row("ca-a-2025", { title: "A Different Act 2025" })));
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(llms.enrichCalls.length, 1);
  assert.equal(llms.verifyCalls.length, 2);
});

test("I2: a GeBIZ tender, whose text is the row its title came from, gets no identity claim", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: gebizWeb(siteFor("ca-a-2025")).impl, gebiz: true, gebizRule: gebizRule({ max: 1 }) }));
  const tender = llms.verifyCalls.find((c) => c.user.includes("sg-gebiz-"))!;
  const listed = llms.verifyCalls.find((c) => c.user.includes("[ca-a-2025#"))!;
  assert.ok(!tender.user.includes("CLAIM identity"));
  assert.ok(listed.user.includes("CLAIM identity"));
});

// ---------------------------------------------------------------------------------------------------------------------
// I3: `published` is kept only when it is cited and the checker supports it

test("I3: a supported published date is kept on the record as a plain date", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025")).impl }));
  assert.ok(llms.verifyCalls[0]!.user.includes("CLAIM published: The document was published, issued or enacted on 2025-09-29."));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.equal(record!.published, "2025-09-29");
});

test("I3: an unsupported published date is dropped, and the record is still built", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const llms = fakeLlms({ unsupported: { "ca-a-2025": ["published"] } });
  const { manifest, stats } = await runBuild(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025")).impl }));
  assert.equal(manifest.counts.total, 1);
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.equal("published" in record!, false);
  assert.deepEqual(stats[0]!.dropped, ["published"]);
});

test("I3: a published date with no support is dropped before verification, so it is never checked", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025")));
  const llms = fakeLlms({ published: { "ca-a-2025": { value: "2025-09-29", support: [] }, "ca-b-2025": null } });
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025", "ca-b-2025")).impl }));
  assert.ok(llms.verifyCalls.every((c) => !c.user.includes("CLAIM published")));
  for (const record of await env.readJson<PolicyRecord[]>("policies.json")) assert.equal("published" in record, false, record.id);
});

test("I3: a record with no published date does not enter the latest ordering or lastActivity", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  await buildSnapshot(env.opts({ llm: fakeLlms({ published: { "ca-a-2025": null } }).llm, fetchImpl: fakeWeb(siteFor("ca-a-2025")).impl }));
  assert.deepEqual(checkSnapshot({ policies: await env.readJson("policies.json"), passages: await env.readJson("passages.json"), manifest: await env.readJson("manifest.json") }), []);
});

// ---------------------------------------------------------------------------------------------------------------------
// M5: the pipeline version is part of the model caches

test("M5: cached enrich and verify answers carry the pipeline version, and an answer from another version is a miss", async () => {
  assert.equal(PIPELINE_VERSION, 2);
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb(siteFor("ca-a-2025"));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  const sha = sha256Hex(htmlToText(page("ca-a-2025")));
  const enrichFile = join(env.paths.cacheDir, "enrich", `${sha}.json`);
  const verifyFile = join(env.paths.cacheDir, "verify", `${sha}.json`);
  const entry = async (file: string) => JSON.parse(await readFile(file, "utf8"))["ca-a-2025"];
  assert.equal((await entry(enrichFile)).pipelineVersion, PIPELINE_VERSION);
  assert.equal((await entry(verifyFile)).pipelineVersion, PIPELINE_VERSION);

  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(llms.total(), 2, "the same version is a hit");

  const stale = async (file: string) => {
    const all = JSON.parse(await readFile(file, "utf8"));
    all["ca-a-2025"].pipelineVersion = PIPELINE_VERSION - 1;
    await writeFile(file, JSON.stringify(all));
  };
  await stale(verifyFile);
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(llms.enrichCalls.length, 1, "an old verdict is asked again");
  assert.equal(llms.verifyCalls.length, 2);

  await stale(enrichFile);
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(llms.enrichCalls.length, 2, "an old enrichment is asked again");
});

test("M5: an entry with no pipeline version (written before it existed) is a miss", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb(siteFor("ca-a-2025"));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  const sha = sha256Hex(htmlToText(page("ca-a-2025")));
  for (const dir of ["enrich", "verify"]) {
    const file = join(env.paths.cacheDir, dir, `${sha}.json`);
    const all = JSON.parse(await readFile(file, "utf8"));
    delete all["ca-a-2025"].pipelineVersion;
    await writeFile(file, JSON.stringify(all));
  }
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(llms.total(), 4);
});

// ---------------------------------------------------------------------------------------------------------------------
// Output order, related records, and unreadable inputs

test("outputs are sorted by id, passages by record then sequence, whatever order the candidates come in", async () => {
  const env = await makeEnv(candidatesMd(row("sg-zeta-2025"), row("ca-beta-2025", { url: "https://example.test/ca-beta-2025" }), row("ca-alpha-2025")));
  const web = fakeWeb({
    ...siteFor("sg-zeta-2025", "ca-alpha-2025"),
    "https://example.test/ca-beta-2025": page("ca-beta-2025", Array(12).fill(300)), // twelve passages: "#10" must follow "#9"
  });
  const manifest = await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl }));
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), ["ca-alpha-2025", "ca-beta-2025", "sg-zeta-2025"]);
  const passages = await env.readJson<Passage[]>("passages.json");
  assert.deepEqual(
    passages.map((p) => `${p.recordId}#${p.seq}`),
    [...passages].sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : a.seq - b.seq)).map((p) => `${p.recordId}#${p.seq}`),
  );
  assert.deepEqual(passages.filter((p) => p.recordId === "ca-beta-2025").map((p) => p.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(manifest.counts.total, 3);
});

test("excluded rows are sorted by id", async () => {
  const env = await makeEnv(candidatesMd(row("sg-b-2025"), row("ca-z-2025"), row("ca-a-2025")));
  const manifest = await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: fakeWeb({}).impl }));
  assert.deepEqual(manifest.excluded.map((e) => e.id), ["ca-a-2025", "ca-z-2025", "sg-b-2025"]);
  assert.ok(manifest.excluded.every((e) => e.reason === "HTTP 404"));
});

test("related links keep records that were built and drop those that were excluded or unknown", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025"), row("ca-c-2025")));
  const llms = fakeLlms({
    unsupported: { "ca-c-2025": ["summary"] },
    related: {
      "ca-a-2025": [
        { id: "ca-b-2025", relation: "amends" },
        { id: "ca-c-2025", relation: "responds-to" }, // listed in the candidates, but excluded later
      ],
    },
  });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025", "ca-b-2025", "ca-c-2025")).impl }));
  const [a] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(a!.related, [{ id: "ca-b-2025", relation: "amends" }]);
  assert.deepEqual(manifest.excluded.map((e) => e.id), ["ca-c-2025"]);
  assert.deepEqual(checkSnapshot({ policies: await env.readJson("policies.json"), passages: await env.readJson("passages.json"), manifest }), []);
});

test("enrichment is told every other included candidate id as a possible related record", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025"), row("ca-off-2025", { include: "no" })));
  const llms = fakeLlms();
  await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: fakeWeb(siteFor("ca-a-2025", "ca-b-2025")).impl }));
  const forA = llms.enrichCalls.find((c) => c.user.includes("Id: ca-a-2025"))!.user;
  assert.ok(forA.includes("- ca-b-2025"));
  assert.ok(!forA.includes("- ca-a-2025"), "a record is not offered itself");
  assert.ok(!forA.includes("ca-off-2025"), "a row set to include=no is not part of the dataset");
});

test("a candidate with include=no is neither built nor excluded", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-off-2025", { include: "no" })));
  const web = fakeWeb(siteFor("ca-a-2025", "ca-off-2025"));
  const manifest = await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl }));
  assert.equal(manifest.counts.total, 1);
  assert.deepEqual(manifest.excluded, []);
  assert.ok(!web.calls.some((u) => u.includes("ca-off-2025")), "an owner-dropped row is never fetched");
});

test("a source with too little text is excluded with the loader's reason", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb({ "https://example.test/ca-a-2025": "<html><body><p>Please log in.</p></body></html>" });
  const llms = fakeLlms();
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl }));
  assert.equal(manifest.excluded[0]!.reason, "too little text");
  assert.equal(llms.total(), 0);
});

test("a bad candidates.md stops the build instead of dropping rows", async () => {
  const env = await makeEnv(candidatesMd("| yes | not a slug | T | bill | ai-governance | s | no | https://example.test/x | seen | w |"));
  await assert.rejects(buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: fakeWeb({}).impl })), /candidates\.md/);
});

test("unusable options stop the build before any fetch or model call", async () => {
  const env = await makeEnv();
  const llms = fixtureLlms();
  const web = fixtureWeb();
  const run = (over: Partial<BuildOptions>) => buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, ...over }));
  await assert.rejects(run({ snapshotDate: "soon" }), /snapshotDate/);
  await assert.rejects(run({ snapshotDate: "2026-02-30" }), /snapshotDate/);
  await assert.rejects(run({ models: { enrich: " ", verify: "v" } }), /model/i);
  await assert.rejects(run({ enrichMaxWords: 0 }), /enrichMaxWords/);
  assert.equal(web.calls.length + llms.total(), 0);
  await assert.rejects(readdir(env.paths.outDir), { code: "ENOENT" }, "nothing was written");
});

test("with no candidates the outputs are empty but valid", async () => {
  const env = await makeEnv(candidatesMd());
  const manifest = await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: fakeWeb({}).impl }));
  assert.equal(manifest.counts.total, 0);
  assert.deepEqual(await env.readJson("policies.json"), []);
  assert.deepEqual(checkSnapshot({ policies: [], passages: [], manifest }), []);
  assert.match(await env.read("review.md"), /no landmark/i);
});

test("the build leaves no temporary files behind", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ llm: fixtureLlms().llm, fetchImpl: fixtureWeb().impl }));
  assert.deepEqual((await readdir(env.paths.outDir)).sort(), [...OUTPUTS].sort());
});

// ---------------------------------------------------------------------------------------------------------------------
// R11: GeBIZ tenders

// The fixture has three awarded tenders: ACR000ETT21000003 (S$108.6M), ACR000ETT21000004 (S$4.5M), ACR000ETT21000001 (S$2.3M).
const gebizRule = (over: Partial<GebizRule> = {}): GebizRule => ({
  datasetId: "d_test_dataset",
  keywords: ["analytics", "\\bcloud\\b", "registry"],
  since: "2021-01-01",
  minAwardSgd: 1_000_000,
  ...over,
});
const TENDER_IDS = ["sg-gebiz-acr000ett21000003", "sg-gebiz-acr000ett21000004", "sg-gebiz-acr000ett21000001"];
const gebizWeb = (extra: Record<string, string | number> = {}) => {
  const base = fakeWeb(extra);
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://data.gov.sg/api/action/datastore_search")) {
      urls.push(url);
      return new Response(GEBIZ_FIXTURE, { status: 200, headers: { "content-type": "application/json" } });
    }
    return base.impl(input, init);
  }) as typeof fetch;
  return { impl, urls, calls: base.calls };
};

test("GeBIZ tenders are built with no minimum word count, and are redistributable under the open data licence", async () => {
  const env = await makeEnv(candidatesMd());
  const web = gebizWeb();
  const llms = fakeLlms({ issuer: "Government Technology Agency" });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule() }));
  const policies = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(policies.map((p) => p.id), [...TENDER_IDS].sort());
  assert.equal(manifest.counts.byType.tender, 3);
  assert.equal(manifest.counts.byJurisdiction.SG, 3);
  const [tender] = policies;
  assert.equal(tender!.type, "tender");
  assert.equal(tender!.landmark, false);
  assert.equal(tender!.redistributionOk, true);
  assert.match(tender!.attribution, /Singapore Open Data Licence/);
  assert.match(tender!.url, /^https:\/\/data\.gov\.sg\/datasets\/d_test_dataset\/view#/);
  // The tender text is the structured description, so the passages are short, far below the 150-word gate.
  const passages = await env.readJson<Passage[]>("passages.json");
  assert.ok(passages.every((p) => p.text.split(/\s+/).length < 150));
  assert.match(passages.find((p) => p.recordId === "sg-gebiz-acr000ett21000003")!.text, /Tender number: ACR000ETT21000003/);
  assert.deepEqual(checkSnapshot({ policies, passages, manifest }), []);
});

test("at most rule.max tenders are kept, taking the largest awards first", async () => {
  const env = await makeEnv(candidatesMd());
  const llms = fakeLlms();
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: gebizWeb().impl, gebiz: true, gebizRule: gebizRule({ max: 2 }) }));
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), [TENDER_IDS[0], TENDER_IDS[1]]);
  assert.equal(manifest.counts.total, 2);
  assert.equal(llms.enrichCalls.length, 2);
});

test("without rule.max the cap is 40", async () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({
    _id: i + 1,
    tender_no: `ZZZ000ETT24${String(i).padStart(6, "0")}`,
    tender_description: `Managed cloud services lot ${i}`,
    agency: "Some Agency",
    award_date: "1/2/2024",
    tender_detail_status: "Awarded to Suppliers",
    supplier_name: "ACME PTE LTD",
    awarded_amt: String(10_000_000 - i),
  }));
  const fetchImpl = (async () => new Response(JSON.stringify({ success: true, result: { records: rows, total: rows.length } }), { status: 200 })) as typeof fetch;
  const env = await makeEnv(candidatesMd());
  const manifest = await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl, gebiz: true, gebizRule: gebizRule() }));
  assert.equal(manifest.counts.total, 40);
  const ids = (await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id);
  assert.ok(ids.includes("sg-gebiz-zzz000ett24000000"), "the largest award is kept");
  assert.ok(!ids.includes("sg-gebiz-zzz000ett24000044"), "the smallest award is not");
});

test("the tender texts are cached in rawDir/gebiz-tenders.json, so a re-run never asks data.gov.sg again and is byte-identical", async () => {
  const env = await makeEnv(candidatesMd());
  const llms = fakeLlms();
  const web = gebizWeb();
  const options = () => env.opts({ llm: llms.llm, fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule({ max: 2 }) });
  await buildSnapshot(options());
  assert.equal(web.urls.length, 1);
  const cached = JSON.parse(await readFile(join(env.paths.rawDir, "gebiz-tenders.json"), "utf8")) as {
    fingerprint: string;
    tenders: { candidate: { id: string }; text: string }[];
  };
  assert.match(cached.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(cached.tenders.map((t) => t.candidate.id), TENDER_IDS, "the cache holds every matched tender, not just the ones kept");
  assert.ok(cached.tenders.every((t) => t.text.includes("Tender number:")));
  const first = await snapshotOf(env);
  assert.equal(JSON.parse(await env.read("manifest.json")).counts.byType.tender, 2);

  const calls = llms.total();
  const offline = (async () => { throw new Error("the network is down"); }) as typeof fetch;
  env.clock.now = new Date("2027-01-01T00:00:00.000Z");
  await buildSnapshot({ ...options(), fetchImpl: offline });
  assert.equal(web.urls.length, 1, "no second request to data.gov.sg");
  assert.equal(llms.total() - calls, 0);
  assert.deepEqual(await snapshotOf(env), first);
});

test("R16: a changed keyword list fetches the tenders again", async () => {
  const env = await makeEnv(candidatesMd());
  const llms = fakeLlms();
  const web = gebizWeb();
  const build = (rule: GebizRule) => buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, gebiz: true, gebizRule: rule }));
  const first = await build(gebizRule({ keywords: ["analytics"] }));
  assert.equal(first.counts.total, 1);
  assert.equal(web.urls.length, 1);

  const second = await build(gebizRule({ keywords: ["analytics", "\\bcloud\\b"] }));
  assert.equal(web.urls.length, 2, "the cache was for a different rule");
  assert.equal(second.counts.total, 2);

  await build(gebizRule({ keywords: ["\\bcloud\\b", "analytics"] }));
  assert.equal(web.urls.length, 2, "the same keywords in another order are the same rule");
});

test("R16: a changed since, minimum award or dataset id fetches the tenders again, and an empty list is not frozen", async () => {
  const env = await makeEnv(candidatesMd());
  const llms = fakeLlms();
  const web = gebizWeb();
  const build = (rule: GebizRule) => buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, gebiz: true, gebizRule: rule }));
  assert.equal((await build(gebizRule({ minAwardSgd: 1_000_000_000 }))).counts.total, 0);
  assert.equal(web.urls.length, 1);
  assert.equal((await build(gebizRule({ minAwardSgd: 1_000_000_000 }))).counts.total, 0);
  assert.equal(web.urls.length, 1, "the same rule reads its (empty) result from the cache");

  assert.equal((await build(gebizRule({ minAwardSgd: 1_000_000 }))).counts.total, 3);
  assert.equal(web.urls.length, 2, "a lower minimum award");
  assert.equal((await build(gebizRule({ since: "2022-01-01" }))).counts.total, 2, "a later since drops the one tender awarded in 2021");
  assert.equal(web.urls.length, 3);
  await build(gebizRule({ since: "2022-01-01", datasetId: "d_other_dataset" }));
  assert.equal(web.urls.length, 4, "another dataset");
  assert.match(web.urls[3]!, /resource_id=d_other_dataset/);
});

test("R16: raising or lowering max reads the full cached list without asking data.gov.sg again", async () => {
  const env = await makeEnv(candidatesMd());
  const llms = fakeLlms();
  const web = gebizWeb();
  const build = (max: number) => buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule({ max }) }));
  assert.deepEqual((await build(1)).counts.total, 1);
  assert.equal(web.urls.length, 1);
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), [TENDER_IDS[0]]);

  assert.equal((await build(3)).counts.total, 3, "a higher max is honoured from the cache");
  assert.equal(web.urls.length, 1, "no refetch");
  assert.equal((await build(2)).counts.total, 2);
  assert.equal(web.urls.length, 1);
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), [TENDER_IDS[0], TENDER_IDS[1]].sort());
});

test("I1: a changed exclude list fetches the tenders again, in any order of the same patterns", async () => {
  const env = await makeEnv(candidatesMd());
  const llms = fakeLlms();
  const web = gebizWeb();
  const build = (rule: GebizRule) => buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, gebiz: true, gebizRule: rule }));
  assert.equal((await build(gebizRule())).counts.total, 3);
  assert.equal(web.urls.length, 1);

  assert.equal((await build(gebizRule({ exclude: ["registry"] }))).counts.total, 2, "the exclude list drops the registry tender");
  assert.equal(web.urls.length, 2, "the cache was for a rule with no exclusions");
  await build(gebizRule({ exclude: ["registry"] }));
  assert.equal(web.urls.length, 2, "the same exclusions read the cache");

  await build(gebizRule({ exclude: ["registry", "analytics"] }));
  assert.equal(web.urls.length, 3);
  await build(gebizRule({ exclude: ["analytics", "registry"] }));
  assert.equal(web.urls.length, 3, "the same patterns in another order are the same rule");
});

test("I1: a rule with groups caches every match and applies the quotas to the cached list, so a new quota needs no new request", async () => {
  const env = await makeEnv(candidatesMd());
  const llms = fakeLlms();
  const web = gebizWeb();
  const groups = (cloudQuota: number): GebizRule["groups"] => [
    { name: "cloud", keywords: ["cloud", "registry"], quota: cloudQuota, topic: "data-centres" },
    { name: "ai", keywords: ["analytics"], quota: 1, topic: "ai-governance" },
  ];
  const build = (cloudQuota: number) =>
    buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule({ keywords: undefined, groups: groups(cloudQuota) }) }));

  assert.equal((await build(1)).counts.total, 2, "the cloud group takes only its largest tender (the registry one)");
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), [TENDER_IDS[0], TENDER_IDS[2]].sort());
  const cached = JSON.parse(await readFile(join(env.paths.rawDir, "gebiz-tenders.json"), "utf8")) as { tenders: { candidate: { id: string }; matched: string[] }[] };
  assert.deepEqual(cached.tenders.map((t) => [t.candidate.id, t.matched]), [[TENDER_IDS[0], ["cloud"]], [TENDER_IDS[1], ["cloud"]], [TENDER_IDS[2], ["ai"]]]);
  assert.equal(web.urls.length, 1);

  assert.equal((await build(2)).counts.total, 3);
  assert.equal(web.urls.length, 1, "a changed quota only cuts the cached list");
});

test("R16: a cache in the old format (a bare list) is fetched again", async () => {
  const env = await makeEnv(candidatesMd());
  const web = gebizWeb();
  await mkdir(env.paths.rawDir, { recursive: true });
  await writeFile(join(env.paths.rawDir, "gebiz-tenders.json"), "[]");
  const manifest = await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule() }));
  assert.equal(web.urls.length, 1);
  assert.equal(manifest.counts.total, 3);
});

test("a damaged GeBIZ cache is fetched again instead of trusted", async () => {
  const env = await makeEnv(candidatesMd());
  const web = gebizWeb();
  await mkdir(env.paths.rawDir, { recursive: true });
  await writeFile(join(env.paths.rawDir, "gebiz-tenders.json"), '{"not": "a list"}');
  const manifest = await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule({ max: 1 }) }));
  assert.equal(web.urls.length, 1);
  assert.equal(manifest.counts.total, 1);
});

test("with gebiz off (the default) data.gov.sg is never asked and no tenders are built", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = gebizWeb(siteFor("ca-a-2025"));
  const off = await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl, gebizRule: gebizRule() }));
  assert.equal(web.urls.length, 0);
  assert.equal(off.counts.byType.tender, 0);
  const explicit = await buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl, gebiz: false, gebizRule: gebizRule() }));
  assert.equal(web.urls.length, 0);
  assert.equal(explicit.counts.total, 1);
});

test("tenders are built alongside the listed candidates, and each tender is excluded individually if it fails", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const llms = fakeLlms({ enrichThrows: { [TENDER_IDS[1]!]: new LlmError("Groq API error 429", 429) } });
  const manifest = await buildSnapshot(env.opts({ llm: llms.llm, fetchImpl: gebizWeb(siteFor("ca-a-2025")).impl, gebiz: true, gebizRule: gebizRule() }));
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), ["ca-a-2025", TENDER_IDS[2], TENDER_IDS[0]].sort());
  assert.deepEqual(manifest.excluded.map((e) => e.id), [TENDER_IDS[1]]);
  assert.equal(manifest.excluded[0]!.reason, "enrichment failed: HTTP 429");
});

test("a GeBIZ fetch that fails stops the build with a message that names GeBIZ", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb(siteFor("ca-a-2025")); // data.gov.sg is not routed: the fake answers 404
  await assert.rejects(
    buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule() })),
    /GeBIZ/,
  );
});

test("a tender whose id is already a listed candidate stops the build", async () => {
  const env = await makeEnv(candidatesMd(row(TENDER_IDS[0]!)));
  await assert.rejects(
    buildSnapshot(env.opts({ llm: fakeLlms().llm, fetchImpl: gebizWeb(siteFor(TENDER_IDS[0]!)).impl, gebiz: true, gebizRule: gebizRule() })),
    /duplicate/i,
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// renderReview

const sampleRecord = (over: Partial<PolicyRecord> = {}): PolicyRecord => ({
  id: "ca-sample-2025",
  jurisdiction: "US-CA",
  type: "bill",
  title: "Sample bill",
  issuer: "Legislature",
  status: { value: "enacted", support: ["ca-sample-2025#2"] },
  statusDate: "2025-09-29",
  timeline: [
    { date: "2025-01-02", event: "Introduced.", support: ["ca-sample-2025#1"] },
    { date: "2025-09-29", event: "Signed.", support: ["ca-sample-2025#2"] },
  ],
  summary: { value: "Large developers must publish a framework.", support: ["ca-sample-2025#1"] },
  provisions: [{ value: "Publish a framework.", support: ["ca-sample-2025#1", "ca-sample-2025#2"] }],
  affected: [{ value: "Large developers.", support: ["ca-sample-2025#1"] }],
  topics: ["ai-governance"],
  related: [{ id: "ca-other-2024", relation: "related" }],
  url: "https://example.test/sample",
  publisher: "Legislature",
  fetched: "2026-10-15T09:00:00.000Z",
  sha256: "a".repeat(64),
  attribution: "Legislature",
  redistributionOk: false,
  landmark: true,
  review: { state: "auto-checked" },
  ...over,
});
const samplePassages: Passage[] = [
  { id: "ca-sample-2025#1", recordId: "ca-sample-2025", seq: 1, heading: "Findings", text: "text one" },
  { id: "ca-sample-2025#2", recordId: "ca-sample-2025", seq: 2, text: "text two" },
];

test("renderReview shows each landmark's status, summary, timeline, provisions and affected groups with links to the source", () => {
  const md = renderReview([sampleRecord()], samplePassages);
  assert.ok(md.includes("ca-sample-2025"));
  assert.ok(md.includes("Sample bill"));
  assert.ok(md.includes("https://example.test/sample"));
  for (const text of ["enacted", "2025-09-29", "Large developers must publish a framework.", "2025-01-02", "Introduced.", "Signed.", "Publish a framework.", "Large developers."]) {
    assert.ok(md.includes(text), text);
  }
  assert.ok(md.includes("a".repeat(64)), "the sha256 is shown, for the reviewed.json entry");
  assert.ok(md.includes("ca-sample-2025#2"), "the passages each claim cites");
  assert.ok(md.includes("Findings"), "a cited passage's heading");
  assert.ok(!md.includes("ca-other-2024"), "related ids are not part of the review");
  assert.equal(md.split("- [ ] reviewed").length - 1, 1);
});

test("renderReview skips records that are not landmarks and says so when there are none", () => {
  const plain = sampleRecord({ id: "ca-plain-2025", landmark: false });
  const md = renderReview([plain, sampleRecord()], samplePassages);
  assert.ok(!md.includes("ca-plain-2025"));
  assert.equal(md.split("- [ ] reviewed").length - 1, 1);

  const none = renderReview([plain], []);
  assert.ok(!none.includes("- [ ] reviewed"));
  assert.match(none, /no landmark/i);
});

test("renderReview shows who already reviewed a landmark", () => {
  const md = renderReview([sampleRecord({ review: { state: "human-reviewed", reviewer: "Dana Reviewer", reviewedAt: "2026-10-16" } })], samplePassages);
  assert.ok(md.includes("Dana Reviewer"));
  assert.ok(md.includes("2026-10-16"));
});

test("renderReview keeps a claim on one line even if the text has line breaks, and copes with a missing passage", () => {
  const record = sampleRecord({
    summary: { value: "line one\nline two", support: ["ca-sample-2025#9"] },
  });
  const md = renderReview([record], samplePassages);
  assert.ok(md.includes("line one line two"));
  assert.ok(md.includes("ca-sample-2025#9"));
});

test("renderReview is deterministic and lists landmarks in the order given", () => {
  const a = sampleRecord({ id: "ca-a-2025", status: { value: "enacted", support: ["ca-a-2025#1"] } });
  const b = sampleRecord({ id: "ca-b-2025" });
  const once = renderReview([a, b], []);
  assert.equal(renderReview([a, b], []), once);
  assert.ok(once.indexOf("ca-a-2025") < once.indexOf("ca-b-2025"));
});

// ---------------------------------------------------------------------------------------------------------------------
// The command line

test("parseArgs reads --date and --no-gebiz, and rejects anything else", () => {
  assert.deepEqual(parseArgs([]), { gebiz: true });
  assert.deepEqual(parseArgs(["--no-gebiz"]), { gebiz: false });
  assert.deepEqual(parseArgs(["--date", "2026-03-04"]), { gebiz: true, date: "2026-03-04" });
  assert.deepEqual(parseArgs(["--date=2026-03-04", "--no-gebiz"]), { gebiz: false, date: "2026-03-04" });
  for (const bad of [["--date"], ["--date", "tomorrow"], ["--date", "2026-02-30"], ["--date", "2026-3-4"], ["--bogus"], ["extra"]]) {
    assert.throws(() => parseArgs(bad), /--date|argument/i, bad.join(" "));
  }
});

type Logged = { out: string[]; err: string[] };
const sink = () => {
  const logged: Logged = { out: [], err: [] };
  return { logged, log: (line: string) => void logged.out.push(line), error: (line: string) => void logged.err.push(line) };
};

test("the command fails with a clear message when GROQ_API_KEY is missing, before doing any work", async () => {
  const dir = await mkdtemp(join(root, "cli-"));
  const io = sink();
  let ran = false;
  const code = await main([], { env: {}, root: dir, run: async () => { ran = true; throw new Error("must not run"); }, ...io });
  assert.equal(code, 1);
  assert.equal(ran, false);
  assert.match(io.logged.err.join("\n"), /GROQ_API_KEY/);
  assert.match(io.logged.err.join("\n"), /\.dev\.vars/);

  const blank = await main([], { env: { GROQ_API_KEY: "   " }, root: dir, run: async () => { ran = true; throw new Error("must not run"); }, ...sink() });
  assert.equal(blank, 1);
  assert.equal(ran, false);
});

test("a bad argument is reported with the usage line and a non-zero code", async () => {
  const io = sink();
  const code = await main(["--date", "soon"], { env: { GROQ_API_KEY: "k" }, root, run: async () => { throw new Error("must not run"); }, ...io });
  assert.equal(code, 1);
  assert.match(io.logged.err.join("\n"), /--date/);
  assert.match(io.logged.err.join("\n"), /snapshot:build/);
});

const emptyResult = (over: Partial<RunResult> = {}): RunResult => ({
  manifest: {
    snapshotDate: SNAPSHOT_DATE,
    builtAt: "2026-10-15T09:00:00.000Z",
    models: { enrich: "e", verify: "v" },
    counts: {
      total: 0,
      byJurisdiction: { "US-CA": 0, SG: 0 },
      byType: { bill: 0, statute: 0, regulation: 0, "executive-order": 0, guidance: 0, tender: 0, "press-release": 0, hansard: 0 },
    },
    excluded: [],
  },
  stats: [],
  ...over,
});

test("the command passes the default paths, the date, the models and the keys to the build", async () => {
  const dir = await mkdtemp(join(root, "cli-"));
  await writeFile(join(dir, ".dev.vars"), "GROQ_API_KEY=gsk_from_file\nBROWSERBASE_API_KEY=bb_from_file\nGROQ_ENRICH_MODEL=file/enrich\n");
  const io = sink();
  let seen: BuildOptions | undefined;
  const code = await main(["--date", "2026-03-04", "--no-gebiz"], {
    env: { GROQ_VERIFY_MODEL: "env/verify", ENRICH_MAX_WORDS: "4500" },
    root: dir,
    run: async (options) => {
      seen = options;
      return emptyResult();
    },
    ...io,
  });
  assert.equal(code, 0);
  assert.ok(seen);
  assert.equal(seen.snapshotDate, "2026-03-04");
  assert.equal(seen.gebiz, false);
  assert.equal(seen.candidatesPath, join(dir, "photon/data/snapshot/candidates.md"));
  assert.equal(seen.reviewedPath, join(dir, "photon/data/snapshot/reviewed.json"));
  assert.equal(seen.outDir, join(dir, "photon/data/snapshot"));
  assert.equal(seen.rawDir, join(dir, ".tmp-snapshot/raw"));
  assert.equal(seen.cacheDir, join(dir, ".tmp-snapshot/cache"));
  assert.deepEqual(seen.models, { enrich: "file/enrich", verify: "env/verify" });
  assert.equal(seen.browserbaseKey, "bb_from_file");
  assert.equal(seen.enrichMaxWords, 4500);
  assert.equal(typeof seen.llm.enrich, "function");
  assert.equal(typeof seen.llm.verify, "function");
  assert.ok(!io.logged.out.concat(io.logged.err).join("\n").includes("gsk_from_file"), "the key is never printed");
});

test("the real environment wins over .dev.vars, and --date defaults to today and gebiz to on", async () => {
  const dir = await mkdtemp(join(root, "cli-"));
  await writeFile(join(dir, ".dev.vars"), "GROQ_API_KEY=gsk_from_file\nGROQ_ENRICH_MODEL=file/enrich\n");
  let seen: BuildOptions | undefined;
  await main([], {
    env: { GROQ_ENRICH_MODEL: "env/enrich" },
    root: dir,
    run: async (options) => ((seen = options), emptyResult()),
    ...sink(),
  });
  assert.equal(seen!.models.enrich, "env/enrich");
  assert.equal(seen!.gebiz, true);
  assert.match(seen!.snapshotDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(seen!.enrichMaxWords, undefined, "the build applies its own default of 6000");
});

test("a bad ENRICH_MAX_WORDS is reported", async () => {
  const io = sink();
  const code = await main([], { env: { GROQ_API_KEY: "k", ENRICH_MAX_WORDS: "lots" }, root, run: async () => emptyResult(), ...io });
  assert.equal(code, 1);
  assert.match(io.logged.err.join("\n"), /ENRICH_MAX_WORDS/);
});

test("a build that throws is reported with its message and a non-zero code", async () => {
  const io = sink();
  const code = await main([], { env: { GROQ_API_KEY: "k" }, root, run: async () => { throw new Error("candidates.md line 9: bad row"); }, ...io });
  assert.equal(code, 1);
  assert.match(io.logged.err.join("\n"), /candidates\.md line 9: bad row/);
});

test("the printed summary has the counts, every excluded row with its reason, and each record's word count", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025", { landmark: "yes" }), row("ca-b-2025"), row("sg-gone-2025")));
  const web = fakeWeb({
    "https://example.test/ca-a-2025": page("ca-a-2025", [300, 300]), // 600 words of body text plus a heading
    "https://example.test/ca-b-2025": page("ca-b-2025", [160]), // a thin capture
    "https://example.test/sg-gone-2025": 403,
  });
  const result = await runBuild(env.opts({ llm: fakeLlms().llm, fetchImpl: web.impl }));
  const text = formatSummary(result);
  assert.match(text, /Snapshot as of 2026-10-15/);
  assert.match(text, /Records: 2 \(US-CA 2, SG 0\)/);
  assert.match(text, /bill 2/);
  assert.match(text, /Landmarks: 1 \(0 human-reviewed\)/);
  assert.match(text, /Excluded: 1/);
  assert.match(text, /sg-gone-2025 \(SG\): HTTP 403/);
  const lineA = text.split("\n").find((l) => l.includes("ca-a-2025"))!;
  const lineB = text.split("\n").find((l) => l.includes("ca-b-2025"))!;
  assert.match(lineA, /\b60\d words\b/, "the extracted word count, heading included");
  assert.match(lineB, /\b16\d words\b/);
  assert.match(lineB, /short/i, "a thin capture stands out");
  assert.doesNotMatch(lineA, /short/i);
});

test("the summary does not flag a short tender, and groups digits in a long word count", () => {
  const result = emptyResult({
    stats: [
      { id: "sg-gebiz-x", jurisdiction: "SG", type: "tender", outcome: "built", words: 45, passages: 1, landmark: false, humanReviewed: false, dropped: [] },
      { id: "ca-big-2025", jurisdiction: "US-CA", type: "bill", outcome: "built", words: 12345, passages: 31, landmark: false, humanReviewed: false, dropped: ["provisions[1]", "affected[0]"] },
    ],
  });
  const text = formatSummary(result);
  const tender = text.split("\n").find((l) => l.includes("sg-gebiz-x"))!;
  const big = text.split("\n").find((l) => l.includes("ca-big-2025"))!;
  assert.match(tender, /45 words/);
  assert.doesNotMatch(tender, /short/i);
  assert.match(big, /12,345 words/);
  assert.match(big, /2 claims dropped/);
});

test("runBuild reports what happened to every candidate, and logs one line for each", async () => {
  const env = await makeEnv();
  const llms = fixtureLlms();
  const lines: string[] = [];
  const { stats } = await runBuild(env.opts({ llm: llms.llm, fetchImpl: fixtureWeb().impl, log: (line) => void lines.push(line) }));
  assert.deepEqual(stats.map((s) => [s.id, s.outcome]), [
    ["ca-ab-100-2024", "excluded"],
    [GOOD_ID, "built"],
    ["sg-pdpc-advisory-2024", "excluded"],
  ]);
  const good = stats.find((s) => s.id === GOOD_ID)!;
  assert.ok(good.words >= 400);
  assert.ok(good.passages >= 1);
  assert.equal(good.enrich, "llm");
  assert.equal(good.landmark, true);
  assert.equal(good.humanReviewed, false);
  assert.equal(lines.filter((l) => l.includes(GOOD_ID)).length >= 1, true);
  assert.equal(lines.filter((l) => l.includes("sg-pdpc-advisory-2024") && l.includes("HTTP 403")).length >= 1, true);

  const again = await runBuild(env.opts({ llm: llms.llm, fetchImpl: fixtureWeb().impl }));
  assert.equal(again.stats.find((s) => s.id === GOOD_ID)!.enrich, "cache");
  assert.equal(again.stats.find((s) => s.id === "sg-pdpc-advisory-2024")!.words, 0, "nothing was extracted from the 403");
});

test("main prints the summary and exits 0 after a successful build", async () => {
  const dir = await mkdtemp(join(root, "cli-"));
  const io = sink();
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const result = await runBuild(env.opts({ llm: fakeLlms().llm, fetchImpl: fakeWeb(siteFor("ca-a-2025")).impl }));
  const code = await main([], { env: { GROQ_API_KEY: "k" }, root: dir, run: async () => result, ...io });
  assert.equal(code, 0);
  assert.match(io.logged.out.join("\n"), /ca-a-2025/);
  assert.match(io.logged.out.join("\n"), /words/);
});
