// The chat screen. index.html loads this as an ES module so it can import the pure helpers in format.js. Whatever the
// model wrote reaches the page through createElement and textContent, never through innerHTML.
import { MAX_HISTORY_TURNS, formatAsOf, formatDay, historyTurn, parseAnswer, spokenReply, tapVoiceAnswers } from "/format.js";

const GREETING = "Hi — ask me what's going on in California or Singapore tech policy.";
const GENERAL_LABEL = "Not from Politik's sources — unverified";
const JURISDICTION_NAMES = { "US-CA": "California", SG: "Singapore" };
const MAX_FOLLOW_UPS = 3;
const HIT_MS = 1800;

const form = document.getElementById("ask-form");
const input = document.getElementById("message");
const button = document.getElementById("ask-btn");
const transcript = document.getElementById("transcript");
const empty = document.getElementById("empty");

function showTranscript() {
  transcript.hidden = false;
  if (empty) empty.hidden = true;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function appendUser(text) {
  transcript.appendChild(el("div", "bubble bubble--user", text));
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}

function wait(ms) {
  return new Promise(function (resolve) {
    window.setTimeout(resolve, ms);
  });
}

function showPending() {
  const pending = el("div", "bubble bubble--photon bubble--pending");
  const dots = el("span", "pending-dots");
  dots.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement("span"));
  pending.appendChild(dots);
  pending.appendChild(el("span", "sr-only", "Looking that up"));
  transcript.appendChild(pending);
  pending.scrollIntoView({ behavior: scrollBehavior(), block: "end" });
  return pending;
}

function clearPending(pending) {
  if (pending && pending.parentNode) pending.remove();
}

// ---- the answer: blocks of text, bold and numbered source buttons ----------------------------------------------

function citeButton(n) {
  const cite = el("button", "cite", String(n));
  cite.type = "button";
  cite.dataset.n = String(n);
  cite.setAttribute("aria-label", "Source " + n);
  return cite;
}

// A [n] button is an atomic inline box, so a line may break on either side of it: the button could end up alone at
// the start of a line, or the full stop after it alone on the next. So the word before a run of buttons and the
// word after it go in one no-wrap span with them.
function appendInline(parent, parts) {
  let glue = null; // the no-wrap span the last [n] button went into
  const put = function (part, text, into) {
    if (!text) return;
    into.appendChild(part.type === "bold" ? el("strong", null, text) : document.createTextNode(text));
  };
  parts.forEach(function (part, i) {
    if (part.type === "cite") {
      if (!glue) {
        glue = el("span", "nobr");
        parent.appendChild(glue);
      }
      glue.appendChild(citeButton(part.n));
      return;
    }
    let text = part.text;
    let before = "";
    const next = parts[i + 1];
    if (next && next.type === "cite") {
      const word = /\S+$/.exec(text);
      if (word) {
        before = word[0];
        text = text.slice(0, word.index);
      }
    }
    const prev = parts[i - 1];
    const after = prev && prev.type === "cite" && glue ? /^\S+/.exec(text) : null;
    if (after) {
      put(part, after[0], glue);
      text = text.slice(after[0].length);
    }
    glue = null;
    put(part, text, parent);
    if (before) {
      glue = el("span", "nobr");
      put(part, before, glue);
      parent.appendChild(glue);
    }
  });
}

function answerBlocks(reply) {
  return parseAnswer(reply).map(function (block) {
    if (block.type === "bullets") {
      const list = el("ul", "answer-list");
      block.items.forEach(function (item) {
        const row = el("li");
        appendInline(row, item);
        list.appendChild(row);
      });
      return list;
    }
    const heading = block.type === "heading";
    const node = el(heading ? "h3" : "p", heading ? "answer-heading" : "answer-para");
    appendInline(node, block.inline);
    return node;
  });
}

// ---- source cards ----------------------------------------------------------------------------------------------

