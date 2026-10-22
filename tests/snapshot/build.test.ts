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
  HEADLINE_VERSION,
  SnapshotGuardError,
  type BuildOptions,
  type RunResult,
} from "../../photon/scripts/snapshot/build.ts";
import type { GebizRule } from "../../photon/scripts/snapshot/gebiz.ts";
import { htmlPageText } from "../../photon/scripts/snapshot/meta.ts";
import { sha256Hex } from "../../photon/scripts/snapshot/passages.ts";
import { renderReview } from "../../photon/scripts/snapshot/review.ts";
import { archiveUrl, billIdOf, pubinfoZip, wordsOf, type FixtureBill } from "../helpers/pubinfo.ts";
import { serveRanges } from "../helpers/zip.ts";

const SNAPSHOT_DATE = "2026-10-15";
const FIXTURE_CANDIDATES = new URL("../fixtures/sources/build-candidates.md", import.meta.url);
const GEBIZ_FIXTURE = await readFile(new URL("../fixtures/sources/gebiz.json", import.meta.url), "utf8");

// ---------------------------------------------------------------------------------------------------------------------
// Test doubles

/** `n` distinct words, so two documents never share a hash by accident. */
const words = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
/** `n` distinct words in sentences of ten, so a paragraph of them can be cut after a whole sentence. */
const sentences = (tag: string, n: number) =>
  Array.from({ length: Math.ceil(n / 10) }, (_, s) => `${Array.from({ length: Math.min(10, n - s * 10) }, (_, i) => `${tag}s${s}w${i}`).join(" ")}.`).join(" ");
const tagOf = (id: string) => id.replace(/[^a-z0-9]/g, "");

/** An HTML page whose text is `h1` plus one paragraph per entry of `paragraphs` (each entry is a word count). */
const page = (id: string, paragraphs: number[] = [200]) =>
  `<!doctype html><html><head><title>${id}</title></head><body><main><h1>Heading of ${id}</h1>${paragraphs
    .map((n, i) => `<p>${sentences(`${tagOf(id)}p${i}`, n)}</p>`)
    .join("")}</main></body></html>`;

/** The page of a California bill the way the build's fixtures give it: a digest, a legislative history, then sections. */
function billPage(id: string, over: { history?: string[] | null; digest?: string[] } = {}) {
  const history =
    over.history === undefined
      ? [
          "2025-02-19 — Introduced. Read first time. To Com. on RLS. for assignment.",
          "2025-09-12 — Read third time. Passed.",
          "2025-09-29 — Chaptered by Secretary of State. Chapter 138, Statutes of 2025.",
        ]
      : over.history;
  const digest = over.digest ?? [
    "Existing law requires the Department of Technology to keep an inventory of the automated decision systems that state agencies use, and to report it every year.",
    "This bill would require a developer of a frontier model to publish a safety framework.",
  ];
  return (
    `<!doctype html><html><head><title>${id}</title></head><body><main>` +
    `<h1>Legislative Counsel's Digest</h1><p>Frontier model transparency.</p>${digest.map((p) => `<p>${p}</p>`).join("")}` +
    (history === null ? "" : `<h1>Legislative history</h1>${history.map((h) => `<p>${h}</p>`).join("")}`) +
    `<h1>SECTION 1.</h1><p>${sentences(`${tagOf(id)}a`, 250)}</p><p>${sentences(`${tagOf(id)}b`, 250)}</p>` +
    `</main></body></html>`
  );
}

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

/** A fetch that fails the test if it is used: a re-run must not need the network. */
const noFetch = (async () => {
  throw new Error("the network must not be used");
}) as typeof fetch;

type Req = Parameters<Llm>[0];

/**
 * Fake headline models that count their calls. The writer answers with a headline for the record named in the request (found by
 * its title, `Title of <id>`); the checker marks the claim `headline` supported unless the record is listed.
 */
function fakeLlms(
  opts: {
    /** Per record: the headline the writer returns (default: a short one-sentence line). */
    headlines?: Record<string, string>;
    writerThrows?: Record<string, Error>;
    checkerThrows?: Record<string, Error>;
    /** Records whose headline the checker rejects. */
    unsupported?: string[];
    /** Records for which the checker leaves the claim out of its answer. */
    omit?: string[];
  } = {},
) {
  const writeCalls: Req[] = [];
  const checkCalls: Req[] = [];
  const enrich = (async (req: Req) => {
    writeCalls.push(req);
    const id = /^Document: Title of (.+)$/m.exec(req.user)![1]!;
    const thrown = opts.writerThrows?.[id];
    if (thrown) throw thrown;
    return { headline: opts.headlines?.[id] ?? `A plain-English line about ${id}.` };
  }) as Llm;
  const verify = (async (req: Req) => {
    checkCalls.push(req);
    const id = /\[([a-z0-9-]+)#\d+\]/.exec(req.user)![1]!;
    const thrown = opts.checkerThrows?.[id];
    if (thrown) throw thrown;
    if (opts.omit?.includes(id)) return { results: [] };
    return { results: [{ claimId: "headline", supported: !opts.unsupported?.includes(id) }] };
  }) as Llm;
  return { llm: { enrich, verify }, writeCalls, checkCalls, total: () => writeCalls.length + checkCalls.length };
}

/** Models that fail the test if they are called: the default build must not use a model. */
const forbiddenLlm = {
  enrich: (async () => {
    throw new Error("the default build must not call a model");
  }) as Llm,
  verify: (async () => {
    throw new Error("the default build must not call a model");
  }) as Llm,
};

const unauthorised = (status = 401) => new LlmError(`Groq API error ${status}: Invalid API Key`, status);
const exhausted = () => new LlmError("Groq API error 429: rate limit", 429);

const HEADLINE_MODELS = { enrich: "enrich-model", verify: "verify-model" };

let root: string;
let counter = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "politik-build-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Fresh output, raw-download and cache directories, and a candidates file (the fixture unless given text). */
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
  const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({
    ...paths,
    snapshotDate: SNAPSHOT_DATE,
    now: () => clock.now,
    // Many tests have a source that fails to load on purpose. The partial-build guard (I5) has its own tests, which turn this off.
    allowPartial: true,
    ...over,
  });
  /** The options of a build with headlines on, fake models in. */
  const withHeadlines = (llms: ReturnType<typeof fakeLlms>, over: Partial<BuildOptions> = {}): BuildOptions =>
    opts({ headlines: true, llm: llms.llm, models: HEADLINE_MODELS, ...over });
  const read = async (name: string) => readFile(join(paths.outDir, name), "utf8");
  const readJson = async <T>(name: string) => JSON.parse(await read(name)) as T;
  const privateFile = join(`${paths.outDir}-private`, "passages.json");
  /** The passages of the restricted records (R39), from the git-ignored private file. */
  const readPrivate = async () => JSON.parse(await readFile(privateFile, "utf8")) as Passage[];
  /** Every passage, committed and private, in record and sequence order. */
  const readPassages = async () =>
    [...(await readJson<Passage[]>("passages.json")), ...(await readPrivate())].sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : a.seq - b.seq));
  return { dir, paths, clock, opts, withHeadlines, read, readJson, readPrivate, readPassages, privateFile };
}

const candidatesMd = (...rows: string[]) =>
  `| include | id | title | type | topics | status (best known) | landmark | url | url_confidence | why |\n|---|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
const row = (id: string, o: { include?: string; landmark?: string; url?: string; type?: string; title?: string; confidence?: string; topics?: string } = {}) =>
  `| ${o.include ?? "yes"} | ${id} | ${o.title ?? `Title of ${id}`} | ${o.type ?? "guidance"} | ${o.topics ?? "ai-governance"} | published | ${o.landmark ?? "no"} | ${o.url ?? `https://example.test/${id}`} | ${o.confidence ?? "seen"} | why |`;
const siteFor = (...ids: string[]) => Object.fromEntries(ids.map((id) => [`https://example.test/${id}`, page(id)]));

const GOOD_ID = "ca-sb-900-2025";
const GOOD_PAGE = billPage(GOOD_ID);
const GOOD_TEXT = htmlPageText(GOOD_PAGE).text;

/** The fixture's web: a bill that builds, a bill with no history, a 403, and a release with no paragraph of 25 words. */
const fixtureWeb = () =>
  fakeWeb({
    "https://example.test/bills/sb-900": GOOD_PAGE,
    "https://example.test/bills/ab-100": billPage("ca-ab-100-2024", { history: null }),
    "https://example.test/pdpc/advisory": 403,
    "https://example.test/mddi/brief": `<html><body><h1>Brief</h1>${Array.from({ length: 30 }, (_, i) => `<p>${words(`short${i}x`, 10)}</p>`).join("")}</body></html>`,
  });
const FIXTURE_IDS = ["ca-ab-100-2024", GOOD_ID, "sg-mddi-brief-2024", "sg-pdpc-advisory-2024"];

// ---------------------------------------------------------------------------------------------------------------------
// The fixture build: extract, check, no model

test("the fixture build produces one record and three excluded rows, each with its reason, and makes no model call", async () => {
  const env = await makeEnv();
  const manifest = await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));

  const policies = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(policies.map((p) => p.id), [GOOD_ID]);
  assert.deepEqual(manifest.excluded, [
    { id: "ca-ab-100-2024", jurisdiction: "US-CA", url: "https://example.test/bills/ab-100", title: "Example deepfake disclosure (AB 100)", reason: "no official status found" },
    { id: "sg-mddi-brief-2024", jurisdiction: "SG", url: "https://example.test/mddi/brief", title: "Example ministry brief", reason: "no official summary found" },
    { id: "sg-pdpc-advisory-2024", jurisdiction: "SG", url: "https://example.test/pdpc/advisory", title: "Advisory Guidelines on use of personal data in AI systems", reason: "HTTP 403" },
  ]);
  assert.deepEqual(await env.readJson<Manifest>("manifest.json"), manifest);
  assert.equal(manifest.snapshotDate, SNAPSHOT_DATE);
  assert.deepEqual(manifest.models, { enrich: "none", verify: "none" });
  assert.equal(manifest.counts.total, 1);
  assert.equal(manifest.counts.byJurisdiction["US-CA"], 1);
  assert.equal(manifest.counts.byJurisdiction.SG, 0);
  assert.equal(manifest.counts.byType.bill, 1);
  assert.equal(manifest.counts.byType.guidance, 0);
  assert.equal(manifest.builtAt, "2026-10-15T09:00:00.000Z");
  assert.ok(ManifestSchema.safeParse(manifest).success);
});

test("with models that fail the test if called and headlines unset, the build completes: the default build makes no model call", async () => {
  const env = await makeEnv();
  const manifest = await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl, llm: forbiddenLlm, models: HEADLINE_MODELS }));
  assert.equal(manifest.counts.total, 1);
  assert.deepEqual(manifest.models, { enrich: "none", verify: "none" }, "the manifest says none, whatever names were passed");
  assert.equal((await env.readJson<PolicyRecord[]>("policies.json"))[0]!.headline, undefined);
  assert.equal(await exists(join(env.paths.cacheDir, "headline")), false);
});

test("every candidate ends in exactly one of policies.json or manifest.excluded", async () => {
  const env = await makeEnv();
  const manifest = await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  const built = (await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id);
  const excluded = manifest.excluded.map((e) => e.id);
  assert.deepEqual([...built, ...excluded].sort(), FIXTURE_IDS);
});

