// R39: what the app shows of a record whose publisher does not allow redistribution (redistributionOk false): at most a 280-character
// quote, always with its attribution and a link to the source. Every route a passage's text can take out of the Worker is covered:
// the cited quotes and the written reply of /api/ask (also behind voice and Telegram), the Sources page's catalog, and the static assets.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { Env } from "../../photon/src/ask.ts";
import { loadCatalog } from "../../photon/src/catalog.ts";
import { citationOf, finalize, MAX_QUOTE_CHARS } from "../../photon/src/chat/cite.ts";
import { FALLBACK_REPLY } from "../../photon/src/chat/index.ts";
import type { ChatResponse, ComposeOut, Source } from "../../photon/src/chat/types.ts";
import type { D1Like } from "../../photon/src/data/d1.ts";
import { MAX_RESTRICTED_QUOTE_CHARS } from "../../photon/src/data/redistribution.ts";
import type { Manifest, Passage, PolicyRecord, RecordSummary } from "../../photon/src/data/schema.ts";
import { snapshotStatements } from "../../photon/src/data/seed.ts";
import { getPassages, listRecords, searchPassages } from "../../photon/src/data/store.ts";
import { formatTelegramReply } from "../../photon/src/telegram.ts";
import worker from "../../photon/src/worker.ts";
import { openTestDb } from "../helpers/d1.ts";