function sentenceCase(value) {
  const text = typeof value === "string" ? value.replace(/-/g, " ").trim() : "";
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function httpUrl(value) {
  try {
    const parsed = new URL(typeof value === "string" ? value.trim() : "");
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch (err) {
    return null;
  }
}

function fetchedDay(value) {
  const match = typeof value === "string" ? /^\d{4}-\d{2}-\d{2}/.exec(value.trim()) : null;
  return match ? match[0] : "";
}

function sourceCard(cite) {
  const card = el("article", "src-card");
  card.id = "src-" + cite.n;
  card.dataset.n = String(cite.n);
  card.tabIndex = -1;

  const head = el("div", "src-head");
  head.appendChild(el("span", "src-num", String(cite.n)));
  const title = el("p", "src-title", cite.title || "Untitled");
  if (cite.shortTitle && cite.shortTitle !== cite.title) title.appendChild(el("span", "src-short", " (" + cite.shortTitle + ")"));
  head.appendChild(title);
  card.appendChild(head);

  if (cite.kind === "post") {
    card.appendChild(el("p", "src-meta", "Public post · Bluesky"));
  } else {
    const meta = [JURISDICTION_NAMES[cite.jurisdiction] || cite.jurisdiction, sentenceCase(cite.type), sentenceCase(cite.status)].filter(Boolean);
    if (meta.length) card.appendChild(el("p", "src-meta", meta.join(" · ")));
    const flags = el("p", "src-flags");
    if (cite.reviewState === "human-reviewed") flags.appendChild(el("span", "src-review src-review--human", "✓ Reviewed"));
    else if (cite.reviewState === "auto-checked") flags.appendChild(el("span", "src-review", "Auto-checked"));
    const day = formatDay(fetchedDay(cite.fetched)); // D Mon YYYY, as the footer shows the data date
    if (day) flags.appendChild(el("span", null, "Fetched " + day));
    if (flags.firstChild) card.appendChild(flags);
  }

  if (cite.quote) card.appendChild(el("blockquote", "src-quote", cite.quote));

  const url = httpUrl(cite.url);
  if (url) {
    const link = el("a", "src-link", "Open source — " + url.hostname);
    link.href = url.href;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    card.appendChild(link);
  }
  return card;
}

// Tapping a [n] button scrolls to source card n of the same reply and marks it for a moment.
function goToSource(cite) {
  const block = cite.closest(".reply-block");
  const card = block && block.querySelector('.src-card[data-n="' + cite.dataset.n + '"]');
  if (!card) return;
  card.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  card.classList.add("src-card--hit");
  card.focus({ preventScroll: true });
  window.clearTimeout(card.hitTimer);
  card.hitTimer = window.setTimeout(function () {
    card.classList.remove("src-card--hit");
  }, HIT_MS);
}

// ---- the rest of a reply ---------------------------------------------------------------------------------------

function generalBox(text) {
  const box = el("div", "general");
  box.setAttribute("role", "note");
  box.appendChild(el("p", "general-label", GENERAL_LABEL));
  box.appendChild(el("p", "general-text", text));
  return box;
}

function followUpChips(questions) {
  const wrap = el("div", "followups");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Suggested questions");
  questions.slice(0, MAX_FOLLOW_UPS).forEach(function (question) {
    const chip = el("button", "chip", question);
    chip.type = "button";
    chip.dataset.ask = question;
    wrap.appendChild(chip);
  });
  return wrap;
}

// What the reply needs from the response, defended against a missing or odd field. An answer with no text is an error.
function readReply(data) {
  const reply = data && typeof data.reply === "string" ? data.reply : "";
  if (!reply.trim()) throw new Error("empty reply");
  const list = function (value) {
    return Array.isArray(value) ? value : [];
  };
  return {
    reply: reply,
    mode: typeof data.mode === "string" ? data.mode : "",
    citations: list(data.citations).filter(function (cite) {
      return cite && typeof cite === "object" && Number.isInteger(cite.n);
    }),
    general: typeof data.general === "string" ? data.general.trim() : "",
    followUps: list(data.followUps).filter(function (question) {
      return typeof question === "string" && question.trim();
    }),
    asOf: formatAsOf(data.asOf),
  };
}

// Shows the blocks of the answer one after another, then everything below them at once. Skipped for reduced motion.
async function reveal(block, parts, tail) {
  if (prefersReducedMotion()) return;
  parts.concat(tail).forEach(function (node) {
    node.classList.add("rv");
  });
  void block.offsetWidth; // let the hidden state paint before it changes
  const step = Math.min(160, Math.max(60, Math.round(700 / Math.max(parts.length, 1))));
  for (let i = 0; i < parts.length; i++) {
    parts[i].classList.add("rv--in");
    await wait(step);
  }
  tail.forEach(function (node) {
    node.classList.add("rv--in");
  });
}

async function appendPhoton(view) {
  // Earlier replies keep their cards, but the newest reply owns the #src-n ids and the suggested questions.
  transcript.querySelectorAll(".src-card[id]").forEach(function (card) {
    card.removeAttribute("id");
  });
  transcript.querySelectorAll(".followups").forEach(function (chips) {
    chips.remove();
  });

  const block = el("div", "reply-block");
  const bubble = el("div", "bubble bubble--photon bubble--answer");
  const parts = answerBlocks(view.reply);
  parts.forEach(function (part) {
    bubble.appendChild(part);
  });
  block.appendChild(bubble);

  const tail = [];
  if (view.general) tail.push(generalBox(view.general));
  if (view.citations.length) {
    const sources = el("section", "sources");
    sources.setAttribute("aria-label", "Sources");
    sources.appendChild(el("h2", "sources-title", "Sources"));
    view.citations.forEach(function (cite) {
      sources.appendChild(sourceCard(cite));
    });
    tail.push(sources);
  }
  if (view.followUps.length) tail.push(followUpChips(view.followUps));
  if (view.asOf) tail.push(el("p", "asof", view.asOf));
  tail.forEach(function (node) {
    block.appendChild(node);
  });

  transcript.appendChild(block);
  block.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  await reveal(block, parts, tail);
}

let reachNoted = false;

function appendError() {
  if (reachNoted) return;
  reachNoted = true;
  transcript.appendChild(el("div", "bubble bubble--photon", "I could not reach Politik. Try again."));
}

// ---- asking ----------------------------------------------------------------------------------------------------

const turns = [];

function rememberTurn(message, reply) {
  turns.push(historyTurn("user", message), historyTurn("assistant", reply));
  while (turns.length > MAX_HISTORY_TURNS) turns.shift();
}

function askBody(message, knowledge) {
  const payload = { message, history: turns.slice() };
  if (knowledge) payload.knowledge = knowledge;
  return payload;
}

function readKnowledge() {
  try {
    const raw = sessionStorage.getItem("politik-kb");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (err) {
    return undefined;
  }
  return undefined;
}

async function postAsk(message) {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(askBody(message, readKnowledge())),
  });
  if (!res.ok) throw new Error("ask failed");
  return res.json();
}

async function renderAsk(message) {
  reachNoted = false;
  showTranscript();
  appendUser(message);
  button.disabled = true;
  const pending = showPending();
  try {
    const view = readReply(await postAsk(message));
    clearPending(pending);
    rememberTurn(message, view.reply);
    await appendPhoton(view);
  } catch (err) {
    clearPending(pending);
    appendError();
  } finally {
    button.disabled = false;
  }
}

function voicePrompt() {
  const lines = [
    "You are Politik.",
    "Greetings stay to one short sentence.",
    "Do not recite a briefing unless the person asked a real question.",
  ];
  const knowledge = readKnowledge();
  if (knowledge) {
    lines.push("Session notes:");
    lines.push(JSON.stringify(knowledge));
  }
  return lines.join("\n");
}

function agentSocketBase() {
  const url = new URL("/api/voice", window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

let voiceFailed = false;

// ---- the voice agent's answers -----------------------------------------------------------------------------------
// A spoken question is one run of the chat pipeline, not two. The agent asks the Worker for every real question (a
// "politik" function call on the socket the Worker proxies), the Worker runs the pipeline once, speaks the reply, and
// sends this page the same answer in a "PolitikAnswer" frame down that socket. The widget ignores a frame type it does
// not know and cannot hand a response to the page, so tapVoiceAnswers (format.js) reads the frames off the socket
// instead. The page never calls /api/ask for a spoken question.

async function showVoiceAnswer(question, data) {
  reachNoted = false;
  showTranscript();
  appendUser(question);
  try {
    const view = readReply(data);
    rememberTurn(question, view.reply);
    await appendPhoton(view);
  } catch (err) {
    appendError();
  }
}

function mountFallbackTalk(host) {
  host.innerHTML = "";
  const talkBtn = document.createElement("button");
  talkBtn.type = "button";
  talkBtn.className = "talk-btn";
  talkBtn.textContent = "Talk";
  host.appendChild(talkBtn);

  let busy = false;
  let mediaStream = null;
  let audioContext = null;
  let processor = null;
  let source = null;
  let socket = null;
  let silenceTimer = null;
  let heard = "";

  function setLabel(text) {
    talkBtn.textContent = text;
  }

  function cleanupMic() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    try {
      if (processor) processor.disconnect();
    } catch (err) {}
    try {
      if (source) source.disconnect();
    } catch (err) {}
    try {
      if (audioContext) audioContext.close();
    } catch (err) {}
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (track) {
        track.stop();
      });
    }
    processor = null;
    source = null;
    audioContext = null;
    mediaStream = null;
  }

  function closeSocket() {
    if (!socket) return;
    try {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
    } catch (err) {}
    try {
      socket.close();
    } catch (err) {}
    socket = null;
  }

  function failOnce() {
    cleanupMic();
    closeSocket();
    busy = false;
    setLabel("Talk");
    talkBtn.disabled = false;
    showTranscript();
    appendError();
  }

  function downsample(buffer, inRate, outRate) {
    if (outRate === inRate) return buffer;
    const ratio = inRate / outRate;
    const length = Math.round(buffer.length / ratio);
    const result = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      result[i] = buffer[Math.min(buffer.length - 1, Math.round(i * ratio))] || 0;
    }
    return result;
  }

  function floatTo16(buffer) {
    const out = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, buffer[i]));
      out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return out;
  }

  async function playReply(text) {
    const spoken = (text || "").trim();
    if (!spoken) return;
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken }),
    });
    if (!res.ok) throw new Error("speak");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await new Promise(function (resolve, reject) {
      const audio = new Audio(url);
      audio.onended = function () {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("play"));
      };
      audio.play().catch(reject);
    });
  }

  async function finishTurn(text) {
    cleanupMic();
    closeSocket();
    const message = (text || heard || "").trim();
    if (!message) {
      busy = false;
      setLabel("Talk");
      talkBtn.disabled = false;
      showTranscript();
      appendError();
      return;
    }
    try {
      setLabel("Thinking");
      const view = readReply(await postAsk(message));
      showTranscript();
      appendUser(message);
      rememberTurn(message, view.reply);
      await appendPhoton(view);
      setLabel("Speaking");
      await playReply(spokenReply(view) || GREETING);
    } catch (err) {
      showTranscript();
      appendError();
    } finally {
      busy = false;
      setLabel("Talk");
      talkBtn.disabled = false;
    }
  }

  function armSilence() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(function () {
      finishTurn(heard);
    }, 1400);
  }

  talkBtn.addEventListener("click", async function () {
    if (busy) return;
    reachNoted = false;
    busy = true;
    talkBtn.disabled = true;
    heard = "";
    setLabel("Listening");
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const listenUrl = new URL("/api/voice/listen", window.location.href);
      listenUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(listenUrl.href);
      socket.binaryType = "arraybuffer";

      await new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
          reject(new Error("connect"));
        }, 8000);
        socket.onopen = function () {
          clearTimeout(timer);
          resolve();
        };
        socket.onerror = function () {
          clearTimeout(timer);
          reject(new Error("socket"));
        };
      });

      socket.onmessage = function (event) {
        if (typeof event.data !== "string") return;
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch (err) {
          return;
        }
        if (payload.type === "UtteranceEnd") {
          finishTurn(heard);
          return;
        }
        const alt =
          payload.channel &&
          payload.channel.alternatives &&
          payload.channel.alternatives[0];
        const text = alt && typeof alt.transcript === "string" ? alt.transcript.trim() : "";
        if (!text) return;
        if (payload.is_final || payload.speech_final) {
          heard = (heard + " " + text).trim();
          armSilence();
        }
      };

      socket.onclose = function () {
        if (busy && talkBtn.textContent === "Listening") failOnce();
      };

      audioContext = new AudioContext();
      const inputRate = audioContext.sampleRate;
      source = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silent = audioContext.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = function (event) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        const down = downsample(input, inputRate, 16000);
        socket.send(floatTo16(down).buffer);
      };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(audioContext.destination);
      setTimeout(function () {
        if (busy && talkBtn.textContent === "Listening" && !heard) failOnce();
      }, 12000);
    } catch (err) {
      failOnce();
    }
  });
}