test("policies.json, passages.json and manifest.json pass checkSnapshot", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  const errors = checkSnapshot({
    policies: await env.readJson("policies.json"),
    passages: await env.readJson("passages.json"),
    privatePassages: await env.readPrivate(),
    manifest: await env.readJson("manifest.json"),
  });
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------------------------------------------------------------
// R39: the passages of a record that may not be redistributed are not committed

const OPEN_URL = "https://oag.ca.gov/news/press-releases/open-example"; // a publisher that allows redistribution
const OPEN_ID = "ca-oag-open-2025";
const CLOSED_ID = "sg-closed-2025"; // example.test: not in the publishers table, so nothing is assumed redistributable
/** A page of an h1 and two paragraphs of 30 sentences of 10 words each, every sentence starting with a capital: its summary is cut at 150 words. */
const sentencePage = (id: string) =>
  `<!doctype html><html><head><title>${id}</title></head><body><main><h1>Heading of ${id}</h1>${[0, 1]
    .map((p) => `<p>${Array.from({ length: 30 }, (_, i) => `Zed ${Array.from({ length: 9 }, (_, j) => `${tagOf(id)}p${p}s${i}w${j}`).join(" ")}.`).join(" ")}</p>`)
    .join("")}</main></body></html>`;
const licenceEnv = async () => {
  const env = await makeEnv(candidatesMd(row(OPEN_ID, { url: OPEN_URL, type: "press-release" }), row(CLOSED_ID)));
  const web = fakeWeb({ [OPEN_URL]: sentencePage(OPEN_ID), [`https://example.test/${CLOSED_ID}`]: sentencePage(CLOSED_ID) });
  return { env, web };
};

test("R39: the committed passages.json holds the redistributable records' passages only; the others are in the private file", async () => {
  const { env, web } = await licenceEnv();
  const manifest = await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  const policies = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(policies.map((p) => [p.id, p.redistributionOk]), [[OPEN_ID, true], [CLOSED_ID, false]], "both records are in policies.json");
  const open = await env.readJson<Passage[]>("passages.json");
  const closed = await env.readPrivate();
  assert.ok(open.length >= 2 && open.every((p) => p.recordId === OPEN_ID));
  assert.ok(closed.length >= 2 && closed.every((p) => p.recordId === CLOSED_ID));
  assert.equal(manifest.counts.total, 2);
  assert.deepEqual(checkSnapshot({ policies, passages: open, privatePassages: closed, manifest }), []);
  // the claims of the restricted record cite passages that exist only in the private file
  const closedRecord = policies[1]!;
  assert.ok(closedRecord.summary.support.every((id) => closed.some((p) => p.id === id)));
});

test("R39: nothing of a restricted record's text beyond its short quotes is in a committed file, and the quotes stay short", async () => {
  const { env, web } = await licenceEnv();
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  const committed = (await Promise.all(["policies.json", "passages.json", "manifest.json", "review.md"].map((n) => env.read(n)))).join("\n");
  // the second paragraph of the restricted page is body text that no claim quotes
  assert.ok(!committed.includes(`${tagOf(CLOSED_ID)}p1s0w0`), "text of the restricted page outside its quotes is in a committed file");
  assert.ok(committed.includes(`${tagOf(OPEN_ID)}p1s0w0`), "the open record's text is committed");
  assert.ok((await readFile(env.privateFile, "utf8")).includes(`${tagOf(CLOSED_ID)}p1s0w0`));
  const closed = (await env.readJson<PolicyRecord[]>("policies.json")).find((p) => p.id === CLOSED_ID)!;
  assert.ok(closed.summary.value.split(/\s+/).length <= 150, "a summary is an excerpt of at most 150 words");
  assert.equal(closed.redistributionOk, false);
  assert.ok(closed.attribution && closed.url, "a restricted record carries its attribution and its link");
});

test("R42: a restricted record's summary and provisions are cut to at most 281 characters and pass the check; a redistributable record's are whole", async () => {
  const bullets = Array.from({ length: 3 }, (_, i) => `<li>Operator ${i} shall keep careful records of every complaint received ${"and shall report every serious incident to the commission ".repeat(8)}end ${i}.</li>`).join("");
  const longPage = (id: string) =>
    `<!doctype html><html><head><title>${id}</title></head><body><main><h1>Heading of ${id}</h1><p>${Array.from({ length: 12 }, (_, i) => `Zed ${tagOf(id)}s${i} ${"word ".repeat(12).trim()}.`).join(" ")}</p><p>${sentences(`${tagOf(id)}q`, 400)}</p><ul>${bullets}</ul></main></body></html>`;
  const env = await makeEnv(candidatesMd(row(OPEN_ID, { url: OPEN_URL, type: "press-release" }), row(CLOSED_ID, { type: "press-release" })));
  const web = fakeWeb({ [OPEN_URL]: longPage(OPEN_ID), [`https://example.test/${CLOSED_ID}`]: longPage(CLOSED_ID) });
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  const [open, closed] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.equal(open!.id, OPEN_ID);
  assert.ok(open!.summary.value.length > 281 && !open!.summary.value.endsWith("…"), "a redistributable summary is whole");
  assert.ok(open!.provisions.some((p) => p.value.length > 281), "and so are its provisions");

  assert.ok(closed!.summary.value.length <= 281 && closed!.summary.value.endsWith("…"), String(closed!.summary.value.length));
  assert.ok(closed!.provisions.length > 0 && closed!.provisions.every((p) => p.value.length <= 281 && p.value.endsWith("…")));
  const passages = await env.readPassages();
  const text = (ids: string[]) => ids.map((id) => passages.find((p) => p.id === id)!.text.replace(/\s+/g, " ")).join(" ");
  for (const claim of [closed!.summary, ...closed!.provisions]) {
    assert.ok(text(claim.support).includes(claim.value.slice(0, -1).trimEnd()), "the quote is the start of what it cites");
  }
  assert.deepEqual(checkSnapshot({ policies: await env.readJson("policies.json"), passages: await env.readJson("passages.json"), privatePassages: await env.readPrivate(), manifest: await env.readJson("manifest.json") }), []);
  // the private file still holds the whole text
  assert.ok((await env.readPrivate()).some((p) => p.text.length > 1000));
  assert.ok(!(await env.read("review.md")).includes("end 2."));
});

test("R39: with no restricted record the private file is written empty; it is replaced on every build and a refused build leaves it as it was", async () => {
  const env = await makeEnv(candidatesMd(row(OPEN_ID, { url: OPEN_URL, type: "press-release" })));
  const web = fakeWeb({ [OPEN_URL]: page(OPEN_ID) });
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  assert.deepEqual(await env.readPrivate(), []);

  await writeFile(env.privateFile, '["stale"]'); // an earlier build's restricted text must not survive a build without it
  await buildSnapshot(env.opts({ fetchImpl: noFetch }));
  assert.deepEqual(await env.readPrivate(), []);

  // a refused build (the partial guard) leaves both files alone
  const guarded = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025")));
  await seedOutputs(guarded);
  await mkdir(`${guarded.paths.outDir}-private`, { recursive: true });
  await writeFile(guarded.privateFile, '["old private passages"]');
  await assert.rejects(runBuild(guarded.opts({ fetchImpl: fakeWeb({}).impl, allowPartial: false })), SnapshotGuardError);
  assert.equal(await readFile(guarded.privateFile, "utf8"), '["old private passages"]');
});

test("R39: a second run writes the same private file, byte for byte; privateDir moves it", async () => {
  const { env, web } = await licenceEnv();
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  const first = await readFile(env.privateFile, "utf8");
  await buildSnapshot(env.opts({ fetchImpl: noFetch }));
  assert.equal(await readFile(env.privateFile, "utf8"), first);
  const elsewhere = join(env.dir, "elsewhere");
  await buildSnapshot(env.opts({ fetchImpl: noFetch, privateDir: elsewhere }));
  assert.equal(await readFile(join(elsewhere, "passages.json"), "utf8"), first);
});

test("R39: GeBIZ tenders (open data licence) are committed; the summary counts the passages of each file", async () => {
  const env = await makeEnv(candidatesMd(row(CLOSED_ID)));
  const web = gebizWeb(siteFor(CLOSED_ID));
  const result = await runBuild(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule() }));
  const committed = await env.readJson<Passage[]>("passages.json");
  assert.ok(committed.length >= 3 && committed.every((p) => p.recordId.startsWith("sg-gebiz-")));
  assert.ok((await env.readPrivate()).every((p) => p.recordId === CLOSED_ID));
  assert.deepEqual(result.passages, { committed: committed.length, private: (await env.readPrivate()).length, restrictedRecords: 1 });
  assert.match(formatSummary(result), new RegExp(`Passages: ${committed.length + result.passages!.private} \\(${committed.length} committed, ${result.passages!.private} private for 1 record that may not be redistributed\\)`));
});

test("a built record carries its provenance, the extracted fields and the full-text hash, and none of the extractor's working parts", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.equal(record!.sha256, sha256Hex(GOOD_TEXT));
  assert.equal(record!.url, "https://example.test/bills/sb-900");
  assert.equal(record!.title, "Example frontier model transparency (SB 900)");
  assert.equal(record!.shortTitle, "SB 900");
  assert.equal(record!.type, "bill");
  assert.equal(record!.jurisdiction, "US-CA");
  assert.equal(record!.landmark, true);
  assert.equal(record!.fetched, "2026-10-15T09:00:00.000Z");
  // example.test is not a known publisher host, so its hostname is the issuer and the publisher, and nothing is assumed redistributable.
  assert.equal(record!.issuer, "example.test");
  assert.equal(record!.publisher, "example.test");
  assert.equal(record!.attribution, "example.test");
  assert.equal(record!.redistributionOk, false);
  assert.equal(record!.summary.value, "This bill would require a developer of a frontier model to publish a safety framework.", "R38: what the bill would do, not the existing law");
  assert.deepEqual(record!.provisions.map((p) => p.value), ["This bill would require a developer of a frontier model to publish a safety framework."]);
  // no operative date in the bill: R31's default, 1 January of the year after chaptering, which is before the snapshot date
  assert.deepEqual(record!.status.value, "in-force");
  assert.equal(record!.statusDate, "2026-01-01");
  assert.equal(record!.published, "2025-02-19");
  assert.deepEqual(record!.timeline.map((t) => [t.date, t.event]), [
    ["2025-02-19", "Introduced. Read first time. To Com. on RLS. for assignment."],
    ["2025-09-12", "Read third time. Passed."],
    ["2025-09-29", "Chaptered by Secretary of State. Chapter 138, Statutes of 2025."],
    ["2026-01-01", "Takes effect"],
  ]);
  assert.deepEqual(record!.affected, []);
  assert.deepEqual(record!.review, { state: "auto-checked" });
  assert.deepEqual(record!.topics, ["ai-governance"], "the topics are the candidate row's");
  assert.deepEqual(record!.related, []);
  assert.ok(!JSON.stringify(record).includes('"parts"'));
  assert.ok(!(await env.read("policies.json")).includes('"parts"'));
});

test("every claim of a built record cites passages that hold it", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  const passages = new Map((await env.readPassages()).map((p) => [p.id, p]));
  const flat = (id: string) => (passages.get(id)!.heading ? `${passages.get(id)!.heading} ${passages.get(id)!.text}` : passages.get(id)!.text).replace(/\s+/g, " ");
  for (const claim of [record!.summary, ...record!.provisions]) assert.ok(claim.support.some((id) => flat(id).includes(claim.value)), claim.value);
  for (const event of record!.timeline) {
    // the default effective date (R31) is a rule applied to the chaptering row, not a date the text writes
    if (event.event === "Takes effect") assert.ok(event.support.some((id) => flat(id).includes("Chaptered by Secretary of State")));
    else assert.ok(event.support.some((id) => flat(id).includes(event.date) && flat(id).includes(event.event)), event.event);
  }
});

