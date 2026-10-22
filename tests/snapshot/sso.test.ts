import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlToText } from "../../photon/scripts/snapshot/extract.ts";
import { fetchSsoAct, isSsoUrl, parseSsoConfig, ssoHasUnloadedParts, ssoPlaceholders } from "../../photon/scripts/snapshot/sso.ts";
import { wordCount } from "../../photon/scripts/snapshot/passages.ts";

// A fixture of Singapore Statutes Online as it was on 2026-10-15: `?WholeDoc=1` answers with the page, the contents and the
// first part of the Act, and leaves one empty `<div class="dms" data-field="seriesId" data-term="...">` for each later part.
// The page's own script (bundles/legis) then asks `GET /Details/GetLazyLoadContent` once per placeholder, with the page's
// `lazyLoadFilter`, the placeholder's SeriesId and the FragSysId and `_` that the page lists for it in `fragments`.

const ORIGIN = "https://sso.agc.gov.sg";
const URL_ = `${ORIGIN}/Act/FIXT2024?WholeDoc=1`;
const words = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");

const config = (terms: string[], over: Record<string, unknown> = {}) => ({
  tocSysId: "toc-1",
  legisTitle: "Fixture Act 2024",
  lazyLoadFilter: { TocSysId: "toc-1", SeriesId: null, ValidTime: null, TransactionTime: null, ViewType: "", V: "41", Phrase: null, Exact: null },
  lazyLoadContentUrl: "/Details/GetLazyLoadContent",
  fragments: Object.fromEntries(terms.map((t, i) => [t, { Item1: `frag-${t}`, Item2: `2026071417171${i}` }])),
  ...over,
});

/** The page: a masthead variable block, the one with the lazy-load settings, the first part, then one placeholder per term. */
const page = (terms: string[], cfg: object | null = config(terms), front = `Fixture Act 2024 front part ${words("front", 20)}`) =>
  `<!DOCTYPE html><html lang="en"><head><title></title><script>var x = 1;</script></head><body>
<div class="global-vars" data-json='{"host":"sso.agc.gov.sg","rootPath":"https://sso.agc.gov.sg/","ajaxToken":"abc=="}'></div>
${cfg ? `<div class="global-vars" data-json='${JSON.stringify(cfg)}'></div>` : ""}
<nav>Contents of the Act</nav>
<div id="legisContent"><div class="front">${front}</div>${terms.map((t) => `<div class="dms" data-field="seriesId" data-term="${t}"></div>`).join("")}</div>
</body></html>`;

const part = (n: number, tag = `part${n}w`) => `<table width="100%"><tr><td class="part" id="P${n}-"><div class="partNo">PART ${n}</div><div class="body">${words(tag, 30)}</div></td></tr></table>`;

type Seen = { url: string; query: Record<string, string>; headers: Record<string, string> };
type Script = {
  page?: () => Response;
  /** Called with the SeriesId and the number of earlier requests for it; undefined means the normal answer. */
  fragment?: (term: string, attempt: number) => Response | undefined;
  parts?: Record<string, string>;
  tags?: Record<string, string>;
};

const challenge = () => new Response(`<html><script>window.gokuProps = {"key":"x"};</script>${"x".repeat(2300)}</html>`, { status: 202 });
const jsonError = () => new Response('{"Status":"ERROR","Message":"Sorry, an error has occurred."}', { status: 404, headers: { "content-type": "application/json" } });

function fakeSso(terms: string[], script: Script = {}) {
  const seen: Seen[] = [];
  const attempts = new Map<string, number>();
  let pageHtml = page(terms);
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    seen.push({ url: u.origin + u.pathname, query: Object.fromEntries(u.searchParams), headers });
    if (u.pathname === "/Details/GetLazyLoadContent") {
      const term = u.searchParams.get("SeriesId") ?? "";
      const attempt = attempts.get(term) ?? 0;
      attempts.set(term, attempt + 1);
      const special = script.fragment?.(term, attempt);
      if (special) return special;
      const body = script.parts?.[term] ?? part(terms.indexOf(term) + 2);
      return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...(script.tags?.[term] ? { XmlTag: script.tags[term] } : {}) } });
    }
    return script.page ? script.page() : new Response(pageHtml, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch;
  return { impl, seen, setPage: (html: string) => (pageHtml = html), fragmentRequests: () => seen.filter((s) => s.url.endsWith("/Details/GetLazyLoadContent")) };
}

