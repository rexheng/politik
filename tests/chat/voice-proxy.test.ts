// The voice proxy between the page and the owner's Deepgram agent: what the page may say to it (tuneSettings), how long a
// session may last (sessionGuard) and the bridge that holds both (bridgeSockets), tested with fake sockets and fake timers.
import assert from "node:assert/strict";
import { describe, mock, test, beforeEach, afterEach } from "node:test";

import type { Env } from "../../photon/src/ask.ts";
import { IDLE_MS, MAX_SESSION_MS, VOICE_THINK_PROVIDER, bridgeSockets, sessionGuard, tuneSettings, type BridgeSocket, type Timers } from "../../photon/src/voice.ts";

const ORIGIN = "https://politik.test";
const OWN = "https://politik.test/api/voice/think";
const EVIL = "https://evil.example/x";

/** The rewritten message for a page's text, or a failure of the test when it was dropped. */
function tune(raw: string, origin = ORIGIN) {
  const tuned = tuneSettings(raw, origin);
  assert.ok(tuned, `the frame was dropped: ${raw.slice(0, 80)}`);
  return { ...tuned, msg: JSON.parse(tuned.text) };
}
const settings = (agent: unknown, more: object = {}) => JSON.stringify({ type: "Settings", audio: {}, agent, ...more });

