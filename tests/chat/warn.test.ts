import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import { describeFailure, warnFailure } from "../../photon/src/chat/warn.ts";
import { LlmError } from "../../photon/src/llm/groq.ts";

describe("describeFailure", () => {
  test("an LlmError gives its status, kind and code", () => {
    const error = new LlmError("Groq API error 429: Rate limit reached", 429);
    error.kind = "http";
    error.code = "rate_limit_exceeded";
    assert.equal(describeFailure(error), "status=429 kind=http code=rate_limit_exceeded: LlmError: Groq API error 429: Rate limit reached");
  });

  test("a timeout has a kind and no status", () => {
    const error = new LlmError("Groq request failed: timed out after 8000ms");
    error.kind = "timeout";
    assert.match(describeFailure(error), /^status=none kind=timeout: /);
  });

  test("a plain error and a thing that is not an error are described without throwing", () => {
    assert.equal(describeFailure(new Error("The ranker did not answer within 2500 ms")), "status=none kind=none: The ranker did not answer within 2500 ms");
    assert.equal(describeFailure(Object.assign(new Error("boom"), { status: 503 })), "status=503 kind=none: boom");
    assert.equal(describeFailure(undefined), "status=none kind=none");
    assert.equal(describeFailure(null), "status=none kind=none");
    assert.equal(describeFailure("text"), "status=none kind=none: text");
  });

  test("anything shaped like a key or a bearer token is masked, and the line is one short line", () => {
    const error = new Error("401 for gsk_abcdefgh12345678 and Bearer sk-live-aaaaaaaaaaaa\nsecond line " + "x".repeat(500));
    const text = describeFailure(error);
    assert.ok(!text.includes("gsk_abcdefgh12345678") && !text.includes("sk-live-aaaaaaaaaaaa"), text);
    assert.ok(text.includes("***"));
    assert.ok(!text.includes("\n"));
    assert.ok(text.length < 300);
  });
});

describe("warnFailure", () => {
  beforeEach(() => {
    mock.method(console, "warn", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
  });

  test("writes one console.warn line naming the step", () => {
    warnFailure("compose", Object.assign(new Error("x"), { status: 429, kind: "http" }));
    const calls = (console.warn as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.arguments.length, 1);
    assert.equal(calls[0]!.arguments[0], "chat: compose failed (status=429 kind=http: x)");
  });
});