function mountVoice() {
  const host = document.getElementById("voice");
  const widget = window.DeepgramAgent;
  if (!host) return;

  function useFallback() {
    if (voiceFailed) return;
    voiceFailed = true;
    try {
      host.innerHTML = "";
    } catch (err) {}
    mountFallbackTalk(host);
  }

  if (!widget || typeof widget.init !== "function") {
    useFallback();
    return;
  }

  const prompt = voicePrompt();
  try {
    widget.init({
      tokenFactory: function () {
        return fetch("/api/deepgram-token").then(function (res) {
          if (!res.ok) throw new Error("token");
          return res.text();
        });
      },
      url: agentSocketBase(),
      agent: {
        language: "en",
        greeting: GREETING,
        listen: {
          provider: { type: "deepgram", model: "nova-3" },
        },
        think: {
          provider: { type: "open_ai", model: "gpt-4o-mini" },
          prompt: prompt,
        },
        speak: {
          provider: { type: "deepgram", model: "aura-2-thalia-en" },
        },
      },
      overrides: {
        greeting: GREETING,
        systemPrompt: prompt,
      },
      layout: "orb",
      containerId: "voice",
      colorScheme: "light",
      showTranscript: false,
      showTextInput: false,
      showMicToggle: false,
      showSpeakerToggle: false,
      text: {
        name: "Politik",
        startLabel: "Talk",
        stopLabel: "Stop",
        connectingLabel: "Connecting",
        emptyStateHint: "Talk",
      },
      theme: {
        primary: "#1c1915",
        primaryHover: "#2e2a24",
        primaryActive: "#1c1915",
        onPrimary: "#f6f1e7",
        background: "#f6f1e7",
        backgroundRaised: "#fffdf8",
        backgroundInput: "#fffdf8",
        backgroundHover: "#f6f1e7",
        backgroundActive: "#efe6d4",
        text: "#1c1915",
        textMuted: "#5c564c",
        border: "#1c1915",
        userMessageBackground: "#fffdf8",
        userMessageBorder: "#1c1915",
        buttonRadius: "9999px",
        font: '"Source Sans 3", "Segoe UI", sans-serif',
      },
      on: {
        onError: function () {
          useFallback();
        },
        onAgentError: function () {
          useFallback();
        },
      },
    });
  } catch (err) {
    useFallback();
  }

  host.addEventListener("click", function (event) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("button") || !target.closest("canvas")) return;
    const talk = host.querySelector("button");
    if (talk && !talk.disabled) talk.click();
  });
}

// The tap must be in place before the widget opens its socket.
tapVoiceAnswers(window, window.location.href, showVoiceAnswer);
mountVoice();

form.addEventListener("submit", async function (event) {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || button.disabled) return;
  input.value = "";
  await renderAsk(message);
  input.focus();
});

// One listener for the buttons inside replies and the empty state: a [n] button goes to its source, and a question
// chip asks its question.
document.addEventListener("click", function (event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const cite = target.closest(".cite");
  if (cite) {
    goToSource(cite);
    return;
  }
  const chip = target.closest("[data-ask]");
  if (chip && chip.dataset.ask && !button.disabled) renderAsk(chip.dataset.ask);
});