test("a known publisher host gets its publisher, issuer, attribution and redistribution flag", async () => {
  const url = "https://oag.ca.gov/news/press-releases/example";
  const env = await makeEnv(candidatesMd(row("ca-oag-example-2025", { url, type: "press-release" })));
  await buildSnapshot(env.opts({ fetchImpl: fakeWeb({ [url]: page("ca-oag-example-2025") }).impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.equal(record!.publisher, "California Department of Justice, Office of the Attorney General");
  assert.equal(record!.issuer, record!.publisher);
  assert.match(record!.attribution, /Attorney General/);
  assert.equal(record!.redistributionOk, true);
});

test("all of a document's passages are stored, and the JSON is 2-space indented with a trailing newline", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  const passages = await env.readPassages();
  assert.ok(passages.length >= 2);
  assert.ok(passages.every((p) => p.recordId === GOOD_ID));
  for (const name of ["policies.json", "passages.json", "manifest.json"]) {
    const text = await env.read(name);
    assert.ok(text.endsWith("}\n") || text.endsWith("]\n"), name);
    assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`, name);
  }
});

test("a page's description that its body lacks is stored as a Page description passage and can be the summary", async () => {
  const description = `The agency published guidelines that require operators to ${words("rule", 14)} under the new policy.`;
  const html = page("sg-x-2025").replace("<title>", `<meta name="description" content="${description}"><title>`);
  const env = await makeEnv(candidatesMd(row("sg-x-2025")));
  await buildSnapshot(env.opts({ fetchImpl: fakeWeb({ "https://example.test/sg-x-2025": html }).impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  const passages = await env.readPassages();
  assert.equal(record!.summary.value, description);
  assert.equal(passages.find((p) => p.id === record!.summary.support[0])!.heading, "Page description");
});

// ---------------------------------------------------------------------------------------------------------------------
// Options that stop the build before it starts

test("headlines without models or without model names stop the build before any fetch", async () => {
  const env = await makeEnv();
  const web = fixtureWeb();
  const llms = fakeLlms();
  await assert.rejects(buildSnapshot(env.opts({ headlines: true, fetchImpl: web.impl })), /headlines|models/i);
  await assert.rejects(buildSnapshot(env.opts({ headlines: true, llm: llms.llm, fetchImpl: web.impl })), /headlines|models/i);
  await assert.rejects(buildSnapshot(env.opts({ headlines: true, llm: llms.llm, models: { enrich: " ", verify: "v" }, fetchImpl: web.impl })), /headlines|models/i);
  await assert.rejects(buildSnapshot(env.opts({ headlines: true, models: HEADLINE_MODELS, fetchImpl: web.impl })), /headlines|models/i);
  assert.equal(web.calls.length + llms.total(), 0);
  await assert.rejects(readdir(env.paths.outDir), { code: "ENOENT" }, "nothing was written");
});

test("an unreal snapshot date stops the build before any fetch", async () => {
  const env = await makeEnv();
  const web = fixtureWeb();
  await assert.rejects(buildSnapshot(env.opts({ snapshotDate: "soon", fetchImpl: web.impl })), /snapshotDate/);
  await assert.rejects(buildSnapshot(env.opts({ snapshotDate: "2026-02-30", fetchImpl: web.impl })), /snapshotDate/);
  assert.equal(web.calls.length, 0);
  await assert.rejects(readdir(env.paths.outDir), { code: "ENOENT" }, "nothing was written");
});

// ---------------------------------------------------------------------------------------------------------------------
// Re-runs

const OUTPUTS = ["policies.json", "passages.json", "manifest.json", "review.md"];
const snapshotOf = async (env: Awaited<ReturnType<typeof makeEnv>>) => Object.fromEntries(await Promise.all(OUTPUTS.map(async (n) => [n, await env.read(n)])));

test("a second run with the same inputs and a fetch that throws writes byte-identical files", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025", { landmark: "yes" }), row("ca-b-2025")));
  const web = fakeWeb(siteFor("ca-a-2025", "ca-b-2025"));
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  const first = await snapshotOf(env);
  env.clock.now = new Date("2027-01-01T00:00:00.000Z"); // a later wall clock must not leak into the output
  await buildSnapshot(env.opts({ fetchImpl: noFetch }));
  assert.deepEqual(await snapshotOf(env), first, "every document came from the raw cache");
  assert.equal(web.calls.length, 2);
});

test("a second run asks again only for what failed to load", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  const first = await snapshotOf(env);
  env.clock.now = new Date("2026-10-16T18:30:00.000Z");
  const web = fakeWeb({ "https://example.test/pdpc/advisory": 403 });
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  assert.deepEqual(web.calls, ["https://example.test/pdpc/advisory"]);
  assert.deepEqual(await snapshotOf(env), first);
});

test("builtAt is kept while nothing else changes, and moves when the content does", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb(siteFor("ca-a-2025"));
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  env.clock.now = new Date("2026-11-01T00:00:00.000Z");
  const same = await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  assert.equal(same.builtAt, "2026-10-15T09:00:00.000Z");
  const changed = await buildSnapshot(env.opts({ fetchImpl: web.impl, snapshotDate: "2026-11-01" }));
  assert.equal(changed.builtAt, "2026-11-01T00:00:00.000Z");
});

test("two candidates that share one source text each keep their own citations", async () => {
  const shared = "https://example.test/shared";
  const env = await makeEnv(candidatesMd(row("ca-a-2025", { url: shared }), row("ca-b-2025", { url: shared })));
  const web = fakeWeb({ [shared]: page("shared") });
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  const policies = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(policies.map((p) => p.summary.support), [["ca-a-2025#1"], ["ca-b-2025#1"]]);
  assert.equal(policies[0]!.sha256, policies[1]!.sha256);
  const passages = await env.readPassages();
  assert.deepEqual([...new Set(passages.map((p) => p.recordId))], ["ca-a-2025", "ca-b-2025"]);
});

test("the snapshot date decides whether a chaptered bill is in force: a later date re-judges it", async () => {
  const withOperative = billPage(GOOD_ID).replace("</main>", "<h1>SEC. 5.</h1><p>This act shall become operative on January 1, 2026.</p></main>");
  const env = await makeEnv(candidatesMd(row(GOOD_ID, { type: "bill", url: "https://example.test/bill" })));
  const web = fakeWeb({ "https://example.test/bill": withOperative });
  await buildSnapshot(env.opts({ fetchImpl: web.impl, snapshotDate: "2025-12-31" }));
  const before = (await env.readJson<PolicyRecord[]>("policies.json"))[0]!;
  assert.equal(before.status.value, "enacted");
  assert.equal(before.statusDate, "2025-09-29");
  await buildSnapshot(env.opts({ fetchImpl: noFetch, snapshotDate: "2026-01-01" }));
  const after = (await env.readJson<PolicyRecord[]>("policies.json"))[0]!;
  assert.equal(after.status.value, "in-force");
  assert.equal(after.statusDate, "2026-01-01");
  assert.ok(after.timeline.some((t) => t.event === "Operative" && t.date === "2026-01-01"));
  assert.deepEqual(checkSnapshot({ policies: await env.readJson("policies.json"), passages: await env.readJson("passages.json"), privatePassages: await env.readPrivate(), manifest: await env.readJson("manifest.json") }), []);
});

// ---------------------------------------------------------------------------------------------------------------------
// I4: the raw cache is tied to the url, and can be refreshed

test("I4: a corrected url in candidates.md is fetched, not served from the old download", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025", { url: "https://example.test/old" })));
  const web = fakeWeb({ "https://example.test/old": page("ca-a-2025"), "https://example.test/new": page("ca-a-2025-new") });
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  const before = await env.readJson<PolicyRecord[]>("policies.json");

  await writeFile(env.paths.candidatesPath, candidatesMd(row("ca-a-2025", { url: "https://example.test/new" })));
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  assert.deepEqual(web.calls, ["https://example.test/old", "https://example.test/new"]);
  const after = await env.readJson<PolicyRecord[]>("policies.json");
  assert.notEqual(after[0]!.sha256, before[0]!.sha256, "the record is built from the new document");
  assert.equal(after[0]!.url, "https://example.test/new");
});

test("7a fix: California bills are read from the bulk download with their history, and the history tables are read once for the whole run", async () => {
  const bill = (num: number, status: string, last: string): FixtureBill => ({
    session: "202520260",
    type: "SB",
    num,
    currentStatus: status,
    versions: [{ stage: "ENR", versionNum: 91, date: "2025-09-17", body: `Text of bill ${num} ${wordsOf(200, `sb${num}w`)}.` }],
    history: [{ date: "2025-09-29", text: last }, { date: "2025-01-07", text: "Introduced.  Read first time." }],
  });
  const bills = [bill(53, "Chaptered", "Chaptered by Secretary of State. Chapter 138, Statutes of 2025."), bill(243, "Vetoed", "Vetoed by the Governor.")];
  const url = (b: FixtureBill) => `https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=${billIdOf(b)}`;
  const env = await makeEnv(candidatesMd(row("ca-sb-53-2025", { url: url(bills[0]!), type: "bill" }), row("ca-sb-243-2025", { url: url(bills[1]!), type: "bill" })));
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip(bills).zip });
  await buildSnapshot(env.opts({ fetchImpl: server.fetch }));

  const policies = await env.readJson<PolicyRecord[]>("policies.json");
  const sb53 = policies.find((p) => p.id === "ca-sb-53-2025")!;
  const sb243 = policies.find((p) => p.id === "ca-sb-243-2025")!;
  assert.equal(sb53.status.value, "in-force", "chaptered 2025-09-29 with no stated operative date: 1 January 2026 is the default");
  assert.equal(sb53.statusDate, "2026-01-01");
  assert.equal(sb53.shortTitle, "SB 53");
  assert.equal(sb53.summary.value, "This bill would cover them better.");
  assert.deepEqual(sb53.provisions.map((p) => p.value), ["This bill would cover them better."]);
  assert.equal(sb53.published, "2025-01-07");
  assert.equal(sb243.status.value, "vetoed");
  assert.equal(sb243.statusDate, "2025-09-29");
  assert.deepEqual(sb243.timeline.map((t) => t.event), ["Introduced. Read first time.", "Vetoed by the Governor."]);

  const passages = await env.readPassages();
  const history = passages.filter((p) => p.heading === "Legislative history");
  assert.deepEqual(history.map((p) => p.recordId).sort(), ["ca-sb-243-2025", "ca-sb-53-2025"]);
  assert.ok(history.find((p) => p.recordId === "ca-sb-243-2025")!.text.includes("2025-09-29 — Vetoed by the Governor."));

  const directory = JSON.parse(await readFile(join(env.paths.rawDir, "leginfo", "2025-directory.json"), "utf8")) as { entries: { name: string; compressedSize: number }[] };
  const table = directory.entries.find((e) => e.name === "BILL_HISTORY_TBL.dat")!;
  assert.equal(server.requests.filter((r) => r.bytes === table.compressedSize).length, 1, "one read of the history table, not one per bill");
});

test("I4: refresh=downloads fetches again and keeps a hand-placed file that has no sidecar; refresh=all replaces that too", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025")));
  const web = fakeWeb(siteFor("ca-a-2025", "ca-b-2025"));
  await mkdir(env.paths.rawDir, { recursive: true });
  await writeFile(join(env.paths.rawDir, "ca-b-2025.txt"), `${sentences("hand", 200)}\n`);
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  assert.deepEqual(web.calls, ["https://example.test/ca-a-2025"], "the hand-placed file stood in for ca-b-2025");
  assert.ok(await exists(join(env.paths.rawDir, "ca-a-2025.source.json")));
  assert.equal(await exists(join(env.paths.rawDir, "ca-b-2025.source.json")), false);

  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  assert.equal(web.calls.length, 1, "a plain re-run fetches nothing");

  await buildSnapshot(env.opts({ fetchImpl: web.impl, refresh: "downloads" }));
  assert.equal(web.calls.length, 2, "only the download is fetched again");
  assert.match(await readFile(join(env.paths.rawDir, "ca-b-2025.txt"), "utf8"), /^hands0w0 /, "the hand-placed file survives");

  await buildSnapshot(env.opts({ fetchImpl: web.impl, refresh: "all" }));
  assert.equal(web.calls.length, 4, "both are fetched again");
  assert.equal(await exists(join(env.paths.rawDir, "ca-b-2025.txt")), false, "the hand-placed file was replaced by the download");
  assert.ok(await exists(join(env.paths.rawDir, "ca-b-2025.html")));
});

test("I4: refresh also fetches the GeBIZ list again, whether or not the rule changed", async () => {
  const env = await makeEnv(candidatesMd());
  const web = gebizWeb();
  const build = (refresh?: "downloads" | "all") => buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule(), refresh }));
  await build();
  await build();
  assert.equal(web.urls.length, 1);
  await build("downloads");
  assert.equal(web.urls.length, 2);
  await build("all");
  assert.equal(web.urls.length, 3);
  await build();
  assert.equal(web.urls.length, 3, "the refreshed list is cached again");
});

// ---------------------------------------------------------------------------------------------------------------------
// The optional headlines (spec 5.4b, --llm-headlines)

const landmarkEnv = () =>
  makeEnv(candidatesMd(row("ca-land-2025", { landmark: "yes" }), row("ca-plain-2025"), row("sg-land-2025", { landmark: "yes" })));
const landmarkWeb = () => fakeWeb(siteFor("ca-land-2025", "ca-plain-2025", "sg-land-2025"));

test("headlines: only landmarks get one, its support is the summary's, a non-landmark makes no call and a landmark at most two", async () => {
  const env = await landmarkEnv();
  const llms = fakeLlms();
  const manifest = await buildSnapshot(env.withHeadlines(llms, { fetchImpl: landmarkWeb().impl }));
  const policies = await env.readJson<PolicyRecord[]>("policies.json");
  const byId = Object.fromEntries(policies.map((p) => [p.id, p]));
  assert.deepEqual(byId["ca-land-2025"]!.headline, { value: "A plain-English line about ca-land-2025.", support: byId["ca-land-2025"]!.summary.support });
  assert.deepEqual(byId["sg-land-2025"]!.headline, { value: "A plain-English line about sg-land-2025.", support: byId["sg-land-2025"]!.summary.support });
  assert.equal(byId["ca-plain-2025"]!.headline, undefined);
  assert.equal(llms.writeCalls.length, 2, "one write per landmark");
  assert.equal(llms.checkCalls.length, 2, "one check per landmark");
  assert.ok(!llms.writeCalls.concat(llms.checkCalls).some((c) => c.user.includes("ca-plain-2025")), "the plain record never reached a model");
  assert.deepEqual(manifest.models, HEADLINE_MODELS);
  assert.deepEqual(checkSnapshot({ policies, passages: await env.readJson("passages.json"), privatePassages: await env.readPrivate(), manifest }), []);
});

test("headlines: the writer is sent the title and the summary only, and the checker the passages the summary cites, with today's date", async () => {
  const env = await landmarkEnv();
  const llms = fakeLlms();
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: landmarkWeb().impl }));
  const [first] = await env.readJson<PolicyRecord[]>("policies.json");
  const write = llms.writeCalls.find((c) => c.user.includes("Title of ca-land-2025"))!;
  assert.ok(write.user.includes(first!.summary.value));
  assert.ok(!write.user.includes("ca-land-2025#"), "no passage ids or other text");
  const check = llms.checkCalls.find((c) => c.user.includes("[ca-land-2025#1]"))!;
  assert.match(check.user, /CLAIM headline: A plain-English line about ca-land-2025\./);
  assert.ok(check.system.includes(SNAPSHOT_DATE));
});

test("headlines: a headline the checker rejects leaves the record built without one, and a second run makes no call", async () => {
  const env = await landmarkEnv();
  const llms = fakeLlms({ unsupported: ["ca-land-2025"] });
  const web = landmarkWeb();
  const first = await runBuild(env.withHeadlines(llms, { fetchImpl: web.impl }));
  const policies = await env.readJson<PolicyRecord[]>("policies.json");
  assert.equal(policies.find((p) => p.id === "ca-land-2025")!.headline, undefined);
  assert.ok(policies.find((p) => p.id === "sg-land-2025")!.headline);
  assert.equal(first.manifest.excluded.length, 0, "a headline never causes an exclusion");
  assert.equal(first.stats.find((s) => s.id === "ca-land-2025")!.headline, "dropped");
  assert.equal(first.stats.find((s) => s.id === "sg-land-2025")!.headline, "llm");

  const before = llms.total();
  const again = await runBuild(env.withHeadlines(llms, { fetchImpl: noFetch }));
  assert.equal(llms.total() - before, 0, "the rejection is cached too");
  assert.equal(again.stats.find((s) => s.id === "ca-land-2025")!.headline, "dropped");
  assert.equal(again.stats.find((s) => s.id === "sg-land-2025")!.headline, "cache");
  assert.equal((await env.readJson<PolicyRecord[]>("policies.json")).find((p) => p.id === "sg-land-2025")!.headline!.value, "A plain-English line about sg-land-2025.");
});

test("headlines: a claim the checker leaves out of its answer, and a headline over 30 words or of two sentences, are dropped", async () => {
  const env = await landmarkEnv();
  const llms = fakeLlms({ omit: ["ca-land-2025"], headlines: { "sg-land-2025": "Operators must publish plans. They must also report incidents." } });
  const { stats } = await runBuild(env.withHeadlines(llms, { fetchImpl: landmarkWeb().impl }));
  assert.deepEqual(stats.filter((s) => s.landmark).map((s) => [s.id, s.headline]), [["ca-land-2025", "dropped"], ["sg-land-2025", "dropped"]]);
  assert.equal(llms.checkCalls.length, 1, "a headline the writer's format rules refuse is never sent to the checker");
  assert.ok((await env.readJson<PolicyRecord[]>("policies.json")).every((p) => p.headline === undefined));
});

test("headlines: a failed call (not a rejected key) leaves the record built without a headline, is logged, and is tried again on the next run", async () => {
  const env = await landmarkEnv();
  const lines: string[] = [];
  const broken = fakeLlms({ writerThrows: { "ca-land-2025": exhausted() }, checkerThrows: { "sg-land-2025": new Error("socket hang up") } });
  const first = await runBuild(env.withHeadlines(broken, { fetchImpl: landmarkWeb().impl, log: (l) => void lines.push(l) }));
  assert.equal(first.manifest.counts.total, 3);
  assert.deepEqual(first.stats.filter((s) => s.landmark).map((s) => s.headline), ["failed", "failed"]);
  assert.ok((await env.readJson<PolicyRecord[]>("policies.json")).every((p) => p.headline === undefined));
  assert.ok(lines.some((l) => l.includes("ca-land-2025") && /429/.test(l)), "the console says why");
  assert.ok(lines.some((l) => l.includes("sg-land-2025") && /socket hang up/.test(l)));

  const healthy = fakeLlms();
  await runBuild(env.withHeadlines(healthy, { fetchImpl: noFetch }));
  assert.equal(healthy.writeCalls.length, 2, "a failure is not cached");
  assert.ok((await env.readJson<PolicyRecord[]>("policies.json")).filter((p) => p.headline).length === 2);
});

test("headlines: a 401 or 403 from Groq stops the build after that record, as an auth guard, and leaves the outputs untouched", async () => {
  for (const status of [401, 403]) {
    const env = await landmarkEnv();
    await buildSnapshot(env.opts({ fetchImpl: landmarkWeb().impl }));
    const seeded = await snapshotOf(env);
    const llms = fakeLlms({ writerThrows: { "sg-land-2025": unauthorised(status) } });
    await assert.rejects(buildSnapshot(env.withHeadlines(llms, { fetchImpl: noFetch })), (e: unknown) => {
      assert.ok(e instanceof SnapshotGuardError);
      assert.equal(e.kind, "auth");
      assert.match(e.message, new RegExp(`HTTP ${status}`));
      assert.match(e.message, /GROQ_API_KEY/);
      assert.match(e.message, /nothing was written/i);
      assert.ok(e.message.includes(`--date ${SNAPSHOT_DATE}`));
      assert.ok(e.message.includes("sg-land-2025"));
      return true;
    });
    assert.deepEqual(await snapshotOf(env), seeded);
    assert.equal(llms.writeCalls.length, 2, "ca-land-2025 was done, sg-land-2025 stopped the run");
  }
});

test("headlines: a 401 while checking is an auth failure too, and what was finished stays cached for the rerun", async () => {
  const env = await landmarkEnv();
  const bad = fakeLlms({ checkerThrows: { "sg-land-2025": unauthorised() } });
  await assert.rejects(buildSnapshot(env.withHeadlines(bad, { fetchImpl: landmarkWeb().impl })), (e: unknown) => e instanceof SnapshotGuardError && e.kind === "auth");
  const good = fakeLlms();
  await buildSnapshot(env.withHeadlines(good, { fetchImpl: landmarkWeb().impl }));
  assert.equal(good.writeCalls.length, 1, "ca-land-2025 is cached: only sg-land-2025 is written again");
  assert.equal((await env.readJson<PolicyRecord[]>("policies.json")).filter((p) => p.headline).length, 2);
});

test("headlines: a run without the flag ignores a cached headline, and a run with it uses the cache and makes no call", async () => {
  const env = await landmarkEnv();
  const llms = fakeLlms();
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: landmarkWeb().impl }));
  const withHeadlines = await snapshotOf(env);
  assert.ok(withHeadlines["policies.json"]!.includes('"headline"'));

  await buildSnapshot(env.opts({ fetchImpl: noFetch, llm: forbiddenLlm, models: HEADLINE_MODELS }));
  assert.ok(!(await env.read("policies.json")).includes('"headline"'), "the output has none");
  assert.ok(!(await env.read("review.md")).includes("machine-written"));
  assert.deepEqual((await env.readJson<Manifest>("manifest.json")).models, { enrich: "none", verify: "none" });

  const calls = llms.total();
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: noFetch }));
  assert.equal(llms.total() - calls, 0);
  assert.deepEqual(await snapshotOf(env), withHeadlines, "back to the same bytes");
});

test("headlines: the cache is cacheDir/headline/<sha>.json, keyed by the models and the summary", async () => {
  const env = await makeEnv(candidatesMd(row("ca-land-2025", { landmark: "yes" })));
  const llms = fakeLlms();
  const web = fakeWeb(siteFor("ca-land-2025"));
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: web.impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  const file = join(env.paths.cacheDir, "headline", `${record!.sha256}.json`);
  const cached = JSON.parse(await readFile(file, "utf8")) as Record<string, { version: number; enrichModel: string; verifyModel: string; summaryHash: string; outcome: string }>;
  assert.deepEqual(Object.keys(cached), ["ca-land-2025"]);
  assert.equal(cached["ca-land-2025"]!.version, HEADLINE_VERSION);
  assert.equal(cached["ca-land-2025"]!.enrichModel, "enrich-model");
  assert.equal(cached["ca-land-2025"]!.verifyModel, "verify-model");
  assert.equal(cached["ca-land-2025"]!.summaryHash, sha256Hex(record!.summary.value));
  assert.equal(cached["ca-land-2025"]!.outcome, "kept");

  // another model is a miss, for the writer and for the checker
  const calls = llms.total();
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: noFetch, models: { enrich: "other-enrich", verify: "verify-model" } }));
  assert.equal(llms.total() - calls, 2);
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: noFetch, models: { enrich: "other-enrich", verify: "other-verify" } }));
  assert.equal(llms.total() - calls, 4);
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: noFetch, models: { enrich: "other-enrich", verify: "other-verify" } }));
  assert.equal(llms.total() - calls, 4, "and then it is cached again");

  // a cached answer from another version of the step is a miss
  const entry = JSON.parse(await readFile(file, "utf8")) as Record<string, Record<string, unknown>>;
  entry["ca-land-2025"]!.version = HEADLINE_VERSION - 1;
  await writeFile(file, JSON.stringify(entry));
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: noFetch, models: { enrich: "other-enrich", verify: "other-verify" } }));
  assert.equal(llms.total() - calls, 6);
});

test("headlines: a changed text is a miss, and an unreadable cache file is a miss", async () => {
  const env = await makeEnv(candidatesMd(row("ca-land-2025", { landmark: "yes" })));
  const llms = fakeLlms();
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: fakeWeb(siteFor("ca-land-2025")).impl }));
  assert.equal(llms.total(), 2);
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: fakeWeb({ "https://example.test/ca-land-2025": page("ca-land-2025-v2") }).impl, refresh: "downloads" }));
  assert.equal(llms.total(), 4, "another text, another sha: asked again");
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  await writeFile(join(env.paths.cacheDir, "headline", `${record!.sha256}.json`), "{ not json");
  await buildSnapshot(env.withHeadlines(llms, { fetchImpl: noFetch }));
  assert.equal(llms.total(), 6);
});

test("headlines: review.md prints a record's headline under its summary, marked machine-written", async () => {
  const env = await landmarkEnv();
  await buildSnapshot(env.withHeadlines(fakeLlms(), { fetchImpl: landmarkWeb().impl }));
  const md = await env.read("review.md");
  const section = md.slice(md.indexOf("## ca-land-2025"), md.indexOf("## sg-land-2025"));
  assert.match(section, /machine-written/i);
  assert.ok(section.indexOf("**Summary**") < section.indexOf("A plain-English line about ca-land-2025."));
  assert.ok(section.indexOf("A plain-English line about ca-land-2025.") < section.indexOf("**Timeline**"));
  assert.ok(!md.includes("ca-plain-2025"));
});

// ---------------------------------------------------------------------------------------------------------------------
// Human review

const reviewedEntry = (over: Partial<Record<string, string>> = {}) => ({
  id: GOOD_ID,
  reviewer: "Dana Reviewer",
  reviewedAt: "2026-10-16",
  sha256: sha256Hex(GOOD_TEXT),
  ...over,
});

test("a reviewed.json entry whose sha256 matches makes the record human-reviewed", async () => {
  const env = await makeEnv();
  await writeFile(env.paths.reviewedPath, JSON.stringify([reviewedEntry()]));
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(record!.review, { state: "human-reviewed", reviewedAt: "2026-10-16", reviewer: "Dana Reviewer" });
  assert.deepEqual(checkSnapshot({ policies: await env.readJson("policies.json"), passages: await env.readJson("passages.json"), privatePassages: await env.readPrivate(), manifest: await env.readJson("manifest.json") }), []);
});

test("a reviewed.json entry with a stale sha256 leaves the record auto-checked", async () => {
  const env = await makeEnv();
  await writeFile(env.paths.reviewedPath, JSON.stringify([reviewedEntry({ sha256: "0".repeat(64) })]));
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  const [record] = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(record!.review, { state: "auto-checked" });
});

test("a missing reviewed.json is fine, entries for unknown ids are ignored, and a datetime keeps its date", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  assert.equal((await env.readJson<PolicyRecord[]>("policies.json"))[0]!.review.state, "auto-checked");

  await writeFile(env.paths.reviewedPath, JSON.stringify([reviewedEntry({ id: "no-such-record" }), reviewedEntry({ reviewedAt: "2026-10-16T08:30:00Z" })]));
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json"))[0]!.review, {
    state: "human-reviewed",
    reviewedAt: "2026-10-16",
    reviewer: "Dana Reviewer",
  });
});

test("a malformed reviewed.json stops the build with a message naming the file", async () => {
  const env = await makeEnv();
  const run = () => buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
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
      row("sg-landmark-two-2025", { landmark: "yes", type: "press-release" }),
      row("sg-plain-two-2025"),
    ),
  );
  const web = fakeWeb(siteFor("ca-landmark-one-2025", "ca-plain-one-2025", "sg-landmark-two-2025", "sg-plain-two-2025"));
  await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  const md = await env.read("review.md");
  assert.ok(md.includes("ca-landmark-one-2025"));
  assert.ok(md.includes("sg-landmark-two-2025"));
  assert.ok(!md.includes("ca-plain-one-2025"));
  assert.ok(!md.includes("sg-plain-two-2025"));
  assert.equal(md.split("- [ ] reviewed").length - 1, 2);
});

test("an excluded landmark is not in review.md", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
  const md = await env.read("review.md");
  assert.ok(md.includes(GOOD_ID));
  assert.ok(!md.includes("ca-ab-100-2024"), "a landmark with no official status has no record to review");
  assert.equal(md.split("- [ ] reviewed").length - 1, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Why a record is excluded

/** Every reason a record can be excluded with: a fixed phrase, never a path, a URL or provider text. */
const REASON_SET = /^(?:HTTP \d{3}|unreachable|too little text|loading failed|pdf extraction failed|browser fetch failed|no official summary found|no official status found|extraction failed)$/;

test("M8: no excluded reason holds a path, a URL or a newline, whatever went wrong; the console keeps the details", async () => {
  const secret = "/home/user/secret/file.ts at https://secret.example/token\nsecond line";
  const ids = ["ca-ok", "ca-http", "ca-gone", "ca-net", "ca-thin", "ca-png", "ca-pdf", "ca-nosummary"];
  const env = await makeEnv(candidatesMd(...ids.map((id) => row(id))));
  const html = (id: string) => new Response(page(id), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  const fetchImpl = (async (input: string | URL | Request) => {
    const id = String(input).split("/").pop()!;
    if (id === "ca-http") return new Response("no", { status: 403 });
    if (id === "ca-gone") return new Response("no", { status: 404 });
    if (id === "ca-net") throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND example.test ${secret}`);
    if (id === "ca-thin") return new Response("<html><body><p>Please log in.</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    if (id === "ca-png") return new Response("PNG", { status: 200, headers: { "content-type": "image/png" } });
    if (id === "ca-pdf") return new Response("%PDF-1.4 not really a pdf", { status: 200, headers: { "content-type": "application/pdf" } });
    if (id === "ca-nosummary")
      return new Response(`<html><body>${Array.from({ length: 30 }, (_, i) => `<p>${words(`s${i}x`, 10)}</p>`).join("")}</body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    return html(id);
  }) as typeof fetch;
  const lines: string[] = [];
  const { manifest } = await runBuild(env.opts({ fetchImpl, log: (l) => void lines.push(l) }));

  assert.deepEqual(Object.fromEntries(manifest.excluded.map((e) => [e.id, e.reason])), {
    "ca-http": "HTTP 403",
    "ca-gone": "HTTP 404",
    "ca-net": "unreachable",
    "ca-thin": "too little text",
    "ca-png": "loading failed",
    "ca-pdf": "pdf extraction failed",
    "ca-nosummary": "no official summary found",
  });
  for (const { reason } of manifest.excluded) {
    assert.match(reason, REASON_SET);
    assert.ok(!/[\\/\n]|:\/\//.test(reason), `a path, URL or newline in "${reason}"`);
  }
  for (const name of OUTPUTS) assert.ok(!(await env.read(name)).includes("secret"), name);
  const net = lines.find((l) => l.includes("ca-net"))!;
  assert.ok(net.includes("ENOTFOUND") && net.includes("/home/user/secret/file.ts"), "the console has the raw details");
  assert.ok(!net.includes("\n"));
});

test("a content exclusion (no official summary, no official status) is not a failed step and not a load failure", async () => {
  const env = await makeEnv();
  // 1 of the 4 listed documents fails to load (the 403): exactly 25% is allowed, and none of the failures is a landmark.
  const result = await runBuild(env.opts({ fetchImpl: fixtureWeb().impl, allowPartial: false }));
  const stat = (id: string) => result.stats.find((s) => s.id === id)!;
  assert.equal(stat("ca-ab-100-2024").failed, undefined);
  assert.equal(stat("ca-ab-100-2024").reason, "no official status found");
  assert.equal(stat("sg-mddi-brief-2024").failed, undefined);
  assert.doesNotMatch(formatSummary(result), /failed in a step/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Order, related records, and the shape of the inputs and outputs

test("outputs are sorted by id, passages by record then sequence, whatever order the candidates come in", async () => {
  const env = await makeEnv(candidatesMd(row("sg-zeta-2025"), row("ca-beta-2025", { url: "https://example.test/ca-beta-2025" }), row("ca-alpha-2025")));
  const web = fakeWeb({
    ...siteFor("sg-zeta-2025", "ca-alpha-2025"),
    "https://example.test/ca-beta-2025": page("ca-beta-2025", Array(12).fill(300)), // twelve passages: "#10" must follow "#9"
  });
  const manifest = await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), ["ca-alpha-2025", "ca-beta-2025", "sg-zeta-2025"]);
  const passages = await env.readPassages();
  assert.deepEqual(
    passages.map((p) => `${p.recordId}#${p.seq}`),
    [...passages].sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : a.seq - b.seq)).map((p) => `${p.recordId}#${p.seq}`),
  );
  assert.deepEqual(passages.filter((p) => p.recordId === "ca-beta-2025").map((p) => p.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(manifest.counts.total, 3);
});

test("excluded rows are sorted by id", async () => {
  const env = await makeEnv(candidatesMd(row("sg-b-2025"), row("ca-z-2025"), row("ca-a-2025")));
  const manifest = await buildSnapshot(env.opts({ fetchImpl: fakeWeb({}).impl }));
  assert.deepEqual(manifest.excluded.map((e) => e.id), ["ca-a-2025", "ca-z-2025", "sg-b-2025"]);
  assert.ok(manifest.excluded.every((e) => e.reason === "HTTP 404"));
});

test("related links come from the text of the records that were built: a bill named in a record's text, built, is linked; one that was excluded is not", async () => {
  const bill = (n: number, extra = "") => billPage(`ca-sb-${n}-2025`, { digest: [`Existing law requires an inventory of automated systems, kept every year by the state.${extra}`, `This bill would require a developer to publish a framework number ${n}.`] });
  const env = await makeEnv(
    candidatesMd(
      row("ca-sb-901-2025", { type: "bill", title: "Frontier models (SB 901)", url: "https://example.test/sb-901" }),
      row("ca-sb-902-2025", { type: "bill", title: "Chatbots (SB 902)", url: "https://example.test/sb-902" }),
      row("ca-sb-903-2025", { type: "bill", title: "Deepfakes (SB 903)", url: "https://example.test/sb-903" }),
      row("sg-sb-901-2025", { type: "guidance", title: "A Singapore note (SB 901)", url: "https://example.test/sg-note" }),
    ),
  );
  const web = fakeWeb({
    "https://example.test/sb-901": bill(901, " It follows Senate Bill 902 and SB 903 of the same session."),
    "https://example.test/sb-902": bill(902),
    "https://example.test/sb-903": billPage("ca-sb-903-2025", { history: null }), // no history: excluded
    "https://example.test/sg-note": page("sg-sb-901-2025"),
  });
  const manifest = await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  const byId = Object.fromEntries((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => [p.id, p]));
  assert.deepEqual(byId["ca-sb-901-2025"]!.related, [{ id: "ca-sb-902-2025", relation: "related" }]);
  assert.deepEqual(byId["ca-sb-902-2025"]!.related, []);
  assert.deepEqual(byId["sg-sb-901-2025"]!.related, [], "another jurisdiction is never linked");
  assert.deepEqual(manifest.excluded.map((e) => e.id), ["ca-sb-903-2025"]);
  assert.deepEqual(checkSnapshot({ policies: Object.values(byId), passages: await env.readJson("passages.json"), privatePassages: await env.readPrivate(), manifest }), []);
});

test("a candidate with include=no is neither built nor excluded", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-off-2025", { include: "no" })));
  const web = fakeWeb(siteFor("ca-a-2025", "ca-off-2025"));
  const manifest = await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  assert.equal(manifest.counts.total, 1);
  assert.deepEqual(manifest.excluded, []);
  assert.ok(!web.calls.some((u) => u.includes("ca-off-2025")), "an owner-dropped row is never fetched");
});

test("a source with too little text is excluded with the loader's reason", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb({ "https://example.test/ca-a-2025": "<html><body><p>Please log in.</p></body></html>" });
  const manifest = await buildSnapshot(env.opts({ fetchImpl: web.impl }));
  assert.equal(manifest.excluded[0]!.reason, "too little text");
});

test("a bad candidates.md stops the build instead of dropping rows", async () => {
  const env = await makeEnv(candidatesMd("| yes | not a slug | T | bill | ai-governance | s | no | https://example.test/x | seen | w |"));
  await assert.rejects(buildSnapshot(env.opts({ fetchImpl: fakeWeb({}).impl })), /candidates\.md/);
});

test("with no candidates the outputs are empty but valid", async () => {
  const env = await makeEnv(candidatesMd());
  const manifest = await buildSnapshot(env.opts({ fetchImpl: fakeWeb({}).impl }));
  assert.equal(manifest.counts.total, 0);
  assert.deepEqual(await env.readJson("policies.json"), []);
  assert.deepEqual(checkSnapshot({ policies: [], passages: [], manifest }), []);
  assert.match(await env.read("review.md"), /no landmark/i);
});

test("the build leaves no temporary files behind", async () => {
  const env = await makeEnv();
  await buildSnapshot(env.opts({ fetchImpl: fixtureWeb().impl }));
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

test("GeBIZ tenders are built from the structured row with no minimum word count, and are redistributable under the open data licence", async () => {
  const env = await makeEnv(candidatesMd());
  const web = gebizWeb();
  const manifest = await buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule() }));
  const policies = await env.readJson<PolicyRecord[]>("policies.json");
  assert.deepEqual(policies.map((p) => p.id), [...TENDER_IDS].sort());
  assert.equal(manifest.counts.byType.tender, 3);
  assert.equal(manifest.counts.byJurisdiction.SG, 3);
  const tender = policies.find((p) => p.id === "sg-gebiz-acr000ett21000003")!;
  assert.equal(tender.type, "tender");
  assert.equal(tender.landmark, false);
  assert.equal(tender.redistributionOk, true);
  assert.match(tender.attribution, /Singapore Open Data Licence/);
  assert.match(tender.url, /^https:\/\/data\.gov\.sg\/datasets\/d_test_dataset\/view#/);
  assert.equal(tender.status.value, "awarded");
  assert.match(tender.summary.value, /ACR000ETT21000003/);
  // The tender text is the structured description, so the passages are short, far below the 150-word gate.
  const passages = await env.readPassages();
  assert.ok(passages.every((p) => p.text.split(/\s+/).length < 150));
  assert.match(passages.find((p) => p.recordId === "sg-gebiz-acr000ett21000003")!.text, /Tender number: ACR000ETT21000003/);
  assert.deepEqual(checkSnapshot({ policies, passages, manifest }), []);
});

test("at most rule.max tenders are kept, taking the largest awards first", async () => {
  const env = await makeEnv(candidatesMd());
  const manifest = await buildSnapshot(env.opts({ fetchImpl: gebizWeb().impl, gebiz: true, gebizRule: gebizRule({ max: 2 }) }));
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), [TENDER_IDS[0], TENDER_IDS[1]]);
  assert.equal(manifest.counts.total, 2);
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
  const manifest = await buildSnapshot(env.opts({ fetchImpl, gebiz: true, gebizRule: gebizRule() }));
  assert.equal(manifest.counts.total, 40);
  const ids = (await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id);
  assert.ok(ids.includes("sg-gebiz-zzz000ett24000000"), "the largest award is kept");
  assert.ok(!ids.includes("sg-gebiz-zzz000ett24000044"), "the smallest award is not");
});

