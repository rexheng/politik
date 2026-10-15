import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { MAX_PASSAGE_CHARS, MAX_SOURCES, retrieve } from "../../photon/src/chat/retrieve.ts";
import type { Route, Source } from "../../photon/src/chat/types.ts";
import type { SourceItem } from "../../photon/src/contracts.ts";
import type { D1Like, D1StatementLike } from "../../photon/src/data/d1.ts";
import type { Manifest, Passage, PolicyRecord } from "../../photon/src/data/schema.ts";
import { snapshotStatements } from "../../photon/src/data/seed.ts";
import { openTestDb } from "../helpers/d1.ts";

const fixtureDir = fileURLToPath(new URL("../fixtures/snapshot/", import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(fixtureDir + name, "utf8"));
const policies: PolicyRecord[] = load("policies.json");
const passages: Passage[] = load("passages.json");
const manifest: Manifest = load("manifest.json");
const sb53 = policies.find((r) => r.id === "ca-sb-53-2025")!;

async function seed(db: D1Like, p: PolicyRecord[], ps: Passage[], m: Manifest = manifest) {
  await db.batch(snapshotStatements(p, ps, m).map((s) => db.prepare(s.sql).bind(...s.params)));
}

/** A route with nothing set but the intent; each test says what it cares about. */
function mk(over: Partial<Route> = {}): Route {
  return { intent: "brief", detail: false, standalone: "", search: "", recordHints: [], ...over };
}

const deps = { manifest } as const;
const idsOf = (sources: Source[]) => sources.map((s) => s.record?.id);
const passageIds = (sources: Source[]) => sources.map((s) => s.passage?.id);
const posts = (sources: Source[]) => sources.filter((s) => s.kind === "post");
const policy = (sources: Source[]) => sources.filter((s) => s.kind === "policy");

/** The db, recording the MATCH expression of every full-text search it runs. */
function spyOn(db: D1Like): { db: D1Like; matches: string[] } {
  const matches: string[] = [];
  const wrap = (stmt: D1StatementLike, isSearch: boolean): D1StatementLike => ({
    bind: (...values) => {
      if (isSearch) matches.push(String(values[0]));
      return wrap(stmt.bind(...values), isSearch);
    },
    all: () => stmt.all(),
    first: () => stmt.first(),
    run: () => stmt.run(),
  });
  return {
    matches,
    db: {
      batch: (statements) => db.batch(statements),
      prepare: (sql) => wrap(db.prepare(sql), sql.includes("passages_fts MATCH")),
    },
  };
}

/** A db that fails the test if anything reads from it. */
const untouchable: D1Like = {
  prepare: () => assert.fail("this intent must not read the database"),
  batch: () => assert.fail("this intent must not read the database"),
};

function post(n: number, over: Partial<SourceItem> & { author?: string } = {}): SourceItem {
  return {
    id: `bsky-${n}`,
    source: "bluesky",
    title: `Post ${n}`,
    plain: `Plain text of post ${n} about frontier models`,
    url: `https://bsky.app/profile/ada.bsky.social/post/${n}`,
    happenedAt: "2026-09-30T10:00:00.000Z",
    ...over,
  };
}

/** A record shaped like SB 53 with one passage, for tests that need more records or other text than the fixture has. */
function bulk(n: number, date: string, text = `Bulk passage ${n} about widgets.`, extra: Partial<PolicyRecord> = {}) {
  const id = `ca-bulk-${n}`;
  const record: PolicyRecord = {
    ...sb53,
    id,
    title: `Bulk record ${n}`,
    shortTitle: `BULK ${n}`,
    status: { value: "enacted", support: [`${id}#1`] },
    statusDate: date,
    published: date,
    timeline: [{ date, event: `Event of bulk record ${n}`, support: [`${id}#1`] }],
    summary: { value: `Summary of bulk record ${n}`, support: [`${id}#1`] },
    provisions: [],
    affected: [],
    ...extra,
  };
  const passage: Passage = { id: `${id}#1`, recordId: id, seq: 1, heading: `Heading ${n}`, text };
  return { record, passage };
}

describe("retrieve on the fixture", () => {
  let db: D1Like;
  let scratch: D1Like;
  let disposeAll: () => Promise<void>;

  before(async () => {
    const main = await openTestDb();
    const other = await openTestDb();
    ({ db, scratch } = { db: main.db, scratch: other.db });
    disposeAll = async () => {
      await main.dispose();
      await other.dispose();
    };
    await seed(db, policies, passages);
  });
  after(() => disposeAll());

  describe("brief", () => {
    test("with no search it lists the records with recent events, each once, newest event first", async () => {
      const { sources, promoted } = await retrieve(mk({ standalone: "What is going on?" }), db, deps);
      assert.equal(promoted, false);
      assert.ok(sources.length > 0);
      assert.ok(sources.every((s) => s.kind === "policy" && s.record && s.passage && !s.post));
      const ids = idsOf(sources);
      assert.equal(new Set(ids).size, ids.length, "each record once");
      const newest = (id: string) => policies.find((r) => r.id === id)!.timeline.map((e) => e.date).sort().at(-1)!;
      for (let i = 1; i < ids.length; i++) assert.ok(newest(ids[i - 1]!) >= newest(ids[i]!), `${ids[i - 1]} before ${ids[i]}`);
      assert.deepEqual(ids, ["ca-sb-53-2025", "ca-cppa-admt-2025", "sg-gebiz-dc-2025", "ca-sb-1047-2024", "sg-mgf-genai-2024", "sg-pdpa-2012"]);
    });

    test("each passage belongs to the record it sits beside", async () => {
      const { sources } = await retrieve(mk({ standalone: "What is going on?" }), db, deps);
      for (const s of sources) assert.equal(s.passage!.recordId, s.record!.id);
    });

    test("the default window reaches back 120 days from the snapshot date, and widens when it holds nothing", async () => {
      // The fixture's newest event is 2025-09-29, a year before its snapshot date (2026-10-01). Nothing falls in the
      // default window, but "what is going on" must still show the latest changes rather than nothing.
      const { sources } = await retrieve(mk({ standalone: "What is going on?" }), db, deps);
      assert.equal(sources.length, 6);
    });

    test("an explicit sinceDays is honoured exactly, and never widened", async () => {
      // 2026-10-01 minus 367 days is 2025-09-29, the day SB 53 was signed; the CPPA event (09-23) is just outside.
      assert.deepEqual(idsOf((await retrieve(mk({ sinceDays: 367 }), db, deps)).sources), ["ca-sb-53-2025"]);
      assert.deepEqual(idsOf((await retrieve(mk({ sinceDays: 366 }), db, deps)).sources), []);
      assert.deepEqual(idsOf((await retrieve(mk({ sinceDays: 400 }), db, deps)).sources), ["ca-sb-53-2025", "ca-cppa-admt-2025"]);
      assert.deepEqual((await retrieve(mk({ sinceDays: 30 }), db, deps)).sources, []);
    });

    test("a sinceDays that is not a usable number falls back to the default window", async () => {
      for (const sinceDays of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
        const { sources } = await retrieve(mk({ sinceDays }), db, deps);
        assert.equal(sources.length, 6, String(sinceDays));
      }
      assert.equal((await retrieve(mk({ sinceDays: 1e12 }), db, deps)).sources.length, 6);
    });

    test("jurisdiction SG gives only Singapore records, and US-CA only California", async () => {
      const sg = await retrieve(mk({ jurisdiction: "SG" }), db, deps);
      assert.deepEqual(idsOf(sg.sources), ["sg-gebiz-dc-2025", "sg-mgf-genai-2024", "sg-pdpa-2012"]);
      assert.ok(sg.sources.every((s) => s.record!.jurisdiction === "SG"));
      const ca = await retrieve(mk({ jurisdiction: "US-CA" }), db, deps);
      assert.deepEqual(idsOf(ca.sources), ["ca-sb-53-2025", "ca-cppa-admt-2025", "ca-sb-1047-2024"]);
    });

    test("topics narrow the records", async () => {
      const { sources } = await retrieve(mk({ topics: ["privacy-data"] }), db, deps);
      assert.deepEqual(idsOf(sources), ["ca-cppa-admt-2025", "sg-pdpa-2012"]);
    });

    test("a record's passage is the one that best matches the standalone question, else its first", async () => {
      const consent = await retrieve(mk({ jurisdiction: "SG", standalone: "consent" }), db, deps);
      assert.equal(consent.sources.find((s) => s.record!.id === "sg-pdpa-2012")!.passage!.id, "sg-pdpa-2012#1");
      const breach = await retrieve(mk({ jurisdiction: "SG", standalone: "breach notification" }), db, deps);
      assert.equal(breach.sources.find((s) => s.record!.id === "sg-pdpa-2012")!.passage!.id, "sg-pdpa-2012#2");
      const nothing = await retrieve(mk({ jurisdiction: "SG", standalone: "zzzz" }), db, deps);
      assert.deepEqual(passageIds(nothing.sources), ["sg-gebiz-dc-2025#1", "sg-mgf-genai-2024#1", "sg-pdpa-2012#1"]);
    });

    test("scope words left in search (the rule-based router keeps them) still give a brief, each record once", async () => {
      const { sources } = await retrieve(
        mk({ standalone: "What's going on in California AI policy?", search: "california ai policy", jurisdiction: "US-CA" }),
        db,
        deps,
      );
      assert.ok(sources.length > 0);
      const ids = idsOf(sources);
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(sources.every((s) => s.record!.jurisdiction === "US-CA"));
    });

    test("a search adds matching records after the recent ones, even outside the window", async () => {
      // sinceDays 400 reaches SB 53 and the CPPA rules; "consent" only matches the PDPA, whose events are old.
      const { sources } = await retrieve(mk({ sinceDays: 400, search: "consent", standalone: "consent" }), db, deps);
      assert.deepEqual(idsOf(sources), ["ca-sb-53-2025", "ca-cppa-admt-2025", "sg-pdpa-2012"]);
      assert.equal(sources[2]!.passage!.id, "sg-pdpa-2012#1");
    });

    test("a search with an empty window gives the matches alone", async () => {
      const { sources } = await retrieve(mk({ sinceDays: 30, search: "consent" }), db, deps);
      assert.deepEqual(idsOf(sources), ["sg-pdpa-2012"]);
    });

    test("a record found by both the window and the search appears once, with the passage the search found", async () => {
      const { sources } = await retrieve(mk({ sinceDays: 400, search: "risk assessment", standalone: "risk assessment" }), db, deps);
      const ids = idsOf(sources);
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(sources.find((s) => s.record!.id === "ca-cppa-admt-2025")!.passage!.id, "ca-cppa-admt-2025#2");
    });

    test("uses the 120-day default from the manifest's snapshot date, not today's date", async () => {
      // With the snapshot dated 2025-10-15, SB 53's 2025-09-29 event is 16 days old and CPPA's 2025-09-23 is 22 days old.
      const dated: Manifest = { ...manifest, snapshotDate: "2025-10-15" };
      const { sources } = await retrieve(mk(), db, { manifest: dated });
      assert.deepEqual(idsOf(sources), ["ca-sb-53-2025", "ca-cppa-admt-2025", "sg-gebiz-dc-2025"]);
    });

    test("without a manifest it still answers", async () => {
      const { sources } = await retrieve(mk(), db, { manifest: null });
      assert.equal(sources.length, 6);
    });
  });

  describe("explain", () => {
    test("a record hint gives that record first, with the passages its summary and provisions cite", async () => {
      const { sources, promoted } = await retrieve(mk({ intent: "explain", recordHints: ["SB 53"], standalone: "What does SB 53 require?" }), db, deps);
      assert.equal(promoted, false);
      assert.equal(sources[0]!.record!.id, "ca-sb-53-2025");
      const cited = new Set([...sb53.summary.support, ...sb53.status.support, ...sb53.provisions.flatMap((p) => p.support), ...sb53.timeline.flatMap((e) => e.support)]);
      assert.deepEqual(new Set(passageIds(sources)), cited);
      assert.ok(sources.every((s) => s.record!.id === "ca-sb-53-2025"));
      assert.equal(new Set(passageIds(sources)).size, sources.length, "no passage twice");
    });

    test("the hint matches case-insensitively, as a whole phrase, on short title or title", async () => {
      const first = async (hint: string) => idsOf((await retrieve(mk({ intent: "explain", recordHints: [hint] }), db, deps)).sources)[0];
      assert.equal(await first("sb 53"), "ca-sb-53-2025");
      assert.equal(await first("PDPA"), "sg-pdpa-2012");
      assert.equal(await first("Personal Data Protection Act"), "sg-pdpa-2012");
      assert.equal(await first("colocation"), "sg-gebiz-dc-2025");
      assert.equal(await first("MGF for GenAI"), "sg-mgf-genai-2024");
      assert.equal(await first("California SB 1047"), "ca-sb-1047-2024");
      assert.equal(await first("SB 5"), undefined, "SB 5 is not SB 53");
      assert.equal(await first("SB 530"), undefined, "SB 530 is not SB 53");
      assert.equal(await first("SB"), undefined, "a bare prefix names no record");
    });

    test("up to two records are used, in the order of the hints", async () => {
      const { sources } = await retrieve(mk({ intent: "explain", recordHints: ["PDPA", "SB 53", "MGF for GenAI"] }), db, deps);
      const records = [...new Set(idsOf(sources))];
      assert.deepEqual(records, ["sg-pdpa-2012", "ca-sb-53-2025"]);
    });

    test("a search adds passages after the record's own, without repeating any", async () => {
      const { sources } = await retrieve(mk({ intent: "explain", recordHints: ["SB 53"], search: "frontier" }), db, deps);
      const ids = passageIds(sources);
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(sources[0]!.record!.id, "ca-sb-53-2025");
      assert.ok(ids.includes("ca-sb-1047-2024#1"), "the search reaches the other bill");
      const firstOther = ids.findIndex((id) => id!.startsWith("ca-sb-1047"));
      assert.ok(ids.slice(0, firstOther).every((id) => id!.startsWith("ca-sb-53")), "the record's own passages come first");
    });

    test("with no record hint it is the search results, best first", async () => {
      const { sources } = await retrieve(mk({ intent: "explain", search: "consent" }), db, deps);
      assert.ok(sources.length > 0);
      assert.equal(sources[0]!.passage!.id, "sg-pdpa-2012#1");
      assert.ok(sources.length <= 6);
    });

    test("a hint that names no record falls back to the search", async () => {
      const { sources } = await retrieve(mk({ intent: "explain", recordHints: ["HB 9999"], search: "consent" }), db, deps);
      assert.equal(sources[0]!.passage!.id, "sg-pdpa-2012#1");
    });

    test("with neither hint nor search it searches the standalone question", async () => {
      const { sources } = await retrieve(mk({ intent: "explain", standalone: "consent" }), db, deps);
      assert.equal(sources[0]!.passage!.id, "sg-pdpa-2012#1");
    });

    test("the jurisdiction the router set narrows the search", async () => {
      const sg = await retrieve(mk({ intent: "explain", search: "frontier", jurisdiction: "SG" }), db, deps);
      assert.deepEqual(sg.sources, []);
    });

    test("nothing to go on gives no sources", async () => {
      assert.deepEqual((await retrieve(mk({ intent: "explain" }), db, deps)).sources, []);
    });
  });

  describe("search matching (ruling R7)", () => {
    test("every term is required first; fewer than 3 hits retries with any term", async () => {
      const spy = spyOn(db);
      // No passage has both words, so the first search finds nothing and the retry finds both bills' and the PDPA's.
      const { sources } = await retrieve(mk({ intent: "explain", search: "consent frontier" }), spy.db, deps);
      assert.deepEqual(spy.matches, ['"consent" "frontier"', '"consent" OR "frontier"']);
      assert.ok(passageIds(sources).includes("sg-pdpa-2012#1"));
      assert.ok(passageIds(sources).includes("ca-sb-53-2025#1"));
    });

    test("three or more hits on the first search means no retry", async () => {
      const spy = spyOn(db);
      const { sources } = await retrieve(mk({ intent: "explain", search: "frontier" }), spy.db, deps);
      assert.deepEqual(spy.matches, ['"frontier"']);
      assert.equal(sources.length, 4);
    });

    test("fewer than three hits on the first search retries even when it found one", async () => {
      const spy = spyOn(db);
      // Only the PDPA's second passage has both words.
      const { sources } = await retrieve(mk({ intent: "explain", search: "breach notification" }), spy.db, deps);
      assert.deepEqual(spy.matches, ['"breach" "notification"', '"breach" OR "notification"']);
      assert.equal(sources[0]!.passage!.id, "sg-pdpa-2012#2");
    });

    test("a one-word search is not run a second time, since any and all are the same query", async () => {
      const spy = spyOn(db);
      const { sources } = await retrieve(mk({ intent: "explain", search: "consent" }), spy.db, deps);
      assert.deepEqual(spy.matches, ['"consent"']);
      assert.equal(sources.length, 1);
    });
  });

  describe("implications", () => {
    test("is explain plus the passages that support `affected`", async () => {
      const { sources } = await retrieve(mk({ intent: "implications", recordHints: ["SB 53"] }), db, deps);
      assert.equal(sources[0]!.record!.id, "ca-sb-53-2025");
      const affected = sb53.affected.flatMap((a) => a.support);
      assert.ok(affected.length > 0);
      for (const id of affected) assert.ok(passageIds(sources).includes(id), id);
    });

    test("explain leaves out a passage only `affected` cites; implications includes it", async () => {
      const extra = { id: "ca-sb-53-2025#3", recordId: "ca-sb-53-2025", seq: 3, heading: "Who it covers", text: "Large developers and their counsel should note this." };
      const record: PolicyRecord = { ...sb53, affected: [{ value: "Large developers", support: [extra.id] }] };
      await seed(
        scratch,
        policies.map((r) => (r.id === record.id ? record : r)),
        [...passages, extra],
      );
      const explain = await retrieve(mk({ intent: "explain", recordHints: ["SB 53"] }), scratch, deps);
      assert.ok(!passageIds(explain.sources).includes(extra.id));
      const implications = await retrieve(mk({ intent: "implications", recordHints: ["SB 53"] }), scratch, deps);
      assert.ok(passageIds(implications.sources).includes(extra.id));
      assert.equal(implications.promoted, false);
    });

    test("with no record named it searches", async () => {
      const { sources } = await retrieve(mk({ intent: "implications", search: "consent" }), db, deps);
      assert.equal(sources[0]!.passage!.id, "sg-pdpa-2012#1");
    });
  });

  describe("sentiment", () => {
    test("two Bluesky posts give two post sources and at most three policy sources", async () => {
      const queries: string[] = [];
      const bluesky = async (q: string) => {
        queries.push(q);
        return [post(1, { author: "Ada" }), post(2, { happenedAt: undefined })];
      };
      const { sources, promoted } = await retrieve(mk({ intent: "sentiment", search: "frontier", standalone: "What do people think of frontier AI rules?" }), db, { manifest, bluesky });
      assert.equal(promoted, false);
      assert.deepEqual(queries, ["frontier"]);
      assert.equal(posts(sources).length, 2);
      assert.ok(policy(sources).length >= 1 && policy(sources).length <= 3);
      assert.ok(sources.length <= 5);
      assert.deepEqual(posts(sources)[0]!.post, {
        text: "Plain text of post 1 about frontier models",
        url: "https://bsky.app/profile/ada.bsky.social/post/1",
        author: "Ada",
        at: "2026-09-30T10:00:00.000Z",
      });
      assert.deepEqual(posts(sources)[1]!.post, { text: "Plain text of post 2 about frontier models", url: "https://bsky.app/profile/ada.bsky.social/post/2", author: "", at: "" });
      for (const s of posts(sources)) assert.ok(!s.record && !s.passage);
      for (const s of policy(sources)) assert.ok(s.record && s.passage && !s.post);
    });

    test("a Bluesky failure still gives the policy sources, and never throws", async () => {
      const route = mk({ intent: "sentiment", search: "frontier" });
      const rejects = await retrieve(route, db, { manifest, bluesky: async () => Promise.reject(new Error("bluesky is down")) });
      assert.equal(posts(rejects.sources).length, 0);
      assert.ok(policy(rejects.sources).length > 0);
      const throwsAtOnce = await retrieve(route, db, {
        manifest,
        bluesky: () => {
          throw new Error("synchronous failure");
        },
      });
      assert.equal(posts(throwsAtOnce.sources).length, 0);
      assert.ok(policy(throwsAtOnce.sources).length > 0);
    });

    test("a Bluesky call that never answers is given up on after the deadline", async () => {
      const started = Date.now();
      const { sources } = await retrieve(mk({ intent: "sentiment", search: "frontier" }), db, {
        manifest,
        bluesky: () => new Promise<SourceItem[]>(() => {}),
        blueskyTimeoutMs: 20,
      });
      assert.ok(Date.now() - started < 1500);
      assert.equal(posts(sources).length, 0);
      assert.ok(policy(sources).length > 0);
    });

    test("the Bluesky deadline timer is cleared once Bluesky has answered or failed", async () => {
      const live = new Set<unknown>();
      const { setTimeout: realSet, clearTimeout: realClear } = globalThis;
      globalThis.setTimeout = ((fn: () => void, ms?: number) => {
        const timer = realSet(() => {
          live.delete(timer);
          fn();
        }, ms);
        live.add(timer);
        return timer;
      }) as typeof setTimeout;
      globalThis.clearTimeout = ((timer?: Parameters<typeof clearTimeout>[0]) => {
        live.delete(timer);
        realClear(timer);
      }) as typeof clearTimeout;
      try {
        const route = mk({ intent: "sentiment", search: "zzzz" });
        await retrieve(route, db, { manifest, bluesky: async () => [post(1)], blueskyTimeoutMs: 60_000 });
        assert.equal(live.size, 0, "after an answer");
        await retrieve(route, db, { manifest, bluesky: async () => Promise.reject(new Error("down")), blueskyTimeoutMs: 60_000 });
        assert.equal(live.size, 0, "after a failure");
      } finally {
        globalThis.setTimeout = realSet;
        globalThis.clearTimeout = realClear;
      }
    });

    test("a Bluesky answer that is not a list of items is ignored", async () => {
      const bad = async () => ({ posts: [] }) as unknown as SourceItem[];
      const { sources } = await retrieve(mk({ intent: "sentiment", search: "frontier" }), db, { manifest, bluesky: bad });
      assert.equal(posts(sources).length, 0);
    });

    test("knowledge items from the client join the posts, up to 6 in all, without repeating a URL", async () => {
      const bluesky = async () => [post(1), post(2), post(3), post(4)];
      const knowledge = [post(3), post(5), post(6), post(7)];
      const { sources } = await retrieve(mk({ intent: "sentiment", search: "frontier" }), db, { manifest, bluesky, knowledge });
      const urls = posts(sources).map((s) => s.post!.url);
      assert.equal(urls.length, 6);
      assert.equal(new Set(urls).size, 6);
      assert.deepEqual(
        urls,
        [1, 2, 3, 4, 5, 6].map((n) => `https://bsky.app/profile/ada.bsky.social/post/${n}`),
        "live posts first, then knowledge",
      );
    });

    test("knowledge alone is used when there is no Bluesky function", async () => {
      const { sources } = await retrieve(mk({ intent: "sentiment", search: "frontier" }), db, { manifest, knowledge: [post(1), post(2)] });
      assert.equal(posts(sources).length, 2);
    });

    test("with no search the Bluesky query is the standalone question, and no policy context is searched", async () => {
      const queries: string[] = [];
      const { sources } = await retrieve(mk({ intent: "sentiment", standalone: "What are people saying?" }), db, {
        manifest,
        bluesky: async (q) => {
          queries.push(q);
          return [post(1)];
        },
      });
      assert.deepEqual(queries, ["What are people saying?"]);
      assert.deepEqual(sources.map((s) => s.kind), ["post"]);
    });

    test("post text is cut to the passage limit and a URL that is not http(s) is dropped", async () => {
      const long = post(1, { plain: "w".repeat(5000), url: "javascript:alert(1)" });
      const { sources } = await retrieve(mk({ intent: "sentiment", search: "zzzz" }), db, { manifest, knowledge: [long] });
      assert.equal(sources.length, 1);
      assert.ok(sources[0]!.post!.text.length <= MAX_PASSAGE_CHARS);
      assert.equal(sources[0]!.post!.url, "");
    });

    test("items that are not shaped like posts are skipped", async () => {
      const junk = [null, 7, { id: "x" }, { plain: 12 }, post(1)] as unknown as SourceItem[];
      const { sources } = await retrieve(mk({ intent: "sentiment", search: "zzzz" }), db, { manifest, knowledge: junk });
      assert.equal(posts(sources).length, 1);
    });
  });

  describe("intents that retrieve nothing", () => {
    test("greeting and clarify read nothing", async () => {
      for (const intent of ["greeting", "clarify"] as const) {
        const result = await retrieve(mk({ intent, search: "frontier", recordHints: ["SB 53"] }), untouchable, {
          manifest,
          bluesky: async () => assert.fail("must not call Bluesky"),
        });
        assert.deepEqual(result, { sources: [], promoted: false });
      }
    });
  });

  describe("out-of-scope", () => {
    test("a question nothing in the corpus matches stays out of scope with no sources", async () => {
      const result = await retrieve(mk({ intent: "out-of-scope", search: "EU AI Act" }), db, deps);
      assert.deepEqual(result, { sources: [], promoted: false });
    });

    test("a question the corpus does match is promoted, with the matching passages", async () => {
      const { sources, promoted } = await retrieve(mk({ intent: "out-of-scope", search: "frontier AI" }), db, deps);
      assert.equal(promoted, true);
      assert.ok(sources.length >= 1 && sources.length <= 3);
      assert.ok(sources.every((s) => s.kind === "policy" && s.record && s.passage));
      assert.ok(sources.every((s) => ["ca-sb-53-2025", "ca-sb-1047-2024"].includes(s.record!.id)));
    });

    test("it searches with every term required, and does not retry with any term", async () => {
      const spy = spyOn(db);
      await retrieve(mk({ intent: "out-of-scope", search: "EU AI Act" }), spy.db, deps);
      assert.deepEqual(spy.matches, ['"eu" "ai" "act"']);
    });

    test("one matching passage is enough, however weak", async () => {
      // "consent" is in one passage only. No score threshold is applied.
      const { promoted, sources } = await retrieve(mk({ intent: "out-of-scope", search: "consent" }), db, deps);
      assert.equal(promoted, true);
      assert.deepEqual(passageIds(sources), ["sg-pdpa-2012#1"]);
    });

    test("an empty search is not promoted", async () => {
      assert.deepEqual(await retrieve(mk({ intent: "out-of-scope", search: "" }), db, deps), { sources: [], promoted: false });
    });

    test("promoted is false for every other intent", async () => {
      for (const intent of ["brief", "explain", "implications", "sentiment", "greeting", "clarify"] as const) {
        const result = await retrieve(mk({ intent, search: "frontier", recordHints: ["SB 53"] }), db, deps);
        assert.equal(result.promoted, false, intent);
      }
    });
  });
});

describe("retrieve limits", () => {
  let db: D1Like;
  let dispose: () => Promise<void>;

  // Each test loads its own records; loading the snapshot wipes the tables first, so one database serves them all.
  before(async () => {
    ({ db, dispose } = await openTestDb());
  });
  after(() => dispose());

  test("a source's passage text is cut to 1,200 characters", async () => {
    const long = bulk(1, "2026-09-01", `${"A long passage about widgets. ".repeat(200)}END`);
    await seed(db, [long.record], [long.passage]);
    assert.ok(long.passage.text.length > 5000);
    for (const route of [mk({ intent: "brief" }), mk({ intent: "explain", recordHints: ["BULK 1"] }), mk({ intent: "explain", search: "widgets" }), mk({ intent: "out-of-scope", search: "widgets" })]) {
      const { sources } = await retrieve(route, db, deps);
      assert.ok(sources.length > 0, route.intent);
      for (const s of sources) {
        assert.ok(s.passage!.text.length <= 1200, `${route.intent}: ${s.passage!.text.length}`);
        assert.ok(s.passage!.text.startsWith("A long passage about widgets."));
        assert.ok(!s.passage!.text.includes("END"));
        assert.equal(s.passage!.id, "ca-bulk-1#1", "only the text is cut");
      }
    }
  });

  test("a passage under the limit is returned whole", async () => {
    const short = bulk(1, "2026-09-01", "Short passage about widgets.");
    await seed(db, [short.record], [short.passage]);
    const { sources } = await retrieve(mk({ intent: "brief" }), db, deps);
    assert.equal(sources[0]!.passage!.text, "Short passage about widgets.");
  });

  test("a cut never splits a surrogate pair", async () => {
    const emoji = bulk(1, "2026-09-01", `${"x".repeat(1198)}${"😀".repeat(5)}`);
    await seed(db, [emoji.record], [emoji.passage]);
    const { sources } = await retrieve(mk({ intent: "brief" }), db, deps);
    const text = sources[0]!.passage!.text;
    assert.ok(text.length <= 1200);
    assert.doesNotMatch(text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, "a high surrogate with no low one after it");
    assert.doesNotMatch(text, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, "a low surrogate with no high one before it");
  });

  test("a brief returns at most 12 sources, newest first, and a search keeps its room", async () => {
    const recent = Array.from({ length: 20 }, (_, i) => bulk(i + 1, `2026-09-${String(i + 1).padStart(2, "0")}`));
    const old = Array.from({ length: 3 }, (_, i) => bulk(i + 21, `2025-01-0${i + 1}`, "A passage about zebras."));
    const all = [...recent, ...old];
    await seed(db, all.map((x) => x.record), all.map((x) => x.passage));

    assert.equal(MAX_SOURCES, 12);
    const plain = await retrieve(mk({ intent: "brief" }), db, deps);
    assert.equal(plain.sources.length, 12);
    assert.deepEqual(idsOf(plain.sources), Array.from({ length: 12 }, (_, i) => `ca-bulk-${20 - i}`));

    const withSearch = await retrieve(mk({ intent: "brief", search: "zebras" }), db, deps);
    const ids = idsOf(withSearch.sources);
    assert.equal(ids.length, 12);
    assert.equal(new Set(ids).size, 12);
    assert.deepEqual(ids.slice(0, 9), Array.from({ length: 9 }, (_, i) => `ca-bulk-${20 - i}`));
    assert.deepEqual(new Set(ids.slice(9)), new Set(["ca-bulk-21", "ca-bulk-22", "ca-bulk-23"]));
  });

  test("two long records share a budget of 8 passages, a search fills the rest, and the total stays within 12", async () => {
    const a = bulk(1, "2026-09-01");
    const b = bulk(2, "2026-09-02");
    const extras: Passage[] = [];
    const withMany = (x: ReturnType<typeof bulk>, n: number): PolicyRecord => {
      for (let seq = 2; seq <= n; seq++) extras.push({ id: `${x.record.id}#${seq}`, recordId: x.record.id, seq, text: `More text ${seq}.` });
      const support = Array.from({ length: n }, (_, i) => `${x.record.id}#${i + 1}`);
      return { ...x.record, summary: { value: "Summary", support }, provisions: [{ value: "Provision", support }] };
    };
    const zebras = Array.from({ length: 7 }, (_, i) => bulk(i + 3, "2026-08-01", `Zebras everywhere ${i + 3}.`));
    await seed(
      db,
      [withMany(a, 9), withMany(b, 9), ...zebras.map((z) => z.record)],
      [a.passage, b.passage, ...extras, ...zebras.map((z) => z.passage)],
    );
    const { sources } = await retrieve(mk({ intent: "implications", recordHints: ["BULK 1", "BULK 2"], search: "zebras" }), db, deps);
    const ids = passageIds(sources);
    assert.deepEqual(ids.slice(0, 8), ["ca-bulk-1#1", "ca-bulk-1#2", "ca-bulk-1#3", "ca-bulk-1#4", "ca-bulk-2#1", "ca-bulk-2#2", "ca-bulk-2#3", "ca-bulk-2#4"]);
    assert.equal(ids.length, 12, "8 record passages and 6 matches, cut to 12");
    assert.equal(new Set(ids).size, 12);
    assert.ok(ids.slice(8).every((id) => /^ca-bulk-[3-9]#1$/.test(id!)));
  });

  test("a hint matches a whole phrase: BULK 1 is not BULK 10", async () => {
    const x = [bulk(10, "2026-09-10"), bulk(1, "2026-09-01")];
    await seed(db, x.map((v) => v.record), x.map((v) => v.passage));
    const { sources } = await retrieve(mk({ intent: "explain", recordHints: ["BULK 1"] }), db, deps);
    assert.deepEqual([...new Set(idsOf(sources))], ["ca-bulk-1"]);
  });
});

describe("retrieve on an empty database", () => {
  test("every intent returns no sources from a database that is not migrated, and does not throw", async () => {
    const { db, dispose } = await openTestDb({ migrate: false });
    try {
      for (const intent of ["greeting", "brief", "explain", "implications", "sentiment", "out-of-scope", "clarify"] as const) {
        const result = await retrieve(mk({ intent, search: "frontier", recordHints: ["SB 53"], standalone: "frontier" }), db, { manifest: null });
        assert.deepEqual(result, { sources: [], promoted: false }, intent);
      }
    } finally {
      await dispose();
    }
  });

  test("a migrated database with nothing loaded gives no sources", async () => {
    const { db, dispose } = await openTestDb();
    try {
      const result = await retrieve(mk({ intent: "brief" }), db, { manifest: null });
      assert.deepEqual(result, { sources: [], promoted: false });
    } finally {
      await dispose();
    }
  });
});
