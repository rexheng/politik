import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { countFromWranglerJson, main, parseArgs } from "../../photon/scripts/snapshot/seed-d1.ts";
import type { Manifest, Passage, PolicyRecord } from "../../photon/src/data/schema.ts";
import { snapshotStatements, toSqlFile } from "../../photon/src/data/seed.ts";

const fixtureDir = fileURLToPath(new URL("../fixtures/snapshot/", import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
const policies: PolicyRecord[] = load("policies.json");
const passages: Passage[] = load("passages.json");
const manifest: Manifest = load("manifest.json");

let root: string;
before(() => {
  root = mkdtempSync(join(tmpdir(), "politik-seed-d1-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

/** Writes a snapshot directory under the temp root and returns its path. */
function snapshotDir(name: string, files: { policies?: unknown; passages?: unknown; manifest?: unknown }): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, value] of Object.entries(files)) writeFileSync(join(dir, `${file}.json`), JSON.stringify(value));
  return dir;
}

/** Runs the command with the wrangler calls recorded instead of made. `status` is each call's exit code. */
async function run(argv: string[], status: (call: number) => number = () => 0, count?: (target: "--local" | "--remote") => number | undefined) {
  const calls: string[][] = [];
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await main(argv, {
    root,
    exec: (args) => {
      calls.push(args);
      return status(calls.length);
    },
    ...(count ? { count } : {}),
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
  });
  return { code, calls, out: lines.join("\n"), err: errors.join("\n") };
}

const sqlPath = () => join(root, ".tmp-seed.sql");

describe("parseArgs", () => {
  test("defaults to local with no directory", () => {
    assert.deepEqual(parseArgs([]), { remote: false });
  });

  test("reads --remote and --dir in either form", () => {
    assert.deepEqual(parseArgs(["--remote", "--dir", "snap"]), { remote: true, dir: "snap" });
    assert.deepEqual(parseArgs(["--dir=snap"]), { remote: false, dir: "snap" });
  });

  test("rejects an unknown argument and a --dir with no value", () => {
    assert.throws(() => parseArgs(["--wipe"]), /Unknown argument "--wipe"/);
    assert.throws(() => parseArgs(["--dir"]), /--dir needs a path/);
  });
});

describe("seed:d1", () => {
  test("migrates and then seeds the local database, in that order", async () => {
    rmSync(sqlPath(), { force: true });
    const r = await run(["--dir", fixtureDir]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.calls, [
      ["d1", "migrations", "apply", "politik", "--local"],
      ["d1", "execute", "politik", "--file", ".tmp-seed.sql", "--local"],
    ]);
    assert.match(r.out, /6 records/);
    assert.match(r.out, /2026-10-01/);
  });

  test("the seed file wipes and reloads from the snapshot", async () => {
    await run(["--dir", fixtureDir]);
    assert.equal(readFileSync(sqlPath(), "utf8"), toSqlFile(snapshotStatements(policies, passages, manifest)));
  });

  test("--remote targets the remote database for both steps", async () => {
    const r = await run(["--remote", "--dir", fixtureDir]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.calls, [
      ["d1", "migrations", "apply", "politik", "--remote"],
      ["d1", "execute", "politik", "--file", ".tmp-seed.sql", "--remote"],
    ]);
  });

  test("a snapshot with errors aborts before anything is written or sent", async () => {
    rmSync(sqlPath(), { force: true });
    const bad: PolicyRecord[] = structuredClone(policies);
    bad[0].related = [{ id: "no-such-record", relation: "related" }];
    const dir = snapshotDir("bad", { policies: bad, passages, manifest });
    const r = await run(["--remote", "--dir", dir]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.calls, []);
    assert.equal(existsSync(sqlPath()), false);
    assert.match(r.err, /no-such-record/);
  });

  test("a missing snapshot aborts before anything is sent", async () => {
    for (const dir of [join(root, "nowhere"), snapshotDir("partial", { policies })]) {
      const r = await run(["--dir", dir]);
      assert.equal(r.code, 1);
      assert.deepEqual(r.calls, []);
      assert.match(r.err, /cannot read/);
    }
  });

  test("an empty snapshot is refused, because seeding wipes the tables first", async () => {
    rmSync(sqlPath(), { force: true });
    const none = Object.fromEntries(Object.keys(manifest.counts.byType).map((type) => [type, 0]));
    const counts = { total: 0, byJurisdiction: { "US-CA": 0, SG: 0 }, byType: none };
    const dir = snapshotDir("nothing", { policies: [], passages: [], manifest: { ...manifest, counts, excluded: [] } });
    const r = await run(["--dir", dir]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.calls, []);
    assert.match(r.err, /has no records/);
    assert.equal(existsSync(sqlPath()), false);
  });

  test("a failed migration stops before the seed is executed", async () => {
    const r = await run(["--dir", fixtureDir], (call) => (call === 1 ? 1 : 0));
    assert.equal(r.code, 1);
    assert.equal(r.calls.length, 1);
    assert.match(r.err, /migrat/i);
  });

  test("a failed seed exits non-zero", async () => {
    const r = await run(["--dir", fixtureDir], (call) => (call === 2 ? 3 : 0));
    assert.equal(r.code, 1);
    assert.equal(r.calls.length, 2);
    assert.match(r.err, /seed/i);
  });

  test("a bad argument prints the usage and sends nothing", async () => {
    const r = await run(["--wipe"]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.calls, []);
    assert.match(r.err, /Usage: pnpm seed:d1/);
  });
});

describe("seed:d1 warns when the snapshot is much smaller than the database it replaces (I5)", () => {
  test("fewer than 75% of the records now in the database: a warning, and the seed still runs", async () => {
    const asked: string[] = [];
    const r = await run(["--dir", fixtureDir], undefined, (target) => (asked.push(target), 9)); // the fixture has 6 records: 6 < 6.75
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /Warning: this snapshot has 6 records, fewer than 75% of the 9 now in politik \(local\)/);
    assert.equal(r.calls.length, 2, "the migration and the seed are still run");
    assert.deepEqual(asked, ["--local"]);
  });

  test("it asks the database that is being seeded, and says which", async () => {
    const asked: string[] = [];
    const r = await run(["--remote", "--dir", fixtureDir], undefined, (target) => (asked.push(target), 200));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(asked, ["--remote"]);
    assert.match(r.err, /200 now in politik \(remote\)/);
  });

  test("exactly 75%, a bigger snapshot, and an empty database give no warning", async () => {
    for (const before of [8, 6, 3, 0]) {
      const r = await run(["--dir", fixtureDir], undefined, () => before);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.err, "", `a database with ${before} records`);
    }
  });

  test("a count that cannot be read, or that throws, is skipped without a warning or a failure", async () => {
    for (const count of [() => undefined, () => { throw new Error("wrangler is not logged in"); }]) {
      const r = await run(["--dir", fixtureDir], undefined, count);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.err, "");
      assert.equal(r.calls.length, 2);
    }
  });

  test("the count is read before anything is changed", async () => {
    const order: string[] = [];
    const calls: string[][] = [];
    await main(["--dir", fixtureDir], {
      root,
      exec: (args) => (calls.push(args), order.push(args[1]!), 0),
      count: () => (order.push("count"), 100),
      log: () => undefined,
      error: () => undefined,
    });
    assert.deepEqual(order, ["count", "migrations", "execute"]);
  });

  test("nothing is read when the wrangler calls are replaced and no count is given", async () => {
    const r = await run(["--dir", fixtureDir]);
    assert.equal(r.err, "");
  });
});

describe("countFromWranglerJson", () => {
  test("reads the count from wrangler's JSON answer, with or without text before it", () => {
    const answer = JSON.stringify([{ results: [{ n: 42 }], success: true, meta: {} }]);
    assert.equal(countFromWranglerJson(answer), 42);
    assert.equal(countFromWranglerJson(`⛅️ wrangler 4.0\n${answer}\n`), 42);
    assert.equal(countFromWranglerJson(`\u001b[33m▲ [WARNING] Proxy environment variables detected.\u001b[0m\n\n${answer}`), 42, "colour codes hold a [");
    assert.equal(countFromWranglerJson(JSON.stringify([{ results: [{ n: 0 }] }])), 0);
  });

  test("anything else is undefined", () => {
    for (const bad of ["", "no json", "[]", "[{}]", JSON.stringify([{ results: [] }]), JSON.stringify([{ results: [{ n: "7" }] }]), JSON.stringify([{ results: [{ n: -1 }] }]), "{ broken ["]) {
      assert.equal(countFromWranglerJson(bad), undefined, bad);
    }
  });
});