const fixtureDir = fileURLToPath(new URL("../fixtures/snapshot/", import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(fixtureDir + name, "utf8"));
const fixturePolicies: PolicyRecord[] = load("policies.json");
const fixturePassages: Passage[] = load("passages.json");
const manifest: Manifest = load("manifest.json");

/** A restricted record, and one passage of it that is far longer than a quote may be. */
const RESTRICTED_ID = "sg-zyxquartz-2025";
const ATTRIBUTION = "Example Agency, Singapore. Used as a short quotation with attribution.";
const FULL_TEXT = Array.from({ length: 40 }, (_, i) => `Zyxquartz clause ${i} states that operators shall keep careful records of every complaint they receive.`).join(" ");
const restrictedRecord: PolicyRecord = {
  ...structuredClone(fixturePolicies[0]!),
  id: RESTRICTED_ID,
  jurisdiction: "SG",
  title: "Zyxquartz guidelines",
  shortTitle: undefined,
  url: "https://agency.example.sg/zyxquartz",
  publisher: "Example Agency",
  attribution: ATTRIBUTION,
  redistributionOk: false,
  summary: { value: "Operators shall keep careful records of every complaint.", support: [`${RESTRICTED_ID}#1`] },
  status: { value: "published", support: [`${RESTRICTED_ID}#1`] },
  timeline: [],
  provisions: [],
  affected: [],
  related: [],
};
delete (restrictedRecord as { shortTitle?: string }).shortTitle;
const restrictedPassage: Passage = { id: `${RESTRICTED_ID}#1`, recordId: RESTRICTED_ID, seq: 1, text: FULL_TEXT };
const policies = [...fixturePolicies, restrictedRecord];
const passages = [...fixturePassages, restrictedPassage];

/** True when `body` holds a run of more than `max` characters of `text` word for word. */
function holdsRunOf(body: string, text: string, max: number): boolean {
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const b = flat(body);
  const t = flat(text);
  for (let i = 0; i + max + 1 <= t.length; i += 5) if (b.includes(t.slice(i, i + max + 1))) return true;
  return false;
}

function summaryOf(id: string, over: Partial<RecordSummary> = {}): RecordSummary {
  return {
    id,
    jurisdiction: "SG",
    type: "guidance",
    title: `Title of ${id}`,
    status: "published",
    lastActivity: "2025-09-29",
    summary: "A short summary.",
    url: `https://agency.example.sg/${id}`,
    publisher: "Example Agency",
    attribution: ATTRIBUTION,
    redistributionOk: false,
    landmark: false,
    reviewState: "auto-checked",
    ...over,
  };
}
const sourceOf = (id: string, text: string, over: Partial<RecordSummary> = {}): Source => ({
  kind: "policy",
  record: summaryOf(id, over),
  passage: { id: `${id}#1`, recordId: id, seq: 1, text },
});
const out = (answer: string): ComposeOut => ({ answer, general: null, followUps: [] });

describe("a restricted record's citation", () => {
  test("quotes at most 280 characters of a long passage, with its attribution, its link and its licence flag", () => {
    const citation = citationOf(sourceOf("a", FULL_TEXT), 1)!;
    assert.ok(citation.quote.length <= MAX_RESTRICTED_QUOTE_CHARS, String(citation.quote.length));
    assert.equal(MAX_QUOTE_CHARS, MAX_RESTRICTED_QUOTE_CHARS);
    assert.ok(FULL_TEXT.startsWith(citation.quote.replace(/…$/, "").trimEnd()));
    assert.equal(citation.attribution, ATTRIBUTION);
    assert.equal(citation.url, "https://agency.example.sg/a");
    assert.equal(citation.redistributionOk, false);
  });

  test("a record with no attribution on its summary is attributed to its publisher, and one with no flag counts as restricted", () => {
    const citation = citationOf(sourceOf("b", "Some text.", { attribution: undefined, redistributionOk: undefined }), 1)!;
    assert.equal(citation.attribution, "Example Agency");
    assert.equal(citation.redistributionOk, false);
  });

  test("a redistributable record's citation says so, and is still at most 280 characters", () => {
    const citation = citationOf(sourceOf("c", FULL_TEXT, { redistributionOk: true }), 1)!;
    assert.equal(citation.redistributionOk, true);
    assert.ok(citation.quote.length <= MAX_QUOTE_CHARS);
    assert.equal(citation.attribution, ATTRIBUTION);
  });

  test("a source with no link is not cited, restricted or not", () => {
    assert.equal(citationOf(sourceOf("d", "Text.", { url: "" }), 1), undefined);
  });
});

describe("finalize: the written reply", () => {
  const restricted = sourceOf("r", FULL_TEXT);

  test("a reply that copies more than 280 characters of a restricted passage is not valid", () => {
    const copied = FULL_TEXT.slice(0, 700);
    const got = finalize(out(`The guidelines say: ${copied} [1]`), [restricted]);
    assert.equal(got.valid, false);
  });

  test("a reply that copies the passage with other spacing or case in the markers is still caught", () => {
    const got = finalize(out(`${FULL_TEXT.slice(40, 600).replace(/ /g, "  ").replace(/\./g, "[1].")} [1]`), [restricted]);
    assert.equal(got.valid, false);
  });

  test("a short quotation, or a paraphrase, is fine", () => {
    assert.equal(finalize(out(`Operators "shall keep careful records of every complaint they receive" [1].`), [restricted]).valid, true);
    assert.equal(finalize(out("Operators have to log complaints [1]."), [restricted]).valid, true);
    assert.equal(finalize(out(`${FULL_TEXT.slice(0, 250)} [1]`), [restricted]).valid, true, "250 characters is under the limit");
  });

  test("the general-knowledge text and the follow-up questions are checked too: a long copy in either makes the reply invalid", () => {
    const copied = FULL_TEXT.slice(0, 700);
    const ok = "Operators have to log complaints [1].";
    assert.equal(finalize({ answer: ok, general: copied, followUps: [] }, [restricted]).valid, false, "general");
    assert.equal(finalize({ answer: ok, general: null, followUps: ["What about this?", copied] }, [restricted]).valid, false, "a follow-up");
    assert.equal(finalize({ answer: ok, general: "A short note.", followUps: ["What next?"] }, [restricted]).valid, true);
    // each field is its own text: two halves of a passage in two fields are not one run
    const half = FULL_TEXT.slice(0, 200);
    assert.equal(finalize({ answer: `${ok} ${half}`, general: FULL_TEXT.slice(200, 400), followUps: [] }, [restricted]).valid, true);
  });

  test("the same long copy of a redistributable record's passage is allowed", () => {
    const open = sourceOf("o", FULL_TEXT, { redistributionOk: true });
    assert.equal(finalize(out(`${FULL_TEXT.slice(0, 700)} [1]`), [open]).valid, true);
  });

  test("only a restricted source in the list is checked: a long copy of an open source next to a restricted one passes", () => {
    const open = sourceOf("o", FULL_TEXT.replaceAll("Zyxquartz", "Qwertyuiop").replaceAll("operators", "providers"), { redistributionOk: true });
    assert.equal(finalize(out(`${open.passage!.text.slice(0, 600)} [1]`), [open, restricted]).valid, true);
  });
});

describe("the Worker", () => {
  let db: D1Like;
  let dispose: () => Promise<void>;
  before(async () => {
    ({ db, dispose } = await openTestDb());
    await db.batch(snapshotStatements(policies, passages, manifest).map((s) => db.prepare(s.sql).bind(...s.params)));
  });
  after(() => dispose());
  beforeEach(() => {
    mock.method(console, "warn", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
  });

  const env = (over: Partial<Env> = {}) => ({ DB: db, ...over }) as unknown as Env;
  const post = (body: unknown, e: Env = env()) =>
    worker.fetch(new Request("https://politik.test/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), e);

  async function withGroq<T>(compose: string, run: () => Promise<T>): Promise<T> {
    const real = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const name = JSON.parse(String(init?.body)).response_format.json_schema.name;
      const content =
        name === "route"
          ? { intent: "brief", detail: false, standalone: "zyxquartz", search: "zyxquartz", recordHints: [], jurisdiction: null, topics: [], sinceDays: null }
          : { answer: compose, general: null, followUps: [] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] }), { status: 200 });
    }) as typeof fetch;
    try {
      return await run();
    } finally {
      globalThis.fetch = real;
    }
  }

  test("/api/ask, fallback: the restricted record is cited as a short quote with its attribution and link, and no more of its text is in the response", async () => {
    const res = await post({ message: "zyxquartz records complaints" });
    const body = (await res.json()) as ChatResponse;
    const cited = body.citations.find((c) => c.recordId === RESTRICTED_ID);
    assert.ok(cited, JSON.stringify(body.citations.map((c) => c.recordId)));
    assert.ok(cited.quote.length <= 280);
    assert.equal(cited.attribution, ATTRIBUTION);
    assert.equal(cited.url, "https://agency.example.sg/zyxquartz");
    assert.equal(cited.redistributionOk, false);
    assert.ok(!holdsRunOf(JSON.stringify(body), FULL_TEXT, 280));
  });

  test("/api/ask, compose: a reply that copies the restricted passage is replaced by the fallback records", async () => {
    const body = await withGroq(`${FULL_TEXT.slice(0, 800)} [1]`, async () => (await (await post({ message: "zyxquartz records complaints" }, env({ GROQ_API_KEY: "gsk-test" }))).json()) as ChatResponse);
    assert.equal(body.mode, "fallback");
    assert.equal(body.reply, FALLBACK_REPLY);
    assert.ok(body.citations.every((c) => c.quote.length <= 280 && c.attribution));
    assert.ok(!holdsRunOf(JSON.stringify(body), FULL_TEXT, 280));
  });

  test("/api/ask, compose: a long copy in a follow-up is replaced by the fallback records, and `general` (dropped when there are sources) never reaches the response", async () => {
    for (const where of ["general", "followUps"] as const) {
      const real = globalThis.fetch;
      globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
        const name = JSON.parse(String(init?.body)).response_format.json_schema.name;
        const content =
          name === "route"
            ? { intent: "brief", detail: false, standalone: "zyxquartz", search: "zyxquartz", recordHints: [], jurisdiction: null, topics: [], sinceDays: null }
            : { answer: "Operators have to log complaints [1][2][3][4][5][6].", general: where === "general" ? FULL_TEXT.slice(0, 900) : null, followUps: where === "followUps" ? [FULL_TEXT.slice(0, 900)] : [] };
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] }), { status: 200 });
      }) as typeof fetch;
      try {
        const body = (await (await post({ message: "zyxquartz records complaints" }, env({ GROQ_API_KEY: "gsk-test" }))).json()) as ChatResponse;
        // `general` is dropped by compose when the answer has sources, so it never reaches the response; a follow-up would
        assert.ok(!holdsRunOf(JSON.stringify(body), FULL_TEXT, 280), where);
        if (where === "followUps") {
          assert.equal(body.mode, "fallback", where);
          assert.equal(body.reply, FALLBACK_REPLY, where);
        } else {
          assert.equal("general" in body, false);
        }
      } finally {
        globalThis.fetch = real;
      }
    }
  });

  test("/api/ask, compose: a short quotation is answered, cited with the attribution", async () => {
    const answer = `Operators "shall keep careful records of every complaint they receive" [1][2][3][4][5][6][7][8].`;
    const body = await withGroq(answer, async () => (await (await post({ message: "zyxquartz records complaints" }, env({ GROQ_API_KEY: "gsk-test" }))).json()) as ChatResponse);
    assert.notEqual(body.mode, "fallback");
    const cited = body.citations.find((c) => c.recordId === RESTRICTED_ID);
    assert.ok(cited, JSON.stringify(body.citations.map((c) => c.recordId)));
    assert.equal(cited.attribution, ATTRIBUTION);
    assert.ok(body.citations.every((c) => c.quote.length <= 280 && c.attribution));
  });

  test("Telegram lists each source with its attribution and link", () => {
    const text = formatTelegramReply({
      reply: "Records are kept [1].",
      mode: "brief",
      followUps: [],
      asOf: "2026-10-01",
      citations: [{ n: 1, kind: "policy", recordId: RESTRICTED_ID, title: "Zyxquartz guidelines", url: "https://agency.example.sg/zyxquartz", attribution: ATTRIBUTION, redistributionOk: false, quote: "q" }],
    });
    assert.ok(text.includes(`[1] Zyxquartz guidelines (${ATTRIBUTION}) — https://agency.example.sg/zyxquartz`), text);
  });

  test("/api/sources lists the restricted record by title and link only: no passage text, and it says it may not be redistributed", async () => {
    const res = await worker.fetch(new Request("https://politik.test/api/sources"), env());
    const catalog = await res.json();
    const raw = JSON.stringify(catalog);
    assert.ok(!raw.includes("Zyxquartz clause"));
    assert.ok(!holdsRunOf(raw, FULL_TEXT, 100));
    const listed = (await loadCatalog(db)).sources.find((s) => s.id === "Example Agency");
    assert.ok(listed && listed.redistributionOk === false && listed.attribution === ATTRIBUTION);
  });

  test("the store's summary of a record carries its attribution and licence, and redistributableOnly leaves out the restricted passages", async () => {
    const summary = (await listRecords(db)).find((r) => r.id === RESTRICTED_ID)!;
    assert.equal(summary.redistributionOk, false);
    assert.equal(summary.attribution, ATTRIBUTION);
    assert.equal((await listRecords(db)).find((r) => r.id === fixturePolicies[0]!.id)!.redistributionOk, true);
    const ids = [restrictedPassage.id, fixturePassages[0]!.id];
    assert.deepEqual((await getPassages(db, ids)).map((p) => p.id), ids);
    assert.deepEqual((await getPassages(db, ids, { redistributableOnly: true })).map((p) => p.id), [fixturePassages[0]!.id]);
    const hits = await searchPassages(db, "zyxquartz");
    assert.equal(hits[0]!.record.redistributionOk, false);
  });
});

describe("static files", () => {
  test("the assets directory holds no snapshot data, and the Worker serves nothing else from the repository", () => {
    const wrangler = readFileSync(fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url)), "utf8");
    assert.match(wrangler, /"directory":\s*"\.\/photon\/public"/);
    const names = readdirSync(fileURLToPath(new URL("../../photon/public/", import.meta.url)), { recursive: true }).map(String);
    for (const name of names) assert.doesNotMatch(name, /passages|policies\.json|snapshot/i, name);
  });
});
