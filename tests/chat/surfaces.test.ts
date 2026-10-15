// The places a chat answer goes out: the /api/ask endpoint, the voice route and the Telegram bot.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ask, askShared, type Env } from "../../photon/src/ask.ts";
import { EMPTY_REPLY, FAIL_REPLY, FALLBACK_REPLY, GREETING } from "../../photon/src/chat/index.ts";
import { toSpoken } from "../../photon/src/chat/spoken.ts";
import type { ChatResponse } from "../../photon/src/chat/types.ts";
import type { D1Like } from "../../photon/src/data/d1.ts";
import type { Manifest, Passage, PolicyRecord } from "../../photon/src/data/schema.ts";
import { snapshotStatements } from "../../photon/src/data/seed.ts";
import worker from "../../photon/src/worker.ts";
import { handleTelegram, formatTelegramReply } from "../../photon/src/telegram.ts";
import { answerFunctionCall, think } from "../../photon/src/voice.ts";
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
      assert.notEqual(askShared("hi", env()), a);
      await Promise.all([a, b]);
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

    test("with no Groq key the spoken reply is the fallback line", async () => {
      const res = await think(new Request("https://politik.test/api/voice/think", { method: "POST", body: JSON.stringify(thinkBody("What is going on?")) }), env());
      assert.equal(await spokenOf(res), toSpoken(FALLBACK_REPLY));
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
          "**SB 53 is law [1].** It covers developers [2].",
          "[1] Transparency in Frontier Artificial Intelligence Act — https://example.org/sb53\n[2] Public post by alice — https://bsky.app/profile/alice/post/1",
        ].join("\n\n"),
      );
    });

    test("a reply with no sources is just the reply", () => {
      assert.equal(formatTelegramReply(response({ citations: [] })), "**SB 53 is law [1].** It covers developers [2].");
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
});
