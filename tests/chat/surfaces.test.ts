// The places a chat answer goes out: the /api/ask endpoint, the voice route and the Telegram bot.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ask, askShared, type Env } from "../../photon/src/ask.ts";
import { EMPTY_REPLY, FAIL_REPLY, FALLBACK_REPLY, GREETING } from "../../photon/src/chat/index.ts";
import { toSpoken, toSpokenResponse } from "../../photon/src/chat/spoken.ts";
import type { ChatResponse } from "../../photon/src/chat/types.ts";
import type { D1Like } from "../../photon/src/data/d1.ts";
import type { Manifest, Passage, PolicyRecord } from "../../photon/src/data/schema.ts";
import { snapshotStatements } from "../../photon/src/data/seed.ts";
import worker from "../../photon/src/worker.ts";
import { handleTelegram, formatTelegramReply } from "../../photon/src/telegram.ts";
import { BUSY_REPLY, busyResponse, type RateLimiter } from "../../photon/src/limit.ts";
import { answerFunctionCall, think, VOICE_ANSWER_TYPE } from "../../photon/src/voice.ts";
import { openTestDb } from "../helpers/d1.ts";

const fixtureDir = fileURLToPath(new URL("../fixtures/snapshot/", import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(fixtureDir + name, "utf8"));
const policies: PolicyRecord[] = load("policies.json");
const passages: Passage[] = load("passages.json");
const manifest: Manifest = load("manifest.json");

async function seed(db: D1Like) {
  await db.batch(snapshotStatements(policies, passages, manifest).map((s) => db.prepare(s.sql).bind(...s.params)));
}

const GROQ = "https://api.groq.com/openai/v1/chat/completions";

/** Replaces fetch for the length of `run`. `handler` sees each request and answers it (or throws). */
async function withFetch<T>(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, run: () => Promise<T>): Promise<{ result: T; urls: string[] }> {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  try {
    return { result: await run(), urls };
  } finally {
    globalThis.fetch = real;
  }
}

/** A Groq that routes everything as a brief and composes an answer with bold, a bullet and two markers. */
const fakeGroq = (_url: string, init?: RequestInit): Response => {
  const body = JSON.parse(String(init?.body));
  const name = body.response_format.json_schema.name;
  const content =
    name === "route"
      ? { intent: "brief", detail: false, standalone: "What is going on?", search: "", recordHints: [], jurisdiction: null, topics: [], sinceDays: null }
      : { answer: "**California and Singapore both moved [1].**\n- The first change is **big** [1].\n- The second is smaller [2].\nWhat to watch: the next vote.", general: null, followUps: ["What next?"] };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] }), { status: 200 });
};

