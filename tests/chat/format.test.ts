import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FALLBACK_REPLY } from "../../photon/src/chat/index.ts";
import { toSpokenResponse } from "../../photon/src/chat/spoken.ts";
import type { Citation } from "../../photon/src/chat/types.ts";
import { BUSY_REPLY } from "../../photon/src/limit.ts";
import { VOICE_ANSWER_TYPE as SERVER_VOICE_ANSWER_TYPE } from "../../photon/src/voice.ts";

// photon/public/format.js is a browser ES module with no DOM in it, so Node can import it as it is. It has no type
// declarations (a .d.ts in photon/public would be served to browsers), so the shapes are written out here.
type Inline = { type: "text" | "bold" | "cite"; text?: string; n?: number };
type Block = { type: "heading" | "para" | "bullets"; items?: Inline[][]; inline?: Inline[] };
type Format = {
  parseAnswer(md: string): Block[];
  formatAsOf(iso: string): string;
  historyTurn(role: string, text: string): { role: string; text: string };
  spokenText(md: string, max?: number): string;
  formatDay(iso: string): string;
  spokenReply(view: { reply: string; mode?: string; citations?: { title?: string; shortTitle?: string }[] }, max?: number): string;
  voiceAnswerOf(data: unknown): { question: string; response: Record<string, unknown> } | null;
  isVoiceSocketUrl(url: string, base?: string): boolean;
  tapVoiceAnswers(target: { WebSocket?: unknown }, base: string, onAnswer: (question: string, response: Record<string, unknown>) => void, onFailed?: (socketUrl: string) => void, onStarted?: (socketUrl: string) => void): boolean;
  voiceBusyLine(
    socketUrl: string,
    doFetch: (url: string, init?: { cache?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>,
    options?: { timeoutMs?: number; setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (id: unknown) => void },
  ): Promise<string>;
  busyLineOf(res: { status: number; json(): Promise<unknown> }): Promise<string>;
  BUSY_LINE: string;
  VOICE_ANSWER_TYPE: string;
};
const { parseAnswer, formatAsOf, historyTurn, spokenText, formatDay, spokenReply, voiceAnswerOf, isVoiceSocketUrl, tapVoiceAnswers, voiceBusyLine, busyLineOf, BUSY_LINE, VOICE_ANSWER_TYPE } = (await import(new URL("../../photon/public/format.js", import.meta.url).href)) as Format;

const text = (t: string): Inline => ({ type: "text", text: t });
const bold = (t: string): Inline => ({ type: "bold", text: t });
const cite = (n: number): Inline => ({ type: "cite", n });

describe("parseAnswer", () => {
  test("bold then a cite, a bullet list, a heading and a paragraph with two cites", () => {
    assert.deepEqual(parseAnswer("**Yes.** [1]\n\n- a [2]\n- b\n\n### Status\ntext [1][3]"), [
      { type: "para", inline: [bold("Yes."), cite(1)] },
      { type: "bullets", items: [[text("a"), cite(2)], [text("b")]] },
      { type: "heading", inline: [text("Status")] },
      { type: "para", inline: [text("text"), cite(1), cite(3)] },
    ]);
  });

  test("model text is never markup: an HTML tag is one text inline holding the literal string", () => {
    assert.deepEqual(parseAnswer("<img src=x onerror=alert(1)>"), [{ type: "para", inline: [text("<img src=x onerror=alert(1)>")] }]);
  });

  test("markup inside bold, bullets and headings stays literal text too", () => {
    assert.deepEqual(parseAnswer("**<b>hi</b>**\n- <script>alert(1)</script> [1]\n## <i>x</i>"), [
      { type: "para", inline: [bold("<b>hi</b>")] },
      { type: "bullets", items: [[text("<script>alert(1)</script>"), cite(1)]] },
      { type: "heading", inline: [text("<i>x</i>")] },
    ]);
  });

  test("a cite inside bold splits the bold around it", () => {
    assert.deepEqual(parseAnswer("**Here is the picture [1].**"), [{ type: "para", inline: [bold("Here is the picture"), cite(1), bold(".")] }]);
  });

  test("a cite takes the place of the space before it, and a word after it keeps its space", () => {
    assert.deepEqual(parseAnswer("It passed [1] and was signed [2][3]. Then more."), [
      { type: "para", inline: [text("It passed"), cite(1), text(" and was signed"), cite(2), cite(3), text(". Then more.")] },
    ]);
  });

  test("a comma group is several cites, and cites with a space between them sit side by side", () => {
    assert.deepEqual(parseAnswer("Both agree [1, 2] [3]."), [{ type: "para", inline: [text("Both agree"), cite(1), cite(2), cite(3), text(".")] }]);
  });

  test("a bracketed year or a zero is not a cite", () => {
    assert.deepEqual(parseAnswer("Tan v Lim [2020] SGCA 5 and item [0]."), [{ type: "para", inline: [text("Tan v Lim [2020] SGCA 5 and item [0].")] }]);
  });

  test("two bold phrases in one line stay two", () => {
    assert.deepEqual(parseAnswer("**One** and **two** [1]"), [{ type: "para", inline: [bold("One"), text(" and "), bold("two"), cite(1)] }]);
  });

  test("an unpaired ** stays as written", () => {
    assert.deepEqual(parseAnswer("2 ** 3 is eight"), [{ type: "para", inline: [text("2 ** 3 is eight")] }]);
  });

  test("a brief: bold lead, bullets, then a closing line that is its own paragraph", () => {
    const md = "**Lead.** [1]\n- one [1]\n- two [2]\nWhat to watch: more to come.";
    assert.deepEqual(parseAnswer(md), [
      { type: "para", inline: [bold("Lead."), cite(1)] },
      { type: "bullets", items: [[text("one"), cite(1)], [text("two"), cite(2)]] },
      { type: "para", inline: [text("What to watch: more to come.")] },
    ]);
  });

  test("headings of any level, and * or a bullet dot for list items", () => {
    assert.deepEqual(parseAnswer("# One\n## Two\n###### Six\n* a\n• b"), [
      { type: "heading", inline: [text("One")] },
      { type: "heading", inline: [text("Two")] },
      { type: "heading", inline: [text("Six")] },
      { type: "bullets", items: [[text("a")], [text("b")]] },
    ]);
  });

  test("lines of one paragraph are joined by a space, and blank lines separate paragraphs", () => {
    assert.deepEqual(parseAnswer("first line\nsecond line\n\n\n\nnext paragraph"), [
      { type: "para", inline: [text("first line second line")] },
      { type: "para", inline: [text("next paragraph")] },
    ]);
  });

  test("CRLF line endings are handled", () => {
    assert.deepEqual(parseAnswer("**A.**\r\n\r\n- b [1]\r\n"), [
      { type: "para", inline: [bold("A.")] },
      { type: "bullets", items: [[text("b"), cite(1)]] },
    ]);
  });

  test("empty and blank input have no blocks, and a hash without a space is not a heading", () => {
    assert.deepEqual(parseAnswer(""), []);
    assert.deepEqual(parseAnswer("  \n\n  "), []);
    assert.deepEqual(parseAnswer("#hashtag"), [{ type: "para", inline: [text("#hashtag")] }]);
  });

  test("a non-string is no blocks, not an exception", () => {
    assert.deepEqual(parseAnswer(undefined as unknown as string), []);
    assert.deepEqual(parseAnswer(null as unknown as string), []);
  });
});

describe("formatAsOf", () => {
  test("an ISO date becomes the footer line, with no zero on the day", () => {
    assert.equal(formatAsOf("2026-10-15"), "Data as of 15 Oct 2026");
    assert.equal(formatAsOf("2026-01-05"), "Data as of 5 Jan 2026");
    assert.equal(formatAsOf("2025-12-31"), "Data as of 31 Dec 2025");
  });

  test("a date with a time keeps the day", () => {
    assert.equal(formatAsOf("2026-10-15T23:30:00Z"), "Data as of 15 Oct 2026");
  });

  test("empty, missing or unreadable is the empty string (an empty database has no date)", () => {
    assert.equal(formatAsOf(""), "");
    assert.equal(formatAsOf(undefined as unknown as string), "");
    assert.equal(formatAsOf("last Tuesday"), "");
    assert.equal(formatAsOf("2026-13-40"), "");
  });
});

describe("historyTurn", () => {
  test("a turn is the role and the text and nothing else", () => {
    assert.deepEqual(historyTurn("user", "What is going on?"), { role: "user", text: "What is going on?" });
    assert.deepEqual(Object.keys(historyTurn("assistant", "A reply [1].")), ["role", "text"]);
  });

  test("text over 600 characters is cut to 600", () => {
    const turn = historyTurn("assistant", "x".repeat(700));
    assert.equal(turn.text.length, 600);
    assert.equal(turn.role, "assistant");
    assert.equal(historyTurn("user", "y".repeat(600)).text.length, 600, "exactly 600 is kept whole");
  });

  test("a cut never leaves half of an emoji", () => {
    const text = "a".repeat(599) + "😀" + "tail";
    const cut = historyTurn("assistant", text).text;
    assert.ok(cut.length <= 600);
    assert.equal(cut, "a".repeat(599));
  });

  test("a missing text is empty", () => {
    assert.equal(historyTurn("user", undefined as unknown as string).text, "");
  });
});

describe("spokenText", () => {
  test("markers and markdown are dropped, and each bullet or heading is a sentence", () => {
    const md = "**Yes, it applies.** [1]\n\n### Status\n- It took effect on 1 January 2026 [2]\n- Fines are up to $1m, [3]\nWhat to watch: the first audits.";
    assert.equal(spokenText(md), "Yes, it applies. Status. It took effect on 1 January 2026. Fines are up to $1m. What to watch: the first audits.");
  });

  test("a long reply is cut at a sentence end within the limit", () => {
    const sentence = "This is one sentence of ordinary length.";
    const spoken = spokenText(Array(40).fill(sentence).join(" "), 100);
    assert.ok(spoken.length <= 100);
    assert.ok(spoken.endsWith("."));
    assert.equal(spoken, `${sentence} ${sentence}`);
  });

  test("a reply of only markers, or no reply, is empty", () => {
    assert.equal(spokenText("[1][2]"), "");
    assert.equal(spokenText(""), "");
    assert.equal(spokenText(undefined as unknown as string), "");
  });
});

describe("formatDay (M6: the card's fetched date reads like the footer)", () => {
  test("a date or an ISO timestamp is D Mon YYYY, the same day the footer shows", () => {
    assert.equal(formatDay("2026-10-15"), "15 Oct 2026");
    assert.equal(formatDay("2026-01-05"), "5 Jan 2026");
    assert.equal(formatDay("2026-09-30T23:59:59Z"), "30 Sep 2026");
    assert.equal(formatAsOf("2026-10-15"), `Data as of ${formatDay("2026-10-15")}`);
  });

  test("no real date is empty", () => {
    for (const bad of ["", "soon", "2026-02-30", "2026-13-01", undefined, null, 20261015]) assert.equal(formatDay(bad as unknown as string), "", String(bad));
  });
});

describe("spokenReply", () => {
  const cite = (n: number, title: string, shortTitle?: string): Citation => ({ n, kind: "policy", recordId: `r${n}`, title, ...(shortTitle ? { shortTitle } : {}), url: `https://example.org/${n}`, quote: "q" });

  test("a fallback names up to three records, by short title where there is one", () => {
    const view = { reply: FALLBACK_REPLY, mode: "fallback", citations: [cite(1, "Transparency in Frontier Artificial Intelligence Act", "SB 53"), cite(2, "Personal Data Protection Act 2012", "PDPA"), cite(3, "Colocation tender"), cite(4, "Fourth")] };
    assert.equal(spokenReply(view), "I couldn't write a summary just now. The most relevant records are SB 53, PDPA and Colocation tender.");
  });

  test("it says what the Worker says for the voice agent", () => {
    const cases = [
      { reply: FALLBACK_REPLY, mode: "fallback" as const, citations: [cite(1, "A", "SB 53"), cite(2, "B")] },
      { reply: FALLBACK_REPLY, mode: "fallback" as const, citations: [cite(1, "Only")] },
      { reply: "**Yes [1].** - bullet", mode: "brief" as const, citations: [cite(1, "A")] },
      { reply: "I could not check that just now. Try again in a minute.", mode: "fallback" as const, citations: [] },
    ];
    for (const view of cases) assert.equal(spokenReply(view), toSpokenResponse(view), view.reply);
  });

  test("an answer, and a fallback with no records, are the reply as speech", () => {
    assert.equal(spokenReply({ reply: "**Yes [1].** More.", mode: "brief", citations: [cite(1, "A")] }), "Yes. More.");
    assert.equal(spokenReply({ reply: "Sorry. Try later.", mode: "fallback", citations: [] }), "Sorry. Try later.");
    assert.equal(spokenReply({ reply: "Hi.", citations: undefined as unknown as [] }), "Hi.");
  });
});

describe("the voice socket's answer frame (I3)", () => {
  const frame = (over: Record<string, unknown> = {}) => JSON.stringify({ type: "PolitikAnswer", question: "What is going on?", response: { reply: "Hi [1].", citations: [] }, ...over });

  test("the type is the one the Worker sends", () => {
    assert.equal(VOICE_ANSWER_TYPE, SERVER_VOICE_ANSWER_TYPE);
  });

  test("a good frame gives the question and the response", () => {
    assert.deepEqual(voiceAnswerOf(frame()), { question: "What is going on?", response: { reply: "Hi [1].", citations: [] } });
    assert.equal(voiceAnswerOf(frame({ question: "  padded  " }))!.question, "padded");
  });

  test("any other frame is not an answer: audio, the agent's own JSON, bad JSON, a frame with no question or response", () => {
    for (const data of [new ArrayBuffer(8), null, undefined, 5, "", "not json", '{"type":"ConversationText","role":"user","content":"PolitikAnswer"}', frame({ type: "Other" }), frame({ question: "" }), frame({ question: 5 }), frame({ response: null }), frame({ response: "text" }), "[1,2]", "PolitikAnswer"]) {
      assert.equal(voiceAnswerOf(data), null, String(data));
    }
  });

  test("only a socket under /api/voice/ on this site is read", () => {
    const base = "https://politik.example/";
    assert.equal(isVoiceSocketUrl("wss://politik.example/api/voice/v1/agent/converse", base), true);
    assert.equal(isVoiceSocketUrl("/api/voice/v1/agent/converse", base), true);
    assert.equal(isVoiceSocketUrl("wss://politik.example/api/voice/listen", base), true);
    assert.equal(isVoiceSocketUrl("wss://politik.example/other", base), false);
    assert.equal(isVoiceSocketUrl("wss://politik.example/api/ask", base), false);
    assert.equal(isVoiceSocketUrl("not a url at all %%", "also bad"), false);
  });
});

describe("tapVoiceAnswers", () => {
  /** A stand-in for the browser's WebSocket: it records its url and protocols and lets a test deliver frames. */
  class FakeSocket {
    static CLOSING = 2;
    static instances: FakeSocket[] = [];
    listeners: ((event: { data: unknown }) => void)[] = [];
    events: Record<string, ((event: { data: unknown }) => void)[]> = {};
    sent: unknown[] = [];
    constructor(
      public url: string,
      public protocols?: string | string[],
    ) {
      FakeSocket.instances.push(this);
    }
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      if (type === "message") this.listeners.push(listener);
      else (this.events[type] ??= []).push(listener);
    }
    fire(type: string) {
      for (const listener of this.events[type] ?? []) listener({ data: undefined });
    }
    send(data: unknown) {
      this.sent.push(data);
    }
    deliver(data: unknown) {
      for (const listener of this.listeners) listener({ data });
    }
  }
  const base = "https://politik.example/";
  const frame = (question: string) => JSON.stringify({ type: "PolitikAnswer", question, response: { reply: "R [1].", citations: [] } });

  function install() {
    FakeSocket.instances = [];
    const target: { WebSocket: unknown } = { WebSocket: FakeSocket };
    const heard: [string, unknown][] = [];
    assert.equal(tapVoiceAnswers(target, base, (q, r) => void heard.push([q, r])), true);
    const Tapped = target.WebSocket as typeof FakeSocket;
    return { target, heard, Tapped };
  }

  test("an answer frame on the voice agent's socket reaches the handler, once", () => {
    const { heard, Tapped } = install();
    const socket = new Tapped("wss://politik.example/api/voice/v1/agent/converse", ["bearer", "proxy"]);
    socket.deliver(frame("What is going on?"));
    assert.deepEqual(heard, [["What is going on?", { reply: "R [1].", citations: [] }]]);
  });

  test("the socket is otherwise the native one: same url and protocols, sends, statics, and an instance of the original", () => {
    const { Tapped } = install();
    const socket = new Tapped("wss://politik.example/api/voice/v1/agent/converse", ["bearer", "proxy"]);
    assert.equal(socket.url, "wss://politik.example/api/voice/v1/agent/converse");
    assert.deepEqual(socket.protocols, ["bearer", "proxy"]);
    socket.send("audio");
    assert.deepEqual(socket.sent, ["audio"]);
    assert.equal(Tapped.CLOSING, 2);
    assert.ok(socket instanceof FakeSocket);
  });

  test("other frames on the voice socket (audio, the agent's own JSON) are ignored", () => {
    const { heard, Tapped } = install();
    const socket = new Tapped("wss://politik.example/api/voice/v1/agent/converse");
    socket.deliver(new ArrayBuffer(4));
    socket.deliver(JSON.stringify({ type: "ConversationText", role: "user", content: "hi" }));
    socket.deliver("not json");
    assert.deepEqual(heard, []);
  });

  test("a socket to any other address is not listened to", () => {
    const { heard, Tapped } = install();
    const socket = new Tapped("wss://elsewhere.example/stream");
    assert.equal(socket.listeners.length, 0);
    socket.deliver(frame("q"));
    assert.deepEqual(heard, []);
  });

  test("a handler that throws does not disturb the socket's other listeners", () => {
    FakeSocket.instances = [];
    const target: { WebSocket: unknown } = { WebSocket: FakeSocket };
    tapVoiceAnswers(target, base, () => {
      throw new Error("boom");
    });
    const socket = new (target.WebSocket as typeof FakeSocket)("wss://politik.example/api/voice/v1/agent/converse");
    let later = 0;
    socket.addEventListener("message", () => later++);
    assert.doesNotThrow(() => socket.deliver(frame("q")));
    assert.equal(later, 1);
  });

  describe("a voice session the Worker refused to open", () => {
    const agent = "wss://politik.example/api/voice/v1/agent/converse";
    function watch() {
      FakeSocket.instances = [];
      const target: { WebSocket: unknown } = { WebSocket: FakeSocket };
      const failed: string[] = [];
      tapVoiceAnswers(target, base, () => {}, (url) => void failed.push(url));
      return { failed, Tapped: target.WebSocket as typeof FakeSocket };
    }

    test("an agent socket that errors and closes without ever opening is reported once, with its address", () => {
      const { failed, Tapped } = watch();
      const socket = new Tapped(agent, ["bearer", "proxy"]);
      socket.fire("error");
      socket.fire("close");
      assert.deepEqual(failed, [agent]);
    });

    test("the address is made absolute against the page, for a socket opened with a relative one", () => {
      const { failed, Tapped } = watch();
      new Tapped("/api/voice/v1/agent/converse").fire("close");
      assert.deepEqual(failed, ["https://politik.example/api/voice/v1/agent/converse"], "the browser turns https into wss; asking https is the same address");
    });

    test("a socket that opened and later closed is a finished session, not a refusal", () => {
      const { failed, Tapped } = watch();
      const socket = new Tapped(agent);
      socket.fire("open");
      socket.fire("error");
      socket.fire("close");
      assert.deepEqual(failed, []);
    });

    test("only the agent's socket is reported: not the listen-only socket of the plain Talk button, and not another address", () => {
      const { failed, Tapped } = watch();
      new Tapped("wss://politik.example/api/voice/listen").fire("close");
      new Tapped("wss://elsewhere.example/stream").fire("close");
      assert.deepEqual(failed, []);
    });

    test("a new agent socket is announced as it is made, so a refusal left over from the last attempt can be forgotten", () => {
      FakeSocket.instances = [];
      const target: { WebSocket: unknown } = { WebSocket: FakeSocket };
      const started: string[] = [];
      tapVoiceAnswers(target, base, () => {}, undefined, (url) => void started.push(url));
      const Tapped = target.WebSocket as typeof FakeSocket;
      new Tapped("wss://politik.example/api/voice/v1/agent/converse", ["bearer", "proxy"]);
      new Tapped("/api/voice/v1/agent/converse");
      new Tapped("wss://politik.example/api/voice/listen");
      new Tapped("wss://elsewhere.example/stream");
      assert.deepEqual(started, ["wss://politik.example/api/voice/v1/agent/converse", "https://politik.example/api/voice/v1/agent/converse"]);
    });

    test("a start handler that throws does not stop the socket being made", () => {
      FakeSocket.instances = [];
      const target: { WebSocket: unknown } = { WebSocket: FakeSocket };
      tapVoiceAnswers(target, base, () => {}, undefined, () => {
        throw new Error("boom");
      });
      assert.doesNotThrow(() => new (target.WebSocket as typeof FakeSocket)("wss://politik.example/api/voice/v1/agent/converse"));
    });

    test("without a handler nothing is listened for, and one that throws does not disturb the socket", () => {
      FakeSocket.instances = [];
      const plain: { WebSocket: unknown } = { WebSocket: FakeSocket };
      tapVoiceAnswers(plain, base, () => {});
      assert.deepEqual(new (plain.WebSocket as typeof FakeSocket)(agent).events, {});

      const target: { WebSocket: unknown } = { WebSocket: FakeSocket };
      tapVoiceAnswers(target, base, () => {}, () => {
        throw new Error("boom");
      });
      const socket = new (target.WebSocket as typeof FakeSocket)(agent);
      let later = 0;
      socket.addEventListener("close", () => void later++);
      assert.doesNotThrow(() => socket.fire("close"));
      assert.equal(later, 1);
    });
  });

  test("it is installed once, and does nothing without a WebSocket", () => {
    const { target } = install();
    assert.equal(tapVoiceAnswers(target, base, () => {}), false, "already wrapped");
    assert.equal(tapVoiceAnswers({}, base, () => {}), false);
    assert.equal(tapVoiceAnswers(undefined as unknown as { WebSocket?: unknown }, base, () => {}), false);
  });
});

describe("voiceBusyLine: was the voice session refused because Politik is busy?", () => {
  const agent = "wss://politik.example/api/voice/v1/agent/converse";
  const reply = (status: number, body?: unknown) => ({ status, json: async () => (body === undefined ? Promise.reject(new SyntaxError("no body")) : body) });

  test("the page's line is the Worker's busy line, word for word", () => {
    assert.equal(BUSY_LINE, BUSY_REPLY);
  });

  test("a 429 gives the line the Worker sent, read from a plain GET to the https address of the socket", async () => {
    const asked: [string, object | undefined][] = [];
    const line = await voiceBusyLine(agent, async (url, init) => (asked.push([url, init]), reply(429, { error: "Politik is busy — try later." })));
    assert.equal(line, "Politik is busy — try later.");
    assert.equal(asked.length, 1);
    assert.equal(asked[0]![0], "https://politik.example/api/voice/v1/agent/converse");
    assert.equal((asked[0]![1] as { cache?: string }).cache, "no-store");
  });

  test("ws:// is asked as http://", async () => {
    let asked = "";
    await voiceBusyLine("ws://localhost:8787/api/voice/v1/agent/converse", async (url) => (asked = url, reply(426)));
    assert.equal(asked, "http://localhost:8787/api/voice/v1/agent/converse");
  });

  test("a 429 whose body cannot be read, or says nothing, still gives the busy line", async () => {
    assert.equal(await voiceBusyLine(agent, async () => reply(429)), BUSY_LINE);
    assert.equal(await voiceBusyLine(agent, async () => reply(429, { error: "  " })), BUSY_LINE);
    assert.equal(await voiceBusyLine(agent, async () => reply(429, { error: 5 })), BUSY_LINE);
    assert.equal(await voiceBusyLine(agent, async () => reply(429, null)), BUSY_LINE);
  });

  test("any other answer, or no answer at all, is not busy: the plain Talk button takes over as before", async () => {
    for (const status of [426, 503, 502, 200, 500]) assert.equal(await voiceBusyLine(agent, async () => reply(status, { error: "x" })), "", String(status));
    assert.equal(await voiceBusyLine(agent, async () => Promise.reject(new TypeError("offline"))), "");
    assert.equal(await voiceBusyLine("not a url", async () => reply(429)), "", "an address that cannot be read");
  });
});

describe("voiceBusyLine gives up after 5 seconds, so the page is never left waiting", () => {
  const agent = "wss://politik.example/api/voice/v1/agent/converse";
  /** Timers that only run when the test says so. */
  function manual() {
    const waiting = new Map<number, { fn: () => void; ms: number }>();
    let next = 1;
    return {
      waiting,
      options: {
        setTimeout: (fn: () => void, ms: number) => (waiting.set(next, { fn, ms }), next++),
        clearTimeout: (id: unknown) => void waiting.delete(id as number),
      },
      fire: () => {
        for (const [id, timer] of [...waiting]) {
          waiting.delete(id);
          timer.fn();
        }
      },
    };
  }

  test("the default wait is 5 seconds", async () => {
    const clock = manual();
    const answer = voiceBusyLine(agent, async () => ({ status: 429, json: async () => ({ error: "busy" }) }), clock.options);
    assert.deepEqual([...clock.waiting.values()].map((t) => t.ms), [5000]);
    assert.equal(await answer, "busy");
  });

  test("a probe that never answers gives \"\" when the time is up, and the request is aborted", async () => {
    const clock = manual();
    let signal: AbortSignal | undefined;
    const answer = voiceBusyLine(agent, (_url, init) => ((signal = init?.signal), new Promise(() => {})), clock.options);
    assert.equal(signal?.aborted, false);
    clock.fire();
    assert.equal(await answer, "");
    assert.equal(signal?.aborted, true);
  });

  test("an answer whose body never arrives is cut off the same way", async () => {
    const clock = manual();
    const answer = voiceBusyLine(agent, async () => ({ status: 429, json: () => new Promise(() => {}) }), clock.options);
    await new Promise((resolve) => setImmediate(resolve));
    clock.fire();
    assert.equal(await answer, "");
  });

  test("the timer is cleared once there is an answer, and a late failure is not an unhandled rejection", async () => {
    const clock = manual();
    assert.equal(await voiceBusyLine(agent, async () => ({ status: 503, json: async () => ({}) }), clock.options), "");
    assert.equal(clock.waiting.size, 0);
    const slow = manual();
    let reject: (e: Error) => void = () => {};
    const answer = voiceBusyLine(agent, () => new Promise((_resolve, rej) => (reject = rej)), slow.options);
    slow.fire();
    assert.equal(await answer, "");
    reject(new Error("late"));
    await new Promise((resolve) => setImmediate(resolve));
  });

  test("the wait can be set, and a real timer is used when none is given", async () => {
    const clock = manual();
    void voiceBusyLine(agent, () => new Promise(() => {}), { ...clock.options, timeoutMs: 1200 });
    assert.deepEqual([...clock.waiting.values()].map((t) => t.ms), [1200]);
    assert.equal(await voiceBusyLine(agent, () => new Promise(() => {}), { timeoutMs: 20 }), "");
  });
});

describe("busyLineOf: is this answer the Worker's 'Politik is busy' refusal?", () => {
  const reply = (status: number, body?: unknown) => ({ status, json: async () => (body === undefined ? Promise.reject(new SyntaxError("no body")) : body) });

  test("a 429 gives the line from its JSON error, or the fixed busy line when the body says nothing usable", async () => {
    assert.equal(await busyLineOf(reply(429, { error: "Politik is busy — try later." })), "Politik is busy — try later.");
    assert.equal(await busyLineOf(reply(429)), BUSY_LINE);
    assert.equal(await busyLineOf(reply(429, { error: "  " })), BUSY_LINE);
    assert.equal(await busyLineOf(reply(429, null)), BUSY_LINE);
  });

  test("any other status is not a refusal", async () => {
    for (const status of [200, 400, 426, 500, 502, 503]) assert.equal(await busyLineOf(reply(status, { error: "x" })), "", String(status));
    assert.equal(await busyLineOf(undefined as unknown as { status: number; json(): Promise<unknown> }), "");
  });
});
