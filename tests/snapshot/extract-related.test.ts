import assert from "node:assert/strict";
import { test } from "node:test";

import { linkRelated } from "../../photon/scripts/snapshot/extract/related.ts";

type Item = Parameters<typeof linkRelated>[0][number];
const sb1047: Item = {
  id: "ca-sb-1047-2024",
  jurisdiction: "US-CA",
  title: "Safe and Secure Innovation for Frontier Artificial Intelligence Models Act",
  shortTitle: "SB 1047",
  text: "This bill follows SB 53 of the 2025 session and builds on the earlier bill. The Personal Data Protection Act is a Singapore law.",
};
const sb53: Item = { id: "ca-sb-53-2025", jurisdiction: "US-CA", title: "Artificial intelligence models: large developers", shortTitle: "SB 53", text: "Frontier developers. Nothing else is mentioned." };
const pdpa: Item = { id: "sg-pdpa-2012", jurisdiction: "SG", title: "Personal Data Protection Act 2012", shortTitle: "PDPA", text: "An Act to govern the collection of personal data. See also the Personal Data Protection Act 2012 itself." };
const guidance: Item = { id: "sg-pdpc-guide-2024", jurisdiction: "SG", title: "Advisory Guidelines", text: "These guidelines explain how the Personal Data Protection Act applies to AI systems. See also SB 53." };

test("a bill that mentions another bill's number links to it, with the relation related", () => {
  const links = linkRelated([sb1047, sb53, pdpa, guidance]);
  assert.deepEqual(links.get("ca-sb-1047-2024"), [{ id: "ca-sb-53-2025", relation: "related" }]);
  assert.deepEqual(links.get("ca-sb-53-2025"), []);
});

test("SB 530 does not match SB 53, and Senate Bill 53 does; the number needs a boundary", () => {
  const text = (t: string): Item => ({ ...sb1047, text: t });
  assert.deepEqual(linkRelated([text("This follows SB 530."), sb53]).get("ca-sb-1047-2024"), []);
  assert.deepEqual(linkRelated([text("This follows SB 5300 and SB 531."), sb53]).get("ca-sb-1047-2024"), []);
  assert.deepEqual(linkRelated([text("Senate Bill 53 was enacted."), sb53]).get("ca-sb-1047-2024"), [{ id: "ca-sb-53-2025", relation: "related" }]);
  assert.deepEqual(linkRelated([text("See (SB 53)."), sb53]).get("ca-sb-1047-2024"), [{ id: "ca-sb-53-2025", relation: "related" }]);
  assert.deepEqual(linkRelated([text("See SB53, later."), sb53]).get("ca-sb-1047-2024"), [{ id: "ca-sb-53-2025", relation: "related" }]);
  assert.deepEqual(linkRelated([text("Assembly Bill 53 is another bill."), sb53]).get("ca-sb-1047-2024"), [], "Assembly Bill 53 is not SB 53");
  const ab: Item = { ...sb53, id: "ca-ab-53-2025", shortTitle: "AB 53" };
  assert.deepEqual(linkRelated([text("Assembly Bill 53 is another bill."), ab]).get("ca-sb-1047-2024"), [{ id: "ca-ab-53-2025", relation: "related" }]);
});

test("a record in the other jurisdiction is never linked, in either direction", () => {
  const links = linkRelated([sb1047, sb53, pdpa, guidance]);
  assert.ok(!links.get("ca-sb-1047-2024")!.some((l) => l.id === "sg-pdpa-2012"), "the CA text names the Personal Data Protection Act, but it is a Singapore record");
  assert.ok(!links.get("sg-pdpc-guide-2024")!.some((l) => l.id.startsWith("ca-")), "the guidance text names SB 53");
});

test("an Act's short title matches without its year, and the guidance links to the statute", () => {
  const links = linkRelated([sb1047, sb53, pdpa, guidance]);
  assert.deepEqual(links.get("sg-pdpc-guide-2024"), [{ id: "sg-pdpa-2012", relation: "related" }]);
});

test("a record never links to itself, even when its own text names itself", () => {
  const links = linkRelated([sb1047, sb53, pdpa, guidance]);
  assert.deepEqual(links.get("sg-pdpa-2012"), []);
  const selfish: Item = { ...sb53, text: "This is SB 53 and Senate Bill 53." };
  assert.deepEqual(linkRelated([selfish]).get("ca-sb-53-2025"), []);
});

test("links are sorted by id, and each record is listed once however often it is named", () => {
  const many: Item = {
    ...guidance,
    text: "The Cybersecurity Act, the Personal Data Protection Act, the Computer Misuse Act, the Personal Data Protection Act again.",
  };
  const acts: Item[] = ["Personal Data Protection Act 2012", "Cybersecurity Act 2018", "Computer Misuse Act 1993"].map((title, i) => ({
    id: ["sg-pdpa-2012", "sg-cybersecurity-act-2018", "sg-cma-1993"][i]!,
    jurisdiction: "SG",
    title,
    text: "An Act.",
  }));
  assert.deepEqual(
    linkRelated([many, ...acts]).get("sg-pdpc-guide-2024")!.map((l) => l.id),
    ["sg-cma-1993", "sg-cybersecurity-act-2018", "sg-pdpa-2012"],
  );
});

test("an Act's short title is matched as a whole phrase, and a title without a year gives no short title", () => {
  const act: Item = { id: "sg-x-2020", jurisdiction: "SG", title: "Personal Data Protection Act 2012", text: "x" };
  const other = (t: string): Item => ({ id: "sg-y", jurisdiction: "SG", title: "Y", text: t });
  assert.deepEqual(linkRelated([other("the Personal Data Protection (Amendment) Act 2020"), act]).get("sg-y"), []);
  assert.deepEqual(linkRelated([other("the Personal Data Protection Act"), act]).get("sg-y"), [{ id: "sg-x-2020", relation: "related" }]);
  assert.deepEqual(linkRelated([other("the Personal Data Protection Act 2012"), act]).get("sg-y"), [{ id: "sg-x-2020", relation: "related" }]);
  assert.deepEqual(linkRelated([other("the Personal Data Protection Actually"), act]).get("sg-y"), []);
  const noYear: Item = { id: "sg-z", jurisdiction: "SG", title: "Model AI Governance Framework", text: "x" };
  assert.deepEqual(linkRelated([other("the Model AI Governance Framework"), noYear]).get("sg-y"), []);
});

test("an empty list gives an empty map", () => {
  assert.equal(linkRelated([]).size, 0);
});
