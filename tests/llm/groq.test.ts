import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { z } from "zod/v4";

import { DEFAULT_CHAT_MODELS, DEFAULT_MODELS, groqLlm, LlmError, resolveChatModels, resolveModels } from "../../photon/src/llm/groq.ts";

const URL_CHAT = "https://api.groq.com/openai/v1/chat/completions";

const Answer = z.object({ answer: z.string(), score: z.number() });
const goodReply = { answer: "yes", score: 3 };

/** A chat-completions success body whose message content is `content`. */
const completion = (content: string, finishReason = "stop") =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: finishReason }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const ok = (value: unknown) => completion(JSON.stringify(value));
const error = (status: number, message: string, headers: Record<string, string> = {}, extra: object = {}) =>
  new Response(JSON.stringify({ error: { message, type: "invalid_request_error", ...extra } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

type Call = { url: string; init: RequestInit; body: any };
/** A fake fetch that answers with the given responses in order (a function is called with the call index). */
function fakeFetch(...script: Array<Response | Error | ((i: number) => Response)>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const i = calls.length;
    calls.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body ?? "null")) });
    const next = script[Math.min(i, script.length - 1)]!;
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(i) : next.clone();
  }) as typeof fetch;
  return { impl, calls };
}

function client(fake: ReturnType<typeof fakeFetch>, opts: { model?: string; maxRetries?: number; reasoningEffort?: "low" | "medium" | "high" } = {}) {
  const sleeps: number[] = [];
  const llm = groqLlm({
    apiKey: "gsk_test_key",
    model: opts.model ?? "openai/gpt-oss-120b",
    fetchImpl: fake.impl,
    maxRetries: opts.maxRetries,
    reasoningEffort: opts.reasoningEffort,
    sleep: async (ms) => void sleeps.push(ms),
  });
  const ask = () => llm({ system: "Be brief.", user: "Question?", schema: Answer, name: "answer" });
  return { llm, ask, sleeps };
}

test("a plain success parses and returns the validated value, and posts to the Groq chat endpoint", async () => {
  const fake = fakeFetch(ok(goodReply));
  const { ask } = client(fake);
  assert.deepEqual(await ask(), goodReply);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]!.url, URL_CHAT);
  assert.equal(fake.calls[0]!.init.method, "POST");
  const headers = new Headers(fake.calls[0]!.init.headers);
  assert.equal(headers.get("authorization"), "Bearer gsk_test_key");
  assert.equal(headers.get("content-type"), "application/json");
});

test("the request body has temperature 0, the model, the messages and a json_schema response_format", async () => {
  const fake = fakeFetch(ok(goodReply));
  await client(fake, { model: "llama-3.3-70b-versatile" }).ask();
  const body = fake.calls[0]!.body;
  assert.equal(body.temperature, 0);
  assert.equal(body.model, "llama-3.3-70b-versatile");
  assert.deepEqual(body.messages, [
    { role: "system", content: "Be brief." },
    { role: "user", content: "Question?" },
  ]);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.name, "answer");
  assert.equal(body.response_format.json_schema.strict, undefined, "a model without documented strict support gets best-effort mode");
  const sent = body.response_format.json_schema.schema;
  assert.equal(sent.type, "object");
  assert.deepEqual(Object.keys(sent.properties).sort(), ["answer", "score"]);
  assert.equal(sent.$schema, undefined, "the $schema keyword is not sent");
});

test("I1: reasoningEffort is sent as reasoning_effort on every request, and left out when it is not set", async () => {
  for (const effort of ["low", "medium", "high"] as const) {
    const fake = fakeFetch(ok(goodReply));
    await client(fake, { reasoningEffort: effort }).ask();
    assert.equal(fake.calls[0]!.body.reasoning_effort, effort);
  }
  const unset = fakeFetch(ok(goodReply));
  await client(unset).ask();
  assert.equal("reasoning_effort" in unset.calls[0]!.body, false, "no field when unset, so a model without it is not sent one");
});

test("I1: reasoning_effort also rides on the json_object fallback and the repair call", async () => {
  const fake = fakeFetch(error(400, "response_format json_schema is not supported by this model"), ok({ answer: 1 }), ok(goodReply));
  assert.deepEqual(await client(fake, { model: "llama-3.3-70b-versatile", reasoningEffort: "low" }).ask(), goodReply);
  assert.equal(fake.calls.length, 3, "json_schema refused, json_object bad, then the repair");
  assert.deepEqual(
    fake.calls.map((c) => c.body.reasoning_effort),
    ["low", "low", "low"],
  );
});