const opts = (impl: typeof fetch, slept: number[] = []) => ({
  fetchImpl: impl,
  sleep: async (ms: number) => {
    slept.push(ms);
  },
  log: () => undefined,
});

test("isSsoUrl: only Singapore Statutes Online pages", () => {
  assert.equal(isSsoUrl("https://sso.agc.gov.sg/Act/PDPA2012?WholeDoc=1"), true);
  assert.equal(isSsoUrl("https://sso.agc.gov.sg/SL/PDPA2012-S1"), true);
  assert.equal(isSsoUrl("https://SSO.AGC.GOV.SG/Act/CSA2018"), true);
  assert.equal(isSsoUrl("https://www.agc.gov.sg/Act/PDPA2012"), false);
  assert.equal(isSsoUrl("https://example.test/sso.agc.gov.sg/Act/X"), false);
  assert.equal(isSsoUrl("not a url"), false);
});

test("the page's lazy-load settings are read from the global-vars block that has them, not the masthead one", () => {
  const cfg = parseSsoConfig(page(["a", "b"]));
  assert.ok(cfg);
  assert.equal(cfg.lazyLoadContentUrl, "/Details/GetLazyLoadContent");
  assert.equal(cfg.lazyLoadFilter.TocSysId, "toc-1");
  assert.deepEqual(Object.keys(cfg.fragments ?? {}), ["a", "b"]);
  assert.equal(parseSsoConfig(page(["a"], null)), undefined, "a page without the block");
  assert.equal(parseSsoConfig("<div class=\"global-vars\" data-json='{broken'></div>"), undefined, "and one whose JSON is broken");
});

test("the settings are also read when the attribute is double-quoted and entity-escaped", () => {
  const json = JSON.stringify(config(["a"])).replaceAll('"', "&quot;").replaceAll("&", "&amp;").replaceAll("&amp;quot;", "&quot;");
  const cfg = parseSsoConfig(`<div class="global-vars" data-json="${json}"></div>`);
  assert.equal(cfg?.lazyLoadFilter.TocSysId, "toc-1");
});

test("placeholders are the empty dms divs, in document order, whatever the order of their attributes", () => {
  const html = `<div class="dms" data-field="seriesId" data-term="one"></div><p>x</p><div data-term="two" data-field="seriesId" class="dms"> </div><div class="dms" data-field="other" data-term="no"></div><div class="dms" data-field="seriesId" data-term="three">has content</div>`;
  assert.deepEqual(ssoPlaceholders(html), ["one", "two"], "a seriesId placeholder with content in it is not one, and nor is a field other than seriesId");
});

test("the lazy-loaded parts are fetched one by one with the page's own parameters and put where their placeholders stood", async () => {
  const terms = ["t-2", "t-3", "t-4"];
  const sso = fakeSso(terms);
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0 });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.fragments, 3);

  const requests = sso.fragmentRequests();
  assert.deepEqual(requests.map((r) => r.query.SeriesId), terms, "in document order");
  const first = requests[0]!;
  assert.equal(first.url, `${ORIGIN}/Details/GetLazyLoadContent`);
  assert.deepEqual(first.query, {
    TocSysId: "toc-1", SeriesId: "t-2", ValidTime: "", TransactionTime: "", ViewType: "", V: "41", Phrase: "", Exact: "", FragSysId: "frag-t-2", _: "20260714171710",
  }, "the filter, with null as '', plus the series, the fragment id and the cache stamp the page lists for it");
  assert.equal(first.headers["x-requested-with"], "XMLHttpRequest");
  assert.equal(first.headers.referer, URL_);
  assert.match(first.headers["user-agent"] ?? "", /Mozilla/);

  assert.ok(!result.html.includes('class="dms"'), "no placeholder is left");
  const order = ["front0", "part2w0", "part3w0", "part4w0"].map((w) => result.html.indexOf(w));
  assert.ok(order.every((i) => i >= 0) && [...order].sort((a, b) => a - b).join() === order.join(), `in order: ${order}`);
  const text = htmlToText(result.html);
  assert.equal(wordCount(text.slice(text.indexOf("Fixture Act"))) >= 20 + 3 * 30, true, "and the text has all of it");
});

