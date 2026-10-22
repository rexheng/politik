import assert from "node:assert/strict";
import { test } from "node:test";

import { checkClaims } from "../../photon/scripts/snapshot/check.ts";
import { extractStatute } from "../../photon/scripts/snapshot/extract/statute.ts";
import { markdownToText } from "../../photon/scripts/snapshot/extract.ts";
import { htmlPageText } from "../../photon/scripts/snapshot/meta.ts";
import { candidate, fixture, withPassages } from "../helpers/extract.ts";

function runHtml(id: string, html: string, snapshotDate = "2026-10-15") {
  const c = candidate({ id, type: "statute" });
  const { text } = htmlPageText(html);
  const { passages } = withPassages(c, text);
  return { passages, result: extractStatute(c, text, passages, { snapshotDate, format: "html", html }) };
}

test("a revised edition: the long title without its cite is the summary (the two pieces are its parts); in force from the first commencement; no published date", () => {
  const { result, passages } = runHtml("sg-pdpa-2012", fixture("sso-revised-act.html"));
  assert.ok(result.ok);
  assert.equal(
    result.fields.summary.value,
    "An Act to govern the collection, use and disclosure of personal data by organisations, and to establish the Do Not Call Register and to provide for its administration, and for matters connected therewith.",
  );
  assert.deepEqual(result.fields.summary.parts, [
    "An Act to govern the collection, use and disclosure of personal data by organisations, and to establish the Do Not Call Register",
    "and to provide for its administration, and for matters connected therewith.",
  ]);
  assert.equal(result.fields.status.value, "in-force");
  assert.equal(result.fields.statusDate, "2013-01-02");
  assert.deepEqual(result.fields.timeline.map((t) => [t.date, t.event]), [["2013-01-02", "Commenced"]]);
  assert.deepEqual(result.fields.timeline[0]!.parts, ["2 January 2013"]);
  assert.equal(result.fields.published, undefined);
  assert.equal(result.fields.shortTitle, "PDPA");
  assert.deepEqual(result.fields.affected, []);
  const checked = checkClaims(result.fields, passages);
  assert.equal(checked.fatal, undefined);
  assert.deepEqual(checked.dropped, []);
});

test("an Act with ten Parts: the provisions are the first eight Part headings, as the contents write them", () => {
  const { result } = runHtml("sg-pdpa-2012", fixture("sso-revised-act.html"));
  assert.ok(result.ok);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), [
    "Part 1 PRELIMINARY",
    "Part 2 PERSONAL DATA PROTECTION COMMISSION AND ADMINISTRATION",
    "Part 3 GENERAL RULES WITH RESPECT TO PROTECTION OF AND ACCOUNTABILITY FOR PERSONAL DATA",
    "Part 4 COLLECTION, USE AND DISCLOSURE OF PERSONAL DATA",
    "Part 5 ACCESS TO AND CORRECTION OF PERSONAL DATA",
    "Part 6 CARE OF PERSONAL DATA",
    "Part 6A NOTIFICATION OF DATA BREACHES",
    "Part 9 DO NOT CALL REGISTRY",
  ]);
});

test("an original-format Act: assent is published and an Assented event; the status turns on the snapshot date; an Act with two Parts lists section headings", () => {
  const html = fixture("sso-original-act.html");
  const later = runHtml("sg-osraa-2025", html, "2026-10-15");
  assert.ok(later.result.ok);
  assert.equal(later.result.fields.published, "2025-11-25");
  assert.deepEqual(later.result.fields.timeline.map((t) => [t.date, t.event]), [["2025-11-25", "Assented"], ["2026-06-29", "Commenced"]]);
  assert.deepEqual(later.result.fields.timeline.map((t) => t.parts), [["25 November 2025"], ["29 June 2026"]]);
  assert.equal(later.result.fields.status.value, "in-force");
  assert.equal(later.result.fields.statusDate, "2026-06-29");
  assert.equal(later.result.fields.shortTitle, "OSRAA");

  const earlier = runHtml("sg-osraa-2025", html, "2026-01-01");
  assert.ok(earlier.result.ok);
  assert.equal(earlier.result.fields.status.value, "enacted", "its commencement, 29 June 2026, is later than the snapshot");
  assert.equal(earlier.result.fields.statusDate, "2025-11-25", "enacted on assent");
  assert.deepEqual(earlier.result.fields.timeline.map((t) => t.event), ["Assented", "Commenced"]);

  const onDay = runHtml("sg-osraa-2025", html, "2026-06-29");
  assert.ok(onDay.result.ok && onDay.result.fields.status.value === "in-force");

  // two Parts: section headings, up to eight, as the contents write them
  assert.deepEqual(later.result.fields.provisions.map((p) => p.value), [
    "1 Short title and commencement",
    "2 Purposes of Act",
    "3 General interpretation",
    "4 Application of Act",
    "5 Appointment of Commissioner of Online Safety",
    "6 Functions of Commissioner",
    "7 Powers of Commissioner",
    "8 Delegation",
  ]);
  const checked = checkClaims(later.result.fields, later.passages);
  assert.equal(checked.fatal, undefined);
  assert.deepEqual(checked.dropped, []);
});