test("two 429s then 200 resolves after 3 fetches, backing off 2s then 4s", async () => {
  const fake = fakeFetch(error(429, "slow down"), error(429, "slow down"), ok(goodReply));
  const { ask, sleeps } = client(fake);
  assert.deepEqual(await ask(), goodReply);
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(sleeps, [2000, 4000]);
});

test("a retry-after header sets the wait", async () => {
  const fake = fakeFetch(error(429, "slow down", { "retry-after": "7" }), ok(goodReply));
  const { ask, sleeps } = client(fake);
  await ask();
  assert.deepEqual(sleeps, [7000]);
});

test("a retry-after longer than the cap fails at once instead of sleeping", async () => {
  const fake = fakeFetch(error(429, "daily limit", { "retry-after": "3600" }), ok(goodReply));
  const { ask, sleeps } = client(fake);
  await assert.rejects(ask(), /429/);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test("5xx responses and network errors are retried too", async () => {
  const fake = fakeFetch(error(503, "overloaded"), new TypeError("fetch failed"), error(500, "oops"), ok(goodReply));
  const { ask, sleeps } = client(fake);
  assert.deepEqual(await ask(), goodReply);
  assert.equal(fake.calls.length, 4);
  assert.deepEqual(sleeps, [2000, 4000, 8000]);
});

test("it gives up after maxRetries retries and reports the status", async () => {
  const fake = fakeFetch(error(503, "overloaded"));
  const { ask } = client(fake, { maxRetries: 2 });
  await assert.rejects(ask(), /503/);
  assert.equal(fake.calls.length, 3);
});

test("maxRetries defaults to 4, so 5 fetches in all", async () => {
  const fake = fakeFetch(error(429, "slow down"));
  await assert.rejects(client(fake).ask(), /429/);
  assert.equal(fake.calls.length, 5);
});

test("a 401 is not retried, and the error never contains the api key", async () => {
  const fake = fakeFetch(error(401, "Invalid API Key"));
  const { ask, sleeps } = client(fake);
  await assert.rejects(ask(), (e: Error) => {
    assert.match(e.message, /401/);
    assert.match(e.message, /Invalid API Key/);
    assert.doesNotMatch(e.message, /gsk_test_key/);
    return true;
  });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test("invalid JSON content twice throws after exactly 2 calls (the original and one repair)", async () => {
  const fake = fakeFetch(completion("this is not json"), completion("{ still not json"));
  await assert.rejects(client(fake).ask(), /answer/);
  assert.equal(fake.calls.length, 2);
});

test("the repair call quotes the bad reply and the problem, and its answer is returned", async () => {
  const fake = fakeFetch(completion("not json at all"), ok(goodReply));
  assert.deepEqual(await client(fake).ask(), goodReply);
  assert.equal(fake.calls.length, 2);
  const messages = fake.calls[1]!.body.messages;
  assert.deepEqual(messages.slice(0, 2), fake.calls[0]!.body.messages);
  assert.deepEqual(messages[2], { role: "assistant", content: "not json at all" });
  assert.equal(messages[3].role, "user");
  assert.match(messages[3].content, /not valid JSON/i);
});

test("a zod validation failure gets one repair call that lists the validation errors, then throws", async () => {
  const fake = fakeFetch(ok({ answer: 7 }), ok({ answer: "x", score: "high" }));
  await assert.rejects(client(fake).ask(), (e: Error) => {
    assert.match(e.message, /score/);
    return true;
  });
  assert.equal(fake.calls.length, 2);
  const repair = fake.calls[1]!.body.messages.at(-1);
  assert.equal(repair.role, "user");
  assert.match(repair.content, /answer/);
  assert.match(repair.content, /score/);
});

test("a reply wrapped in a markdown code fence still parses", async () => {
  const fake = fakeFetch(completion("```json\n" + JSON.stringify(goodReply) + "\n```"));
  assert.deepEqual(await client(fake).ask(), goodReply);
  assert.equal(fake.calls.length, 1);
});

test("a truncated reply (finish_reason length) is repaired with a note that it was cut off", async () => {
  const fake = fakeFetch(completion('{"answer": "yes", "sco', "length"), ok(goodReply));
  assert.deepEqual(await client(fake).ask(), goodReply);
  assert.match(fake.calls[1]!.body.messages.at(-1).content, /cut off|truncated|length/i);
});

test("an empty message is treated as invalid output and repaired", async () => {
  const fake = fakeFetch(completion(""), ok(goodReply));
  assert.deepEqual(await client(fake).ask(), goodReply);
  assert.equal(fake.calls.length, 2);
});

test("a 400 mentioning json_schema retries with json_object and the JSON schema in the system prompt", async () => {
  const fake = fakeFetch(
    error(400, "`response_format` of type `json_schema` is not supported with this model"),
    ok(goodReply),
  );
  assert.deepEqual(await client(fake, { model: "llama-3.3-70b-versatile" }).ask(), goodReply);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0]!.body.response_format.type, "json_schema");
  const retry = fake.calls[1]!.body;
  assert.deepEqual(retry.response_format, { type: "json_object" });
  assert.equal(retry.temperature, 0);
  assert.equal(retry.messages[0].role, "system");
  assert.ok(retry.messages[0].content.startsWith("Be brief."));
  assert.match(retry.messages[0].content, /JSON/);
  assert.match(retry.messages[0].content, /"answer"/);
  assert.match(retry.messages[0].content, /"score"/);
  assert.deepEqual(retry.messages[1], { role: "user", content: "Question?" });
});

test("a model that rejected json_schema once goes straight to json_object for that schema afterwards", async () => {
  const fake = fakeFetch(error(400, "json_schema is not supported"), ok(goodReply), ok(goodReply));
  const { ask } = client(fake, { model: "llama-3.3-70b-versatile" });
  await ask();
  await ask();
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(fake.calls[2]!.body.response_format, { type: "json_object" });
});

test("a 400 that is not about the response format is not retried", async () => {
  const fake = fakeFetch(error(400, "messages must not be empty"));
  await assert.rejects(client(fake).ask(), /400/);
  assert.equal(fake.calls.length, 1);
});

test("a best-effort generation failure (400) goes to the repair call, not to json_object", async () => {
  const fake = fakeFetch(
    error(400, "Generated JSON does not match the expected schema. Please adjust your prompt.", {}, { code: "json_validate_failed", failed_generation: '{"answer": 1}' }),
    ok(goodReply),
  );
  assert.deepEqual(await client(fake, { model: "qwen/qwen3.8-27b" }).ask(), goodReply);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1]!.body.response_format.type, "json_schema");
  const messages = fake.calls[1]!.body.messages;
  assert.deepEqual(messages.at(-2), { role: "assistant", content: '{"answer": 1}' });
  assert.match(messages.at(-1).content, /does not match/i);
});