test("a part's own placeholders (the page's script loops until none is left) are fetched in a later round", async () => {
  const nested = `<div class="body">${words("outer", 5)}</div><div class="dms" data-field="seriesId" data-term="t-9"></div>`;
  const sso = fakeSso(["t-2", "t-9"], { parts: { "t-2": nested, "t-9": `<div>${words("inner", 5)}</div>` } });
  // t-9 is listed as a placeholder in the page too; remove it there so that only the nested one is asked for
  sso.setPage(page(["t-2"], config(["t-2", "t-9"])));
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0 });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(sso.fragmentRequests().map((r) => r.query.SeriesId), ["t-2", "t-9"]);
  assert.ok(result.html.indexOf("outer0") < result.html.indexOf("inner0"));
  assert.equal(result.fragments, 2);
});

test("requests are paced: one at a time, with the pause between them", async () => {
  const slept: number[] = [];
  const sso = fakeSso(["t-2", "t-3", "t-4"]);
  let inFlight = 0;
  let worst = 0;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    inFlight++;
    worst = Math.max(worst, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 5));
      return await sso.impl(input, init);
    } finally {
      inFlight--;
    }
  }) as typeof fetch;
  const result = await fetchSsoAct(URL_, { ...opts(impl, slept), pauseMs: 350 });
  assert.ok(result.ok);
  assert.equal(worst, 1, "never two requests at once");
  assert.equal(slept.filter((ms) => ms === 350).length, 3, "a pause after each part");
});

test("an Act whose page has no placeholders (a short amending Act) is returned as the page is, with no further request", async () => {
  const sso = fakeSso([]);
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0 });
  assert.ok(result.ok);
  assert.equal(result.fragments, 0);
  assert.equal(sso.seen.length, 1);
  assert.ok(result.html.includes("front0"));
});

test("placeholders but no settings on the page is a failure, not a silently partial Act", async () => {
  const sso = fakeSso(["t-2"]);
  sso.setPage(page(["t-2"], null));
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0 });
  assert.ok(!result.ok && result.reason === "loading failed" && /lazy-load/i.test(result.detail ?? ""), JSON.stringify(result));
  assert.equal("blocked" in result, false);
});

test("a placeholder the page lists no fragment for is a failure", async () => {
  const sso = fakeSso(["t-2", "t-3"]);
  sso.setPage(page(["t-2", "t-3"], config(["t-2"])));
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0 });
  assert.ok(!result.ok && result.reason === "loading failed" && result.detail?.includes("t-3"), JSON.stringify(result));
});

test("a page with no `fragments` map still asks for each part, without FragSysId (as the page's script does)", async () => {
  const sso = fakeSso(["t-2"]);
  sso.setPage(page(["t-2"], { ...config(["t-2"]), fragments: null }));
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0 });
  assert.ok(result.ok, JSON.stringify(result));
  const q = sso.fragmentRequests()[0]!.query;
  assert.equal(q.SeriesId, "t-2");
  assert.ok(!("FragSysId" in q) && !("_" in q));
});

test("an AWS WAF challenge (HTTP 202 with a script page) on a part is waited out and the part asked for again", async () => {
  const slept: number[] = [];
  const sso = fakeSso(["t-2", "t-3"], { fragment: (term, attempt) => (term === "t-3" && attempt < 2 ? challenge() : undefined) });
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl, slept), pauseMs: 0, challengeWaitMs: 1000 });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(slept.filter((ms) => ms >= 1000), [1000, 2000], "waits longer each time");
  assert.ok(!result.html.includes("gokuProps"), "the challenge page is never spliced into the Act");
  assert.equal(sso.fragmentRequests().filter((r) => r.query.SeriesId === "t-3").length, 3);
});

test("a challenge page that comes back as HTTP 200 is recognised too", async () => {
  const sso = fakeSso(["t-2"], { fragment: (_t, attempt) => (attempt === 0 ? new Response(challenge().body, { status: 200 }) : undefined) });
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0, challengeWaitMs: 1 });
  assert.ok(result.ok && !result.html.includes("gokuProps"), JSON.stringify(result).slice(0, 200));
});

