import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { lastActivity, type PolicyRecord } from "../../photon/src/data/schema.ts";
import { checkSnapshot } from "../../scripts/check-data.ts";

const fixtureDir = fileURLToPath(new URL("../fixtures/snapshot/", import.meta.url));
const cliPath = fileURLToPath(new URL("../../scripts/check-data.ts", import.meta.url));

function load(name: string): any {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

/** A fresh, mutable copy of the fixture for each test. */
function fixture() {
  return { policies: load("policies.json"), passages: load("passages.json"), manifest: load("manifest.json") };
}

const mentions = (errors: string[], needle: string) => errors.some((e) => e.includes(needle));

test("valid fixture has no errors", () => {
  assert.deepEqual(checkSnapshot(fixture()), []);
});

test("unknown support id is reported", () => {
  const f = fixture();
  f.policies[0].provisions[0].support = ["ca-sb-53-2025#99"];
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "ca-sb-53-2025#99"), errors.join("\n"));
});

test("empty support is reported", () => {
  const f = fixture();
  f.policies[0].summary.support = [];
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "summary"), errors.join("\n"));
});

test("unknown related id is reported", () => {
  const f = fixture();
  f.policies[0].related = [{ id: "nope", relation: "related" }];
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "nope"), errors.join("\n"));
});

test("unsorted timeline is reported", () => {
  const f = fixture();
  f.policies[0].timeline.reverse();
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "timeline"), errors.join("\n"));
});

test("timeline with an invalid date is reported", () => {
  const f = fixture();
  f.policies[0].timeline[0].date = "2025-02-30";
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "timeline"), errors.join("\n"));
});

test("record without topics is reported", () => {
  const f = fixture();
  f.policies[0].topics = [];
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "topics"), errors.join("\n"));
});

test("duplicate record id is reported", () => {
  const f = fixture();
  f.policies.push(structuredClone(f.policies[0]));
  f.manifest.counts.total = 7;
  f.manifest.counts.byJurisdiction["US-CA"] = 4;
  f.manifest.counts.byType.bill = 3;
  const errors = checkSnapshot(f);
  assert.ok(
    errors.some((e) => e.includes("duplicate") && e.includes("ca-sb-53-2025")),
    errors.join("\n"),
  );
});

test("bad enum is reported", () => {
  const f = fixture();
  f.policies[0].jurisdiction = "US-NY";
  const errors = checkSnapshot(f);
  assert.ok(errors.length >= 1);
  assert.ok(mentions(errors, "jurisdiction"), errors.join("\n"));
});

test("passage id must match its record and sequence", () => {
  const f = fixture();
  f.passages[1].seq = 5;
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "ca-sb-53-2025#2"), errors.join("\n"));
});

test("passage for an unknown record is reported", () => {
  const f = fixture();
  f.passages.push({ id: "ghost#1", recordId: "ghost", seq: 1, text: "orphan" });
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "ghost"), errors.join("\n"));
});

test("manifest counts must match records", () => {
  const f = fixture();
  f.manifest.counts.total = 7;
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "counts"), errors.join("\n"));
});

test("manifest byType and byJurisdiction counts must match records", () => {
  const f = fixture();
  f.manifest.counts.byType.tender = 2;
  f.manifest.counts.byJurisdiction.SG = 1;
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "counts.byType.tender"), errors.join("\n"));
  assert.ok(mentions(errors, "counts.byJurisdiction.SG"), errors.join("\n"));
});

test("a record cannot be both published and excluded", () => {
  const f = fixture();
  f.manifest.excluded[0].id = "ca-sb-53-2025";
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "excluded"), errors.join("\n"));
});

test("non-array input is reported without throwing", () => {
  const errors = checkSnapshot({ policies: {}, passages: null, manifest: "x" });
  assert.ok(mentions(errors, "policies"), errors.join("\n"));
  assert.ok(mentions(errors, "passages"), errors.join("\n"));
  assert.ok(mentions(errors, "manifest"), errors.join("\n"));
});

test("lastActivity picks the newest date across published, statusDate and timeline", () => {
  const base: PolicyRecord = load("policies.json")[0];
  const withDates = (published: string | undefined, statusDate: string | undefined, timeline: string[]): PolicyRecord => ({
    ...base,
    published,
    statusDate,
    timeline: timeline.map((date) => ({ date, event: "e", support: base.status.support })),
  });

  assert.equal(lastActivity(withDates("2025-12-01", "2025-03-01", ["2025-01-01", "2025-02-01"])), "2025-12-01");
  assert.equal(lastActivity(withDates("2025-01-01", "2025-09-29", ["2025-02-01"])), "2025-09-29");
  assert.equal(lastActivity(withDates("2025-01-01", "2025-02-01", ["2025-03-01", "2025-11-15"])), "2025-11-15");
  assert.equal(lastActivity(withDates(undefined, undefined, ["2025-04-01"])), "2025-04-01");
  assert.equal(lastActivity(withDates(undefined, undefined, [])), "");
});

test("CLI exits 0 on a valid snapshot directory and 1 on an invalid one", () => {
  const run = (dir: string) =>
    spawnSync(process.execPath, ["--import", "tsx", cliPath, dir], { encoding: "utf8" });

  const ok = run(fixtureDir);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);

  const bad = fixture();
  bad.policies[0].related = [{ id: "nope", relation: "related" }];
  const dir = mkdtempSync(join(tmpdir(), "politik-check-data-"));
  try {
    for (const [name, value] of Object.entries(bad)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
    const failed = run(dir);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stderr + failed.stdout, /nope/);

    const missing = run(join(dir, "does-not-exist"));
    assert.equal(missing.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