test("strict mode is requested on a documented strict model when the schema is closed and fully required", async () => {
  const fake = fakeFetch(ok(goodReply));
  await client(fake, { model: "openai/gpt-oss-20b" }).ask();
  assert.equal(fake.calls[0]!.body.response_format.json_schema.strict, true);
});

test("strict mode is not requested when the schema has an optional field", async () => {
  const fake = fakeFetch(ok({ a: "x" }));
  const llm = groqLlm({ apiKey: "k", model: "openai/gpt-oss-120b", fetchImpl: fake.impl });
  await llm({ system: "s", user: "u", schema: z.object({ a: z.string(), b: z.string().optional() }), name: "opt" });
  assert.equal(fake.calls[0]!.body.response_format.json_schema.strict, undefined);
});

test("strict mode is not requested when the schema uses a keyword Groq's strict mode may refuse", async () => {
  const fake = fakeFetch(ok({ a: "2025-01-01" }));
  const llm = groqLlm({ apiKey: "k", model: "openai/gpt-oss-120b", fetchImpl: fake.impl });
  await llm({ system: "s", user: "u", schema: z.object({ a: z.string().min(1) }), name: "min" });
  assert.equal(fake.calls[0]!.body.response_format.json_schema.strict, undefined);
});

test("if strict is rejected the call falls back to best-effort json_schema, then to json_object", async () => {
  const fake = fakeFetch(
    error(400, "strict is not supported for this schema in json_schema mode"),
    error(400, "`response_format` of type `json_schema` is not supported"),
    ok(goodReply),
  );
  await client(fake, { model: "openai/gpt-oss-120b" }).ask();
  assert.equal(fake.calls.length, 3);
  assert.equal(fake.calls[0]!.body.response_format.json_schema.strict, true);
  assert.equal(fake.calls[1]!.body.response_format.type, "json_schema");
  assert.equal(fake.calls[1]!.body.response_format.json_schema.strict, undefined);
  assert.equal(fake.calls[2]!.body.response_format.type, "json_object");
});