test("a part that always answers with the challenge fails the Act, and nothing is returned", async () => {
  const sso = fakeSso(["t-2", "t-3"], { fragment: (term) => (term === "t-3" ? challenge() : undefined) });
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0, challengeWaitMs: 1, maxAttempts: 3 });
  assert.ok(!result.ok && result.reason === "loading failed" && /t-3/.test(result.detail ?? "") && /challenge/i.test(result.detail ?? ""), JSON.stringify(result));
  assert.equal("html" in result, false, "no partial Act");
  assert.equal(sso.fragmentRequests().filter((r) => r.query.SeriesId === "t-3").length, 3);
});

test("the page itself behind the challenge is waited for too, and when it never clears the failure is 'loading failed', never 'blocked' (R28)", async () => {
  const slept: number[] = [];
  let n = 0;
  const flaky = fakeSso(["t-2"], { page: () => (++n < 3 ? challenge() : new Response(page(["t-2"]), { status: 200 })) });
  const ok = await fetchSsoAct(URL_, { ...opts(flaky.impl, slept), pauseMs: 0, challengeWaitMs: 5 });
  assert.ok(ok.ok, JSON.stringify(ok));

  const stuck = fakeSso(["t-2"], { page: () => challenge() });
  const result = await fetchSsoAct(URL_, { ...opts(stuck.impl), pauseMs: 0, challengeWaitMs: 1, maxAttempts: 2 });
  assert.ok(!result.ok && result.reason === "loading failed" && /challenge/i.test(result.detail ?? ""), JSON.stringify(result));
  assert.equal("blocked" in result, false, "a browser reads the first part only, so it is never offered");
});

test("the service's JSON error (HTTP 404 'Sorry, an error has occurred') is retried, as it cleared on its own in practice", async () => {
  const slept: number[] = [];
  const sso = fakeSso(["t-2"], { fragment: (_t, attempt) => (attempt < 2 ? jsonError() : undefined) });
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl, slept), pauseMs: 0, retryWaitMs: 100 });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(slept, [100, 200], "backs off");
  assert.ok(!result.html.includes("Sorry, an error"));
});

test("a part that keeps failing fails the Act with the part and the status", async () => {
  const sso = fakeSso(["t-2"], { fragment: () => jsonError() });
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0, retryWaitMs: 1, maxAttempts: 3 });
  assert.ok(!result.ok && result.reason === "loading failed" && /t-2/.test(result.detail ?? "") && /404/.test(result.detail ?? ""), JSON.stringify(result));
  assert.equal(sso.fragmentRequests().length, 3);
});

test("an untagged empty answer is a glitch, not a part: it is asked for again and, if it stays empty, fails the Act", async () => {
  const sso = fakeSso(["t-2"], { parts: { "t-2": "   " } });
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0, retryWaitMs: 1, maxAttempts: 2 });
  assert.ok(!result.ok && /empty/i.test(result.detail ?? ""), JSON.stringify(result));
  assert.equal(sso.fragmentRequests().length, 2);
});

test("an empty part that the service tagged (the legislative history of an Act that has none yet) is a part: it fills its placeholder with nothing", async () => {
  // Seen on the live OCHA 2023 page: the last placeholder answers HTTP 200, `XmlTag: legislativeHistory`, content-length 0.
  const sso = fakeSso(["t-2", "t-3"], { parts: { "t-3": "" }, tags: { "t-3": "legislativeHistory" } });
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0, retryWaitMs: 1, maxAttempts: 2 });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(sso.fragmentRequests().filter((r) => r.query.SeriesId === "t-3").length, 1, "not asked again");
  assert.ok(!result.html.includes('class="dms"') && result.html.includes("part2w0"));
});