test("the tender texts are cached in rawDir/gebiz-tenders.json, so a re-run never asks data.gov.sg again and is byte-identical", async () => {
  const env = await makeEnv(candidatesMd());
  const web = gebizWeb();
  const options = () => env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule({ max: 2 }) });
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

  env.clock.now = new Date("2027-01-01T00:00:00.000Z");
  await buildSnapshot({ ...options(), fetchImpl: noFetch });
  assert.equal(web.urls.length, 1, "no second request to data.gov.sg");
  assert.deepEqual(await snapshotOf(env), first);
});

test("R16: a changed keyword list fetches the tenders again", async () => {
  const env = await makeEnv(candidatesMd());
  const web = gebizWeb();
  const build = (rule: GebizRule) => buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: rule }));
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
  const web = gebizWeb();
  const build = (rule: GebizRule) => buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: rule }));
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
  const web = gebizWeb();
  const build = (max: number) => buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule({ max }) }));
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
  const web = gebizWeb();
  const build = (rule: GebizRule) => buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: rule }));
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
  const web = gebizWeb();
  const groups = (cloudQuota: number): GebizRule["groups"] => [
    { name: "cloud", keywords: ["cloud", "registry"], quota: cloudQuota, topic: "data-centres" },
    { name: "ai", keywords: ["analytics"], quota: 1, topic: "ai-governance" },
  ];
  const build = (cloudQuota: number) =>
    buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule({ keywords: undefined, groups: groups(cloudQuota) }) }));

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
  const manifest = await buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule() }));
  assert.equal(web.urls.length, 1);
  assert.equal(manifest.counts.total, 3);
});

