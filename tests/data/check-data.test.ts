import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { lastActivity, type PolicyRecord } from "../../photon/src/data/schema.ts";
import { checkSnapshot, inspectSnapshot } from "../../scripts/check-data.ts";

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

test("a record with a headline passes", () => {
  const f = fixture();
  f.policies[0].headline = { value: "California now makes the largest AI developers publish their safety plans.", support: f.policies[0].summary.support };
  assert.deepEqual(checkSnapshot(f), []);
});

test("a headline whose support names an unknown passage is reported with the id and the word headline", () => {
  const f = fixture();
  f.policies[0].headline = { value: "A one-line headline.", support: ["ca-sb-53-2025#99"] };
  const errors = checkSnapshot(f);
  assert.ok(errors.some((e) => e.includes("ca-sb-53-2025#99") && e.includes("headline")), errors.join("\n"));
});

test("a headline with empty support is reported", () => {
  const f = fixture();
  f.policies[0].headline = { value: "A one-line headline.", support: [] };
  const errors = checkSnapshot(f);
  assert.ok(mentions(errors, "headline"), errors.join("\n"));
});

test("an unknown extra key on a record is still rejected", () => {
  const f = fixture();
  f.policies[0].tagline = "x";
  const errors = checkSnapshot(f);
  assert.ok(errors.length >= 1 && mentions(errors, "tagline"), errors.join("\n"));
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

// ---------------------------------------------------------------------------------------------------------------------
// R39: the passages of a record that may not be redistributed live in a private, git-ignored file

/** The fixture with its first record restricted: its passages moved to the private list. */
function restricted() {
  const f = fixture();
  f.policies[0].redistributionOk = false;
  const cut = (v: string) => (v.length > 281 ? `${v.slice(0, 280)}…` : v); // R42: a restricted record's quotes are short
  f.policies[0].summary.value = cut(f.policies[0].summary.value);
  for (const p of f.policies[0].provisions) p.value = cut(p.value);
  const id = f.policies[0].id;
  const privatePassages = f.passages.filter((p: any) => p.recordId === id);
  const passages = f.passages.filter((p: any) => p.recordId !== id);
  assert.ok(privatePassages.length > 0 && passages.length > 0);
  return { ...f, passages, privatePassages };
}

test("R39: the committed and the private passages are checked together; no errors and no warnings when both are there", () => {
  const f = restricted();
  const result = inspectSnapshot(f);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(checkSnapshot(f), []);
});

test("R39: with no private file the restricted record's passages are not checked: a warning, not an error", () => {
  const { privatePassages: _private, ...f } = restricted();
  const result = inspectSnapshot(f);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /private/i);
  assert.match(result.warnings[0]!, /1 record/);
  assert.ok(result.warnings[0]!.includes(f.policies[0].id));
  // a record that may be redistributed still needs its passages in the committed file
  const open = { ...f, passages: f.passages.filter((p: any) => p.recordId !== f.policies[1].id) };
  const missing = inspectSnapshot(open);
  assert.ok(missing.errors.some((e) => e.includes("unknown passage")), missing.errors.join("\n"));
  // and no restricted record, no warning
  assert.deepEqual(inspectSnapshot(fixture()).warnings, []);
});

test("R39: a restricted record's passage in the committed file is an error (the file is public)", () => {
  const f = restricted();
  const leaked = { ...f, passages: [...f.passages, f.privatePassages[0]] };
  const errors = inspectSnapshot(leaked).errors;
  assert.ok(errors.some((e) => e.includes(f.privatePassages[0].id) && /not be committed|restricted/i.test(e)), errors.join("\n"));
  // and also when the private file is missing
  const { privatePassages: _p, ...noPrivate } = leaked;
  assert.ok(inspectSnapshot(noPrivate).errors.some((e) => /restricted/i.test(e)));
});

test("R39: a private passage of a record that may be redistributed, or of an unknown record, is an error", () => {
  const f = restricted();
  const open = f.passages[0];
  const bad = { ...f, privatePassages: [...f.privatePassages, { ...open }, { id: "ghost#1", recordId: "ghost", seq: 1, text: "text" }] };
  const errors = inspectSnapshot(bad).errors;
  assert.ok(errors.some((e) => e.includes(open.id) && /private/i.test(e)), errors.join("\n"));
  assert.ok(errors.some((e) => e.includes("ghost#1")), errors.join("\n"));
});

test("R39: the passage ids of the two files must not repeat, and a restricted record's sequence must run on unbroken", () => {
  const f = restricted();
  const dup = inspectSnapshot({ ...f, privatePassages: [...f.privatePassages, f.privatePassages[0]] }).errors;
  assert.ok(dup.some((e) => /duplicate/i.test(e)), dup.join("\n"));
  const gap = inspectSnapshot({ ...f, privatePassages: f.privatePassages.slice(1) }).errors;
  assert.ok(gap.some((e) => /seq/.test(e) || /unknown passage/.test(e)), gap.join("\n"));
});

test("R39: the CLI reads <dir>-private/passages.json when it is there, warns when it is not, and fails when restricted text is in the committed file", () => {
  const run = (dir: string) => spawnSync(process.execPath, ["--import", "tsx", cliPath, dir], { encoding: "utf8" });
  const f = restricted();
  const root = mkdtempSync(join(tmpdir(), "politik-check-private-"));
  const dir = join(root, "snapshot");
  try {
    mkdirSync(dir);
    writeFileSync(join(dir, "policies.json"), JSON.stringify(f.policies));
    writeFileSync(join(dir, "passages.json"), JSON.stringify(f.passages));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(f.manifest));

    const missing = run(dir);
    assert.equal(missing.status, 0, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /private/i);
    assert.match(missing.stdout, /^ok:/);

    mkdirSync(`${dir}-private`);
    writeFileSync(join(`${dir}-private`, "passages.json"), JSON.stringify(f.privatePassages));
    const both = run(dir);
    assert.equal(both.status, 0, both.stdout + both.stderr);
    assert.doesNotMatch(both.stderr, /private/i);
    assert.match(both.stdout, new RegExp(`${f.passages.length + f.privatePassages.length} passages`));

    writeFileSync(join(dir, "passages.json"), JSON.stringify([...f.passages, ...f.privatePassages]));
    rmSync(`${dir}-private`, { recursive: true, force: true });
    const leaked = run(dir);
    assert.equal(leaked.status, 1, leaked.stdout + leaked.stderr);
    assert.match(leaked.stderr, /restricted/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R42: a restricted record's summary or provision of more than 281 characters is an error; 281 is fine and a redistributable record is not limited", () => {
  const f = restricted();
  const rec = f.policies[0];
  const long = (n: number) => `${"word ".repeat(Math.ceil(n / 5)).slice(0, n - 1).trimEnd()}…`.padEnd(n, "x");
  assert.equal(long(281).length, 281);
  rec.summary.value = long(281);
  rec.provisions = [{ value: long(281), support: rec.summary.support }];
  assert.deepEqual(inspectSnapshot(f).errors, [], "281 characters is the limit");

  rec.summary.value = long(282);
  const summaryErrors = inspectSnapshot(f).errors;
  assert.ok(summaryErrors.some((e) => e.includes(rec.id) && /summary/.test(e) && /281/.test(e)), summaryErrors.join("\n"));

  rec.summary.value = long(100);
  rec.provisions = [{ value: long(100), support: rec.summary.support }, { value: long(500), support: rec.summary.support }];
  const provisionErrors = inspectSnapshot(f).errors;
  assert.ok(provisionErrors.some((e) => e.includes(rec.id) && /provisions\[1\]/.test(e) && /281/.test(e)), provisionErrors.join("\n"));
  assert.ok(!provisionErrors.some((e) => /provisions\[0\]/.test(e)));

  rec.provisions = [];
  rec.affected = [{ value: long(100), support: rec.summary.support }, { value: long(300), support: rec.summary.support }];
  const affectedErrors = inspectSnapshot(f).errors;
  assert.ok(affectedErrors.some((e) => e.includes(rec.id) && /affected\[1\]/.test(e) && /281/.test(e)), affectedErrors.join("\n"));
  assert.ok(!affectedErrors.some((e) => /affected\[0\]/.test(e)));

  const open = fixture();
  open.policies[0].summary.value = long(900);
  open.policies[0].provisions = [{ value: long(900), support: open.policies[0].summary.support }];
  assert.deepEqual(checkSnapshot(open), [], "a redistributable record may quote at length");
});

test("R39: check:data and seed:d1 give the same warning for a missing private file, and it says what is lost", () => {
  const { privatePassages: _p, ...f } = restricted();
  const root = mkdtempSync(join(tmpdir(), "politik-warning-"));
  const dir = join(root, "snapshot");
  try {
    mkdirSync(dir);
    writeFileSync(join(dir, "policies.json"), JSON.stringify(f.policies));
    writeFileSync(join(dir, "passages.json"), JSON.stringify(f.passages));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(f.manifest));
    const run = spawnSync(process.execPath, ["--import", "tsx", cliPath, dir], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const line = run.stderr.split("\n").find((l) => l.startsWith("Warning: "))!;
    assert.ok(line, run.stderr);
    assert.ok(line.includes(join(`${dir}-private`, "passages.json")), "it names the file that is missing");
    assert.match(line, /1 record that may not be redistributed/);
    assert.match(line, /not checked against the text/);
    assert.match(line, /seed:d1 loads them with no passage text/);
    assert.match(line, /pnpm snapshot:build/);
    // the same sentence from the shared function, which seed:d1 also uses
    const inspected = inspectSnapshot({ ...f, privatePath: join(`${dir}-private`, "passages.json") });
    assert.equal(line, `Warning: ${inspected.warnings[0]}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
