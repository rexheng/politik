import assert from "node:assert/strict";
import { test } from "node:test";

import type { RecordType } from "../../photon/src/data/schema.ts";
import { extractRecord, withoutParts } from "../../photon/scripts/snapshot/extract/index.ts";
import { htmlPageText } from "../../photon/scripts/snapshot/meta.ts";
import { candidate, fixture, withPassages } from "../helpers/extract.ts";

const meta = { snapshotDate: "2026-10-15" };

test("a press release goes to the PDF rules for a PDF and to the HTML rules for an HTML page or a text capture", () => {
  const c = candidate({ id: "ca-ag-x", type: "press-release" });
  // An Executive summary line is read only by the PDF rules; the HTML rules take the first long paragraph.
  const body = `Some words of the front matter that make up a long first paragraph of the document itself, well over twenty five words in all of its sentences.`;
  const text = `${body}\n\nExecutive summary\nThe real summary of the document is here and it is long enough to be a paragraph of its own, as the rules of the extractor need it to be.\n\nMore text.`;
  const { passages } = withPassages(c, text);
  const pdf = extractRecord(c, text, passages, { ...meta, format: "pdf" });
  const plain = extractRecord(c, text, passages, { ...meta, format: "text" });
  assert.ok(pdf.ok && plain.ok);
  assert.ok(pdf.fields.summary.value.startsWith("The real summary of the document"));
  assert.ok(plain.fields.summary.value.startsWith("Some words of the front matter"));

  const html = fixture("release-oag.html");
  const page = htmlPageText(html);
  const fromHtml = extractRecord(c, page.text, withPassages(c, page.text).passages, { ...meta, format: "html", html });
  assert.ok(fromHtml.ok);
  assert.equal(fromHtml.fields.published, "2026-01-16", "the HTML rules read the page's meta date");
});

test("each record type goes to its own extractor", () => {
  const expectations: [RecordType, string, string][] = [
    ["bill", "ca-sb-900-2025", "bill-enacted.txt"],
    ["tender", "sg-gebiz-gbz000123", "tender.txt"],
  ];
  for (const [type, id, file] of expectations) {
    const c = candidate({ id, type });
    const text = fixture(file);
    const r = extractRecord(c, text, withPassages(c, text).passages, { ...meta, format: "text" });
    assert.ok(r.ok, type);
    assert.equal(r.fields.status.value, type === "bill" ? "in-force" : "awarded");
  }
  const statute = candidate({ id: "sg-pdpa-2012", type: "statute" });
  const html = fixture("sso-revised-act.html");
  const page = htmlPageText(html);
  const s = extractRecord(statute, page.text, withPassages(statute, page.text).passages, { ...meta, format: "html", html });
  assert.ok(s.ok && s.fields.shortTitle === "PDPA");
  const hansard = candidate({ id: "sg-hansard-pdp-bill-2r-2012", type: "hansard", url: "https://sprs.parl.gov.sg/x?id=023_20121015_S0003_T0002" });
  const hhtml = fixture("hansard-sprs.html");
  const hp = htmlPageText(hhtml);
  const h = extractRecord(hansard, hp.text, withPassages(hansard, hp.text).passages, { ...meta, format: "html", html: hhtml });
  assert.ok(h.ok && h.fields.timeline[0]?.event === "Sitting");
  const eo = candidate({ id: "ca-eo-n-12-23", type: "executive-order" });
  const ehtml = fixture("eo.html");
  const ep = htmlPageText(ehtml);
  const e = extractRecord(eo, ep.text, withPassages(eo, ep.text).passages, { ...meta, format: "html", html: ehtml });
  assert.ok(e.ok && e.fields.timeline[0]?.event === "Signed");
});

test("extractRecord is pure: the same input gives the same output, and the input is not changed", () => {
  const c = candidate({ id: "ca-sb-900-2025", type: "bill" });
  const text = fixture("bill-enacted.txt");
  const { passages } = withPassages(c, text);
  const frozen = structuredClone(passages);
  const a = extractRecord(c, text, passages, { ...meta, format: "text" });
  const b = extractRecord(c, text, passages, { ...meta, format: "text" });
  assert.deepEqual(a, b);
  assert.deepEqual(passages, frozen);
});

test("withoutParts takes parts off every claim and leaves the rest", () => {
  const c = candidate({ id: "sg-gebiz-gbz000123", type: "tender" });
  const text = fixture("tender.txt");
  const r = extractRecord(c, text, withPassages(c, text).passages, { ...meta, format: "text" });
  assert.ok(r.ok);
  assert.ok(r.fields.summary.parts && r.fields.timeline[0]!.parts);
  const stripped = withoutParts(r.fields);
  assert.equal(JSON.stringify(stripped).includes("parts"), false);
  assert.equal(stripped.summary.value, r.fields.summary.value);
  assert.deepEqual(stripped.summary.support, r.fields.summary.support);
  assert.equal(stripped.statusDate, "2025-03-04");
});

test("a bill of Singapore (a ministry's page about it) is read as a web page, not by the California bill rules", () => {
  const c = candidate({ id: "sg-digital-infrastructure-bill-2026", type: "bill", url: "https://www.mddi.gov.sg/newsroom/x/" });
  const html = fixture("release-isomer.html");
  const page = htmlPageText(html);
  const r = extractRecord(c, page.text, withPassages(c, page.text).passages, { ...meta, format: "html", html });
  assert.ok(r.ok);
  assert.equal(r.fields.status.value, "published");
  assert.equal(r.fields.published, "2024-10-01");
  // a California "bill" with no digest and no history still has no summary
  const ca = candidate({ id: "ca-sb-1-2025", type: "bill" });
  assert.deepEqual(extractRecord(ca, page.text, withPassages(ca, page.text).passages, { ...meta, format: "html", html }), { ok: false, reason: "no official summary found" });
});
