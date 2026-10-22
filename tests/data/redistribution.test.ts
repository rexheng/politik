import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isRedistributable,
  MAX_RESTRICTED_QUOTE_CHARS,
  privateDirOf,
  redistributablePassages,
  restrictedRecordIds,
  splitPassagesByLicence,
} from "../../photon/src/data/redistribution.ts";
import type { Passage } from "../../photon/src/data/schema.ts";

const records = [
  { id: "ca-open", redistributionOk: true },
  { id: "sg-closed", redistributionOk: false },
];
const passage = (recordId: string, seq: number): Passage => ({ id: `${recordId}#${seq}`, recordId, seq, text: `text ${recordId} ${seq}` });
const passages = [passage("ca-open", 1), passage("sg-closed", 1), passage("sg-closed", 2), passage("ca-open", 2), passage("unknown", 1)];

test("a record is redistributable only when its publisher says so", () => {
  assert.equal(isRedistributable({ redistributionOk: true }), true);
  assert.equal(isRedistributable({ redistributionOk: false }), false);
  assert.deepEqual([...restrictedRecordIds(records)], ["sg-closed"]);
  assert.equal(MAX_RESTRICTED_QUOTE_CHARS, 280);
});

test("passages are split by their record's licence, in their order; a passage of an unknown record counts as restricted", () => {
  const { open, restricted } = splitPassagesByLicence(records, passages);
  assert.deepEqual(open.map((p) => p.id), ["ca-open#1", "ca-open#2"]);
  assert.deepEqual(restricted.map((p) => p.id), ["sg-closed#1", "sg-closed#2", "unknown#1"]);
  assert.deepEqual(redistributablePassages(records, passages).map((p) => p.id), ["ca-open#1", "ca-open#2"]);
});

test("the private directory sits beside the snapshot directory", () => {
  assert.equal(privateDirOf("photon/data/snapshot"), "photon/data/snapshot-private");
  assert.equal(privateDirOf("/repo/photon/data/snapshot/"), "/repo/photon/data/snapshot-private");
  assert.equal(privateDirOf("tests/fixtures/snapshot"), "tests/fixtures/snapshot-private");
});
