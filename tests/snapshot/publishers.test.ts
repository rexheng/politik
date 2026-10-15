import assert from "node:assert/strict";
import { test } from "node:test";

import { publisherFor } from "../../photon/scripts/snapshot/publishers.ts";

const ISSUER = "Some Issuer";

// The hosts R2 names, plus the extra hosts photon/data/snapshot/candidates.md links to.
const NAMED_HOSTS = [
  "leginfo.legislature.ca.gov", "oag.ca.gov", "gov.ca.gov", "cppa.ca.gov", "cdt.ca.gov", "cpuc.ca.gov", "energy.ca.gov",
  "calcivilrights.ca.gov", "sso.agc.gov.sg", "imda.gov.sg", "pdpc.gov.sg", "mddi.gov.sg", "csa.gov.sg", "mha.gov.sg",
  "mas.gov.sg", "sprs.parl.gov.sg", "data.gov.sg",
];
const EXTRA_HOSTS = ["govops.ca.gov", "publicadvocates.cpuc.ca.gov", "edb.gov.sg", "police.gov.sg", "aiverifyfoundation.sg"];

test("every known host has its own publisher and an attribution, never the issuer fallback", () => {
  for (const host of [...NAMED_HOSTS, ...EXTRA_HOSTS]) {
    const out = publisherFor(`https://${host}/some/page`, ISSUER);
    assert.notEqual(out.publisher, ISSUER, host);
    assert.ok(out.publisher.length > 0 && out.attribution.length > 0, host);
    assert.notEqual(out.attribution, ISSUER, host);
  }
});

test("redistributionOk is true only for California government hosts and data.gov.sg", () => {
  const yes = [
    "leginfo.legislature.ca.gov", "oag.ca.gov", "gov.ca.gov", "cppa.ca.gov", "cdt.ca.gov", "cpuc.ca.gov", "energy.ca.gov",
    "calcivilrights.ca.gov", "govops.ca.gov", "publicadvocates.cpuc.ca.gov", "data.gov.sg",
  ];
  for (const host of yes) assert.equal(publisherFor(`https://${host}/x`, ISSUER).redistributionOk, true, host);
  const no = NAMED_HOSTS.concat(EXTRA_HOSTS).filter((h) => !yes.includes(h));
  for (const host of no) assert.equal(publisherFor(`https://${host}/x`, ISSUER).redistributionOk, false, host);
});

test("the Singapore Open Data Licence is named in the data.gov.sg attribution", () => {
  const out = publisherFor("https://data.gov.sg/datasets/d_acde1106003906a75c3fa052592f2fcb/view#ABC", ISSUER);
  assert.match(out.attribution, /Singapore Open Data Licence/);
  assert.match(out.attribution, /data\.gov\.sg/);
  assert.equal(publisherFor("https://api-production.data.gov.sg/v2/x", ISSUER).redistributionOk, true);
});

test("a www prefix, a subdomain and upper-case letters in the host do not matter", () => {
  const base = publisherFor("https://leginfo.legislature.ca.gov/faces/x", ISSUER);
  assert.deepEqual(publisherFor("https://www.leginfo.legislature.ca.gov/faces/x", ISSUER), base);
  assert.deepEqual(publisherFor("HTTPS://LEGINFO.Legislature.CA.gov/faces/x", ISSUER), base);
  assert.equal(publisherFor("https://www.mddi.gov.sg/a", ISSUER).publisher, publisherFor("https://mddi.gov.sg/b", ISSUER).publisher);
  assert.equal(publisherFor("https://docs.cpuc.ca.gov/x.PDF", ISSUER).publisher, publisherFor("https://www.cpuc.ca.gov/", ISSUER).publisher);
  assert.equal(publisherFor("https://broadbandforall.cdt.ca.gov/2025/", ISSUER).publisher, publisherFor("https://cdt.ca.gov/", ISSUER).publisher);
});

test("the more specific host wins: the Public Advocates Office is not the CPUC itself", () => {
  const advocates = publisherFor("https://www.publicadvocates.cpuc.ca.gov/press-room", ISSUER);
  assert.notEqual(advocates.publisher, publisherFor("https://www.cpuc.ca.gov/", ISSUER).publisher);
});

test("an unknown host falls back to the issuer and is not redistributable", () => {
  assert.deepEqual(publisherFor("https://example.test/doc", "Example Body"), {
    publisher: "Example Body",
    attribution: "Example Body",
    redistributionOk: false,
  });
  // A host that merely ends with a known name is not that host.
  assert.equal(publisherFor("https://evilgov.ca.gov.example.test/x", "X").publisher, "X");
  assert.equal(publisherFor("https://notimda.gov.sg/x", "X").publisher, "X");
  // Generic file hosts say nothing about who wrote the document.
  assert.equal(publisherFor("https://arxiv.org/pdf/2506.20702", "Authors").publisher, "Authors");
  assert.equal(publisherFor("https://file.go.gov.sg/nais2023.pdf", "Smart Nation Group").publisher, "Smart Nation Group");
});

test("a string that is not a URL falls back instead of throwing", () => {
  assert.deepEqual(publisherFor("not a url", "Issuer"), { publisher: "Issuer", attribution: "Issuer", redistributionOk: false });
  assert.deepEqual(publisherFor("", "Issuer"), { publisher: "Issuer", attribution: "Issuer", redistributionOk: false });
});
