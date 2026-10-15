import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Static checks on the chat screen's files. What the screen does in a browser is covered by the smoke test
// (Playwright against `wrangler dev`); these pin the things a diff could quietly undo.
const publicDir = fileURLToPath(new URL("../../photon/public/", import.meta.url));
const read = (name: string) => readFileSync(publicDir + name, "utf8");

describe("the onboarding flow is gone", () => {
  test("the onboarding page, script and styles are deleted", () => {
    for (const name of ["onboard.html", "onboard.js", "onboard.css"]) assert.equal(existsSync(publicDir + name), false, name);
  });

  test("the chat page does not send anyone to /onboard", () => {
    const html = read("index.html");
    assert.doesNotMatch(html, /onboard/i);
    assert.doesNotMatch(html, /politik-who/);
  });

  test("the app has no profile: no readWho, who, or assistant titles", () => {
    const js = read("app.js");
    assert.doesNotMatch(js, /politik-who|readWho|onboard/);
    assert.doesNotMatch(js, /\bwho\b/);
    assert.doesNotMatch(js, /\btitles\b/);
    assert.doesNotMatch(js, /\bcategory\b|\bdata\.items\b|CATEGORY_LABELS/, "the old response contract is gone");
  });

  test("the service worker no longer caches the onboarding files", () => {
    assert.doesNotMatch(read("sw.js"), /onboard/);
    assert.doesNotMatch(read("manifest.webmanifest"), /onboard/);
  });
});

describe("the chat page loads the new front end", () => {
  test("app.js is a module (it imports format.js), and the page loads it as one", () => {
    assert.match(read("index.html"), /<script\s+type="module"\s+src="\/app\.js"\s*><\/script>/);
    assert.match(read("app.js"), /import\s*\{[^}]*\bparseAnswer\b[^}]*\}\s*from\s*"\/format\.js"/);
  });

  test("the service worker caches format.js, under a newer cache name than v24", () => {
    const sw = read("sw.js");
    assert.match(sw, /"\/format\.js"/);
    const version = Number(/politik-shell-v(\d+)/.exec(sw)?.[1]);
    assert.ok(version > 25, `cache version ${version}: the shell changed (voice, cards, categorisation page), so it must be a new one`);
  });

  test("the empty state names the three example questions from the spec", () => {
    const html = read("index.html");
    for (const question of ["What's going on in California AI policy?", "Explain Singapore's PDPA", "What does SB 53 mean for a state agency?"]) {
      assert.ok(html.includes(question), question);
    }
  });

  test("the fixed copy is used as written", () => {
    const js = read("app.js");
    assert.ok(js.includes("Not from Politik's sources — unverified"));
    assert.ok(js.includes("Hi — ask me what's going on in California or Singapore tech policy."));
    assert.ok(js.includes("Public post · Bluesky"));
    assert.ok(js.includes("✓ Reviewed") && js.includes("Auto-checked"));
  });
});