test("a network error on a part is retried; a page that cannot be reached is 'unreachable'", async () => {
  let calls = 0;
  const sso = fakeSso(["t-2"]);
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes("GetLazyLoadContent") && calls++ === 0) throw new TypeError("fetch failed");
    return sso.impl(input, init);
  }) as typeof fetch;
  const ok = await fetchSsoAct(URL_, { ...opts(impl), pauseMs: 0, retryWaitMs: 1 });
  assert.ok(ok.ok, JSON.stringify(ok));

  const down = await fetchSsoAct(URL_, { ...opts((async () => { throw new TypeError("fetch failed"); }) as typeof fetch), pauseMs: 0, retryWaitMs: 1, maxAttempts: 2 });
  assert.ok(!down.ok && down.reason === "unreachable" && /fetch failed/.test(down.detail ?? ""), JSON.stringify(down));
  assert.equal("blocked" in down, false);
});

test("a failure never says 'blocked': HTTP 403, 429 and 500 on the page are 'HTTP n' (R28: a browser must not be tried on an Act)", async () => {
  for (const status of [403, 429, 500]) {
    const sso = fakeSso([], { page: () => new Response("no", { status }) });
    const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0, retryWaitMs: 1, maxAttempts: 1 });
    assert.ok(!result.ok && result.reason === `HTTP ${status}`, `${status}: ${JSON.stringify(result)}`);
    assert.equal("blocked" in result, false, String(status));
  }
});

test("derivations and toBeTabled parts (which the page's script appends to their own tables) are kept, where their placeholder stood", async () => {
  const sso = fakeSso(["t-2", "t-3"], { tags: { "t-2": "derivations", "t-3": "toBeTabled" } });
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0 });
  assert.ok(result.ok && result.html.includes("part2w0") && result.html.includes("part3w0"));
});

test("replacement text is inserted as it is: a '$&' in a part is not read as a replacement pattern", async () => {
  const sso = fakeSso(["t-2"], { parts: { "t-2": `<div>Fine of $1,000 and $& and $$ per day ${words("w", 3)}</div>` } });
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0 });
  assert.ok(result.ok && result.html.includes("Fine of $1,000 and $& and $$ per day"), result.ok ? "" : JSON.stringify(result));
});

// ---------------------------------------------------------------------------------------------------------------------
// R28: unloaded parts are never passed off as a whole Act

test("ssoHasUnloadedParts: any dms placeholder, however it is written, and nothing else", () => {
  assert.equal(ssoHasUnloadedParts(`<p>x</p><div class="dms" data-field="seriesId" data-term="a"></div>`), true);
  assert.equal(ssoHasUnloadedParts(`<div data-term='a' data-field='seriesId' class='dms'></div>`), true, "single quotes and another order");
  assert.equal(ssoHasUnloadedParts(`<div class="dms extra" data-field="seriesId" data-term="a"><span class="loading"></span></div>`), true, "with something inside, and another class");
  assert.equal(ssoHasUnloadedParts(`<DIV CLASS=dms DATA-FIELD=seriesId data-term=a></DIV>`), true, "unquoted, upper case");
  assert.equal(ssoHasUnloadedParts(`<div class="dms">no field</div><div class="dmsx" data-field="seriesId"></div><div class="x" data-field="seriesId"></div>`), false, "a dms div without the seriesId field, a class that only starts with dms, and a field without the class");
  assert.equal(ssoHasUnloadedParts(`<p>Part 2 text, complete.</p>`), false);
  assert.equal(ssoHasUnloadedParts(""), false);
});

test("a page with lazy-load markers that the assembler cannot read is a failure, not an Act that happens to have no parts", async () => {
  const sso = fakeSso([]);
  const odd = page([]).replace("</div>\n</body>", `<div class='dms' data-field='seriesId' data-term='odd'> </div></div>\n</body>`);
  assert.equal(ssoPlaceholders(odd).length, 0, "the assembler's own pattern does not see it");
  sso.setPage(odd);
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0 });
  assert.ok(!result.ok && result.reason === "loading failed" && /lazy-load|part/i.test(result.detail ?? ""), JSON.stringify(result));
  assert.equal(sso.fragmentRequests().length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// R28: a deadline for the whole Act, and one progress line per part

/** A clock that only the injected sleep moves, so a deadline can be tested without waiting. */
function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), advance: (ms: number) => void (t += ms) };
}