test("the json_schema name is sanitised to what the API accepts", async () => {
  const fake = fakeFetch(ok(goodReply));
  const llm = groqLlm({ apiKey: "k", model: "m", fetchImpl: fake.impl });
  await llm({ system: "s", user: "u", schema: Answer, name: "my schema: v1!" });
  assert.match(fake.calls[0]!.body.response_format.json_schema.name, /^[A-Za-z0-9_-]{1,64}$/);
});

test("DEFAULT_MODELS names a model for each step, and both support json_schema", () => {
  assert.equal(typeof DEFAULT_MODELS.enrich, "string");
  assert.equal(typeof DEFAULT_MODELS.verify, "string");
  assert.ok(DEFAULT_MODELS.enrich.length > 0 && DEFAULT_MODELS.verify.length > 0);
});

test("resolveModels lets GROQ_ENRICH_MODEL and GROQ_VERIFY_MODEL override the defaults, ignoring blanks", () => {
  assert.deepEqual(resolveModels({}), { enrich: DEFAULT_MODELS.enrich, verify: DEFAULT_MODELS.verify });
  assert.deepEqual(resolveModels({ GROQ_ENRICH_MODEL: "a/b", GROQ_VERIFY_MODEL: "c/d" }), { enrich: "a/b", verify: "c/d" });
  assert.deepEqual(resolveModels({ GROQ_ENRICH_MODEL: "  ", GROQ_VERIFY_MODEL: "" }), {
    enrich: DEFAULT_MODELS.enrich,
    verify: DEFAULT_MODELS.verify,
  });
});

test("DEFAULT_CHAT_MODELS is the strong model for compose and the fast one for routing, both with strict json_schema (B-R2)", () => {
  assert.deepEqual(DEFAULT_CHAT_MODELS, { compose: "openai/gpt-oss-120b", router: "openai/gpt-oss-20b" });
});

test("resolveChatModels lets GROQ_CHAT_MODEL and GROQ_ROUTER_MODEL override the defaults, ignoring blanks (B-R2)", () => {
  assert.deepEqual(resolveChatModels({}), { compose: DEFAULT_CHAT_MODELS.compose, router: DEFAULT_CHAT_MODELS.router });
  assert.deepEqual(resolveChatModels({ GROQ_CHAT_MODEL: " a/b ", GROQ_ROUTER_MODEL: "c/d" }), { compose: "a/b", router: "c/d" });
  assert.deepEqual(resolveChatModels({ GROQ_CHAT_MODEL: "  ", GROQ_ROUTER_MODEL: "" }), {
    compose: DEFAULT_CHAT_MODELS.compose,
    router: DEFAULT_CHAT_MODELS.router,
  });
});