describe("tuneSettings: only a rewritten copy of the page's JSON is ever sent on", () => {
  test("a think.provider.url is dropped, and the provider is the server's whatever the page asked for", () => {
    const { msg, text } = tune(settings({ think: { provider: { type: "open_ai", model: "gpt-4o", url: "https://evil.example/p" }, prompt: "p" } }));
    assert.deepEqual(msg.agent.think.provider, VOICE_THINK_PROVIDER);
    assert.doesNotMatch(text, /evil/);
  });

  test("a think.url is dropped", () => {
    const { msg, text } = tune(settings({ think: { url: "https://evil.example/t", prompt: "p" } }));
    assert.equal("url" in msg.agent.think, false);
    assert.equal(msg.agent.think.prompt.startsWith("p"), true);
    assert.doesNotMatch(text, /evil/);
  });

  test("a speak.provider.endpoint and a speak.url are dropped", () => {
    const { msg, text } = tune(settings({ speak: { provider: { type: "deepgram", model: "aura-2-thalia-en", endpoint: { url: EVIL } }, url: EVIL } }));
    assert.deepEqual(msg.agent.speak, { provider: { type: "deepgram", model: "aura-2-thalia-en" } });
    assert.doesNotMatch(text, /evil/);
  });

  test("a think or speak section at the top of the message, outside agent, is rewritten too", () => {
    const { msg, text } = tune(JSON.stringify({ type: "Settings", agent: {}, think: { endpoint: { url: EVIL }, provider: { type: "x", model: "y" } }, speak: { endpoint: { url: EVIL }, url: EVIL } }));
    assert.deepEqual(msg.think.endpoint, { url: OWN, headers: {} });
    assert.deepEqual(msg.think.provider, VOICE_THINK_PROVIDER);
    assert.equal("endpoint" in msg.speak, false);
    assert.equal("url" in msg.speak, false);
    assert.doesNotMatch(text, /evil/);
  });

  test("the message type is read in any letter case, and every section is rewritten whatever the type says", () => {
    for (const type of ["settings", "SETTINGS", "Settings ", "updatethink", "UpdateThink", "nonsense", ""]) {
      const { text } = tune(JSON.stringify({ type, agent: { think: { endpoint: { url: EVIL } }, speak: { endpoint: { url: EVIL } } }, think: { url: EVIL }, speak: { url: EVIL } }));
      assert.doesNotMatch(text, /evil/, JSON.stringify(type));
    }
  });

  test("a section under a key in another letter case (Think, SPEAK, Endpoint, URL) is rewritten too", () => {
    const { text } = tune(JSON.stringify({ type: "Settings", Agent: { Think: { Endpoint: { URL: EVIL }, Url: EVIL }, SPEAK: { ENDPOINT: EVIL } } }));
    assert.doesNotMatch(text, /evil/);
  });

  test("a key that names a URL is dropped with its value, whatever its spelling", () => {
    const keys = ["url", "Url", "URL", "uri", "href", "endpoint", "baseUrl", "base_url", "api-url", "apiURL", "webhookUri", "callbackHref", "ENDPOINT", "endpoints", "image_url"];
    for (const key of keys) {
      const think = { prompt: "p", [key]: { marker: "PAGEVALUE" }, nested: { [key]: "PAGEVALUE" } };
      const speak = { [key]: "PAGEVALUE", nested: { [key]: [1, "PAGEVALUE"] } };
      const { msg, text } = tune(settings({ think, speak }));
      assert.doesNotMatch(text, /PAGEVALUE/, key);
      assert.equal(key in msg.agent.speak, false, `speak.${key}`);
      assert.equal(key in msg.agent.speak.nested, false, `speak.nested.${key}`);
      assert.equal(key in msg.agent.think.nested, false, `think.nested.${key}`);
    }
  });

  test("a key that merely contains letters of those words is kept: security, during, curious", () => {
    const { msg } = tune(settings({ think: { prompt: "p", security_level: 2, during: "x" }, speak: { curious: true } }));
    assert.equal(msg.agent.think.security_level, 2);
    assert.equal(msg.agent.think.during, "x");
    assert.equal(msg.agent.speak.curious, true);
  });

  test("a string that is a URL is dropped from wherever it sits under think or speak, key or not", () => {
    const { msg, text } = tune(
      settings({
        think: { provider: { type: "open_ai", model: "https://evil.example/m" }, prompt: "p", note: "wss://evil.example/n", list: ["//evil.example/a", "fine", "data:text/plain,evil", "javascript:evil()"] },
        speak: { provider: { type: "deepgram", model: "aura", voice: "ftp://evil.example/v" }, tags: ["http://evil.example/t", "ok"] },
      }),
    );
    assert.doesNotMatch(text, /evil/);
    assert.deepEqual(msg.agent.think.list, ["fine"]);
    assert.deepEqual(msg.agent.speak.tags, ["ok"]);
    assert.deepEqual(msg.agent.speak.provider, { type: "deepgram", model: "aura" });
  });

  test("JSON written inside a string is read through: agent, think and speak as strings, and strings inside them", () => {
    const think = { endpoint: { url: EVIL }, provider: { type: "x", model: "y", url: EVIL } };
    const forms = [
      settings(JSON.stringify({ think })),
      settings({ think: JSON.stringify(think) }),
      settings({ speak: JSON.stringify({ provider: { endpoint: { url: EVIL } }, url: EVIL }) }),
      settings({ think: { provider: JSON.stringify({ type: "x", url: EVIL }), extra: JSON.stringify([{ endpoint: EVIL }, "https://evil.example"]) } }),
      settings({ think: JSON.stringify(JSON.stringify(think)) }),
      JSON.stringify(settings({ think })),
      JSON.stringify({ type: "Settings", agent: JSON.stringify({ speak: JSON.stringify({ endpoint: { url: EVIL } }) }) }),
    ];
    for (const raw of forms) {
      const { text } = tune(raw);
      assert.doesNotMatch(text, /evil/, raw.slice(0, 100));
    }
  });

  test("agent and think given as JSON strings come out as objects, pinned like any other", () => {
    const { msg } = tune(settings(JSON.stringify({ think: JSON.stringify({ prompt: "p", endpoint: { url: EVIL }, provider: { type: "z", model: "z" } }) })));
    assert.equal(typeof msg.agent, "object");
    assert.deepEqual(msg.agent.think.endpoint, { url: OWN, headers: {} });
    assert.deepEqual(msg.agent.think.provider, VOICE_THINK_PROVIDER);
  });

  test("a frame that does not parse is dropped, not passed on: NaN, a byte-order mark, text after the JSON, plain text", () => {
    const evil = '{"type":"Settings","agent":{"think":{"endpoint":{"url":"https://evil.example/x"}}}';
    const frames = [
      '{"type":"Settings","agent":{"think":{"endpoint":{"url":"https://evil.example/x"}}},"n":NaN}',
      `﻿${evil}}`,
      `${evil}} trailing text`,
      `${evil}}{"type":"KeepAlive"}`,
      `${evil},}`,
      `${evil}`,
      "{'type':'Settings'}",
      "Infinity",
      "undefined",
      "hello",
      "",
      "   ",
      "\u0000",
    ];
    for (const raw of frames) assert.equal(tuneSettings(raw, ORIGIN), null, JSON.stringify(raw.slice(0, 60)));
  });

  test("JSON that is not an object is dropped too: a number, a string that is not JSON, null, a list", () => {
    for (const raw of ["5", '"hello"', "null", "true", "[1,2]", '[{"type":"Settings"}]', '"[1,2]"']) {
      assert.equal(tuneSettings(raw, ORIGIN), null, raw);
    }
  });

  test("a message with the type twice is sent with it once, and the sections in it are rewritten whichever copy a parser would read", () => {
    for (const raw of [
      '{"type":"Settings","type":"KeepAlive","agent":{"think":{"endpoint":{"url":"https://evil.example/x"}}}}',
      '{"type":"KeepAlive","type":"Settings","agent":{"think":{"endpoint":{"url":"https://evil.example/x"}}}}',
      '{"type":"Settings","agent":{"think":{"endpoint":{"url":"https://evil.example/x"}},"think":{"prompt":"p"}}}',
    ]) {
      const { text } = tune(raw);
      assert.equal((text.match(/"type":"(?:Settings|KeepAlive)"/g) ?? []).length, 1, text);
      assert.doesNotMatch(text, /evil/, raw);
    }
  });

  test("the whole message is built again: the text is the JSON of what was kept, never the page's own characters", () => {
    const { text } = tune('  {  "type" : "KeepAlive" ,\n "extra" : [ 1 , 2 ]  }  ');
    assert.equal(text, '{"type":"KeepAlive","extra":[1,2]}');
  });

  test("the provider is the server's, and everything else the page put in the think section but a URL is kept", () => {
    const { msg } = tune(settings({ think: { provider: { type: "anthropic", model: "claude-opus", temperature: 2 }, prompt: "You are Politik.", context_length: 8000, ignored: true } }));
    assert.deepEqual(msg.agent.think.provider, VOICE_THINK_PROVIDER);
    assert.equal(msg.agent.think.context_length, 8000);
    assert.equal(msg.agent.think.ignored, true);
    assert.match(msg.agent.think.prompt, /^You are Politik\./);
  });

  test("the server's provider and model are what the page's own settings used to be, so the shipped page's flow is unchanged", () => {
    assert.deepEqual(VOICE_THINK_PROVIDER, { type: "open_ai", model: "gpt-4o-mini" });
    const { msg } = tune(settings({ think: { provider: { type: "open_ai", model: "gpt-4o-mini" }, prompt: "You are Politik." } }));
    assert.deepEqual(msg.agent.think.provider, VOICE_THINK_PROVIDER);
    assert.equal(msg.agent.think.functions[0].name, "politik");
  });

  test("a prompt is text: its URLs and JSON-looking content are kept, and the session notes in it are still read", () => {
    const notes = [{ title: "A post", url: "https://bsky.app/profile/a/post/1" }];
    const prompt = `You are Politik.\nSession notes:\n${JSON.stringify(notes)}`;
    const { msg, knowledge } = tune(settings({ think: { prompt } }));
    assert.ok(msg.agent.think.prompt.startsWith(prompt));
    assert.deepEqual(knowledge, notes);
    const whole = tune(settings({ think: { prompt: '{"a":1}' } }));
    assert.equal(typeof whole.msg.agent.think.prompt, "string");
    assert.ok(whole.msg.agent.think.prompt.startsWith('{"a":1}'));
  });

  test("what is outside think and speak is the page's: the audio settings, listen, the greeting, and text typed into a message", () => {
    const keep = { type: "Settings", audio: { input: { encoding: "linear16", sample_rate: 16000 } }, agent: { language: "en", greeting: "Hi — see https://politik.example", listen: { provider: { type: "deepgram", model: "nova-3" } } } };
    assert.deepEqual(tune(JSON.stringify(keep)).msg, keep);
    const typed = { type: "InjectUserMessage", content: "[1,2]" };
    assert.deepEqual(tune(JSON.stringify(typed)).msg, typed);
    const link = { type: "InjectUserMessage", content: "https://example.com" };
    assert.deepEqual(tune(JSON.stringify(link)).msg, link);
  });

  test("a very deeply nested message cannot break it: it is dropped or cleaned, never thrown", () => {
    const deep = (n: number) => `${'{"a":'.repeat(n)}1${"}".repeat(n)}`;
    for (const n of [50, 500, 5000]) {
      const raw = `{"type":"Settings","agent":{"think":${deep(n)},"speak":${deep(n)}}}`;
      assert.doesNotThrow(() => {
        const tuned = tuneSettings(raw, ORIGIN);
        if (tuned) assert.doesNotMatch(tuned.text, /evil/);
      }, String(n));
    }
  });

  test("a __proto__ key is just a key: it does not change what the message becomes", () => {
    const { msg, text } = tune('{"type":"Settings","agent":{"think":{"__proto__":{"endpoint":"https://evil.example"},"prompt":"p"}}}');
    assert.doesNotMatch(text, /evil/);
    assert.equal(Object.getPrototypeOf(msg.agent.think), Object.prototype);
    assert.equal(({} as { endpoint?: unknown }).endpoint, undefined);
    assert.equal(Object.keys(msg.agent.think).includes("__proto__"), false);
  });
});