test("R28: the whole Act has a deadline of 10 minutes by default: a challenge that keeps waiting ends in 'loading failed' that says deadline", async () => {
  const clock = fakeClock();
  const sso = fakeSso(["t-2", "t-3"], { fragment: (term) => (term === "t-3" ? challenge() : undefined) });
  // waits of 100 s and 200 s are taken (300 s gone); the third, 300 s, would reach the 600 s deadline, so it is not taken
  const result = await fetchSsoAct(URL_, { fetchImpl: sso.impl, sleep: clock.sleep, now: clock.now, log: () => undefined, pauseMs: 0, challengeWaitMs: 100_000 });
  assert.ok(!result.ok && result.reason === "loading failed" && /deadline/i.test(result.detail ?? "") && /10 minutes/.test(result.detail ?? ""), JSON.stringify(result));
  assert.ok(/t-3/.test(result.ok ? "" : result.detail ?? ""), "and names the part it was on");
  assert.equal(sso.fragmentRequests().filter((r) => r.query.SeriesId === "t-3").length, 3, "it did not sleep up to the deadline just to try again");
  assert.equal("html" in result, false, "no partial Act");
});

test("R28: a deadline can be set, and is checked between parts as well as between tries", async () => {
  const clock = fakeClock();
  const sso = fakeSso(["t-2", "t-3", "t-4", "t-5", "t-6"]);
  const result = await fetchSsoAct(URL_, { fetchImpl: sso.impl, sleep: clock.sleep, now: clock.now, log: () => undefined, pauseMs: 400, deadlineMs: 1000 });
  assert.ok(!result.ok && result.reason === "loading failed" && /deadline/i.test(result.detail ?? ""), JSON.stringify(result));
  assert.deepEqual(sso.fragmentRequests().map((r) => r.query.SeriesId), ["t-2", "t-3", "t-4"], "three parts fit in 1,000 ms at 400 ms each; the fourth is not started");
});

test("R28: the deadline counts from the first request, and an Act that finishes in time is not affected by it", async () => {
  const clock = fakeClock();
  clock.advance(5_000_000); // the clock's value is irrelevant; only the time since this call began
  const sso = fakeSso(["t-2", "t-3"]);
  const result = await fetchSsoAct(URL_, { fetchImpl: sso.impl, sleep: clock.sleep, now: clock.now, log: () => undefined, pauseMs: 350 });
  assert.ok(result.ok, JSON.stringify(result));
});

test("R28: one progress line per part fetched, to the console by default: 'sso <Act>: part n/total'", async () => {
  const lines: string[] = [];
  const sso = fakeSso(["t-2", "t-3", "t-4"]);
  const result = await fetchSsoAct(URL_, { ...opts(sso.impl), pauseMs: 0, log: (line: string) => lines.push(line) });
  assert.ok(result.ok);
  assert.deepEqual(lines, ["sso FIXT2024: part 1/3", "sso FIXT2024: part 2/3", "sso FIXT2024: part 3/3"]);

  const nested: string[] = [];
  const inner = fakeSso(["t-2", "t-9"], { parts: { "t-2": `<div>x</div><div class="dms" data-field="seriesId" data-term="t-9"></div>`, "t-9": "<div>y</div>" } });
  inner.setPage(page(["t-2"], config(["t-2", "t-9"])));
  await fetchSsoAct(URL_, { ...opts(inner.impl), pauseMs: 0, log: (line: string) => nested.push(line) });
  assert.deepEqual(nested, ["sso FIXT2024: part 1/1", "sso FIXT2024: part 2/2"], "a nested part raises the total");

  const supp: string[] = [];
  await fetchSsoAct(`${ORIGIN}/Acts-Supp/34-2024/Published/20241121?DocDate=20241121&WholeDoc=1`, { ...opts(fakeSso(["t-2"]).impl), pauseMs: 0, log: (line: string) => supp.push(line) });
  assert.deepEqual(supp, ["sso 34-2024/Published/20241121: part 1/1"], "an Act in a supplement is named by its whole path below the first segment");

  const logged: unknown[][] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void logged.push(args);
  try {
    const { log: _quiet, ...withoutLog } = opts(fakeSso(["t-2"]).impl);
    await fetchSsoAct(URL_, { ...withoutLog, pauseMs: 0 });
  } finally {
    console.log = original;
  }
  assert.deepEqual(logged, [["sso FIXT2024: part 1/1"]], "the default is console.log");
});
