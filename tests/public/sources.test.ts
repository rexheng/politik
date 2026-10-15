import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const publicDir = fileURLToPath(new URL("../../photon/public/", import.meta.url));
const script = readFileSync(publicDir + "sources.js", "utf8");
const html = readFileSync(publicDir + "sources.html", "utf8");

/** Runs sources.js against a stub page whose /api/sources answers `response`, and returns the as-of line. */
async function asOfLine(response: () => Promise<unknown>): Promise<string> {
  const elements = new Map<string, Record<string, unknown>>();
  const element = (id: string) => {
    if (!elements.has(id)) {
      elements.set(id, { id, textContent: "", children: [], appendChild() {}, append() {} });
    }
    return elements.get(id)!;
  };
  const sandbox = {
    document: { getElementById: element },
    fetch: async () => ({ json: response }),
  };
  vm.runInNewContext(script, sandbox);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return element("asof").textContent as string;
}

const lists = { blocked: [], jurisdictions: [], sources: [], latest: [] };

describe("sources page", () => {
  test("the as-of line sits directly after the nav", () => {
    assert.match(html, /<\/nav>\s*<p id="asof" class="meta"><\/p>/);
  });

  test("shows the snapshot date as D Mon YYYY", async () => {
    assert.equal(await asOfLine(async () => ({ ...lists, snapshotDate: "2026-10-15" })), "Data as of 15 Oct 2026");
    assert.equal(await asOfLine(async () => ({ ...lists, snapshotDate: "2026-10-01" })), "Data as of 1 Oct 2026");
    assert.equal(await asOfLine(async () => ({ ...lists, snapshotDate: "2026-01-31" })), "Data as of 31 Jan 2026");
  });

  test("says no data is loaded when the date is empty or missing", async () => {
    assert.equal(await asOfLine(async () => ({ ...lists, snapshotDate: "" })), "No policy data loaded yet");
    assert.equal(await asOfLine(async () => lists), "No policy data loaded yet");
  });

  test("says no data is loaded when the request fails", async () => {
    assert.equal(await asOfLine(async () => Promise.reject(new Error("offline"))), "No policy data loaded yet");
  });
});