describe("I3: a spoken question runs the pipeline once", () => {
  const js = read("app.js");

  test("the voice widget does not hand its user turns to the chat: no onMessage handler, so no second /api/ask", () => {
    assert.doesNotMatch(js, /onMessage/);
    assert.doesNotMatch(js, /voiceTurn/);
  });

  test("the widget is not given the /api/voice/think endpoint: the agent asks the Worker through the politik function, whose answer the page is sent", () => {
    assert.doesNotMatch(js, /\/api\/voice\/think/);
    assert.doesNotMatch(js, /endpoint\s*:/);
  });

  test("/api/ask is asked from only the typed question, a suggestion chip, and the plain Talk button (used when the widget could not load)", () => {
    const calls = [...js.matchAll(/\b(postAsk|renderAsk)\(/g)].map((m) => m[1]);
    // definitions: postAsk, renderAsk; uses: renderAsk in the form submit and in the chip click; postAsk in renderAsk and in finishTurn
    assert.deepEqual(calls.sort(), ["postAsk", "postAsk", "postAsk", "renderAsk", "renderAsk", "renderAsk"]);
    assert.match(js, /async function finishTurn[\s\S]*?postAsk\(message\)/, "the plain Talk button asks once for its own turn");
  });

  test("the answer frames are read off the voice socket before the widget connects, and shown without asking", () => {
    const tap = js.indexOf("tapVoiceAnswers(window, window.location.href, showVoiceAnswer, voiceSocketFailed, voiceSocketStarted);");
    assert.ok(tap > 0);
    assert.ok(tap < js.indexOf("\nmountVoice();"), "the tap is installed before the widget starts");
    const show = /async function showVoiceAnswer[\s\S]*?\n}\n/.exec(js)![0];
    assert.doesNotMatch(show, /postAsk|fetch\(/, "showing a spoken answer asks for nothing");
    assert.match(show, /readReply\(data\)/, "the frame gets the same checks as an /api/ask reply");
    assert.match(show, /appendPhoton\(view\)/);
  });

  test("the spoken text of the plain Talk button names the records of a fallback, as the Worker does", () => {
    assert.match(js, /spokenReply\(view\)/);
    assert.doesNotMatch(js, /spokenText/);
  });
});

describe("a voice session the Worker refuses because Politik is busy", () => {
  const js = read("app.js");

  test("the page learns of a socket that never opened, and asks the same address for the reason with its own fetch", () => {
    assert.match(js, /import\s*\{[^}]*\bvoiceBusyLine\b[^}]*\}\s*from\s*"\/format\.js"/);
    const failed = /function voiceSocketFailed[\s\S]*?\n}\n/.exec(js)![0];
    assert.match(failed, /voiceBusyLine\(url,/);
    assert.match(failed, /fetch\(/);
    assert.match(failed, /showVoiceBusy\(line\)/, "the line is shown only when there is one");
  });

  test("the busy line is shown as an ordinary reply in the transcript, and asks for nothing", () => {
    const show = /async function showVoiceBusy[\s\S]*?\n}\n/.exec(js)![0];
    assert.match(show, /readReply\(/);
    assert.match(show, /appendPhoton\(/);
    assert.doesNotMatch(show, /postAsk|fetch\(|rememberTurn/, "it is not a turn of the conversation");
  });

  test("the plain Talk button does not replace the orb for a refused session: the person can try again in a minute", () => {
    const mount = /function mountVoice\(\) \{[\s\S]*?\n}\n/.exec(js)![0];
    const fallback = /function useFallback\(\) \{[\s\S]*?\n  }\n/.exec(mount)![0];
    assert.match(fallback, /voiceRefusal/, "it waits for the check on the failed socket");
    assert.match(fallback, /if \(line\) \{\s*voiceFailed = false;\s*return;\s*\}/, "busy: no fallback, and a later real failure can still use it");
    assert.ok(fallback.lastIndexOf("swapInFallback()") > fallback.indexOf("if (line)"), "the plain Talk button is mounted after the check, and only when the session was not refused as busy");
    assert.match(mount, /function swapInFallback\(\) \{[\s\S]*?mountFallbackTalk\(host\);/);
  });

  test("the plain Talk button: a listen socket that never opened is checked for a busy refusal, and the line is shown instead of the error", () => {
    const talk = /function mountFallbackTalk[\s\S]*?\nfunction mountVoice/.exec(js)![0];
    assert.match(talk, /function failOnce\(line\)[\s\S]*?if \(line\) showVoiceBusy\(line\);\s*else appendError\(\);/);
    const click = /talkBtn\.addEventListener\("click"[\s\S]*?\n  \}\);/.exec(talk)![0];
    assert.match(click, /listenHref = listenUrl\.href/);
    assert.match(click, /voiceBusyLine\(listenHref,/, "the same plain GET to the socket's address");
    assert.match(click, /opened = true/, "a socket that opened was not refused");
    const caught = click.slice(click.lastIndexOf("} catch (err) {"));
    assert.ok(caught.indexOf("socket.onclose = null") < caught.indexOf("voiceBusyLine("), "the failed handshake's close event must not report a second failure while the check runs");
    assert.match(caught, /failOnce\(line\)/);
  });

  test("the plain Talk button: a spoken reply refused with a 429 shows the busy line, and the answer already on screen stays", () => {
    const play = /async function playReply[\s\S]*?\n  }\n/.exec(js)![0];
    assert.match(play, /res\.status === 429[\s\S]*?showVoiceBusy\(await busyLineOf\(res\)\)/);
    assert.ok(play.indexOf("res.status === 429") < play.indexOf("if (!res.ok)"), "checked before the generic failure");
  });

  test("a refusal left over from an earlier attempt is forgotten when a new one starts: at the widget's token request and at the new agent socket", () => {
    assert.match(js, /function voiceSocketStarted\(\) \{\s*voiceRefusal = null;\s*\}/);
    const token = /tokenFactory: function \(\) \{[\s\S]*?\n      \},/.exec(js)![0];
    assert.ok(token.indexOf("voiceRefusal = null") > 0 && token.indexOf("voiceRefusal = null") < token.indexOf("fetch("), "cleared before the token is asked for");
  });

  test("the check on a refused session has a 5 second limit, so the Talk button and the fallback never wait on it for ever", () => {
    assert.match(read("format.js"), /const PROBE_TIMEOUT_MS = 5000;/);
    const talk = /function mountFallbackTalk[\s\S]*?\nfunction mountVoice/.exec(js)![0];
    assert.match(talk, /line = await voiceBusyLine\(listenHref,[\s\S]*?\n      \}\n      failOnce\(line\);/, "the label goes back to Talk when the check is over, answered or not");
  });

  test("the service worker has a new cache name for the changed shell", () => {
    assert.ok(Number(/politik-shell-v(\d+)/.exec(read("sw.js"))?.[1]) >= 29);
  });
});

describe("M6: a card's fetched date is written like the footer's", () => {
  test("the card formats the day with formatDay (D Mon YYYY), not the raw ISO date", () => {
    const js = read("app.js");
    assert.match(js, /formatDay\(fetchedDay\(cite\.fetched\)\)/);
    assert.match(js, /"Fetched " \+ day/);
  });
});

describe("M7: the Categorisation page describes the new Ask pipeline", () => {
  const html = read("jev.html");

  test("the Ask path names route, find records, rank, Groq's cited answer and the citation check", () => {
    const ask = /<h2>Ask<\/h2>[\s\S]*?<\/ol>/.exec(html)![0];
    for (const step of [/Route/, /Find records/, /Rank/, /Groq writes a cited answer/, /Citations are checked/]) assert.match(ask, step);
  });

  test("the old text is gone: no 'OpenAI writes the line' and no 'Question keeps the desk'", () => {
    assert.doesNotMatch(html, /OpenAI writes the line/);
    assert.doesNotMatch(html, /Question keeps the desk/);
  });
});

describe("after a service worker update", () => {
  /** Runs sw.js against a stub worker scope, fires `activate` with open windows at `urls`, and returns the urls that were navigated. */
  async function navigatedOnActivate(urls: string[]): Promise<string[]> {
    const handlers: Record<string, (event: { waitUntil(work: Promise<unknown>): void }) => void> = {};
    const navigated: string[] = [];
    const windows = urls.map((url) => ({ url, navigate: async (to: string) => void navigated.push(to) }));
    const sandbox = {
      URL,
      Promise,
      self: {
        addEventListener: (type: string, handler: (event: { waitUntil(work: Promise<unknown>): void }) => void) => void (handlers[type] = handler),
        skipWaiting() {},
        clients: { claim: async () => {}, matchAll: async () => windows },
      },
      caches: { keys: async () => ["politik-shell-v24"], delete: async () => true, open: async () => ({ addAll: async () => {} }) },
    };
    vm.runInNewContext(read("sw.js"), sandbox);
    let work: Promise<unknown> = Promise.resolve();
    handlers.activate!({ waitUntil: (p) => void (work = p) });
    await work;
    return navigated;
  }

  test("open chat and map windows are reloaded onto the new page, and other pages are left alone", async () => {
    const navigated = await navigatedOnActivate([
      "https://politik.example/",
      "https://politik.example/map",
      "https://politik.example/sources",
      "https://politik.example/saying",
    ]);
    assert.deepEqual(navigated.sort(), ["https://politik.example/", "https://politik.example/map"]);
  });

  test("a chat window with a query string is reloaded too (the path is what counts)", async () => {
    assert.deepEqual(await navigatedOnActivate(["https://politik.example/?utm=1"]), ["https://politik.example/?utm=1"]);
  });
});

describe("model text never reaches HTML", () => {
  const js = read("app.js");

  test("app.js sets no markup from strings: innerHTML only to clear a node, and no other HTML sinks", () => {
    const assignments = [...js.matchAll(/\.innerHTML\s*(\+?=)\s*([^;\n]*)/g)].map((m) => `${m[1]} ${m[2]!.trim()}`);
    assert.ok(assignments.every((a) => a === '= ""'), `innerHTML assignments: ${assignments.join(" | ")}`);
    for (const sink of ["outerHTML", "insertAdjacentHTML", "document.write", "createContextualFragment", "DOMParser", "eval(", "new Function"]) {
      assert.ok(!js.includes(sink), sink);
    }
  });

  test("format.js builds no markup either", () => {
    const format = read("format.js");
    assert.doesNotMatch(format, /innerHTML|document\.|window\./);
  });
});