test("R34: an Act with an assent date and no commencement date is enacted, dated by the assent; one with no dates at all has no status date and no timeline", () => {
  const noCommencement = fixture("sso-original-act.html").replace(/<div class="cDateL">[\s\S]*?<\/div>/, "");
  const a = runHtml("sg-osraa-2025", noCommencement).result;
  assert.ok(a.ok);
  assert.equal(a.fields.status.value, "enacted", "Acts commence by notification: we claim only the assent the page shows");
  assert.equal(a.fields.statusDate, "2025-11-25");
  assert.deepEqual(a.fields.timeline.map((t) => t.event), ["Assented"]);

  const nothing = fixture("sso-revised-act.html").replace(/<table width="100%"><tr><td class="cDate">[\s\S]*?<\/td><\/tr><\/table>/g, "");
  const n = runHtml("sg-pdpa-2012", nothing).result;
  assert.ok(n.ok);
  assert.equal(n.fields.status.value, "in-force");
  assert.equal(n.fields.statusDate, undefined);
  assert.deepEqual(n.fields.timeline, []);
});

test("a page whose table of contents the body lacks still cites its entries, through the Contents block", () => {
  const { result, passages } = runHtml("sg-osraa-2025", fixture("sso-original-act.html"));
  assert.ok(result.ok);
  assert.ok(passages.some((p) => p.heading === "Contents" && p.text.includes("2 Purposes of Act")));
});

test("a capture with no HTML: the 'An Act to' paragraph, no status date, and the Part N lines with the paragraph after them", () => {
  const c = candidate({ id: "sg-pdpa-2012", type: "statute" });
  const text = markdownToText(fixture("sso-act-capture.md"));
  const { passages } = withPassages(c, text);
  const result = extractStatute(c, text, passages, { snapshotDate: "2026-10-15", format: "text" });
  assert.ok(result.ok);
  assert.equal(
    result.fields.summary.value,
    "An Act to govern the collection, use and disclosure of personal data by organisations, and to establish the Do Not Call Register and to provide for its administration, and for matters connected therewith.",
  );
  assert.equal(result.fields.summary.parts, undefined);
  assert.equal(result.fields.status.value, "in-force");
  assert.equal(result.fields.statusDate, undefined);
  assert.deepEqual(result.fields.timeline, []);
  assert.equal(result.fields.published, undefined);
  assert.deepEqual(result.fields.provisions.map((p) => p.value), [
    "Part 1 PRELIMINARY",
    "Part 2 PERSONAL DATA PROTECTION COMMISSION AND ADMINISTRATION",
    "Part 3 GENERAL RULES WITH RESPECT TO PROTECTION OF AND ACCOUNTABILITY FOR PERSONAL DATA",
  ]);
  const checked = checkClaims(result.fields, passages);
  assert.equal(checked.fatal, undefined);
  assert.deepEqual(checked.dropped, []);

  const fewer = text.replace(/Part 3\n\nGENERAL[^\n]*\n\n/, "").replace(/Part 2\n\nPERSONAL[^\n]*\n\n/, "");
  const f = extractStatute(c, fewer, withPassages(c, fewer).passages, { snapshotDate: "2026-10-15", format: "text" });
  assert.ok(f.ok);
  assert.deepEqual(f.fields.provisions, [], "fewer than three Parts: no provisions from a capture");
});

test("no long title gives no official summary found, in a page and in a capture", () => {
  const without = fixture("sso-revised-act.html").replace(/<table width="100%"><tr><td class="longTitle"[\s\S]*?<\/td><\/tr><\/table>/, "");
  assert.deepEqual(runHtml("sg-pdpa-2012", without).result, { ok: false, reason: "no official summary found" });
  const c = candidate({ id: "sg-pdpa-2012", type: "statute" });
  const text = markdownToText(fixture("sso-act-capture.md")).replace(/^An Act to[^\n]*\n\n/m, "");
  assert.deepEqual(extractStatute(c, text, withPassages(c, text).passages, { snapshotDate: "2026-10-15", format: "text" }), { ok: false, reason: "no official summary found" });
});

test("the short title is a 2-to-6-letter acronym segment of the id, or none", () => {
  const html = fixture("sso-revised-act.html");
  const title = (id: string) => {
    const r = runHtml(id, html).result;
    assert.ok(r.ok);
    return r.fields.shortTitle;
  };
  assert.equal(title("sg-cma-1993"), "CMA");
  assert.equal(title("sg-eliona-2024"), "ELIONA");
  assert.equal(title("sg-cybersecurity-act-2018"), undefined);
  assert.equal(title("sg-pdpa-amendment-2020"), undefined);
  assert.equal(title("sg-a-2020"), undefined);
});