test("a damaged GeBIZ cache is fetched again instead of trusted", async () => {
  const env = await makeEnv(candidatesMd());
  const web = gebizWeb();
  await mkdir(env.paths.rawDir, { recursive: true });
  await writeFile(join(env.paths.rawDir, "gebiz-tenders.json"), '{"not": "a list"}');
  const manifest = await buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule({ max: 1 }) }));
  assert.equal(web.urls.length, 1);
  assert.equal(manifest.counts.total, 1);
});

test("with gebiz off (the default) data.gov.sg is never asked and no tenders are built", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = gebizWeb(siteFor("ca-a-2025"));
  const off = await buildSnapshot(env.opts({ fetchImpl: web.impl, gebizRule: gebizRule() }));
  assert.equal(web.urls.length, 0);
  assert.equal(off.counts.byType.tender, 0);
  const explicit = await buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: false, gebizRule: gebizRule() }));
  assert.equal(web.urls.length, 0);
  assert.equal(explicit.counts.total, 1);
});

test("tenders are built alongside the listed candidates", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const manifest = await buildSnapshot(env.opts({ fetchImpl: gebizWeb(siteFor("ca-a-2025")).impl, gebiz: true, gebizRule: gebizRule() }));
  assert.deepEqual((await env.readJson<PolicyRecord[]>("policies.json")).map((p) => p.id), ["ca-a-2025", ...TENDER_IDS].sort());
  assert.deepEqual(manifest.excluded, []);
});

