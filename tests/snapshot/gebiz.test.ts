import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { fetchGebizTenders, GEBIZ_RULE, selectTenders, type GebizRule } from "../../photon/scripts/snapshot/gebiz.ts";
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

test("matching is case-insensitive and keywords are whole words", async () => {
  const tenders = serve(() => ({
    records: [
      row({ tender_no: "A1", tender_description: "Airport baggage system" }),
      row({ tender_no: "A2", tender_description: "Enterprise AI platform" }),
      row({ tender_no: "A3", tender_description: "Cybersecurity audit services" }),
    ],
    total: 3,
  }));
  const found = await fetchGebizTenders(rule({ keywords: ["AI", "cybersecurity"] }), tenders.impl);
  assert.deepEqual(found.map((t) => t.candidate.id).sort(), ["sg-gebiz-a2", "sg-gebiz-a3"]);
  // "AI" is a whole word, so it is not found inside "Airport", and "cyber" is not found inside "Cybersecurity".
  assert.deepEqual((await fetchGebizTenders(rule({ keywords: ["AI"] }), tenders.impl)).map((t) => t.candidate.id), ["sg-gebiz-a2"]);
  assert.deepEqual(await fetchGebizTenders(rule({ keywords: ["cyber"] }), tenders.impl), []);
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

test("a keyword that contains \\b is a pattern, and one that is not a valid pattern throws before any request", async () => {
  const { impl, urls } = serveFixture();
  await assert.rejects(() => fetchGebizTenders(rule({ keywords: ["\\b("] }), impl), /keyword/i);
  await assert.rejects(() => fetchGebizTenders(rule({ exclude: ["\\b("] }), impl), /exclude/i);
  assert.equal(urls.length, 0);
  // A plain "(" is matched as the character: it is found in "(UDAP)" and does not throw.
  assert.deepEqual((await fetchGebizTenders(rule({ keywords: ["("] }), serveFixture().impl)).map((t) => t.candidate.id), ["sg-gebiz-acr000ett21000001"]);
});

// ---------------------------------------------------------------------------------------------------------------------
// I1: whole-word keywords, exclusions, topic groups and the real rule

const serveRows = (...rows: Record<string, unknown>[]) => serve(() => ({ records: rows, total: rows.length }));
const idsOf = async (r: GebizRule, ...rows: Record<string, unknown>[]) =>
  (await fetchGebizTenders(r, serveRows(...rows).impl)).map((t) => t.candidate.id);

test("a plain keyword is a whole word: `server` does not match 'Observer'", async () => {
  const found = await idsOf(
    rule({ keywords: ["server"] }),
    row({ tender_no: "OBS1", tender_description: "Supply of an Observer drone" }),
    row({ tender_no: "SRV1", tender_description: "Supply of a Server" }),
    row({ tender_no: "SRV2", tender_description: "Servers for the data hall" }),
  );
  assert.deepEqual(found, ["sg-gebiz-srv1"], "'Servers' is another word: a plural needs its own keyword or a pattern");
  assert.deepEqual(await idsOf(rule({ keywords: ["\\bservers?\\b"] }), row({ tender_no: "SRV2", tender_description: "Servers for the data hall" })), ["sg-gebiz-srv2"]);
});

test("characters that mean something in a pattern are matched literally in a plain keyword", async () => {
  const rows = [
    row({ tender_no: "DOT1", tender_description: "Supply of a.b modules" }),
    row({ tender_no: "DOT2", tender_description: "Supply of axb modules" }),
    row({ tender_no: "PAR1", tender_description: "Wi-Fi (v6) access points" }),
    row({ tender_no: "PLUS1", tender_description: "A C++ compiler licence" }),
  ];
  assert.deepEqual(await idsOf(rule({ keywords: ["a.b"] }), ...rows), ["sg-gebiz-dot1"]);
  assert.deepEqual(await idsOf(rule({ keywords: ["wi-fi (v6)"] }), ...rows), ["sg-gebiz-par1"]);
  assert.deepEqual(await idsOf(rule({ keywords: ["c++"] }), ...rows), ["sg-gebiz-plus1"]);
});

test("the exclude list drops a tender that a keyword matched", async () => {
  const rows = [
    row({ tender_no: "KEEP1", tender_description: "Managed cloud services" }),
    row({ tender_no: "DROP1", tender_description: "Cloud kitchen cleaning services" }),
    row({ tender_no: "DROP2", tender_description: "Cloud migration with GUARDING staff" }),
  ];
  assert.deepEqual(await idsOf(rule({ keywords: ["cloud"] }), ...rows), ["sg-gebiz-drop1", "sg-gebiz-drop2", "sg-gebiz-keep1"]);
  assert.deepEqual(await idsOf(rule({ keywords: ["cloud"], exclude: ["cleaning", "guarding"] }), ...rows), ["sg-gebiz-keep1"]);
  // Exclude patterns follow the keyword syntax: whole words by default, a pattern when it contains \b.
  assert.deepEqual(await idsOf(rule({ keywords: ["cloud"], exclude: ["clean"] }), ...rows), ["sg-gebiz-drop1", "sg-gebiz-drop2", "sg-gebiz-keep1"]);
  assert.deepEqual(await idsOf(rule({ keywords: ["cloud"], exclude: ["\\bclean"] }), ...rows), ["sg-gebiz-drop2", "sg-gebiz-keep1"]);
  assert.deepEqual(await idsOf(rule({ keywords: ["cloud"], exclude: ["^(?!.*migration).*\\bkitchen\\b"] }), ...rows), ["sg-gebiz-drop2", "sg-gebiz-keep1"]);
});

test("a rule has either keywords or groups, with unique names and whole-number quotas", async () => {
  const group = (over: Record<string, unknown> = {}) => ({ name: "g", keywords: ["cloud"], quota: 1, topic: "data-centres", ...over }) as never;
  const both = rule({ keywords: ["cloud"], groups: [group()] });
  await assert.rejects(() => fetchGebizTenders(both, serveFixture().impl), /either keywords or groups/);
  await assert.rejects(() => fetchGebizTenders(rule({ keywords: undefined, groups: [group(), group()] }), serveFixture().impl), /unique/);
  await assert.rejects(() => fetchGebizTenders(rule({ keywords: undefined, groups: [group({ quota: 1.5 })] }), serveFixture().impl), /quota/);
});

const groupRule = (over: Partial<GebizRule> = {}): GebizRule => ({
  datasetId: "d_test_dataset",
  groups: [
    { name: "ai", keywords: ["AI", "analytics"], quota: 2, topic: "ai-governance" },
    { name: "cloud", keywords: ["cloud", "analytics"], quota: 1, topic: "data-centres" },
  ],
  since: "2021-01-01",
  minAwardSgd: 1_000_000,
  ...over,
});
const tender = (no: string, description: string, amount: number, agency = "Some Agency") =>
  row({ tender_no: no, tender_description: description, awarded_amt: String(amount), agency });

test("selectTenders fills each group up to its quota, largest award first, and gives the group's topic", async () => {
  const r = groupRule();
  const all = await fetchGebizTenders(
    r,
    serveRows(
      tender("A1", "AI platform one", 9_000_000),
      tender("A2", "AI platform two", 8_000_000),
      tender("A3", "AI platform three", 7_000_000),
      tender("C1", "Cloud migration one", 6_000_000),
      tender("C2", "Cloud migration two", 5_000_000),
    ).impl,
  );
  assert.equal(all.length, 5, "fetch returns every match");
  assert.deepEqual(all.map((t) => t.matched), [["ai"], ["ai"], ["ai"], ["cloud"], ["cloud"]]);
  const kept = selectTenders(r, all);
  assert.deepEqual(kept.map((t) => t.candidate.id), ["sg-gebiz-a1", "sg-gebiz-a2", "sg-gebiz-c1"], "a third AI tender and a second cloud tender are over quota");
  assert.deepEqual(kept.map((t) => t.candidate.topics), [
    ["ai-governance", "gov-tech-procurement"],
    ["ai-governance", "gov-tech-procurement"],
    ["data-centres", "gov-tech-procurement"],
  ]);
});

test("a tender whose first group is full goes to the next group it matches, and max cuts the smallest awards", async () => {
  const r = groupRule();
  const all = await fetchGebizTenders(
    r,
    serveRows(
      tender("X1", "AI analytics", 9_000_000),
      tender("X2", "AI analytics", 8_000_000),
      tender("X3", "AI analytics", 7_000_000),
      tender("X4", "AI analytics", 6_000_000),
    ).impl,
  );
  assert.deepEqual(all.map((t) => t.matched), [["ai", "cloud"], ["ai", "cloud"], ["ai", "cloud"], ["ai", "cloud"]]);
  const kept = selectTenders(r, all);
  assert.deepEqual(kept.map((t) => [t.candidate.id, t.candidate.topics[0]]), [
    ["sg-gebiz-x1", "ai-governance"],
    ["sg-gebiz-x2", "ai-governance"],
    ["sg-gebiz-x3", "data-centres"],
  ], "the fourth finds both groups full");
  assert.deepEqual(selectTenders({ ...r, max: 2 }, all).map((t) => t.candidate.id), ["sg-gebiz-x1", "sg-gebiz-x2"]);
});

test("selectTenders on a flat keyword rule only applies max, and leaves the topics alone", async () => {
  const r = rule({ keywords: ["cloud"] });
  const all = await fetchGebizTenders(r, serveRows(tender("F1", "Cloud one", 3_000_000), tender("F2", "Cloud two", 2_000_000)).impl);
  assert.deepEqual(all.map((t) => t.matched), [[], []]);
  assert.deepEqual(selectTenders({ ...r, max: 1 }, all).map((t) => t.candidate.id), ["sg-gebiz-f1"]);
  assert.deepEqual(selectTenders(r, all)[0]!.candidate.topics, ["gov-tech-procurement"]);
});

test("equal awards are ordered by agency priority, then id", async () => {
  const r = rule({ keywords: ["cloud"], agencyPriority: ["Government Technology Agency", "Cyber Security"] });
  const found = await idsOf(
    r,
    tender("A1", "Cloud", 2_000_000, "Some Other Agency"),
    tender("B1", "Cloud", 2_000_000, "Cyber Security Agency of Singapore"),
    tender("C1", "Cloud", 2_000_000, "Government Technology Agency (GovTech)"),
    tender("D1", "Cloud", 3_000_000, "Some Other Agency"),
  );
  assert.deepEqual(found, ["sg-gebiz-d1", "sg-gebiz-c1", "sg-gebiz-b1", "sg-gebiz-a1"], "the larger award still comes first; the priority only breaks the tie");
});

// Descriptions modelled on the tenders the first draft of the rule wrongly picked from the live dataset (2026-10-15).
const NOT_TECH = [
  "Construction of Cycling Path Network",
  "Rehabilitation of Sewerage Network Phase 6 - Eastern Zone Contract 3",
  "Provision of Technical Services in Water Supply Network, PUB (2024)",
  "Advance Engineering Study for Proposed Road Network at Jurong Lake District",
  "REMAKING OUR HEARTLAND BATCH 3 - PARKS UPGRADING PROGRAMME AND IMPROVEMENT TO PEDESTRIAN NETWORK",
  "Proposed Renovation Works to Office Space Located at 92 Punggol Way for Cyber Security Agency of Singapore",
  "Batch 15 works includes: 1 Replacement of 14 nos Air Handling Units (AHUs) 4 New 31 Nos Fan Coil Unit (FCU) for IT Server Rooms",
  "Architectural Consultancy Services for the Proposed Co-location of a School and a Special School",
  "Provision of Security Services for CAAS' Facilities",
  "Provision of Integrated Cleaning Services including a Network of Public Toilets",
  "Technology Refresh and Maintenance of a Network of Automated Weather Stations with Customised Software as a Service",
  "Replacement of Closed-Circuit Television (CCTV) Systems on Buses and CCTV maintenance for cloud depots",
  "Provision of Manpower Services for Support Officers at the data centre",
  "DEVELOPMENT AND CONDUCT OF CYBERSECURITY STRATEGIC LEADERSHIP PROGRAMME (CSLP)",
];
const TECH = [
  "Automatic Fare Collection Cloud Transformation (ACT)",
  "Provision of Microsoft Azure Cloud and Facility Management Services",
  "Implementation of a Unified Data Platform (UDP) in Government Commercial Cloud (GCC)",
  "PROVISION OF PUBLIC CLOUD SOFTWARE AS A SERVICE FOR THE SUBSCRIPTION OF A PORTAL",
  "SUPPLY OF ON-PREMISE ARTIFICIAL INTELLIGENCE (AI) CLUSTER",
  "Provision of Video Analytics System for Carpark Operations",
  "PROVISION OF MANAGED CYBERSECURITY SERVICES",
  "Provision of Operator Services by a Managed Security Service Provider to Support Manpower Requirements at the Maritime Cyber Assurance and Operations Centre",
  "Application Maintenance, Cloud Facility Management (FM) Support and Information Technology Security Officer (ITSO) for a Grant Management System",
  "Procurement of Global Network Connectivity Service between HQ and 52 Overseas Missions",
  "INVITATION TO TENDER FOR PROVISION OF NETWORK AND SECURITY PLATFORM SOLUTION",
  "Provision of RP campus network refresh and managed services",
  "Tender for Main Data Centre Modernization",
  "Replacement of CCTV systems with video analytics and maintenance",
  "Supply of Servers and Storage for the data centre",
];

test("GEBIZ_RULE picks none of the non-tech tenders the first draft picked, and picks the tech ones", async () => {
  const rows = [...NOT_TECH, ...TECH].map((description, i) => tender(`T${String(i).padStart(3, "0")}`, description, 2_000_000));
  const picked = (await fetchGebizTenders(GEBIZ_RULE, serveRows(...rows).impl)).map((t) => t.candidate.title);
  assert.deepEqual(picked.filter((t) => NOT_TECH.includes(t)), []);
  assert.deepEqual(TECH.filter((t) => !picked.includes(t)), []);
});

test("GEBIZ_RULE is complete and well-formed: the approved groups and quotas, valid patterns, no bare weak keywords", () => {
  assert.equal(GEBIZ_RULE.datasetId, "d_acde1106003906a75c3fa052592f2fcb");
  assert.match(GEBIZ_RULE.since, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(GEBIZ_RULE.minAwardSgd > 0);
  assert.equal(GEBIZ_RULE.keywords, undefined);
  const groups = GEBIZ_RULE.groups!;
  assert.deepEqual(groups.map((g) => [g.name, g.quota]), [["ai-analytics", 12], ["cloud-data-centre", 10], ["cybersecurity", 10], ["digital-infrastructure", 8]]);
  assert.equal(groups.reduce((n, g) => n + g.quota, 0), 40);
  for (const g of groups) {
    assert.ok(TopicSchema.safeParse(g.topic).success);
    assert.ok(g.keywords.length > 0);
    for (const kw of g.keywords) assert.doesNotThrow(() => new RegExp(kw, "i"), kw);
  }
  for (const pattern of GEBIZ_RULE.exclude ?? []) assert.doesNotThrow(() => new RegExp(pattern, "i"), pattern);
  // The words that matched sewers, servers rooms and a renovation must not come back on their own.
  const all = groups.flatMap((g) => g.keywords.map((k) => k.toLowerCase()));
  for (const bare of ["network", "hosting", "server", "servers", "cyber", "co-location", "wan", "lan"]) assert.ok(!all.includes(bare), bare);
  assert.ok((GEBIZ_RULE.exclude ?? []).length > 0);
  assert.ok((GEBIZ_RULE.agencyPriority ?? []).length > 0);
});
