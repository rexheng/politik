import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { main, parseArgs } from "../../photon/scripts/snapshot/seed-d1.ts";
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
async function run(argv: string[], status: (call: number) => number = () => 0) {
  const calls: string[][] = [];
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await main(argv, {
    root,
    exec: (args) => {
      calls.push(args);
      return status(calls.length);
    },
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
