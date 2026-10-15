import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { D1Like } from "../../photon/src/data/d1.ts";
import { lastActivity } from "../../photon/src/data/schema.ts";
import type { Manifest, Passage, PolicyRecord, RecordSummary } from "../../photon/src/data/schema.ts";
import { snapshotStatements } from "../../photon/src/data/seed.ts";
import {
  getManifest,
  getRecord,
  listRecords,
  recentChanges,
  searchPassages,
} from "../../photon/src/data/store.ts";
import { openTestDb } from "../helpers/d1.ts";

const fixtureDir = fileURLToPath(new URL("../fixtures/snapshot/", import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(fixtureDir + name, "utf8"));
const policies: PolicyRecord[] = load("policies.json");
const passages: Passage[] = load("passages.json");
const manifest: Manifest = load("manifest.json");

async function seed(db: D1Like, p = policies, ps = passages, m = manifest) {
  await db.batch(snapshotStatements(p, ps, m).map((s) => db.prepare(s.sql).bind(...s.params)));
}

/** What listRecords should say about a fixture record. Optional keys are absent, not undefined. */
function summaryOf(r: PolicyRecord): RecordSummary {
  return {
    id: r.id,
    jurisdiction: r.jurisdiction,
    type: r.type,
    title: r.title,
    ...(r.shortTitle !== undefined && { shortTitle: r.shortTitle }),
    status: r.status.value,
    ...(r.statusDate !== undefined && { statusDate: r.statusDate }),
    ...(r.published !== undefined && { published: r.published }),
    lastActivity: lastActivity(r),
    summary: r.summary.value,
    url: r.url,
    publisher: r.publisher,
    landmark: r.landmark,
    reviewState: r.review.state,
  };
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const recordIds = (hits: { record: { id: string } }[]) => [...new Set(hits.map((h) => h.record.id))].sort();

describe("seeded database", () => {
  let db: D1Like;
  let dispose: () => Promise<void>;

  before(async () => {
    ({ db, dispose } = await openTestDb());
    await seed(db);
  });
  after(() => dispose());

  describe("searchPassages", () => {
    test("frontier matches only the two California bills, best first", async () => {
      const hits = await searchPassages(db, "frontier");
      assert.ok(hits.length > 0);
      assert.deepEqual(recordIds(hits), ["ca-sb-1047-2024", "ca-sb-53-2025"]);
      for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score);
      assert.ok(hits.every((h) => Number.isFinite(h.score) && h.score >= 0));
    });

    test("a hit carries the passage, its record summary and a score", async () => {
      const [top] = await searchPassages(db, "frontier");
      const passage = passages.find((p) => p.id === top.passage.id);
      assert.deepEqual(top.passage, passage);
      const record = policies.find((r) => r.id === top.record.id)!;
      assert.deepEqual(top.record, summaryOf(record));
    });

    test("the jurisdiction filter applies", async () => {
      assert.deepEqual(await searchPassages(db, "frontier", { jurisdiction: "SG" }), []);
      const ca = await searchPassages(db, "frontier", { jurisdiction: "US-CA" });
      assert.deepEqual(recordIds(ca), ["ca-sb-1047-2024", "ca-sb-53-2025"]);
    });

    test("consent ranks the PDPA first", async () => {
      const hits = await searchPassages(db, "consent");
      assert.equal(hits[0].record.id, "sg-pdpa-2012");
    });

    test("data centre with the data-centres topic returns only the tender", async () => {
      const hits = await searchPassages(db, "data centre", { topics: ["data-centres"] });
      assert.ok(hits.length > 0);
      assert.deepEqual(recordIds(hits), ["sg-gebiz-dc-2025"]);
    });

    test("stemming: centres finds centre", async () => {
      const hits = await searchPassages(db, "centres");
      assert.ok(recordIds(hits).includes("sg-gebiz-dc-2025"));
    });

    test("a heading-only or title-only term is searchable", async () => {
      const byHeading = await searchPassages(db, "veto message");
      assert.ok(byHeading.some((h) => h.passage.id === "ca-sb-1047-2024#1"));
      const t = policies.find((r) => r.id === "sg-pdpa-2012")!;
      const titleWord = t.title.split(/\s+/).find((w) => /^[A-Za-z]{6,}$/.test(w))!;
      const byTitle = await searchPassages(db, titleWord);
      assert.ok(recordIds(byTitle).includes("sg-pdpa-2012"));
    });

    test("filters agree with filtering the unfiltered hits", async () => {
      const all = await searchPassages(db, "report", {}, 100);
      assert.deepEqual(new Set(all.map((h) => h.record.type)), new Set(["bill", "guidance", "tender"]));
      assert.equal(new Set(all.map((h) => h.record.jurisdiction)).size, 2);
      const idsOf = (hits: typeof all) => hits.map((h) => h.passage.id);

      const tender = await searchPassages(db, "report", { types: ["tender"] }, 100);
      assert.deepEqual(idsOf(tender), idsOf(all.filter((h) => h.record.type === "tender")));
      assert.ok(tender.length > 0 && tender.length < all.length);

      const twoTypes = await searchPassages(db, "report", { types: ["tender", "guidance"] }, 100);
      assert.deepEqual(idsOf(twoTypes), idsOf(all.filter((h) => h.record.type === "tender" || h.record.type === "guidance")));
      assert.ok(twoTypes.length > tender.length);

      const since = "2025-06-01";
      const recent = await searchPassages(db, "report", { since }, 100);
      assert.deepEqual(idsOf(recent), idsOf(all.filter((h) => h.record.lastActivity >= since)));
      assert.ok(recent.length > 0 && recent.length < all.length);

      const sg = await searchPassages(db, "report", { jurisdiction: "SG" }, 100);
      assert.deepEqual(idsOf(sg), idsOf(all.filter((h) => h.record.jurisdiction === "SG")));

      const combined = await searchPassages(db, "data", { jurisdiction: "SG", topics: ["privacy-data"], since: "2021-01-01" }, 100);
      assert.deepEqual(recordIds(combined), ["sg-pdpa-2012"]);
      assert.deepEqual(await searchPassages(db, "data", { jurisdiction: "SG", topics: ["privacy-data"], since: "2021-02-02" }), []);
    });

    test("empty filter arrays mean no filter", async () => {
      const all = await searchPassages(db, "report", {}, 100);
      const empty = await searchPassages(db, "report", { types: [], topics: [] }, 100);
      assert.deepEqual(empty.map((h) => h.passage.id), all.map((h) => h.passage.id));
    });

    test("a record with two matching topics is returned once per passage", async () => {
      const hits = await searchPassages(db, "tender", { topics: ["gov-tech-procurement", "data-centres"] }, 100);
      const keys = hits.map((h) => h.passage.id);
      assert.equal(new Set(keys).size, keys.length);
      assert.ok(keys.length > 0);
    });

    test("limit is honoured", async () => {
      const all = await searchPassages(db, "report", {}, 100);
      assert.ok(all.length > 2);
      assert.equal((await searchPassages(db, "report", {}, 2)).length, 2);
      assert.equal((await searchPassages(db, "report", {}, 1)).length, 1);
      assert.deepEqual(await searchPassages(db, "report", {}, 0), []);
      assert.deepEqual(await searchPassages(db, "report", {}, Number.NaN), all);
      assert.deepEqual(
        (await searchPassages(db, "report", {}, 2)).map((h) => h.passage.id),
        all.slice(0, 2).map((h) => h.passage.id),
      );
    });

    test("hostile input resolves to [] or hits and never throws", async () => {
      const hostile = [
        '"',
        '""',
        '"; DROP TABLE records; --',
        "'; DROP TABLE passages; --",
        "NEAR(a b)",
        "NEAR(frontier AI, 3)",
        "*",
        "frontier*",
        "AND OR NOT",
        "frontier AND OR NOT",
        "title:frontier",
        "{title text}: frontier",
        "^frontier",
        "-frontier",
        "(((",
        ")))",
        "\\",
        "\0",
        "́",
        "🙂",
        "🙂🙂 frontier",
        "数据 中心",
        "Pelan Perlindungan Data Peribadi",
        "the of and",
        "",
        "   ",
        "frontier ".repeat(400),
        Array.from({ length: 600 }, (_, i) => `w${i}`).join(" ").slice(0, 2000),
        "x".repeat(2000),
        "é".repeat(500),
      ];
      for (const text of hostile) {
        const hits = await searchPassages(db, text);
        assert.ok(Array.isArray(hits), JSON.stringify(text));
      }
      // nothing was dropped by the injection attempts
      assert.equal((await listRecords(db)).length, 6);
      assert.ok((await searchPassages(db, "frontier")).length > 0);
    });

    test("operator words are dropped and the remaining terms are all required", async () => {
      const plain = await searchPassages(db, "frontier");
      const withNot = await searchPassages(db, "frontier NOT consent");
      // "not" is a stop-word and "consent" is just another required term, and no passage has both
      assert.deepEqual(withNot, []);
      assert.ok(plain.length > 0);
    });
  });

  describe("getRecord", () => {
    test("returns the full record", async () => {
      const expected = policies.find((r) => r.id === "ca-sb-53-2025");
      assert.deepEqual(await getRecord(db, "ca-sb-53-2025"), expected);
    });

    test("returns every fixture record unchanged", async () => {
      for (const r of policies) assert.deepEqual(await getRecord(db, r.id), r);
    });

    test("returns null for a missing id", async () => {
      assert.equal(await getRecord(db, "missing"), null);
      assert.equal(await getRecord(db, ""), null);
      assert.equal(await getRecord(db, "' OR 1=1 --"), null);
    });
  });

  describe("recentChanges", () => {
    const allEvents = policies
      .flatMap((r) => r.timeline.map((e) => ({ date: e.date, event: e.event, id: r.id })))
      .map((e, i) => ({ ...e, i }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : a.i - b.i));

    test("lists events newest first with their record", async () => {
      const changes = await recentChanges(db, { since: "2024-01-01" });
      assert.ok(changes.length > 0);
      for (let i = 1; i < changes.length; i++) assert.ok(changes[i - 1].date >= changes[i].date);
      for (const c of changes) {
        const r = policies.find((x) => x.id === c.record.id)!;
        assert.deepEqual(c.record, summaryOf(r));
      }
      assert.deepEqual(
        changes.map((c) => ({ date: c.date, event: c.event, id: c.record.id })),
        allEvents.filter((e) => e.date >= "2024-01-01").map(({ date, event, id }) => ({ date, event, id })),
      );
    });

    test("since is inclusive and excludes older events", async () => {
      const changes = await recentChanges(db, { since: "2025-09-29" });
      assert.ok(changes.length > 0);
      assert.ok(changes.every((c) => c.date >= "2025-09-29"));
      assert.ok(changes.some((c) => c.date === "2025-09-29"));
      assert.deepEqual(await recentChanges(db, { since: "2999-01-01" }), []);
    });

    test("filters apply", async () => {
      const sg = await recentChanges(db, { since: "2024-01-01", jurisdiction: "SG" });
      assert.ok(sg.length > 0);
      assert.ok(sg.every((c) => c.record.jurisdiction === "SG"));
      const tender = await recentChanges(db, { since: "2024-01-01", types: ["tender"] });
      assert.deepEqual(ids(tender.map((c) => c.record)), ["sg-gebiz-dc-2025"]);
      const dc = await recentChanges(db, { since: "2024-01-01", topics: ["data-centres"] });
      assert.deepEqual(ids(dc.map((c) => c.record)), ["sg-gebiz-dc-2025"]);
    });

    test("limit is honoured and the default is 20", async () => {
      assert.equal((await recentChanges(db, { since: "2024-01-01" }, 3)).length, 3);
      assert.deepEqual(
        (await recentChanges(db, { since: "2024-01-01" }, 3)).map((c) => c.event),
        allEvents.slice(0, 3).map((e) => e.event),
      );
      assert.deepEqual(await recentChanges(db, { since: "2024-01-01" }, 0), []);
    });
  });

  describe("listRecords", () => {
    const expected = policies
      .map(summaryOf)
      .sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : a.id < b.id ? -1 : 1));

    test("returns every record, newest activity first", async () => {
      const all = await listRecords(db);
      assert.equal(all.length, 6);
      assert.deepEqual(all, expected);
    });

    test("filters apply", async () => {
      assert.deepEqual(ids(await listRecords(db, { topics: ["data-centres"] })), ["sg-gebiz-dc-2025"]);
      assert.deepEqual(
        ids(await listRecords(db, { topics: ["ai-governance"] })),
        ids(expected.filter((r) => policies.find((p) => p.id === r.id)!.topics.includes("ai-governance"))),
      );
      assert.deepEqual(ids(await listRecords(db, { jurisdiction: "SG" })), ids(expected.filter((r) => r.jurisdiction === "SG")));
      assert.deepEqual(ids(await listRecords(db, { types: ["bill", "tender"] })), ids(expected.filter((r) => r.type === "bill" || r.type === "tender")));
      assert.deepEqual(ids(await listRecords(db, { since: "2025-09-01" })), ids(expected.filter((r) => r.lastActivity >= "2025-09-01")));
      assert.deepEqual(ids(await listRecords(db, { topics: [] })), ids(expected));
    });

    test("a record with two matching topics appears once", async () => {
      const list = await listRecords(db, { topics: ["gov-tech-procurement", "data-centres"] });
      assert.deepEqual(ids(list), ["sg-gebiz-dc-2025"]);
    });

    test("a record without dates sorts last and never matches since", async () => {
      const undated: PolicyRecord = {
        ...structuredClone(policies[0]),
        id: "undated-record",
        timeline: [],
      };
      delete (undated as { published?: string }).published;
      delete (undated as { statusDate?: string }).statusDate;
      assert.equal(lastActivity(undated), "");
      const { db: db2, dispose: dispose2 } = await openTestDb();
      try {
        await seed(db2, [...policies, undated], passages, manifest);
        const list = await listRecords(db2);
        assert.equal(list.at(-1)!.id, "undated-record");
        assert.equal(list.at(-1)!.lastActivity, "");
        assert.ok(!ids(await listRecords(db2, { since: "1900-01-01" })).includes("undated-record"));
      } finally {
        await dispose2();
      }
    });
  });

  describe("getManifest", () => {
    test("returns the manifest", async () => {
      assert.deepEqual(await getManifest(db), manifest);
    });
  });

  describe("reseeding", () => {
    test("loading the snapshot twice does not duplicate anything", async () => {
      const { db: db2, dispose: dispose2 } = await openTestDb();
      try {
        await seed(db2);
        await seed(db2);
        assert.equal((await listRecords(db2)).length, 6);
        const once = await searchPassages(db, "frontier", {}, 100);
        const twice = await searchPassages(db2, "frontier", {}, 100);
        assert.deepEqual(twice.map((h) => h.passage.id), once.map((h) => h.passage.id));
        assert.deepEqual(await getManifest(db2), manifest);
      } finally {
        await dispose2();
      }
    });

    test("loading a smaller snapshot removes what is gone", async () => {
      const { db: db2, dispose: dispose2 } = await openTestDb();
      try {
        await seed(db2);
        const keep = policies.filter((r) => r.id === "sg-pdpa-2012");
        const keepPassages = passages.filter((p) => p.recordId === "sg-pdpa-2012");
        const smaller: Manifest = { ...manifest, counts: { ...manifest.counts, total: 1 } };
        await seed(db2, keep, keepPassages, smaller);
        assert.deepEqual(ids(await listRecords(db2)), ["sg-pdpa-2012"]);
        assert.deepEqual(await searchPassages(db2, "frontier"), []);
        assert.deepEqual(await recentChanges(db2, { since: "2000-01-01" }).then((cs) => [...new Set(cs.map((c) => c.record.id))]), ["sg-pdpa-2012"]);
        assert.equal(await getRecord(db2, "ca-sb-53-2025"), null);
        assert.deepEqual(await getManifest(db2), smaller);
      } finally {
        await dispose2();
      }
    });

    test("the default limits are 12 hits and 20 changes, and listRecords has none", async () => {
      const base = policies[0];
      const many: PolicyRecord[] = Array.from({ length: 30 }, (_, i) => ({
        ...structuredClone(base),
        id: `bulk-${String(i).padStart(2, "0")}`,
        timeline: Array.from({ length: 2 }, (_, j) => ({
          date: `2025-01-${String(j + 1).padStart(2, "0")}`,
          event: `Event ${j}`,
          support: ["x#1"],
        })),
      }));
      const bulkPassages: Passage[] = many.map((r) => ({ id: `${r.id}#1`, recordId: r.id, seq: 1, text: "zebra crossing rules" }));
      const { db: db2, dispose: dispose2 } = await openTestDb();
      try {
        await seed(db2, many, bulkPassages, manifest);
        assert.equal((await searchPassages(db2, "zebra")).length, 12);
        assert.equal((await searchPassages(db2, "zebra", {}, 30)).length, 30);
        assert.equal((await recentChanges(db2, { since: "2025-01-01" })).length, 20);
        assert.equal((await recentChanges(db2, { since: "2025-01-01" }, 60)).length, 60);
        assert.equal((await listRecords(db2)).length, 30);
      } finally {
        await dispose2();
      }
    });

    test("a passage that points at an unknown record is refused", () => {
      const orphan: Passage = { id: "ghost#1", recordId: "ghost", seq: 1, text: "Nothing here." };
      assert.throws(() => snapshotStatements(policies, [...passages, orphan], manifest), /ghost/);
    });
  });
});

describe("unseeded database", () => {
  let db: D1Like;
  let dispose: () => Promise<void>;

  before(async () => {
    ({ db, dispose } = await openTestDb());
  });
  after(() => dispose());

  test("every read comes back empty and nothing throws", async () => {
    assert.deepEqual(await listRecords(db), []);
    assert.deepEqual(await listRecords(db, { jurisdiction: "SG", topics: ["ai-governance"] }), []);
    assert.equal(await getManifest(db), null);
    assert.deepEqual(await searchPassages(db, "x"), []);
    assert.deepEqual(await searchPassages(db, "frontier AI", { jurisdiction: "US-CA" }), []);
    assert.deepEqual(await recentChanges(db, { since: "2024-01-01" }), []);
    assert.equal(await getRecord(db, "ca-sb-53-2025"), null);
  });
});
