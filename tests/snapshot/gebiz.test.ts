import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { fetchGebizTenders, GEBIZ_RULE, type GebizRule } from "../../photon/scripts/snapshot/gebiz.ts";
import { TopicSchema } from "../../photon/src/data/schema.ts";

const gebizJson = readFileSync(new URL("../fixtures/sources/gebiz.json", import.meta.url), "utf8");

// The fixture holds three real-shaped rows:
//   ACR000ETT21000001  "...UNIFIED DATA ANALYTICS PLATFORM (UDAP)..."  S$2,321,600    6/9/2021
//   ACR000ETT21000003  "...BUSINESS REGISTRY & REGULATORY SYSTEM..."   S$108,555,723  14/4/2022
//   ACR000ETT21000004  "...HOSTED IN THE GOVERNMENT COMMERCIAL CLOUD"  S$4,503,450    13/4/2022
const rule = (over: Partial<GebizRule> = {}): GebizRule => ({
  datasetId: "d_test_dataset",
  keywords: ["analytics", "\\bcloud\\b"],
  since: "2021-01-01",
  minAwardSgd: 1_000_000,
  ...over,
});

type Page = { records: Record<string, unknown>[]; total: number };
const serve = (pages: (url: URL) => Page | Response) => {
  const urls: URL[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url);
    const out = pages(url);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify({ success: true, result: { records: out.records, total: out.total } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, urls };
};
const serveFixture = () => serve(() => new Response(gebizJson, { status: 200 }));

const row = (over: Record<string, unknown>) => ({
  _id: 1,
  tender_no: "XYZ000ETT23000001",
  tender_description: "Managed cloud services",
  agency: "Some Agency",
  award_date: "1/2/2024",
  tender_detail_status: "Awarded to Suppliers",
  supplier_name: "ACME PTE LTD",
  awarded_amt: "2000000",
  ...over,
});

test("only rows matching a keyword and the award threshold are kept, with lowercased ids", async () => {
  const { impl, urls } = serveFixture();
  const tenders = await fetchGebizTenders(rule({ minAwardSgd: 3_000_000 }), impl);
  assert.deepEqual(
    tenders.map((t) => t.candidate.id),
    ["sg-gebiz-acr000ett21000004"],
  );
  assert.equal(urls.length, 1);
  assert.equal(urls[0]?.origin + urls[0]?.pathname, "https://data.gov.sg/api/action/datastore_search");
  assert.equal(urls[0]?.searchParams.get("resource_id"), "d_test_dataset");
  assert.equal(urls[0]?.searchParams.get("offset"), "0");
});

test("a lower threshold lets the second keyword row in, and the keyword filter still drops the registry row", async () => {
  const { impl } = serveFixture();
  const tenders = await fetchGebizTenders(rule(), impl);
  assert.deepEqual(
    tenders.map((t) => t.candidate.id),
    ["sg-gebiz-acr000ett21000004", "sg-gebiz-acr000ett21000001"],
  );
});

test("a high threshold keeps nothing and a keyword-free rule keeps nothing", async () => {
  assert.deepEqual(await fetchGebizTenders(rule({ minAwardSgd: 1_000_000_000 }), serveFixture().impl), []);
  assert.deepEqual(await fetchGebizTenders(rule({ keywords: ["submarine cable"] }), serveFixture().impl), []);
  assert.deepEqual(await fetchGebizTenders(rule({ keywords: [] }), serveFixture().impl), []);
});

test("since compares the award date, read as day/month/year", async () => {
  // 6/9/2021 is 6 September 2021 (not 9 June): in on 2021-07-01, out on 2021-10-01.
  const july = await fetchGebizTenders(rule({ since: "2021-07-01" }), serveFixture().impl);
  assert.deepEqual(
    july.map((t) => t.candidate.id).sort(),
    ["sg-gebiz-acr000ett21000001", "sg-gebiz-acr000ett21000004"],
  );
  const october = await fetchGebizTenders(rule({ since: "2021-10-01" }), serveFixture().impl);
  assert.deepEqual(
    october.map((t) => t.candidate.id),
    ["sg-gebiz-acr000ett21000004"],
  );
});

test("each tender becomes a tender candidate with the dataset provenance and a text built from the row", async () => {
  const { impl } = serveFixture();
  const [cloud] = await fetchGebizTenders(rule({ minAwardSgd: 3_000_000 }), impl);
  assert.ok(cloud);
  assert.deepEqual(cloud.candidate, {
    include: true,
    id: "sg-gebiz-acr000ett21000004",
    jurisdiction: "SG",
    title: "INVITATION TO TENDER FOR THE APPLICATION SOFTWARE MAINTENANCE AND SUPPORT FOR BIZFINX SYSTEM HOSTED IN THE GOVERNMENT COMMERCIAL CLOUD FOR ACCOUNTING AND CORPORATE REGULARTORY AUTHORITY",
    type: "tender",
    topics: ["gov-tech-procurement"],
    status: "awarded",
    landmark: false,
    url: "https://data.gov.sg/datasets/d_test_dataset/view#ACR000ETT21000004",
    urlConfidence: "constructed",
    why: cloud.candidate.why,
  });
  assert.ok(cloud.candidate.why.length > 0);
  for (const topic of cloud.candidate.topics) assert.ok(TopicSchema.safeParse(topic).success);
  for (const part of [
    "ACR000ETT21000004",
    "GOVERNMENT COMMERCIAL CLOUD",
    "Accounting And Corporate Regulatory Authority",
    "CRIMSONLOGIC PTE LTD",
    "S$4,503,450",
    "2022-04-13",
  ]) {
    assert.ok(cloud.text.includes(part), `${part} missing from: ${cloud.text}`);
  }
});

test("whitespace in a description is collapsed in the title and the text", async () => {
  const { impl } = serveFixture();
  const tenders = await fetchGebizTenders(rule({ minAwardSgd: 0, keywords: ["UNIFIED DATA ANALYTICS"] }), impl);
  assert.equal(tenders.length, 1);
  assert.ok(!tenders[0]!.candidate.title.includes("  "));
  assert.ok(tenders[0]!.text.includes("TESTING AND COMMISSIONING"));
});

test("matching is case-insensitive and a regex keyword can anchor a whole word", async () => {
  const tenders = serve(() => ({
    records: [
      row({ tender_no: "A1", tender_description: "Airport baggage system" }),
      row({ tender_no: "A2", tender_description: "Enterprise AI platform" }),
      row({ tender_no: "A3", tender_description: "Cybersecurity audit services" }),
    ],
    total: 3,
  }));
  const found = await fetchGebizTenders(rule({ keywords: ["\\bAI\\b", "cyber"] }), tenders.impl);
  assert.deepEqual(found.map((t) => t.candidate.id).sort(), ["sg-gebiz-a2", "sg-gebiz-a3"]);
});

test("rows are fetched page by page until the total is reached, even if the server caps the page size", async () => {
  const all = Array.from({ length: 5 }, (_, i) => row({ tender_no: `T${i}`, awarded_amt: String(1_000_000 + i) }));
  const { impl, urls } = serve((url) => {
    const offset = Number(url.searchParams.get("offset"));
    return { records: all.slice(offset, offset + 2), total: all.length };
  });
  const tenders = await fetchGebizTenders(rule(), impl);
  assert.equal(tenders.length, 5);
  assert.deepEqual(
    urls.map((u) => u.searchParams.get("offset")),
    ["0", "2", "4"],
  );
});

test("an empty page ends the paging even when the total says there is more", async () => {
  const { impl, urls } = serve((url) =>
    Number(url.searchParams.get("offset")) === 0 ? { records: [row({})], total: 10 } : { records: [], total: 10 },
  );
  const tenders = await fetchGebizTenders(rule(), impl);
  assert.equal(tenders.length, 1);
  assert.equal(urls.length, 2);
});

test("a tender with several award rows becomes one candidate, listing every award and the latest date", async () => {
  const { impl } = serve(() => ({
    records: [
      row({ tender_no: "MULTI1", supplier_name: "FIRM A", awarded_amt: "2500000", award_date: "21/6/2023", tender_detail_status: "Awarded by Items" }),
      row({ tender_no: "MULTI1", supplier_name: "FIRM B", awarded_amt: "1200000", award_date: "22/6/2023", tender_detail_status: "Awarded by Items" }),
      row({ tender_no: "MULTI1", supplier_name: "FIRM A", awarded_amt: "1000", award_date: "21/6/2023", tender_detail_status: "Awarded by Items" }),
    ],
    total: 3,
  }));
  const tenders = await fetchGebizTenders(rule(), impl);
  assert.equal(tenders.length, 1);
  const [t] = tenders;
  assert.equal(t!.candidate.id, "sg-gebiz-multi1");
  assert.ok(t!.text.includes("FIRM A (S$2,500,000); FIRM B (S$1,200,000); FIRM A (S$1,000)"), t!.text);
  assert.ok(t!.text.includes("Largest single award: S$2,500,000"), t!.text);
  assert.ok(t!.text.includes("2023-06-22"));
});

test("the award threshold applies to the largest single award, because award rows are not additive", async () => {
  const { impl } = serve(() => ({
    records: [
      // A framework agreement repeats its ceiling on every supplier's row; the sum (3.6M) would overstate it.
      row({ tender_no: "FRAME1", supplier_name: "FIRM A", awarded_amt: "900000", tender_detail_status: "Awarded by Items" }),
      row({ tender_no: "FRAME1", supplier_name: "FIRM B", awarded_amt: "900000", tender_detail_status: "Awarded by Items" }),
      row({ tender_no: "FRAME1", supplier_name: "FIRM C", awarded_amt: "900000", tender_detail_status: "Awarded by Items" }),
      row({ tender_no: "FRAME1", supplier_name: "FIRM D", awarded_amt: "900000", tender_detail_status: "Awarded by Items" }),
    ],
    total: 4,
  }));
  assert.deepEqual(await fetchGebizTenders(rule(), impl), []);
});

test("tenders with no award are dropped", async () => {
  const { impl } = serve(() => ({
    records: [
      row({ tender_no: "NOAWARD1", tender_detail_status: "Awarded to No Suppliers" }),
      row({ tender_no: "CANCEL1", tender_detail_status: "Cancelled" }),
      row({ tender_no: "OK1", tender_detail_status: "Awarded by Items" }),
    ],
    total: 3,
  }));
  assert.deepEqual(
    (await fetchGebizTenders(rule(), impl)).map((t) => t.candidate.id),
    ["sg-gebiz-ok1"],
  );
});

test("rows with a missing or unreadable amount, date or tender number are skipped, not guessed", async () => {
  const { impl } = serve(() => ({
    records: [
      row({ tender_no: "BADAMT", awarded_amt: "n/a" }),
      row({ tender_no: "NOAMT", awarded_amt: null }),
      row({ tender_no: "BADDATE", award_date: "sometime" }),
      row({ tender_no: "NODATE", award_date: null }),
      row({ tender_no: "" }),
      row({ tender_no: "GOOD", awarded_amt: "1,500,000.50", award_date: "2024-03-05" }),
    ],
    total: 6,
  }));
  const tenders = await fetchGebizTenders(rule(), impl);
  assert.deepEqual(
    tenders.map((t) => t.candidate.id),
    ["sg-gebiz-good"],
  );
  assert.ok(tenders[0]!.text.includes("2024-03-05"));
});

test("ids are lowercase slugs even when the tender number has odd characters", async () => {
  const { impl } = serve(() => ({
    records: [row({ tender_no: "GVT/000 ETT_24.000007" })],
    total: 1,
  }));
  const [t] = await fetchGebizTenders(rule(), impl);
  assert.equal(t!.candidate.id, "sg-gebiz-gvt-000-ett-24-000007");
  assert.match(t!.candidate.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test("results are ordered by award amount, largest first, then by id", async () => {
  const { impl } = serve(() => ({
    records: [
      row({ tender_no: "B", awarded_amt: "2000000" }),
      row({ tender_no: "A", awarded_amt: "2000000" }),
      row({ tender_no: "C", awarded_amt: "9000000" }),
    ],
    total: 3,
  }));
  assert.deepEqual(
    (await fetchGebizTenders(rule(), impl)).map((t) => t.candidate.id),
    ["sg-gebiz-c", "sg-gebiz-a", "sg-gebiz-b"],
  );
});

test("an HTTP error or an unexpected response throws", async () => {
  await assert.rejects(() => fetchGebizTenders(rule(), serve(() => new Response("oops", { status: 500 })).impl), /HTTP 500/);
  await assert.rejects(() => fetchGebizTenders(rule(), serve(() => new Response("{}", { status: 200 })).impl), /unexpected/i);
  await assert.rejects(
    () => fetchGebizTenders(rule(), serve(() => new Response('{"success":false,"error":{"message":"nope"}}', { status: 200 })).impl),
    /unexpected|nope/i,
  );
});

test("a keyword that is not a valid pattern throws before any request", async () => {
  const { impl, urls } = serveFixture();
  await assert.rejects(() => fetchGebizTenders(rule({ keywords: ["("] }), impl), /keyword/i);
  assert.equal(urls.length, 0);
});

test("the provisional rule is complete and well-formed", () => {
  assert.equal(GEBIZ_RULE.datasetId, "d_acde1106003906a75c3fa052592f2fcb");
  assert.ok(GEBIZ_RULE.keywords.length > 0);
  for (const kw of GEBIZ_RULE.keywords) assert.doesNotThrow(() => new RegExp(kw, "i"), kw);
  assert.match(GEBIZ_RULE.since, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(GEBIZ_RULE.minAwardSgd > 0);
});