test("a GeBIZ fetch that fails stops the build with a message that names GeBIZ", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const web = fakeWeb(siteFor("ca-a-2025")); // data.gov.sg is not routed: the fake answers 404
  await assert.rejects(buildSnapshot(env.opts({ fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule() })), /GeBIZ/);
});

test("a tender whose id is already a listed candidate stops the build", async () => {
  const env = await makeEnv(candidatesMd(row(TENDER_IDS[0]!)));
  await assert.rejects(buildSnapshot(env.opts({ fetchImpl: gebizWeb(siteFor(TENDER_IDS[0]!)).impl, gebiz: true, gebizRule: gebizRule() })), /duplicate/i);
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
  assert.ok(!md.includes("machine-written"), "no headline, no headline note");
  assert.equal(md.split("- [ ] reviewed").length - 1, 1);
});

test("renderReview shows a headline under the summary, marked as machine-written", () => {
  const record = sampleRecord({ headline: { value: "Big AI developers must publish safety plans.", support: ["ca-sample-2025#1"] } });
  const md = renderReview([record], samplePassages);
  assert.match(md, /machine-written/i);
  assert.ok(md.includes("Big AI developers must publish safety plans."));
  assert.ok(md.indexOf("Large developers must publish a framework.") < md.indexOf("Big AI developers must publish safety plans."));
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
  const record = sampleRecord({ summary: { value: "line one\nline two", support: ["ca-sample-2025#9"] } });
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

test("parseArgs reads --date, --no-gebiz and --llm-headlines, and rejects anything else", () => {
  assert.deepEqual(parseArgs([]), { gebiz: true });
  assert.deepEqual(parseArgs(["--no-gebiz"]), { gebiz: false });
  assert.deepEqual(parseArgs(["--llm-headlines"]), { gebiz: true, headlines: true });
  assert.deepEqual(parseArgs(["--date", "2026-03-04"]), { gebiz: true, date: "2026-03-04" });
  assert.deepEqual(parseArgs(["--date=2026-03-04", "--no-gebiz"]), { gebiz: false, date: "2026-03-04" });
  for (const bad of [["--date"], ["--date", "tomorrow"], ["--date", "2026-02-30"], ["--date", "2026-3-4"], ["--bogus"], ["extra"], ["--llm-headline"]]) {
    assert.throws(() => parseArgs(bad), /--date|argument/i, bad.join(" "));
  }
});

test("parseArgs reads --refresh, --refresh-all and --allow-partial", () => {
  assert.deepEqual(parseArgs(["--refresh"]), { gebiz: true, refresh: "downloads" });
  assert.deepEqual(parseArgs(["--refresh-all"]), { gebiz: true, refresh: "all" });
  assert.deepEqual(parseArgs(["--refresh", "--refresh-all"]), { gebiz: true, refresh: "all" });
  assert.deepEqual(parseArgs(["--allow-partial", "--no-gebiz", "--date", "2026-03-04"]), { gebiz: false, date: "2026-03-04", allowPartial: true });
});

type Logged = { out: string[]; err: string[] };
const sink = () => {
  const logged: Logged = { out: [], err: [] };
  return { logged, log: (line: string) => void logged.out.push(line), error: (line: string) => void logged.err.push(line) };
};

const emptyResult = (over: Partial<RunResult> = {}): RunResult => ({
  manifest: {
    snapshotDate: SNAPSHOT_DATE,
    builtAt: "2026-10-15T09:00:00.000Z",
    models: { enrich: "none", verify: "none" },
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

test("the command needs no key by default: it runs the build with no model, no key and no headlines", async () => {
  const dir = await mkdtemp(join(root, "cli-"));
  const io = sink();
  let seen: BuildOptions | undefined;
  const code = await main([], { env: {}, root: dir, run: async (options) => ((seen = options), emptyResult()), ...io });
  assert.equal(code, 0, io.logged.err.join("\n"));
  assert.ok(seen);
  assert.equal(seen.llm, undefined);
  assert.equal(seen.models, undefined);
  assert.ok(!seen.headlines);
  assert.ok(!io.logged.err.join("\n").includes("GROQ_API_KEY"));
});

test("--llm-headlines without GROQ_API_KEY fails before doing any work, and names the key and .dev.vars", async () => {
  const dir = await mkdtemp(join(root, "cli-"));
  const io = sink();
  let ran = false;
  const run = async () => {
    ran = true;
    throw new Error("must not run");
  };
  const code = await main(["--llm-headlines"], { env: {}, root: dir, run, ...io });
  assert.equal(code, 1);
  assert.equal(ran, false);
  assert.match(io.logged.err.join("\n"), /GROQ_API_KEY/);
  assert.match(io.logged.err.join("\n"), /\.dev\.vars/);

  const blank = await main(["--llm-headlines"], { env: { GROQ_API_KEY: "   " }, root: dir, run, ...sink() });
  assert.equal(blank, 1);
  assert.equal(ran, false);
});

test("a bad argument is reported with the usage line and a non-zero code", async () => {
  const io = sink();
  const code = await main(["--date", "soon"], { env: {}, root, run: async () => { throw new Error("must not run"); }, ...io });
  assert.equal(code, 1);
  assert.match(io.logged.err.join("\n"), /--date/);
  assert.match(io.logged.err.join("\n"), /snapshot:build/);
  assert.match(io.logged.err.join("\n"), /--llm-headlines/);
});

test("with --llm-headlines the command passes the default paths, the date, the models and the keys to the build", async () => {
  const dir = await mkdtemp(join(root, "cli-"));
  await writeFile(join(dir, ".dev.vars"), "GROQ_API_KEY=gsk_from_file\nBROWSERBASE_API_KEY=bb_from_file\nGROQ_ENRICH_MODEL=file/enrich\n");
  const io = sink();
  let seen: BuildOptions | undefined;
  const code = await main(["--llm-headlines", "--date", "2026-03-04", "--no-gebiz"], {
    env: { GROQ_VERIFY_MODEL: "env/verify" },
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
  assert.equal(seen.headlines, true);
  assert.equal(seen.candidatesPath, join(dir, "photon/data/snapshot/candidates.md"));
  assert.equal(seen.reviewedPath, join(dir, "photon/data/snapshot/reviewed.json"));
  assert.equal(seen.outDir, join(dir, "photon/data/snapshot"));
  assert.equal(seen.rawDir, join(dir, ".tmp-snapshot/raw"));
  assert.equal(seen.cacheDir, join(dir, ".tmp-snapshot/cache"));
  assert.deepEqual(seen.models, { enrich: "file/enrich", verify: "env/verify" });
  assert.equal(seen.browserbaseKey, "bb_from_file");
  assert.equal(typeof seen.llm!.enrich, "function");
  assert.equal(typeof seen.llm!.verify, "function");
  assert.ok(!io.logged.out.concat(io.logged.err).join("\n").includes("gsk_from_file"), "the key is never printed");
});

test("without the flag a key in .dev.vars is not used, the real environment wins over .dev.vars, and --date defaults to today and gebiz to on", async () => {
  const dir = await mkdtemp(join(root, "cli-"));
  await writeFile(join(dir, ".dev.vars"), "GROQ_API_KEY=gsk_from_file\nGROQ_ENRICH_MODEL=file/enrich\nBROWSERBASE_API_KEY=bb_file\n");
  let seen: BuildOptions | undefined;
  const run = async (options: BuildOptions) => ((seen = options), emptyResult());
  await main([], { env: { BROWSERBASE_API_KEY: "bb_env" }, root: dir, run, ...sink() });
  assert.equal(seen!.llm, undefined, "a key on disk does not turn the headlines on");
  assert.equal(seen!.browserbaseKey, "bb_env");
  assert.equal(seen!.gebiz, true);
  assert.match(seen!.snapshotDate, /^\d{4}-\d{2}-\d{2}$/);

  await main(["--llm-headlines"], { env: { GROQ_ENRICH_MODEL: "env/enrich" }, root: dir, run, ...sink() });
  assert.equal(seen!.models!.enrich, "env/enrich");
});

test("the command passes --refresh and --allow-partial to the build, and defaults to neither", async () => {
  let seen: BuildOptions | undefined;
  const run = async (options: BuildOptions) => ((seen = options), emptyResult());
  await main(["--refresh-all", "--allow-partial"], { env: {}, root, run, ...sink() });
  assert.equal(seen!.refresh, "all");
  assert.equal(seen!.allowPartial, true);
  await main(["--refresh"], { env: {}, root, run, ...sink() });
  assert.equal(seen!.refresh, "downloads");
  assert.ok(!seen!.allowPartial);
  await main([], { env: {}, root, run, ...sink() });
  assert.equal(seen!.refresh, undefined);
  assert.ok(!seen!.allowPartial);
});

test("a build that throws is reported with its message and a non-zero code", async () => {
  const io = sink();
  const code = await main([], { env: {}, root, run: async () => { throw new Error("candidates.md line 9: bad row"); }, ...io });
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
  const result = await runBuild(env.opts({ fetchImpl: web.impl }));
  const text = formatSummary(result);
  assert.match(text, /Snapshot as of 2026-10-15/);
  assert.match(text, /Models: enrich none, verify none\./);
  assert.doesNotMatch(text, /Headlines:/);
  assert.match(text, /Records: 2 \(US-CA 2, SG 0\)/);
  assert.match(text, /guidance 2/);
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

test("with headlines the summary counts them by outcome", async () => {
  const env = await landmarkEnv();
  const llms = fakeLlms({ unsupported: ["sg-land-2025"], writerThrows: { "ca-land-2025": exhausted() } });
  const result = await runBuild(env.withHeadlines(llms, { fetchImpl: landmarkWeb().impl }));
  const text = formatSummary(result);
  assert.match(text, /Models: enrich enrich-model, verify verify-model\./);
  assert.match(text, /Headlines: 0 of 2 landmarks \(1 dropped, 1 failed\)\./);
});

test("the summary does not flag a short tender, groups digits in a long word count, and says to run again for a record that failed in a step", () => {
  const result = emptyResult({
    stats: [
      { id: "sg-gebiz-x", jurisdiction: "SG", type: "tender", outcome: "built", words: 45, passages: 1, landmark: false, humanReviewed: false, dropped: [] },
      { id: "ca-big-2025", jurisdiction: "US-CA", type: "bill", outcome: "built", words: 12345, passages: 31, landmark: false, humanReviewed: false, dropped: ["provisions[1]", "affected[0]"] },
      { id: "ca-bug-2025", jurisdiction: "US-CA", type: "bill", outcome: "excluded", words: 900, passages: 4, landmark: false, humanReviewed: false, dropped: [], reason: "extraction failed", failed: true },
    ],
  });
  const text = formatSummary(result);
  const tender = text.split("\n").find((l) => l.includes("sg-gebiz-x"))!;
  const big = text.split("\n").find((l) => l.includes("ca-big-2025"))!;
  assert.match(tender, /45 words/);
  assert.doesNotMatch(tender, /short/i);
  assert.match(big, /12,345 words/);
  assert.match(big, /2 claims dropped \(provisions\[1\], affected\[0\]\)/, "the dropped claims are named (spec 5.4)");
  assert.match(text, /1 record failed in a step rather than on content\. Run again with --date 2026-10-15 after fixing the cause\./);
});

test("runBuild reports what happened to every candidate, and logs one line for each", async () => {
  const env = await makeEnv();
  const lines: string[] = [];
  const { stats } = await runBuild(env.opts({ fetchImpl: fixtureWeb().impl, log: (line) => void lines.push(line) }));
  assert.deepEqual(stats.map((s) => [s.id, s.outcome]), [
    ["ca-ab-100-2024", "excluded"],
    [GOOD_ID, "built"],
    ["sg-mddi-brief-2024", "excluded"],
    ["sg-pdpc-advisory-2024", "excluded"],
  ]);
  const good = stats.find((s) => s.id === GOOD_ID)!;
  assert.ok(good.words >= 400);
  assert.ok(good.passages >= 1);
  assert.equal(good.headline, undefined);
  assert.equal(good.landmark, true);
  assert.equal(good.humanReviewed, false);
  assert.equal(lines.filter((l) => l.includes(GOOD_ID)).length >= 1, true);
  assert.equal(lines.filter((l) => l.includes("sg-pdpc-advisory-2024") && l.includes("HTTP 403")).length >= 1, true);
  assert.equal(stats.find((s) => s.id === "sg-pdpc-advisory-2024")!.words, 0, "nothing was extracted from the 403");
});

test("main prints the summary and exits 0 after a successful build", async () => {
  const dir = await mkdtemp(join(root, "cli-"));
  const io = sink();
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const result = await runBuild(env.opts({ fetchImpl: fakeWeb(siteFor("ca-a-2025")).impl }));
  const code = await main([], { env: {}, root: dir, run: async () => result, ...io });
  assert.equal(code, 0);
  assert.match(io.logged.out.join("\n"), /ca-a-2025/);
  assert.match(io.logged.out.join("\n"), /words/);
});

// ---------------------------------------------------------------------------------------------------------------------
// I5: a build that lost many documents to load failures does not overwrite the committed snapshot

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

const three = () => candidatesMd(row("ca-a-2025"), row("ca-b-2025"), row("ca-c-2025"));
const threeWeb = () => fakeWeb(siteFor("ca-a-2025", "ca-b-2025", "ca-c-2025"));
const four = () => candidatesMd(row("ca-a-2025"), row("ca-b-2025"), row("ca-c-2025"), row("ca-d-2025"));
const webWithout = (missing: string[], ids = ["ca-a-2025", "ca-b-2025", "ca-c-2025", "ca-d-2025"]) =>
  fakeWeb(Object.fromEntries(ids.filter((id) => !missing.includes(id)).map((id) => [`https://example.test/${id}`, page(id)])));
const guarded = (env: Awaited<ReturnType<typeof makeEnv>>, over: Partial<BuildOptions> = {}) => runBuild(env.opts({ allowPartial: false, ...over }));

test("I5: more than 25% of the listed documents failing to load refuses to write, names the counts and keeps the old files", async () => {
  const env = await makeEnv(four());
  const seeded = await seedOutputs(env);
  const web = webWithout(["ca-b-2025", "ca-c-2025"]);
  await assert.rejects(guarded(env, { fetchImpl: web.impl }), (e: unknown) => {
    assert.ok(e instanceof SnapshotGuardError);
    assert.equal(e.kind, "partial");
    assert.match(e.message, /2 of the 4 listed documents/);
    assert.match(e.message, /50%/);
    assert.match(e.message, /25%/);
    assert.match(e.message, /nothing was written/i);
    assert.ok(e.message.includes(`--date ${SNAPSHOT_DATE}`), "how to run again");
    assert.ok(e.message.includes("--allow-partial"), "how to go ahead anyway");
    assert.doesNotMatch(e.message, /landmark/i, "no landmark failed");
    return true;
  });
  assert.deepEqual(await snapshotOf(env), seeded);
  assert.ok(await exists(join(env.paths.rawDir, "ca-a-2025.html")), "what loaded is kept for the rerun");
});

test("I5: exactly 25% is not more than 25%", async () => {
  const env = await makeEnv(four());
  const { manifest } = await guarded(env, { fetchImpl: webWithout(["ca-d-2025"]).impl });
  assert.deepEqual(manifest.excluded.map((e) => e.id), ["ca-d-2025"]);
  assert.equal(manifest.counts.total, 3);
});

test("I5: any landmark that fails to load refuses to write, even when it is far under 25%", async () => {
  const ids = ["ca-a-2025", "ca-b-2025", "ca-c-2025", "ca-d-2025", "ca-e-2025", "ca-f-2025", "ca-g-2025", "ca-h-2025"];
  const env = await makeEnv(candidatesMd(...ids.map((id) => row(id, { landmark: id === "ca-c-2025" || id === "ca-g-2025" ? "yes" : "no" }))));
  const seeded = await seedOutputs(env);
  await assert.rejects(guarded(env, { fetchImpl: webWithout(["ca-c-2025", "ca-g-2025"], ids).impl }), (e: unknown) => {
    assert.ok(e instanceof SnapshotGuardError);
    assert.equal(e.kind, "partial");
    assert.match(e.message, /2 of the 8 listed documents/);
    assert.match(e.message, /landmark/i);
    assert.ok(e.message.includes("ca-c-2025") && e.message.includes("ca-g-2025"), "the failed landmark ids are named");
    assert.ok(!e.message.includes("ca-a-2025"), "a failed non-landmark is not");
    return true;
  });
  assert.deepEqual(await snapshotOf(env), seeded);
});

test("I5: a landmark that loads but is excluded for its content (no official summary) is not a load failure", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025", { landmark: "yes" }), row("ca-b-2025")));
  const thin = `<html><body>${Array.from({ length: 30 }, (_, i) => `<p>${words(`t${i}x`, 10)}</p>`).join("")}</body></html>`;
  const { manifest } = await guarded(env, { fetchImpl: fakeWeb({ "https://example.test/ca-a-2025": thin, ...siteFor("ca-b-2025") }).impl });
  assert.deepEqual(manifest.excluded.map((e) => e.reason), ["no official summary found"]);
});

test("I5: every kind of load failure counts: HTTP errors, too little text, a bad content type, an unreachable host", async () => {
  const ids = ["ca-a-2025", "ca-b-2025", "ca-c-2025", "ca-d-2025", "ca-e-2025"];
  const env = await makeEnv(candidatesMd(...ids.map((id) => row(id))));
  const fetchImpl = (async (input: string | URL | Request) => {
    const id = String(input).split("/").pop()!;
    if (id === "ca-a-2025") return new Response("x", { status: 500 });
    if (id === "ca-b-2025") return new Response("<p>Log in</p>", { status: 200, headers: { "content-type": "text/html" } });
    if (id === "ca-c-2025") return new Response("PNG", { status: 200, headers: { "content-type": "image/png" } });
    if (id === "ca-d-2025") throw new TypeError("fetch failed");
    return new Response(page(id), { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  await assert.rejects(guarded(env, { fetchImpl }), (e: unknown) => e instanceof SnapshotGuardError && e.kind === "partial" && /4 of the 5/.test(e.message));
});

test("I5: GeBIZ tenders are not part of the 25%", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025"), row("ca-b-2025"), row("ca-c-2025")));
  const web = gebizWeb(siteFor("ca-a-2025", "ca-b-2025")); // ca-c-2025 is missing: 1 of 3 listed documents (33%) although there are 6 documents in all
  await assert.rejects(
    guarded(env, { fetchImpl: web.impl, gebiz: true, gebizRule: gebizRule() }),
    (e: unknown) => e instanceof SnapshotGuardError && e.kind === "partial" && /1 of the 3 listed documents/.test(e.message),
  );
});

test("I5: allowPartial writes the snapshot anyway", async () => {
  const env = await makeEnv(four());
  const { manifest } = await runBuild(env.opts({ fetchImpl: webWithout(["ca-b-2025", "ca-c-2025"]).impl, allowPartial: true }));
  assert.deepEqual(manifest.excluded.map((e) => e.id), ["ca-b-2025", "ca-c-2025"]);
  assert.equal(manifest.counts.total, 2);
  assert.ok(await exists(join(env.paths.outDir, "policies.json")));
});

test("I5: with no listed documents there is nothing to fail", async () => {
  const env = await makeEnv(candidatesMd());
  const { manifest } = await guarded(env, { fetchImpl: fakeWeb({}).impl });
  assert.equal(manifest.counts.total, 0);
});

test("I5: the auth guard comes before the partial guard, so a dead key is still reported as one", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025", { landmark: "yes" }), row("ca-b-2025"), row("ca-c-2025"), row("ca-d-2025")));
  const llms = fakeLlms({ writerThrows: { "ca-a-2025": unauthorised() } });
  await assert.rejects(
    guarded(env, { headlines: true, llm: llms.llm, models: HEADLINE_MODELS, fetchImpl: webWithout(["ca-b-2025", "ca-c-2025"]).impl }),
    (e: unknown) => e instanceof SnapshotGuardError && e.kind === "auth",
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// I6: a guarded run keeps its date, so a rerun reuses the cached answers

test("I6: the in-progress date is saved when a build starts, and removed after a successful write", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const file = join(env.paths.cacheDir, "in-progress.json");
  const web = fakeWeb(siteFor("ca-a-2025"));
  const seen: boolean[] = [];
  const spy = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(await exists(file)); // while the build is running
    return web.impl(input, init);
  }) as typeof fetch;
  await runBuild(env.opts({ fetchImpl: spy, snapshotDate: "2026-03-04" }));
  assert.deepEqual(seen, [true]);
  assert.equal(await exists(file), false, "cleared after the write");
});

test("I6: a build that is stopped by a guard leaves the in-progress date behind", async () => {
  const env = await makeEnv(three());
  const file = join(env.paths.cacheDir, "in-progress.json");
  await assert.rejects(runBuild(env.opts({ fetchImpl: fakeWeb({}).impl, snapshotDate: "2026-03-04", allowPartial: false })), SnapshotGuardError);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { snapshotDate: "2026-03-04" });
});

test("I6: every guard message tells how to run again with the same --date", async () => {
  const date = "2026-03-04";
  const refused = async (over: (env: Awaited<ReturnType<typeof makeEnv>>) => Partial<BuildOptions>) => {
    const env = await makeEnv(candidatesMd(row("ca-a-2025", { landmark: "yes" }), row("ca-b-2025"), row("ca-c-2025")));
    return runBuild({ ...env.opts({ allowPartial: false }), ...over(env), snapshotDate: date, allowPartial: false }).then(
      () => assert.fail("the build should have been refused"),
      (e: unknown) => e as SnapshotGuardError,
    );
  };
  const auth = await refused((env) => env.withHeadlines(fakeLlms({ writerThrows: { "ca-a-2025": unauthorised() } }), { fetchImpl: threeWeb().impl }));
  const partial = await refused(() => ({ fetchImpl: fakeWeb(siteFor("ca-b-2025")).impl }));
  assert.deepEqual([auth.kind, partial.kind], ["auth", "partial"]);
  for (const e of [auth, partial]) assert.ok(e.message.includes(`run again with --date ${date}`), `${e.kind}: ${e.message}`);
});

/** A project root with the three-candidate list (one landmark), for the command. */
async function cliRoot() {
  const dir = await mkdtemp(join(root, "cli-"));
  const dataDir = join(dir, "photon/data/snapshot");
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "candidates.md"), candidatesMd(row("ca-a-2025", { landmark: "yes" }), row("ca-b-2025", { landmark: "yes" }), row("ca-c-2025")));
  return { dir, dataDir, inProgress: join(dir, ".tmp-snapshot/cache/in-progress.json") };
}

test("I6: after a guarded --llm-headlines run, the command without --date reuses its date and does not repeat the cached model calls", async () => {
  const { dir, dataDir, inProgress } = await cliRoot();
  const web = threeWeb();
  const broken = fakeLlms({ writerThrows: { "ca-b-2025": unauthorised() } });
  const first = sink();
  const code1 = await main(["--llm-headlines", "--date", "2026-03-04", "--no-gebiz"], {
    env: { GROQ_API_KEY: "k" },
    root: dir,
    run: (options) => runBuild({ ...options, llm: broken.llm, fetchImpl: web.impl }),
    ...first,
  });
  assert.equal(code1, 1);
  assert.match(first.logged.err.join("\n"), /run again with --date 2026-03-04/);
  assert.equal(broken.writeCalls.length, 2, "ca-a was done; ca-b stopped the run");
  assert.deepEqual(JSON.parse(await readFile(inProgress, "utf8")), { snapshotDate: "2026-03-04" });

  const healthy = fakeLlms();
  const second = sink();
  let date: string | undefined;
  const code2 = await main(["--llm-headlines", "--no-gebiz"], {
    env: { GROQ_API_KEY: "k" },
    root: dir,
    run: (options) => ((date = options.snapshotDate), runBuild({ ...options, llm: healthy.llm, fetchImpl: web.impl })),
    ...second,
  });
  assert.equal(code2, 0, second.logged.err.join("\n"));
  assert.equal(date, "2026-03-04", "the date of the unfinished build");
  assert.equal(healthy.writeCalls.length, 1, "ca-b only: ca-a's headline is cached");
  assert.equal(healthy.checkCalls.length, 1);
  assert.match(second.logged.out.join("\n"), /Resuming the unfinished build dated 2026-03-04/);
  assert.equal(await exists(inProgress), false, "the success cleared it");
  assert.equal(JSON.parse(await readFile(join(dataDir, "manifest.json"), "utf8")).snapshotDate, "2026-03-04");

  // With nothing in progress, the date is today's again.
  let third: string | undefined;
  await main(["--no-gebiz"], { env: {}, root: dir, run: async (options) => ((third = options.snapshotDate), emptyResult()), ...sink() });
  assert.notEqual(third, "2026-03-04");
  assert.match(third!, /^\d{4}-\d{2}-\d{2}$/);
});

test("I6: an explicit --date wins over the date in progress and replaces it", async () => {
  const { dir, inProgress } = await cliRoot();
  await mkdir(join(dir, ".tmp-snapshot/cache"), { recursive: true });
  await writeFile(inProgress, JSON.stringify({ snapshotDate: "2026-03-04" }));
  let date: string | undefined;
  const run = async (options: BuildOptions) => ((date = options.snapshotDate), emptyResult());
  await main(["--date", "2026-05-06", "--no-gebiz"], { env: {}, root: dir, run, ...sink() });
  assert.equal(date, "2026-05-06");
});

test("I6: an in-progress file that is not a date is ignored", async () => {
  const { dir, inProgress } = await cliRoot();
  await mkdir(join(dir, ".tmp-snapshot/cache"), { recursive: true });
  for (const content of ["{ not json", JSON.stringify({ snapshotDate: "soon" }), JSON.stringify([])]) {
    await writeFile(inProgress, content);
    let date: string | undefined;
    await main(["--no-gebiz"], { env: {}, root: dir, run: async (options) => ((date = options.snapshotDate), emptyResult()), ...sink() });
    assert.match(date!, /^\d{4}-\d{2}-\d{2}$/, content);
    assert.notEqual(date, "soon");
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// I2 (second half): constructed URLs are listed for a person to look at

const openers = "https://example.test/";
test("I2: each built record with a constructed URL is listed with its title and what its page opens with, in the summary and in review.md", async () => {
  const env = await makeEnv(
    candidatesMd(
      row("ca-built-heading-2025", { confidence: "constructed", title: "SB 53 Frontier AI", landmark: "yes" }),
      row("ca-built-plain-2025", { confidence: "constructed", title: "AB 2013 Training data", url: `${openers}plain` }),
      row("ca-seen-2025", { confidence: "seen" }),
      row("ca-unsure-2025", { confidence: "seen (match unverified)", title: "Counts as constructed" }),
      row("ca-failed-2025", { confidence: "constructed", title: "Never loaded" }),
    ),
  );
  const plainBody = `<p>${words("opening", 3)} ${"long text ".repeat(100)}</p>`;
  const web = fakeWeb({
    ...siteFor("ca-built-heading-2025", "ca-seen-2025", "ca-unsure-2025"),
    [`${openers}plain`]: `<html><body>${plainBody}</body></html>`,
  });
  const result = await runBuild(env.opts({ fetchImpl: web.impl }));
  const text = formatSummary(result);
  const start = text.indexOf("Constructed URLs");
  assert.ok(start >= 0, text);
  const section = text.slice(start).split("\n\n")[0]!; // up to the blank line before the word counts
  assert.ok(section.includes('ca-built-heading-2025: "SB 53 Frontier AI" opens with "Heading of ca-built-heading-2025"'), section);
  const plain = section.split("\n").find((l) => l.includes("ca-built-plain-2025"))!;
  assert.match(plain, /"AB 2013 Training data" opens with "opening0 opening1 opening2 long text long text/);
  const opens = /opens with "([^"]*)"/.exec(plain)![1]!;
  assert.equal(opens.length, 80, "the first 80 characters of the text");
  assert.ok(section.includes("ca-unsure-2025"), "'seen (match unverified)' counts as constructed");
  assert.ok(!section.includes("ca-seen-2025"));
  assert.ok(!section.includes("ca-failed-2025"), "a record that was not built has no page to look at");

  const md = await env.read("review.md");
  assert.ok(md.includes("Constructed URLs"));
  const reviewSection = md.slice(md.indexOf("## Constructed URLs"));
  for (const id of ["ca-built-heading-2025", "ca-built-plain-2025", "ca-unsure-2025"]) assert.ok(reviewSection.includes(id), id);
  assert.ok(reviewSection.includes("SB 53 Frontier AI") && reviewSection.includes("Heading of ca-built-heading-2025"));
  assert.ok(reviewSection.includes(`${openers}plain`), "a link to the page");
  assert.ok(!reviewSection.includes("ca-seen-2025"));
  assert.equal(md.split("- [ ] reviewed").length - 1, 1, "only the landmark has a review box");
});

test("I2: tenders are not listed as constructed URLs, and nothing is printed when no record has one", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const result = await runBuild(env.opts({ fetchImpl: gebizWeb(siteFor("ca-a-2025")).impl, gebiz: true, gebizRule: gebizRule() }));
  assert.doesNotMatch(formatSummary(result), /Constructed URLs/);
  assert.doesNotMatch(await env.read("review.md"), /Constructed URLs/);
});

test("I2: renderReview lists the checks it is given even when there is no landmark", () => {
  const record = sampleRecord({ landmark: false, title: "A bill" });
  const md = renderReview([record], samplePassages, [{ id: record.id, opens: "Findings" }]);
  assert.match(md, /no landmark/i);
  assert.ok(md.includes("Constructed URLs"));
  assert.ok(md.includes(`${record.id}: "A bill" opens with "Findings"`));
  assert.ok(md.includes(record.url));
  assert.doesNotMatch(renderReview([record], samplePassages), /Constructed URLs/);
});

// ---------------------------------------------------------------------------------------------------------------------
// The proxy note: an unreachable network gets a hint

test("a build where every source is unreachable says to check NODE_USE_ENV_PROXY and the network", async () => {
  const env = await makeEnv(three());
  const offline = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  await assert.rejects(guarded(env, { fetchImpl: offline }), (e: unknown) => {
    assert.ok(e instanceof SnapshotGuardError && e.kind === "partial");
    assert.match(e.message, /3 of the 3 listed documents/);
    assert.match(e.message, /NODE_USE_ENV_PROXY=1/);
    assert.match(e.message, /network settings/i);
    return true;
  });
});

test("the hint is not given when the sources failed for other reasons", async () => {
  const env = await makeEnv(three());
  await assert.rejects(guarded(env, { fetchImpl: fakeWeb({}).impl }), (e: unknown) => e instanceof SnapshotGuardError && !/PROXY/.test(e.message));
  const ok = await makeEnv(three());
  const result = await runBuild(ok.opts({ fetchImpl: fakeWeb({}).impl }));
  assert.doesNotMatch(formatSummary(result), /PROXY/);
});

test("with --allow-partial the summary still carries the hint when every source was unreachable", async () => {
  const env = await makeEnv(three());
  const offline = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  const result = await runBuild(env.opts({ fetchImpl: offline }));
  assert.match(formatSummary(result), /NODE_USE_ENV_PROXY=1/);
});

test("a GeBIZ fetch that fails on the network says to check the proxy and network settings", async () => {
  const env = await makeEnv(candidatesMd(row("ca-a-2025")));
  const cause = Object.assign(new Error("getaddrinfo ENOTFOUND data.gov.sg"), { code: "ENOTFOUND" });
  const offline = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause }); }) as typeof fetch;
  await assert.rejects(buildSnapshot(env.opts({ fetchImpl: offline, gebiz: true, gebizRule: gebizRule() })), /GeBIZ[^]*NODE_USE_ENV_PROXY=1/);
  // An HTTP error from the API is not a network problem.
  await assert.rejects(buildSnapshot(env.opts({ fetchImpl: fakeWeb({}).impl, gebiz: true, gebizRule: gebizRule() })), (e: unknown) => /GeBIZ/.test(String(e)) && !/PROXY/.test(String(e)));
});

// ---------------------------------------------------------------------------------------------------------------------
// Singapore Statutes Online: the build's log carries the Act's progress lines, and an Act never goes to the browser

const SSO_URL = "https://sso.agc.gov.sg/Act/FIXT2024?WholeDoc=1";
const ssoTerms = ["t-2", "t-3"];
const ssoPage = () => {
  const cfg = {
    lazyLoadFilter: { TocSysId: "toc-1", SeriesId: null, V: "41" },
    lazyLoadContentUrl: "/Details/GetLazyLoadContent",
    fragments: Object.fromEntries(ssoTerms.map((t) => [t, { Item1: `f-${t}`, Item2: "20260714171716" }])),
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title></title></head><body>
<div class="global-vars" data-json='${JSON.stringify(cfg)}'></div><nav>Contents</nav>
<div id="legisContent"><p>Fixture Act front part ${words("front", 40)}</p>${ssoTerms.map((t) => `<div class="dms" data-field="seriesId" data-term="${t}"></div>`).join("")}</div></body></html>`;
};
const ssoFast = { pauseMs: 0, sleep: async () => undefined, retryWaitMs: 1, challengeWaitMs: 1, maxAttempts: 2 };
const ssoSite = (fail?: string) =>
  (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/Details/GetLazyLoadContent")) {
      const term = new URL(url).searchParams.get("SeriesId")!;
      if (term === fail) return new Response("error", { status: 500 });
      return new Response(`<table><tr><td>Part for ${term} ${words(`part${term.replace("-", "")}w`, 60)}</td></tr></table>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response(ssoPage(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch;

test("an Act's progress lines go to the build's log, as the build's own sso log", async () => {
  const env = await makeEnv(candidatesMd(row("sg-fixt-2024", { type: "statute", url: SSO_URL, title: "Fixture Act 2024" })));
  const lines: string[] = [];
  await runBuild(env.opts({ fetchImpl: ssoSite(), sso: ssoFast, log: (l) => void lines.push(l) }));
  const parts = lines.filter((l) => l.startsWith("sso FIXT2024"));
  assert.deepEqual(parts, ["sso FIXT2024: part 1/2", "sso FIXT2024: part 2/2"]);
  assert.ok(lines.some((l) => l.includes("sg-fixt-2024")), "and the record's own line");
});

test("an Act with a part that cannot be loaded ends loading failed, never read through the browser", async () => {
  const env = await makeEnv(candidatesMd(row("sg-fixt-2024", { type: "statute", url: SSO_URL, title: "Fixture Act 2024" })));
  const site = ssoSite("t-3");
  const urls: string[] = [];
  const spy = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    return site(input, init);
  }) as typeof fetch;
  const manifest = await buildSnapshot(env.opts({ fetchImpl: spy, sso: ssoFast, browserbaseKey: "bb-key" }));
  assert.deepEqual(manifest.excluded.map((e) => [e.id, e.reason]), [["sg-fixt-2024", "loading failed"]]);
  assert.ok(urls.length > 0 && urls.every((u) => u.startsWith("https://sso.agc.gov.sg/")), "only the Act's own site was asked");
  assert.equal(await exists(join(env.paths.rawDir, "sg-fixt-2024.html")), false, "a partial Act is never cached");
});