describe("surfaces", () => {
  let db: D1Like;
  let dispose: () => Promise<void>;
  before(async () => {
    ({ db, dispose } = await openTestDb());
    await seed(db);
  });
  after(() => dispose());
  beforeEach(() => {
    mock.method(console, "warn", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
  });

  const env = (over: Partial<Env> = {}) => ({ DB: db, ...over }) as unknown as Env;
  const post = (path: string, body: unknown, e: Env = env()) =>
    worker.fetch(new Request(`https://politik.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), e);
  const KEYS = ["asOf", "citations", "followUps", "mode", "reply"];

  describe("POST /api/ask", () => {
    test("answers with a ChatResponse", async () => {
      const res = await post("/api/ask", { message: "What is going on?" });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/);
      const body = (await res.json()) as ChatResponse;
      assert.deepEqual(Object.keys(body).sort(), KEYS, "no category or items");
      assert.equal(body.mode, "fallback", "no Groq key in this environment");
      assert.equal(body.reply, FALLBACK_REPLY);
      assert.equal(body.citations.length, 3);
      assert.equal(body.asOf, "2026-10-01");
    });

    test("a greeting is one fixed line", async () => {
      const body = (await (await post("/api/ask", { message: "hi" })).json()) as ChatResponse;
      assert.equal(body.mode, "greeting");
      assert.equal(body.reply, GREETING);
      assert.equal(body.followUps.length, 3);
    });

    test("Review Focus 5: a 5,000-character message and 30 history turns are cut and answered with HTTP 200", async () => {
      const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "t".repeat(2000), titles: ["x"] }));
      const res = await post("/api/ask", { message: "What is going on? ".repeat(300), history, knowledge: "junk", who: { name: "Ada" } });
      assert.equal(res.status, 200);
      const body = (await res.json()) as ChatResponse;
      assert.deepEqual(Object.keys(body).sort(), KEYS);
      assert.ok(body.reply.length > 0);
    });

    test("a missing, blank or non-string message is a 400 with no model call", async () => {
      for (const message of [undefined, "", "   ", 5, null]) {
        const { result, urls } = await withFetch(
          () => assert.fail("no network"),
          () => post("/api/ask", { message }),
        );
        assert.equal(result.status, 400, String(message));
        assert.deepEqual(await result.json(), { error: "Ask a question." });
        assert.deepEqual(urls, []);
      }
    });

    test("a body that is not JSON gets the failure response in the ChatResponse shape", async () => {
      const res = await post("/api/ask", "{not json");
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { reply: FAIL_REPLY, mode: "fallback", citations: [], followUps: [], asOf: "" });
    });

    test("an unmigrated D1 is the empty-data reply with status 200", async () => {
      const bare = await openTestDb({ migrate: false });
      try {
        const res = await post("/api/ask", { message: "What does SB 53 require?" }, env({ DB: bare.db }));
        assert.equal(res.status, 200);
        const body = (await res.json()) as ChatResponse;
        assert.equal(body.reply, EMPTY_REPLY);
        assert.equal(body.asOf, "");
      } finally {
        await bare.dispose();
      }
    });

    test("with a Groq key the whole path runs: route, retrieve, compose, cite", async () => {
      const { result, urls } = await withFetch(fakeGroq, () => post("/api/ask", { message: "What is going on?" }, env({ GROQ_API_KEY: "gsk-test" })));
      const body = (await result.json()) as ChatResponse;
      assert.deepEqual(urls, [GROQ, GROQ]);
      assert.equal(body.mode, "brief");
      assert.equal(body.citations.length, 2);
      assert.match(body.reply, /^\*\*California and Singapore both moved \[1\]\.\*\*/);
      assert.deepEqual(body.followUps, ["What next?"]);
    });
  });

  describe("ask and askShared", () => {
    test("ask takes the message, the saved posts and the history", async () => {
      const res = await ask("What is going on?", env(), [{ title: "T", plain: "P", url: "https://bsky.app/p/1" }], []);
      assert.equal(res.mode, "fallback");
    });

    test("identical questions asked at once share one answer", async () => {
      const a = askShared("What is going on?", env(), undefined, []);
      const b = askShared("What is going on?", env(), undefined, []);
      assert.equal(a, b);
      const other = askShared("hi", env());
      assert.notEqual(other, a);
      await Promise.all([a, b, other]);
      const again = askShared("What is going on?", env(), undefined, []);
      assert.notEqual(again, a, "a finished question is asked afresh");
      await again;
    });
  });

  describe("voice", () => {
    const thinkBody = (content: string, stream = false) => ({ stream, messages: [{ role: "user", content }] });
    const spokenOf = async (res: Response) => ((await res.json()) as any).choices[0].message.content as string;

    test("think speaks the reply with no markers or markdown", async () => {
      const { result, urls } = await withFetch(fakeGroq, () => think(new Request("https://politik.test/api/voice/think", { method: "POST", body: JSON.stringify(thinkBody("What is going on?")) }), env({ GROQ_API_KEY: "gsk-test" })));
      assert.equal(urls.length, 2);
      const spoken = await spokenOf(result);
      assert.equal(spoken, "California and Singapore both moved. The first change is big. The second is smaller. What to watch: the next vote.");
      assert.doesNotMatch(spoken, /[*\[\]]/);
    });

    test("think speaks toSpoken(reply), also when streaming", async () => {
      const { result } = await withFetch(fakeGroq, () => think(new Request("https://politik.test/api/voice/think", { method: "POST", body: JSON.stringify(thinkBody("What is going on?", true)) }), env({ GROQ_API_KEY: "gsk-test" })));
      assert.match(result.headers.get("content-type") ?? "", /text\/event-stream/);
      const text = await result.text();
      const chunk = JSON.parse(text.split("\n\n")[0]!.replace(/^data: /, ""));
      assert.equal(chunk.choices[0].delta.content, "California and Singapore both moved. The first change is big. The second is smaller. What to watch: the next vote.");
    });

    test("think passes the earlier turns as history", async () => {
      const seen: string[] = [];
      await withFetch(
        (url, init) => {
          seen.push(String(JSON.parse(String(init?.body)).messages[1].content));
          return fakeGroq(url, init);
        },
        () =>
          think(
            new Request("https://politik.test/api/voice/think", {
              method: "POST",
              body: JSON.stringify({ messages: [{ role: "user", content: "Tell me about SB 53" }, { role: "assistant", content: "It is a transparency law." }, { role: "user", content: "Who does it apply to?" }] }),
            }),
            env({ GROQ_API_KEY: "gsk-test" }),
          ),
      );
      assert.match(seen[0]!, /User: Tell me about SB 53\nAssistant: It is a transparency law\./);
      assert.match(seen[0]!, /Latest message:\nWho does it apply to\?/);
    });

    test("I3: with no Groq key the spoken reply names the records, not just 'here are the records'", async () => {
      const res = await think(new Request("https://politik.test/api/voice/think", { method: "POST", body: JSON.stringify(thinkBody("What is going on?")) }), env());
      const spoken = await spokenOf(res);
      const written = (await (await post("/api/ask", { message: "What is going on?" })).json()) as ChatResponse;
      assert.equal(written.mode, "fallback");
      assert.equal(written.citations.length, 3);
      const names = written.citations.map((c) => c.shortTitle ?? c.title);
      assert.equal(spoken, `I couldn't write a summary just now. The most relevant records are ${names[0]}, ${names[1]} and ${names[2]}.`);
      assert.equal(spoken, toSpokenResponse(written));
      assert.match(spoken, /^I couldn't write a summary just now\. The most relevant records are /);
    });

    test("no question is the greeting", async () => {
      const res = await think(new Request("https://politik.test/api/voice/think", { method: "POST", body: JSON.stringify({ messages: [] }) }), env());
      assert.equal(await spokenOf(res), GREETING);
      assert.equal(toSpoken(GREETING), GREETING, "the greeting is already speech");
    });

    test("a broken request is still a spoken reply", async () => {
      const res = await think(new Request("https://politik.test/api/voice/think", { method: "POST", body: "{nope" }), env());
      assert.equal(typeof (await spokenOf(res)), "string");
    });

    test("the agent's function call gets the spoken reply too", async () => {
      const sent: any[] = [];
      const remote = { send: (data: string) => sent.push(JSON.parse(data)) } as unknown as WebSocket;
      const raw = JSON.stringify({ type: "FunctionCallRequest", functions: [{ id: "f1", name: "politik", arguments: JSON.stringify({ question: "What is going on?" }), client_side: true }] });
      const { result } = await withFetch(fakeGroq, () => answerFunctionCall(raw, env({ GROQ_API_KEY: "gsk-test" }), remote, undefined));
      assert.equal(result, true);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].type, "FunctionCallResponse");
      assert.equal(sent[0].id, "f1");
      assert.equal(sent[0].content, "California and Singapore both moved. The first change is big. The second is smaller. What to watch: the next vote.");
    });
  });

  describe("Telegram", () => {
    const response = (over: Partial<ChatResponse> = {}): ChatResponse => ({
      reply: "**SB 53 is law [1].** It covers developers [2].",
      mode: "brief",
      citations: [
        { n: 1, kind: "policy", recordId: "ca-sb-53-2025", title: "Transparency in Frontier Artificial Intelligence Act", url: "https://example.org/sb53", quote: "q" },
        { n: 2, kind: "post", title: "Public post by alice", url: "https://bsky.app/profile/alice/post/1", quote: "q" },
      ],
      followUps: ["Next?"],
      asOf: "2026-10-01",
      ...over,
    });

    test("the reply keeps its markers and is followed by one numbered line per source", () => {
      assert.equal(
        formatTelegramReply(response()),
        [
          "SB 53 is law [1]. It covers developers [2].",
          "[1] Transparency in Frontier Artificial Intelligence Act — https://example.org/sb53\n[2] Public post by alice — https://bsky.app/profile/alice/post/1",
        ].join("\n\n"),
      );
    });

    test("a reply with no sources is just the reply", () => {
      assert.equal(formatTelegramReply(response({ citations: [] })), "SB 53 is law [1]. It covers developers [2].");
    });

    test("M8: ** and ### are taken out of the text, whatever the reply or the general-knowledge text", () => {
      const text = formatTelegramReply(
        response({ reply: "**Bold answer [1].**\n### What it does\nIt **sets** rules [1].\n#### Deeper\n- a bullet", citations: [], general: "### Background\nA **fact**." }),
      );
      assert.equal(text, "Bold answer [1].\nWhat it does\nIt sets rules [1].\nDeeper\n- a bullet\n\nNot from Politik's sources — unverified:\nBackground\nA fact.");
      assert.doesNotMatch(text, /\*\*|^#+ /m);
    });

    test("M8: a hash that is not a heading mark stays (C# and #1)", () => {
      assert.equal(formatTelegramReply(response({ reply: "It is ranked #1 in C#.", citations: [] })), "It is ranked #1 in C#.");
    });

    test("general knowledge is added with its label", () => {
      const text = formatTelegramReply(response({ citations: [], reply: "Politik has nothing on this.", general: "The EU AI Act is a regulation." }));
      assert.equal(text, "Politik has nothing on this.\n\nNot from Politik's sources — unverified:\nThe EU AI Act is a regulation.");
    });

    test("handleTelegram sends the answer and its source lines to the chat, with no history", async () => {
      const sent: { url: string; body: any }[] = [];
      const update = { message: { chat: { id: 77 }, text: "What is going on?" } };
      const { result } = await withFetch(
        (url, init) => {
          assert.match(url, /^https:\/\/api\.telegram\.org\/bottok\/sendMessage$/, "no other network call");
          sent.push({ url, body: JSON.parse(String(init?.body)) });
          return new Response("{}");
        },
        () => handleTelegram(new Request("https://politik.test/telegram", { method: "POST", body: JSON.stringify(update) }), env({ TELEGRAM_BOT_TOKEN: "tok" })),
      );
      assert.equal(await result.text(), "ok");
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.body.chat_id, 77);
      const text: string = sent[0]!.body.text;
      assert.ok(text.startsWith(FALLBACK_REPLY), text);
      assert.doesNotMatch(text, /\*\*/);
      const lines = text.split("\n").filter((l) => /^\[\d\] /.test(l));
      assert.equal(lines.length, 3);
      assert.match(lines[0]!, /^\[1\] .+ — https:\/\/\S+$/);
      assert.ok(text.length <= 4000);
    });

    test("a failure is one plain apology", async () => {
      const sent: any[] = [];
      const update = { message: { chat: { id: 5 }, text: "What is going on?" } };
      await withFetch(
        (_url, init) => {
          sent.push(JSON.parse(String(init?.body)));
          return new Response("{}");
        },
        () => handleTelegram(new Request("https://politik.test/telegram", { method: "POST", body: JSON.stringify(update) }), { DB: undefined, TELEGRAM_BOT_TOKEN: "tok" } as unknown as Env),
      );
      assert.equal(sent.length, 1);
      assert.equal(typeof sent[0].text, "string");
      assert.ok(sent[0].text.length > 0);
    });
  });

  // ---- I2: rate limiting and the Telegram secret ----------------------------------------------------------------------

  describe("I2: rate limiting", () => {
    /** A limiter that records the keys it was asked about and lets `allow` decide. */
    function limiter(allow: boolean | ((key: string) => boolean) = true): { keys: string[]; binding: RateLimiter } {
      const keys: string[] = [];
      return { keys, binding: { limit: async ({ key }) => (keys.push(key), { success: typeof allow === "function" ? allow(key) : allow }) } };
    }
    const asPost = (path: string, body: unknown, e: Env, ip = "203.0.113.7") =>
      worker.fetch(new Request(`https://politik.test${path}`, { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), e);
    const noModel = (): Response => assert.fail("no model call");

    test("the busy response is a fallback ChatResponse with the fixed line and nothing else", () => {
      assert.equal(BUSY_REPLY, "Politik is busy — please try again in a minute.");
      assert.deepEqual(busyResponse(), { reply: BUSY_REPLY, mode: "fallback", citations: [], followUps: [], asOf: "" });
    });

    test("/api/ask over the limit: HTTP 200 and the busy ChatResponse, with no pipeline and no database read", async () => {
      const { binding, keys } = limiter(false);
      const e = env({ ASK_LIMITER: binding, GROQ_API_KEY: "gsk-test" });
      (e as unknown as { DB: unknown }).DB = new Proxy({}, { get: () => assert.fail("no database read") });
      const { result, urls } = await withFetch(noModel, () => asPost("/api/ask", { message: "What is going on?" }, e));
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), busyResponse());
      assert.deepEqual(keys, ["203.0.113.7"], "keyed on CF-Connecting-IP");
      assert.deepEqual(urls, []);
    });

    test("/api/ask under the limit is answered as before, after one check on the caller's IP", async () => {
      const { binding, keys } = limiter(true);
      const res = await asPost("/api/ask", { message: "hi" }, env({ ASK_LIMITER: binding }), "198.51.100.4");
      assert.equal(((await res.json()) as ChatResponse).mode, "greeting");
      assert.deepEqual(keys, ["198.51.100.4"]);
    });

    test("the limit is per caller: one address over its allowance does not stop another", async () => {
      const { binding } = limiter((key) => key !== "203.0.113.7");
      const e = env({ ASK_LIMITER: binding });
      assert.equal(((await (await asPost("/api/ask", { message: "hi" }, e, "203.0.113.7")).json()) as ChatResponse).reply, BUSY_REPLY);
      assert.equal(((await (await asPost("/api/ask", { message: "hi" }, e, "203.0.113.8")).json()) as ChatResponse).mode, "greeting");
    });

    test("with no limiter binding (tests, local) nothing is checked", async () => {
      const res = await asPost("/api/ask", { message: "hi" }, env());
      assert.equal(((await res.json()) as ChatResponse).mode, "greeting");
    });

    test("with no CF-Connecting-IP there is nothing to key on, so nothing is checked", async () => {
      const { binding, keys } = limiter(false);
      const res = await post("/api/ask", { message: "hi" }, env({ ASK_LIMITER: binding }));
      assert.equal(((await res.json()) as ChatResponse).mode, "greeting");
      assert.deepEqual(keys, []);
    });

    test("a request to localhost (wrangler dev, which simulates the binding) is never limited, so a local eval can run", async () => {
      const { binding, keys } = limiter(false);
      for (const host of ["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"]) {
        const res = await worker.fetch(
          new Request(`${host}/api/ask`, { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "127.0.0.1" }, body: JSON.stringify({ message: "hi" }) }),
          env({ ASK_LIMITER: binding }),
        );
        assert.equal(((await res.json()) as ChatResponse).mode, "greeting", host);
      }
      assert.deepEqual(keys, []);
    });

    test("a limiter that fails does not stop questions", async () => {
      const broken: RateLimiter = {
        limit: async () => {
          throw new Error("limiter down");
        },
      };
      const res = await asPost("/api/ask", { message: "hi" }, env({ ASK_LIMITER: broken }));
      assert.equal(((await res.json()) as ChatResponse).mode, "greeting");
    });

    test("/api/voice/think over the limit speaks the busy line, streaming or not, without asking the pipeline", async () => {
      for (const stream of [false, true]) {
        const { binding } = limiter(false);
        const request = new Request("https://politik.test/api/voice/think", { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.7" }, body: JSON.stringify({ stream, messages: [{ role: "user", content: "What is going on?" }] }) });
        const { result, urls } = await withFetch(noModel, () => worker.fetch(request, env({ ASK_LIMITER: binding, GROQ_API_KEY: "gsk-test" })));
        assert.deepEqual(urls, []);
        if (stream) assert.equal(JSON.parse((await result.text()).split("\n\n")[0]!.replace(/^data: /, "")).choices[0].delta.content, BUSY_REPLY);
        else assert.equal(((await result.json()) as any).choices[0].message.content, BUSY_REPLY);
      }
    });

    test("the voice agent's function call over the limit answers with the busy line, shows the page the busy response, and runs nothing", async () => {
      const sent: any[] = [];
      const page: any[] = [];
      const remote = { send: (data: string) => sent.push(JSON.parse(data)) } as unknown as WebSocket;
      const client = { send: (data: string) => page.push(JSON.parse(data)) };
      const raw = JSON.stringify({ type: "FunctionCallRequest", functions: [{ id: "f1", name: "politik", arguments: JSON.stringify({ question: "What is going on?" }), client_side: true }] });
      const { binding, keys } = limiter(false);
      const { urls } = await withFetch(noModel, () => answerFunctionCall(raw, env({ ASK_LIMITER: binding, GROQ_API_KEY: "gsk-test" }), remote, undefined, { client, ip: "203.0.113.7" }));
      assert.deepEqual(urls, []);
      assert.deepEqual(keys, ["203.0.113.7"]);
      assert.equal(sent[0].content, BUSY_REPLY);
      assert.deepEqual(page, [{ type: VOICE_ANSWER_TYPE, question: "What is going on?", response: busyResponse() }]);
    });

    test("Telegram over the limit sends the busy line to the chat and runs nothing", async () => {
      const { binding, keys } = limiter(false);
      const sent: any[] = [];
      const update = { message: { chat: { id: 9 }, text: "What is going on?" } };
      const { result, urls } = await withFetch(
        (url, init) => {
          assert.match(url, /^https:\/\/api\.telegram\.org\/bottok\/sendMessage$/);
          sent.push(JSON.parse(String(init?.body)));
          return new Response("{}");
        },
        () =>
          worker.fetch(
            new Request("https://politik.test/telegram", { method: "POST", headers: { "CF-Connecting-IP": "91.108.4.1" }, body: JSON.stringify(update) }),
            env({ TELEGRAM_BOT_TOKEN: "tok", ASK_LIMITER: binding, GROQ_API_KEY: "gsk-test" }),
          ),
      );
      assert.equal(await result.text(), "ok");
      assert.deepEqual(sent, [{ chat_id: 9, text: BUSY_REPLY }]);
      assert.deepEqual(keys, ["91.108.4.1"]);
      assert.equal(urls.length, 1, "only the Telegram send");
    });
  });

  describe("I2: the Telegram webhook secret", () => {
    const update = { message: { chat: { id: 5 }, text: "hi" } };
    const send = (headers: Record<string, string | undefined>, e: Env) =>
      withFetch(
        () => new Response("{}"),
        () => worker.fetch(new Request("https://politik.test/telegram", { method: "POST", headers: headers as Record<string, string>, body: JSON.stringify(update) }), e),
      );

    test("a wrong or missing secret is a 401 and nothing is sent or run", async () => {
      for (const headers of [{ "X-Telegram-Bot-Api-Secret-Token": "wrong" }, {}, { "X-Telegram-Bot-Api-Secret-Token": "s3cre" }, { "X-Telegram-Bot-Api-Secret-Token": "s3cret-and-more" }, { "X-Telegram-Bot-Api-Secret-Token": "" }]) {
        const { result, urls } = await send(headers, env({ TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_WEBHOOK_SECRET: "s3cret" }));
        assert.equal(result.status, 401, JSON.stringify(headers));
        assert.deepEqual(urls, []);
      }
    });

    test("the right secret is answered as usual", async () => {
      const { result, urls } = await send({ "X-Telegram-Bot-Api-Secret-Token": "s3cret" }, env({ TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_WEBHOOK_SECRET: "s3cret" }));
      assert.equal(result.status, 200);
      assert.equal(urls.length, 1, "the greeting was sent");
    });

    test("with no secret configured (or a blank one) the header is not required, as before", async () => {
      for (const TELEGRAM_WEBHOOK_SECRET of [undefined, "", "  "]) {
        const { result, urls } = await send({}, env({ TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_WEBHOOK_SECRET }));
        assert.equal(result.status, 200);
        assert.equal(urls.length, 1);
      }
    });

    test("a secret mismatch is refused even when no bot token is set", async () => {
      const { result } = await send({}, env({ TELEGRAM_WEBHOOK_SECRET: "s3cret" }));
      assert.equal(result.status, 401);
    });
  });

  // ---- I3: one run of the pipeline for one spoken question ------------------------------------------------------------

  describe("I3: one pipeline per spoken question", () => {
    const callFor = (question: string, id = "f1") => JSON.stringify({ type: "FunctionCallRequest", functions: [{ id, name: "politik", arguments: JSON.stringify({ question }), client_side: true }] });
    const session = () => {
      const sent: any[] = [];
      const page: any[] = [];
      return {
        sent,
        page,
        remote: { send: (data: string) => sent.push(JSON.parse(data)) } as unknown as WebSocket,
        client: { send: (data: string) => page.push(JSON.parse(data)) },
      };
    };

    test("a spoken question is one route call and one compose call, and the page is sent that answer rather than asking again", async () => {
      const { sent, page, remote, client } = session();
      const { result, urls } = await withFetch(fakeGroq, () => answerFunctionCall(callFor("What is going on?"), env({ GROQ_API_KEY: "gsk-test" }), remote, undefined, { client, history: [] }));
      assert.equal(result, true);
      assert.deepEqual(urls, [GROQ, GROQ], "route + compose: one chat()");
      assert.equal(sent.length, 1);
      assert.equal(page.length, 1);
      assert.equal(page[0].type, VOICE_ANSWER_TYPE);
      assert.equal(page[0].question, "What is going on?");
      const response = page[0].response as ChatResponse;
      assert.equal(response.mode, "brief");
      assert.equal(response.citations.length, 2);
      assert.match(response.reply, /^\*\*California and Singapore both moved \[1\]\.\*\*/);
      assert.equal(sent[0].content, toSpokenResponse(response), "what is spoken is what the page shows");
    });

    test("the page's frame is sent before the agent's answer, so the cards appear while it speaks", async () => {
      const order: string[] = [];
      const remote = { send: () => order.push("agent") } as unknown as WebSocket;
      const client = { send: () => order.push("page") };
      await withFetch(fakeGroq, () => answerFunctionCall(callFor("What is going on?"), env({ GROQ_API_KEY: "gsk-test" }), remote, undefined, { client }));
      assert.deepEqual(order, ["page", "agent"]);
    });

    test("a fallback answer is spoken with its record titles and shown to the page with its records", async () => {
      const { sent, page, remote, client } = session();
      await answerFunctionCall(callFor("What is going on?"), env(), remote, undefined, { client });
      const response = page[0].response as ChatResponse;
      assert.equal(response.mode, "fallback");
      const names = response.citations.map((c) => c.shortTitle ?? c.title);
      assert.equal(names.length, 3);
      assert.equal(sent[0].content, `I couldn't write a summary just now. The most relevant records are ${names[0]}, ${names[1]} and ${names[2]}.`);
    });

    test("a page that has gone away does not stop the agent getting its answer", async () => {
      const { sent, remote } = session();
      const client = {
        send: () => {
          throw new Error("closed");
        },
      };
      await answerFunctionCall(callFor("hi"), env(), remote, undefined, { client });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].content, GREETING);
    });

    test("with no page to tell (the old call) it still answers the agent", async () => {
      const { sent, remote } = session();
      await answerFunctionCall(callFor("hi"), env(), remote, undefined);
      assert.equal(sent[0].content, GREETING);
    });

    test("the questions of a voice session are the history of the next one, so a follow-up keeps its thread", async () => {
      const { remote, client } = session();
      const history: { role: "user" | "assistant"; text: string }[] = [];
      const seen: string[] = [];
      const recordingGroq = (url: string, init?: RequestInit): Response => {
        const body = JSON.parse(String(init?.body));
        if (body.response_format.json_schema.name === "route") seen.push(String(body.messages[1].content));
        return fakeGroq(url, init);
      };
      const e = env({ GROQ_API_KEY: "gsk-test" });
      await withFetch(recordingGroq, async () => {
        await answerFunctionCall(callFor("Tell me about SB 53", "f1"), e, remote, undefined, { client, history });
        await answerFunctionCall(callFor("Who does it apply to?", "f2"), e, remote, undefined, { client, history });
      });
      assert.equal(seen.length, 2);
      assert.match(seen[0]!, /\(no earlier conversation\)/);
      assert.match(seen[1]!, /User: Tell me about SB 53\nAssistant: /);
      assert.match(seen[1]!, /Latest message:\nWho does it apply to\?/);
      assert.equal(history.length, 4);
      assert.ok(history.length <= 8);
    });

    test("the history kept for a session is bounded", async () => {
      const { remote } = session();
      const history = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), text: `t${i}` }));
      await answerFunctionCall(callFor("hi"), env(), remote, undefined, { history });
      assert.equal(history.length, 8);
      assert.equal(history[history.length - 2]!.text, "hi");
    });

    test("/api/voice/think runs the pipeline once for a spoken question too", async () => {
      const { urls } = await withFetch(fakeGroq, () =>
        think(new Request("https://politik.test/api/voice/think", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "What is going on?" }] }) }), env({ GROQ_API_KEY: "gsk-test" })),
      );
      assert.deepEqual(urls, [GROQ, GROQ]);
    });
  });
});