// ---- the time a session may last ----------------------------------------------------------------------------------

/** Timers that only move when the test says so. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id as number);
    },
  };
  return {
    timers,
    pending: () => pending.size,
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        pending.delete(due[0]);
        due[1].fn();
      }
      now = target;
    },
  };
}

describe("sessionGuard: a session ends after 10 minutes, or after 60 seconds without a frame from the page", () => {
  test("the limits are 10 minutes and 60 seconds", () => {
    assert.equal(MAX_SESSION_MS, 600_000);
    assert.equal(IDLE_MS, 60_000);
  });

  test("with nothing from the page it ends at 60 seconds, not before", () => {
    const clock = fakeTimers();
    const ended: string[] = [];
    sessionGuard({ timers: clock.timers, onExpire: (why) => ended.push(why) });
    clock.advance(59_999);
    assert.deepEqual(ended, []);
    clock.advance(1);
    assert.deepEqual(ended, ["idle"]);
    assert.equal(clock.pending(), 0, "both timers are cleared once it has ended");
  });

  test("a frame from the page starts the 60 seconds again", () => {
    const clock = fakeTimers();
    const ended: string[] = [];
    const guard = sessionGuard({ timers: clock.timers, onExpire: (why) => ended.push(why) });
    for (let i = 0; i < 5; i++) {
      clock.advance(59_000);
      guard.touch();
    }
    assert.deepEqual(ended, []);
    clock.advance(59_999);
    assert.deepEqual(ended, []);
    clock.advance(1);
    assert.deepEqual(ended, ["idle"]);
  });

  test("a page that keeps sending still ends at 10 minutes", () => {
    const clock = fakeTimers();
    const ended: string[] = [];
    const guard = sessionGuard({ timers: clock.timers, onExpire: (why) => ended.push(why) });
    for (let elapsed = 0; elapsed < 599_000; elapsed += 1_000) {
      clock.advance(1_000);
      guard.touch();
    }
    assert.deepEqual(ended, []);
    clock.advance(1_000);
    assert.deepEqual(ended, ["session limit"]);
    assert.equal(clock.pending(), 0);
  });

  test("it ends once: later time and later frames change nothing", () => {
    const clock = fakeTimers();
    const ended: string[] = [];
    const guard = sessionGuard({ timers: clock.timers, onExpire: (why) => ended.push(why) });
    clock.advance(IDLE_MS);
    guard.touch();
    clock.advance(MAX_SESSION_MS * 2);
    assert.deepEqual(ended, ["idle"]);
    assert.equal(clock.pending(), 0);
  });

  test("stop() cancels both timers, so a session that closed by itself leaves nothing running", () => {
    const clock = fakeTimers();
    const ended: string[] = [];
    const guard = sessionGuard({ timers: clock.timers, onExpire: (why) => ended.push(why) });
    guard.stop();
    assert.equal(clock.pending(), 0);
    clock.advance(MAX_SESSION_MS * 2);
    assert.deepEqual(ended, []);
  });

  test("the limits can be set: a shorter idle time or session", () => {
    const clock = fakeTimers();
    const ended: string[] = [];
    const guard = sessionGuard({ timers: clock.timers, idleMs: 1_000, maxMs: 2_500, onExpire: (why) => ended.push(why) });
    clock.advance(900);
    guard.touch();
    clock.advance(900);
    guard.touch();
    clock.advance(700);
    assert.deepEqual(ended, ["session limit"]);
  });

  test("without timers given it uses the real ones, which a test can stop at once", () => {
    const guard = sessionGuard({ onExpire: () => assert.fail("not within this test") });
    guard.touch();
    guard.stop();
  });
});

// ---- the bridge between the page and Deepgram ----------------------------------------------------------------------

class FakeSocket implements BridgeSocket {
  listeners: Record<string, ((event: { data?: unknown; code?: number; reason?: string }) => void)[]> = {};
  sent: unknown[] = [];
  closes: { code?: number; reason?: string }[] = [];
  accepted = 0;
  addEventListener(type: string, listener: (event: { data?: unknown; code?: number; reason?: string }) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closes.push({ code, reason });
  }
  accept() {
    this.accepted++;
  }
  emit(type: string, event: { data?: unknown; code?: number; reason?: string } = {}) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
  message(data: unknown) {
    this.emit("message", { data });
  }
}

describe("bridgeSockets", () => {
  beforeEach(() => {
    mock.method(console, "warn", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
  });

  function bridge(over: Partial<Parameters<typeof bridgeSockets>[0]> = {}) {
    const server = new FakeSocket();
    const remote = new FakeSocket();
    const clock = fakeTimers();
    bridgeSockets({ server, remote, env: {} as Env, origin: ORIGIN, ip: "203.0.113.7", timers: clock.timers, ...over });
    return { server, remote, clock };
  }

  test("both sockets are accepted", () => {
    const { server, remote } = bridge();
    assert.equal(server.accepted, 1);
    assert.equal(remote.accepted, 1);
  });

  test("a Settings message from the page reaches Deepgram rewritten, with no trace of the page's endpoints or provider", () => {
    const { server, remote } = bridge();
    server.message(settings({ think: { provider: { type: "anthropic", model: "big" }, endpoint: { url: EVIL }, functions: [{ name: "x", endpoint: { url: EVIL } }] }, speak: { endpoint: { url: EVIL } } }));
    assert.equal(remote.sent.length, 1);
    const text = String(remote.sent[0]);
    assert.doesNotMatch(text, /evil|anthropic/);
    assert.deepEqual(JSON.parse(text).agent.think.endpoint, { url: OWN, headers: {} });
  });

  test("a text frame that does not parse is never forwarded", () => {
    const { server, remote } = bridge();
    for (const raw of ['{"type":"KeepAlive","n":NaN}', '﻿{"type":"KeepAlive"}', '{"type":"KeepAlive"} trailing', "hello", "", "5"]) server.message(raw);
    assert.deepEqual(remote.sent, []);
    assert.deepEqual(server.closes, [], "the session goes on");
  });

  test("other JSON messages (keep-alives, injected text) are forwarded, as the same JSON written again", () => {
    const { server, remote } = bridge();
    server.message('{ "type": "KeepAlive" }');
    server.message('{"type":"InjectUserMessage","content":"hello"}');
    assert.deepEqual(remote.sent, ['{"type":"KeepAlive"}', '{"type":"InjectUserMessage","content":"hello"}']);
  });

  test("the listen proxy, which has no env, rewrites and drops the same way", () => {
    const { server, remote } = bridge({ env: undefined });
    server.message('{"type":"CloseStream"}');
    server.message('{"type":"CloseStream"} x');
    assert.deepEqual(remote.sent, ['{"type":"CloseStream"}']);
  });

  test("audio goes through untouched in both directions", () => {
    const { server, remote } = bridge();
    const up = new Uint8Array([1, 2, 3]);
    server.message(up);
    assert.deepEqual(remote.sent, [up]);
    const down = new Uint8Array([9, 8]);
    remote.message(down);
    assert.deepEqual(server.sent, [down]);
  });

  test("a message from Deepgram that is not a function call goes on to the page as it came", async () => {
    const { server, remote } = bridge({ answerCall: async () => false });
    remote.message('{"type":"ConversationText","role":"user","content":"hi"}');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(server.sent, ['{"type":"ConversationText","role":"user","content":"hi"}']);
  });

  test("the session notes are kept for the whole session: a later message with no notes does not erase them", async () => {
    const seen: unknown[] = [];
    const answerCall = (async (_raw: string, _env: Env, _remote: WebSocket, knowledge: unknown) => {
      seen.push(knowledge);
      return true;
    }) as never;
    const { server, remote } = bridge({ answerCall });
    const notes = [{ title: "A post" }];
    server.message(settings({ think: { prompt: `You are Politik.\nSession notes:\n${JSON.stringify(notes)}` } }));
    server.message('{"type":"KeepAlive"}');
    server.message(JSON.stringify({ type: "UpdatePrompt", prompt: "more" }));
    server.message(settings({ think: { prompt: "A new prompt with no notes" } }));
    remote.message('{"type":"FunctionCallRequest","functions":[]}');
    await Promise.resolve();
    assert.deepEqual(seen, [notes]);
  });

  test("a message that does carry notes replaces them", async () => {
    const seen: unknown[] = [];
    const answerCall = (async (_raw: string, _env: Env, _remote: WebSocket, knowledge: unknown) => {
      seen.push(knowledge);
      return true;
    }) as never;
    const { server, remote } = bridge({ answerCall });
    server.message(settings({ think: { prompt: `a\nSession notes:\n${JSON.stringify([{ title: "one" }])}` } }));
    server.message(JSON.stringify({ type: "UpdateThink", think: { prompt: `b\nSession notes:\n${JSON.stringify([{ title: "two" }])}` } }));
    remote.message('{"type":"FunctionCallRequest","functions":[]}');
    await Promise.resolve();
    assert.deepEqual(seen, [[{ title: "two" }]]);
  });

  test("60 seconds without a frame from the page closes both sockets", () => {
    const { server, remote, clock } = bridge();
    clock.advance(59_999);
    assert.deepEqual([server.closes, remote.closes], [[], []]);
    clock.advance(1);
    assert.deepEqual(server.closes, [{ code: 1000, reason: "idle" }]);
    assert.deepEqual(remote.closes, [{ code: 1000, reason: "idle" }]);
    assert.equal(clock.pending(), 0);
  });

  test("a frame from the page, audio or text, starts the 60 seconds again", () => {
    const { server, clock } = bridge();
    clock.advance(50_000);
    server.message(new Uint8Array([0]));
    clock.advance(59_999);
    assert.deepEqual(server.closes, []);
    server.message('{"type":"KeepAlive"}');
    clock.advance(59_999);
    assert.deepEqual(server.closes, []);
    clock.advance(1);
    assert.deepEqual(server.closes, [{ code: 1000, reason: "idle" }]);
  });

  test("frames from Deepgram are not a sign of the page being there", () => {
    const { server, remote, clock } = bridge();
    clock.advance(30_000);
    remote.message(new Uint8Array([1]));
    clock.advance(29_999);
    remote.message(new Uint8Array([1]));
    assert.deepEqual(server.closes, []);
    clock.advance(1);
    assert.deepEqual(server.closes, [{ code: 1000, reason: "idle" }]);
  });

  test("a page that keeps sending is cut off at 10 minutes", () => {
    const { server, remote, clock } = bridge();
    for (let elapsed = 0; elapsed < 590_000; elapsed += 10_000) {
      clock.advance(10_000);
      server.message(new Uint8Array([0]));
    }
    assert.deepEqual(server.closes, []);
    clock.advance(10_000);
    assert.deepEqual(server.closes, [{ code: 1000, reason: "session limit" }]);
    assert.deepEqual(remote.closes, [{ code: 1000, reason: "session limit" }]);
  });

  test("a session that ends by itself leaves no timer behind, and Deepgram ending it closes the page's socket", () => {
    const { server, remote, clock } = bridge();
    remote.emit("close", { code: 1000, reason: "done" });
    assert.equal(clock.pending(), 0);
    assert.deepEqual(server.closes, [{ code: 1000, reason: "done" }]);
    clock.advance(MAX_SESSION_MS * 2);
    assert.deepEqual(remote.closes, [], "nothing is closed a second time");
  });

  test("the page closing the socket, or an error on either, also stops the timers", () => {
    for (const [side, type] of [["server", "close"], ["remote", "error"], ["server", "error"]] as const) {
      const { server, remote, clock } = bridge();
      (side === "server" ? server : remote).emit(type, { code: 1001, reason: "bye" });
      assert.equal(clock.pending(), 0, `${side} ${type}`);
    }
  });

  test("frames dropped for not parsing still count as the page being there", () => {
    const { server, clock } = bridge();
    clock.advance(59_000);
    server.message("garbage");
    clock.advance(59_000);
    assert.deepEqual(server.closes, []);
  });

  test("the default limits are used when none are given", () => {
    const { server, clock } = bridge({ maxSessionMs: undefined, idleMs: undefined });
    clock.advance(IDLE_MS);
    assert.equal(server.closes.length, 1);
  });
});
