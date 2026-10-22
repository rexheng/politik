import assert from "node:assert/strict";
import { test } from "node:test";

import { checkClaims } from "../../photon/scripts/snapshot/check.ts";
import { extractTender } from "../../photon/scripts/snapshot/extract/tender.ts";
import { candidate, fixture, withPassages } from "../helpers/extract.ts";

const META = { snapshotDate: "2026-10-15", format: "text" } as const;
const c = candidate({ id: "sg-gebiz-gbz000123", type: "tender", landmark: false });

test("a tender's summary is the template sentence built from its fields, with all six fields as parts, and it checks", () => {
  const { text, passages } = withPassages(c, fixture("tender.txt"));
  const r = extractTender(c, text, passages, META);
  assert.ok(r.ok);
  assert.equal(
    r.fields.summary.value,
    "Ministry of Digital Development and Information awarded tender GBZ000123 (Supply of cloud services) to Example Pte Ltd for S$1,234,567 on 2025-03-04.",
  );
  assert.deepEqual(r.fields.summary.parts, [
    "Ministry of Digital Development and Information",
    "GBZ000123",
    "Supply of cloud services",
    "Example Pte Ltd",
    "S$1,234,567",
    "2025-03-04",
  ]);
  assert.deepEqual(r.fields.summary.support, [`${c.id}#1`]);
  const checked = checkClaims(r.fields, passages);
  assert.equal(checked.fatal, undefined);
  assert.deepEqual(checked.dropped, []);
});

test("a tender's affected parties are the agency and the supplier; status awarded, dated by the award date, with one Awarded event", () => {
  const { text, passages } = withPassages(c, fixture("tender.txt"));
  const r = extractTender(c, text, passages, META);
  assert.ok(r.ok);
  assert.deepEqual(r.fields.affected.map((a) => a.value), ["Ministry of Digital Development and Information", "Example Pte Ltd"]);
  assert.equal(r.fields.status.value, "awarded");
  assert.deepEqual(r.fields.status.support, [`${c.id}#1`]);
  assert.equal(r.fields.statusDate, "2025-03-04");
  assert.equal(r.fields.published, "2025-03-04");
  assert.deepEqual(r.fields.timeline.map((t) => [t.date, t.event]), [["2025-03-04", "Awarded"]]);
  assert.deepEqual(r.fields.provisions, []);
  assert.equal(r.fields.shortTitle, undefined);
});

test("a tender with several suppliers uses the Suppliers line as written and the largest single award", () => {
  const mc = candidate({ id: "sg-gebiz-mas000ett24000070", type: "tender" });
  const { text, passages } = withPassages(mc, fixture("tender-multi.txt"));
  const r = extractTender(mc, text, passages, META);
  assert.ok(r.ok);
  assert.equal(
    r.fields.summary.value,
    "Monetary Authority of Singapore awarded tender MAS000ETT24000070 (INVITATION TO TENDER FOR PROVISION OF HARDWARE AND PROFESSIONAL SERVICES FOR A NETWORK AND SECURITY PLATFORM SOLUTION - MAS-REQ-2024-001785 - DTA(CYL)) to NTT SINGAPORE PTE. LTD. (S$15,099,039); FUJITSU ASIA PTE LTD (S$532,068) for a largest single award of S$15,099,039 on 2025-02-25.",
  );
  assert.ok(r.fields.summary.parts!.includes("NTT SINGAPORE PTE. LTD. (S$15,099,039); FUJITSU ASIA PTE LTD (S$532,068)"));
  assert.deepEqual(r.fields.affected.map((a) => a.value), ["Monetary Authority of Singapore", "NTT SINGAPORE PTE. LTD.", "FUJITSU ASIA PTE LTD"]);
  const checked = checkClaims(r.fields, passages);
  assert.equal(checked.fatal, undefined);
  assert.deepEqual(checked.dropped, []);
});

test("a tender missing a field gives no official summary found, whichever field it is", () => {
  for (const key of ["Tender number", "Description", "Agency", "Supplier", "Awarded amount", "Award date"]) {
    const text = fixture("tender.txt").split("\n").filter((l) => !l.startsWith(`${key}:`)).join("\n");
    const mc = candidate({ id: "sg-gebiz-gbz000123", type: "tender" });
    const r = extractTender(mc, text, withPassages(mc, text).passages, META);
    assert.deepEqual(r, { ok: false, reason: "no official summary found" }, key);
  }
  const noDate = fixture("tender.txt").replace("2025-03-04", "March 4th");
  assert.deepEqual(extractTender(c, noDate, withPassages(c, noDate).passages, META), { ok: false, reason: "no official summary found" });
  const noAgencyMulti = fixture("tender-multi.txt").replace(/^Agency:.*\n/m, "");
  const mc = candidate({ id: "sg-gebiz-mas000ett24000070", type: "tender" });
  assert.deepEqual(extractTender(mc, noAgencyMulti, withPassages(mc, noAgencyMulti).passages, META), { ok: false, reason: "no official summary found" });
});

test("a value that is not in the tender text fails the check", () => {
  const { text, passages } = withPassages(c, fixture("tender.txt"));
  const r = extractTender(c, text, passages, META);
  assert.ok(r.ok);
  const tampered = { ...r.fields, summary: { ...r.fields.summary, parts: [...r.fields.summary.parts!, "Someone Else Pte Ltd"] } };
  assert.equal(checkClaims(tampered, passages).fatal, "no official summary found");
});
