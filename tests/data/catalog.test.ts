import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ask, type Env } from "../../photon/src/ask.ts";
import { loadCatalog, type Catalog } from "../../photon/src/catalog.ts";
import type { D1Like } from "../../photon/src/data/d1.ts";
import type { Manifest, Passage, PolicyRecord, RecordSummary } from "../../photon/src/data/schema.ts";
import { snapshotStatements } from "../../photon/src/data/seed.ts";
import { listRecords } from "../../photon/src/data/store.ts";
import { recordItems } from "../../photon/src/select.ts";
import { openTestDb } from "../helpers/d1.ts";

const fixtureDir = fileURLToPath(new URL("../fixtures/snapshot/", import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(fixtureDir + name, "utf8"));
const policies: PolicyRecord[] = load("policies.json");
const passages: Passage[] = load("passages.json");
const manifest: Manifest = load("manifest.json");

async function seed(db: D1Like, p = policies, ps = passages, m = manifest) {
  await db.batch(snapshotStatements(p, ps, m).map((s) => db.prepare(s.sql).bind(...s.params)));
}

/** A D1 whose every call fails, the way a binding that is down or unmigrated does. */
const brokenDb: D1Like = {
  prepare() {
    throw new Error("D1 is down");
  },
  batch() {
    throw new Error("D1 is down");
  },
};

const EMPTY: Catalog = { blocked: [], jurisdictions: [], sources: [], latest: [], snapshotDate: "" };

/** The store failures below are logged by design; keep the test output clean. */
function silenceWarnings() {
  beforeEach(() => {
    mock.method(console, "warn", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
  });
}

describe("loadCatalog on a seeded database", () => {
  let db: D1Like;
  let dispose: () => Promise<void>;
  let catalog: Catalog;

  before(async () => {
    ({ db, dispose } = await openTestDb());
    await seed(db);
    catalog = await loadCatalog(db);
  });
  after(() => dispose());

  test("jurisdictions come from the manifest counts", () => {
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    assert.deepEqual(
      [...catalog.jurisdictions].sort(byId),
      [
        { id: "US-CA", label: "US-CA", documents: 3 },
        { id: "SG", label: "SG", documents: 3 },
      ].sort(byId),
    );
  });

  test("sources group the records by publisher", () => {
    const byId = new Map(catalog.sources.map((s) => [s.id, s]));
    assert.equal(byId.size, catalog.sources.length);
    assert.deepEqual([...byId.keys()].sort(), [
      "AI Verify Foundation",
      "California Legislative Information",
      "California Privacy Protection Agency",
      "GeBIZ via data.gov.sg",
      "Personal Data Protection Commission",
    ]);
    assert.equal(byId.get("California Legislative Information")?.documents, 2);
    assert.equal(byId.get("GeBIZ via data.gov.sg")?.documents, 1);
    assert.equal(catalog.sources.reduce((n, s) => n + s.documents, 0), policies.length);
    for (const source of catalog.sources) {
      const first = policies.find((r) => r.publisher === source.id)!;
      assert.equal(source.redistributionOk, first.redistributionOk);
      assert.equal(source.attribution, first.attribution);
    }
  });

  test("latest has at most 10 rows, newest published first", () => {
    assert.ok(catalog.latest.length > 0 && catalog.latest.length <= 10);
    const dates = catalog.latest.map((d) => d.published);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.equal(catalog.latest.length, policies.length);
  });

  test("a latest row carries the record's provenance", () => {
    const [top] = catalog.latest;
    const sb53 = policies.find((r) => r.id === "ca-sb-53-2025")!;
    assert.deepEqual(top, {
      title: sb53.title,
      kind: "bill",
      jurisdiction: "US-CA",
      sourceId: sb53.publisher,
      published: sb53.published,
      url: sb53.url,
      fetched: sb53.fetched,
      sha256: sb53.sha256,
      redistributionOk: sb53.redistributionOk,
      attribution: sb53.attribution,
    });
  });

  test("blocked comes from the manifest's excluded list", () => {
    assert.equal(catalog.blocked.length, 1);
    assert.equal(catalog.blocked[0].id, "sg-sso-osa-2022");
    assert.equal(catalog.blocked[0].error, "HTTP 403");
    assert.deepEqual(catalog.blocked[0], {
      id: "sg-sso-osa-2022",
      jurisdiction: "SG",
      live: false,
      ended: manifest.builtAt,
      error: "HTTP 403",
      url: "https://sso.agc.gov.sg/",
      attribution: "",
      officialText: false,
    });
  });

  test("snapshotDate is the manifest's", () => {
    assert.equal(catalog.snapshotDate, "2026-10-01");
  });
});

describe("loadCatalog with more records than the latest list holds", () => {
  let db: D1Like;
  let dispose: () => Promise<void>;

  before(async () => {
    ({ db, dispose } = await openTestDb());
  });
  after(() => dispose());

  test("keeps the 10 newest published and leaves out records with no published date", async () => {
    const template = policies[0];
    const clones: PolicyRecord[] = Array.from({ length: 8 }, (_, i) => ({
      ...template,
      id: `clone-${i}`,
      published: `2026-0${i + 1}-15`,
    }));
    const undated: PolicyRecord = { ...template, id: "clone-undated" };
    delete undated.published;
    await seed(db, [...policies, ...clones, undated], [], { ...manifest, counts: { ...manifest.counts, total: 15 } });

    const { latest, sources } = await loadCatalog(db);
    assert.equal(latest.length, 10);
    const dates = latest.map((d) => d.published);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.equal(dates[0], "2026-08-15");
    assert.ok(latest.every((d) => d.published));
    // The undated record still counts toward its publisher.
    assert.equal(
      sources.find((s) => s.id === template.publisher)?.documents,
      [...policies, ...clones, undated].filter((r) => r.publisher === template.publisher).length,
    );
  });
});

describe("loadCatalog without data", () => {
  silenceWarnings();

  test("an empty, migrated D1 gives empty lists and no snapshot date", async () => {
    const { db, dispose } = await openTestDb();
    try {
      assert.deepEqual(await loadCatalog(db), EMPTY);
    } finally {
      await dispose();
    }
  });

  test("a D1 that was never migrated gives empty lists instead of throwing", async () => {
    const { db, dispose } = await openTestDb({ migrate: false });
    try {
      await assert.rejects(listRecords(db), /no such table/);
      assert.deepEqual(await loadCatalog(db), EMPTY);
    } finally {
      await dispose();
    }
  });

  test("a D1 whose prepare throws gives empty lists and no snapshot date", async () => {
    assert.deepEqual(await loadCatalog(brokenDb), EMPTY);
  });

  test("a missing binding gives empty lists", async () => {
    assert.deepEqual(await loadCatalog(undefined as unknown as D1Like), EMPTY);
  });
});

describe("recordItems", () => {
  let summaries: RecordSummary[];
  let dispose: () => Promise<void>;

  before(async () => {
    const opened = await openTestDb();
    dispose = opened.dispose;
    await seed(opened.db);
    summaries = await listRecords(opened.db);
  });
  after(() => dispose());

  test("a record becomes a policy item whose plain text is its summary", () => {
    const item = recordItems(summaries).find((i) => i.id === "ca-sb-53-2025")!;
    const sb53 = policies.find((r) => r.id === "ca-sb-53-2025")!;
    assert.equal(item.source, "policy");
    assert.equal(item.title, sb53.title);
    assert.equal(item.plain, sb53.summary.value);
    assert.equal(item.url, sb53.url);
    assert.equal(item.happenedAt, sb53.published);
    assert.equal(item.jurisdiction, "US-CA");
  });

  test("one item per record, in the order given", () => {
    assert.deepEqual(
      recordItems(summaries).map((i) => i.id),
      summaries.map((r) => r.id),
    );
    assert.deepEqual(recordItems([]), []);
  });

  test("happenedAt falls back to the status date, and is left out when there is neither", () => {
    const base = summaries[0];
    const noPublished = { ...base, published: undefined, statusDate: "2026-01-01" };
    const noDates = { ...base, published: undefined, statusDate: undefined };
    assert.equal(recordItems([noPublished])[0].happenedAt, "2026-01-01");
    assert.equal("happenedAt" in recordItems([noDates])[0], false);
  });
});

describe("the chat pool", () => {
  let realFetch: typeof fetch;
  before(() => {
    realFetch = globalThis.fetch;
    // OpenAlex is the only network call on this path; make it fail fast and offline.
    globalThis.fetch = (async () => new Response("{}", { status: 503 })) as typeof fetch;
  });
  after(() => {
    globalThis.fetch = realFetch;
  });
  silenceWarnings();

  const envFor = (db: D1Like) => ({ DB: db }) as unknown as Env;
  const question = "What is the Transparency in Frontier Artificial Intelligence Act?";

  test("answers from the seeded policy records", async () => {
    const { db, dispose } = await openTestDb();
    try {
      await seed(db);
      const result = await ask(question, envFor(db));
      const sb53 = policies.find((r) => r.id === "ca-sb-53-2025")!;
      const card = result.items.find((c) => c.title === sb53.title);
      assert.ok(card, `cards: ${result.items.map((c) => c.title).join(" | ")}`);
      assert.equal(card.source, "policy");
      assert.equal(card.plain, sb53.summary.value);
      assert.match(result.reply, /SB 53 requires/);
    } finally {
      await dispose();
    }
  });

  test("an unseeded D1 still gets a reply, with no cards", async () => {
    const { db, dispose } = await openTestDb();
    try {
      const result = await ask(question, envFor(db));
      assert.deepEqual(result.items, []);
      assert.equal(typeof result.reply, "string");
      assert.ok(result.reply.length > 0);
    } finally {
      await dispose();
    }
  });

  test("a D1 that was never migrated still gets a reply, with no cards", async () => {
    const { db, dispose } = await openTestDb({ migrate: false });
    try {
      const result = await ask(question, envFor(db));
      assert.deepEqual(result.items, []);
      assert.ok(result.reply.length > 0);
    } finally {
      await dispose();
    }
  });

  test("a broken or missing binding still gets a reply, with no cards", async () => {
    for (const DB of [brokenDb, undefined]) {
      const result = await ask(question, { DB } as unknown as Env);
      assert.deepEqual(result.items, []);
      assert.ok(result.reply.length > 0);
    }
  });
});