test("the client is Worker-safe: no node: imports, process, dotenv or env reads", () => {
  const source = readFileSync(new URL("../../photon/src/llm/groq.ts", import.meta.url), "utf8");
  // Strip comments so the prose can mention what is avoided.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /["']node:/);
  assert.doesNotMatch(code, /\bprocess\b/);
  assert.doesNotMatch(code, /dotenv/);
  assert.doesNotMatch(code, /\brequire\(/);
});

// --- request timeout (R13a) ---

/**
 * AbortSignal.timeout timers are unref'd, and a real stalled socket keeps the event loop alive. A fake has no socket,
 * so this holds a ref'd timer until the signal fires.
 */
function holdLoopUntilAborted(signal: AbortSignal) {
  const keepAlive = setInterval(() => undefined, 1000);
  signal.addEventListener("abort", () => clearInterval(keepAlive), { once: true });
}

/** A fetch that never answers until its AbortSignal fires, like a stalled connection. */
const hangs = (calls: Array<{ signal?: AbortSignal | null }>) =>
  (async (_input: string | URL | Request, init?: RequestInit) => {
    calls.push({ signal: init?.signal });
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // would hang for ever: the test fails by timing out
      holdLoopUntilAborted(signal);
      const abort = () => reject(signal.reason ?? new Error("aborted"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }) as typeof fetch;

test("every request carries an abort signal that times out after 60 seconds, or after timeoutMs when given", async () => {
  const original = AbortSignal.timeout;
  const asked: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    asked.push(ms);
    return original.call(AbortSignal, ms);
  };
  try {
    const fake = fakeFetch(ok(goodReply));
    await client(fake).ask();
    assert.ok(fake.calls[0]!.init.signal instanceof AbortSignal, "an AbortSignal is passed to fetch");
    assert.deepEqual(asked, [60_000]);

    asked.length = 0;
    const custom = fakeFetch(ok(goodReply));
    await groqLlm({ apiKey: "k", model: "m", fetchImpl: custom.impl, timeoutMs: 1234 })({ system: "s", user: "u", schema: Answer, name: "answer" });
    assert.deepEqual(asked, [1234]);
  } finally {
    AbortSignal.timeout = original;
  }
});

test("a request that stalls past timeoutMs is aborted and retried like a network error", async () => {
  const stalled: Array<{ signal?: AbortSignal | null }> = [];
  const answers = [ok(goodReply)];
  const sleeps: number[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (stalled.length === 0) return hangs(stalled)(input, init); // the first attempt stalls
    stalled.push({ signal: init?.signal });
    return answers[0]!.clone();
  }) as typeof fetch;
  const llm = groqLlm({ apiKey: "k", model: "m", fetchImpl, timeoutMs: 25, maxRetries: 2, sleep: async (ms) => void sleeps.push(ms) });
  assert.deepEqual(await llm({ system: "s", user: "u", schema: Answer, name: "answer" }), goodReply);
  assert.equal(stalled.length, 2, "one stalled attempt and one retry");
  assert.equal(stalled[0]!.signal?.aborted, true);
  assert.deepEqual(sleeps, [2000], "the timeout backs off like any other network error");
});

test("when every attempt times out it gives up after maxRetries with a timeout message", async () => {
  const calls: Array<{ signal?: AbortSignal | null }> = [];
  const sleeps: number[] = [];
  const llm = groqLlm({
    apiKey: "gsk_test_key",
    model: "m",
    fetchImpl: hangs(calls),
    timeoutMs: 10,
    maxRetries: 2,
    sleep: async (ms) => void sleeps.push(ms),
  });
  await assert.rejects(llm({ system: "s", user: "u", schema: Answer, name: "answer" }), (e: Error) => {
    assert.match(e.message, /timed out|timeout/i);
    assert.match(e.message, /10\s?ms/);
    assert.doesNotMatch(e.message, /gsk_test_key/);
    assert.equal((e as LlmError).kind, "timeout");
    return true;
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [2000, 4000]);
});

test("a body that stalls after the headers arrive also counts as a timeout, not as an empty reply", async () => {
  let attempt = 0;
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    attempt++;
    if (attempt > 1) return ok(goodReply);
    const signal = init!.signal!;
    holdLoopUntilAborted(signal);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const sleeps: number[] = [];
  const llm = groqLlm({ apiKey: "k", model: "m", fetchImpl, timeoutMs: 25, sleep: async (ms) => void sleeps.push(ms) });
  assert.deepEqual(await llm({ system: "s", user: "u", schema: Answer, name: "answer" }), goodReply);
  assert.equal(attempt, 2);
  assert.deepEqual(sleeps, [2000], "retried after a backoff as a network error, not repaired as an empty reply");
});

// --- LlmError.kind (R17): how a call failed, without parsing the message ---

test("an LlmError says how the call failed: http (with its status), network, or invalid-output", async () => {
  await assert.rejects(client(fakeFetch(error(401, "Invalid API Key"))).ask(), (e: LlmError) => e.kind === "http" && e.status === 401);
  await assert.rejects(client(fakeFetch(error(503, "overloaded")), { maxRetries: 1 }).ask(), (e: LlmError) => e.kind === "http" && e.status === 503);
  await assert.rejects(
    client(fakeFetch(new TypeError("fetch failed")), { maxRetries: 0 }).ask(),
    (e: LlmError) => e.kind === "network" && e.status === undefined,
  );
  await assert.rejects(
    client(fakeFetch(completion("nope"), completion("still nope"))).ask(),
    (e: LlmError) => e.kind === "invalid-output" && e.status === undefined,
  );
});
