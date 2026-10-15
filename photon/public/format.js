// Pure helpers for the chat screen: no DOM, no network. The browser loads this file as an ES module (app.js imports
// it) and the tests import it directly. Model text goes in here as plain strings and comes out as data, never as
// markup: app.js turns the data into elements with createElement and textContent.

export const MAX_TURN_CHARS = 600;
export const MAX_HISTORY_TURNS = 8;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// One source marker: [3], or a comma group like [1, 2]. One or two digits and no leading zero, so a year such as
// [2020] or a [0] is left as written.
const CITE = /\[[ \t]*([1-9]\d?(?:[ \t]*,[ \t]*[1-9]\d?)*)[ \t]*\]/g;
// **bold**: text with no space right inside either pair of stars, so "2 ** 3" is left as written. (No lookbehind: it
// would break this whole file on iOS before 16.4.)
const BOLD = /\*\*(\S(?:.*?\S)??)\*\*/g;
const HEADING = /^#{1,6}\s+(.*\S)$/;
const BULLET = /^[-*•]\s+(.*\S)$/;

/** Adds `text` to the end of `out` as a `kind` inline, joining it to a neighbour of the same kind. */
function addText(out, kind, text) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === kind) last.text += text;
  else out.push({ type: kind, text });
}

/** Adds a cite. The space before a marker goes, so the marker sits against the word it supports. */
function addCite(out, n) {
  for (let last = out[out.length - 1]; last && last.type !== "cite"; last = out[out.length - 1]) {
    last.text = last.text.trimEnd();
    if (last.text) break;
    out.pop();
  }
  out.push({ type: "cite", n });
}

/** `text` as inlines of `kind` ("text" or "bold") with its markers cut out as cites. */
function addPieces(out, kind, text) {
  let at = 0;
  for (const marker of text.matchAll(CITE)) {
    addText(out, kind, text.slice(at, marker.index));
    for (const digits of marker[1].split(",")) addCite(out, Number(digits));
    at = marker.index + marker[0].length;
  }
  addText(out, kind, text.slice(at));
}

/** One line (or joined lines) of an answer as inlines: text, bold and cite. Nothing here is ever markup. */
function parseInline(line) {
  const out = [];
  let at = 0;
  for (const bold of line.matchAll(BOLD)) {
    addPieces(out, "text", line.slice(at, bold.index));
    addPieces(out, "bold", bold[1]);
    at = bold.index + bold[0].length;
  }
  addPieces(out, "text", line.slice(at));
  return out;
}

/**
 * The answer's markdown subset (**bold**, "- " bullets, "#" headings, [n] markers, paragraphs) as blocks:
 *   { type: "heading" | "para", inline: Inline[] } or { type: "bullets", items: Inline[][] }
 * where an Inline is { type: "text" | "bold", text } or { type: "cite", n }. Anything else, HTML included, is text.
 */
export function parseAnswer(md) {
  if (typeof md !== "string") return [];
  const blocks = [];
  let para = [];
  let items = null;

  const endPara = () => {
    if (para.length === 0) return;
    const inline = parseInline(para.join(" "));
    if (inline.length) blocks.push({ type: "para", inline });
    para = [];
  };
  const endList = () => {
    if (items && items.length) blocks.push({ type: "bullets", items });
    items = null;
  };

  for (const raw of md.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    if (!line) {
      endPara();
      endList();
    } else if (heading) {
      endPara();
      endList();
      const inline = parseInline(heading[1]);
      if (inline.length) blocks.push({ type: "heading", inline });
    } else if (bullet) {
      endPara();
      (items ??= []).push(parseInline(bullet[1]));
    } else {
      endList();
      para.push(line);
    }
  }
  endPara();
  endList();
  return blocks;
}

/** "2026-10-15" (or an ISO timestamp that starts with it) as "15 Oct 2026", or "" when there is no real date. */
export function formatDay(iso) {
  const match = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(iso.trim()) : null;
  if (!match) return "";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** "2026-10-15" as "Data as of 15 Oct 2026", or "" when there is no usable date (an empty database has none). */
export function formatAsOf(iso) {
  const day = formatDay(iso);
  return day ? `Data as of ${day}` : "";
}

/** `text` cut to at most `max` characters, never between the two halves of an emoji. */
function clip(text, max) {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

/** One earlier turn as /api/ask takes it: the role and the text, at most 600 characters. */
export function historyTurn(role, text) {
  return { role, text: clip(typeof text === "string" ? text.trim() : "", MAX_TURN_CHARS) };
}

const SPOKEN_MAX_CHARS = 600;
const SPOKEN_FALLBACK_TITLES = 3;
const SPOKEN_FALLBACK_LEAD = "I couldn't write a summary just now.";

/**
 * The answer as plain sentences to read aloud: no markers, no markdown, each heading or bullet a sentence of its own,
 * cut at a sentence end to at most `max` characters. (The Worker does the same for the voice agent; this is for the
 * plain Talk button, which sends text to /api/voice/speak as it is.)
 */
export function spokenText(md, max = SPOKEN_MAX_CHARS) {
  const plain = (inline) => inline.filter((part) => part.type !== "cite").map((part) => part.text).join("").trim();
  const lines = [];
  for (const block of parseAnswer(md)) {
    for (const line of block.type === "bullets" ? block.items.map(plain) : [plain(block.inline)]) {
      if (line) lines.push(/[.!?:]["')\]]*$/.test(line) ? line : `${line.replace(/[,;]+$/, "")}.`);
    }
  }
  const text = lines.join(" ");
  if (text.length <= max) return text;
  const head = clip(text, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return end > 0 ? head.slice(0, end + 1) : head;
}

/**
 * What a response sounds like. An answer is `spokenText(reply)`. A fallback that has records names them, as the Worker
 * does for the voice agent (photon/src/chat/spoken.ts): "I couldn't write a summary just now. The most relevant records are
 * SB 53, SB 1047 and PDPA." `view` needs `reply`, and `mode` and `citations` for a fallback.
 */
export function spokenReply(view, max = SPOKEN_MAX_CHARS) {
  const reply = view && typeof view.reply === "string" ? view.reply : "";
  const citations = view && Array.isArray(view.citations) ? view.citations : [];
  if (!view || view.mode !== "fallback" || citations.length === 0) return spokenText(reply, max);
  const titles = citations
    .slice(0, SPOKEN_FALLBACK_TITLES)
    .map((c) => String((c && (typeof c.shortTitle === "string" && c.shortTitle.trim() ? c.shortTitle : c.title)) || "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, ""))
    .filter(Boolean);
  if (titles.length === 0) return spokenText(reply, max);
  const list = titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
  return spokenText(`${SPOKEN_FALLBACK_LEAD} The most relevant records are ${list}.`, max);
}

/** The type of the frame the Worker sends down the voice socket with the full answer to a spoken question (photon/src/voice.ts). */
export const VOICE_ANSWER_TYPE = "PolitikAnswer";

/**
 * A frame from the voice socket as a spoken question's answer: `{ question, response }`, or null when it is any other
 * frame (audio, or the agent's own JSON) or is not shaped like one. Nothing in it is trusted yet: the page reads
 * `response` with the same checks it gives an /api/ask reply.
 */
export function voiceAnswerOf(data) {
  if (typeof data !== "string" || !data.includes(VOICE_ANSWER_TYPE)) return null;
  let frame;
  try {
    frame = JSON.parse(data);
  } catch (err) {
    return null;
  }
  if (!frame || typeof frame !== "object" || frame.type !== VOICE_ANSWER_TYPE) return null;
  if (typeof frame.question !== "string" || !frame.question.trim()) return null;
  if (!frame.response || typeof frame.response !== "object") return null;
  return { question: frame.question.trim(), response: frame.response };
}

/** True when `url` is the voice agent's socket on this site (the path /api/voice/...), so the page reads answers off it. */
export function isVoiceSocketUrl(url, base) {
  try {
    return new URL(String(url), base).pathname.startsWith("/api/voice/");
  } catch (err) {
    return false;
  }
}

/** What the Worker says when it will not open a voice session (or answer a question) because the caller is over the limit: the same line as photon/src/limit.ts. */
export const BUSY_LINE = "Politik is busy — please try again in a minute.";

/** True when `url` is the voice agent's socket (the one that opens a Deepgram agent session), not the listen-only socket of the plain Talk button. */
function isVoiceAgentUrl(url, base) {
  try {
    return new URL(String(url), base).pathname.startsWith("/api/voice/v1/agent/");
  } catch (err) {
    return false;
  }
}

/**
 * Makes every socket that `target` (the window) opens to /api/voice/... also report the answer frames it receives to
 * `onAnswer(question, response)`, by replacing `target.WebSocket` with a subclass. It changes nothing else about a
 * socket, and a handler that throws does not disturb it. It must run before the voice widget connects. Returns false
 * when there is no WebSocket to wrap or it was already wrapped.
 *
 * With `onFailed(socketUrl)`, an agent socket that fails without ever opening is reported once, with its address. The
 * Worker refuses a session over the rate limit with an HTTP 429 before the upgrade, and a browser tells the page nothing
 * of why a handshake failed, so `voiceBusyLine` asks the address again to find out.
 */
export function tapVoiceAnswers(target, base, onAnswer, onFailed) {
  const Native = target && target.WebSocket;
  if (typeof Native !== "function" || Native.politikTapped) return false;
  class TappedWebSocket extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      if (!isVoiceSocketUrl(url, base)) return;
      this.addEventListener("message", function (event) {
        const answer = voiceAnswerOf(event.data);
        if (!answer) return;
        try {
          onAnswer(answer.question, answer.response);
        } catch (err) {}
      });
      if (typeof onFailed !== "function" || !isVoiceAgentUrl(url, base)) return;
      let opened = false;
      let reported = false;
      const failed = function () {
        if (opened || reported) return;
        reported = true;
        try {
          onFailed(new URL(String(url), base).href);
        } catch (err) {}
      };
      this.addEventListener("open", function () {
        opened = true;
      });
      this.addEventListener("error", failed);
      this.addEventListener("close", failed);
    }
  }
  TappedWebSocket.politikTapped = true;
  target.WebSocket = TappedWebSocket;
  return true;
}

/**
 * The line to show when the Worker refused to open the voice session `socketUrl` because Politik is busy, else "". The
 * Worker answers an over-limit caller with a 429 and a JSON `error` to any request for that address, so a plain GET
 * (`doFetch`, the page's fetch) finds out what the socket's failed handshake cannot say. Any other answer, or none, is "".
 */
export async function voiceBusyLine(socketUrl, doFetch) {
  try {
    const url = new URL(String(socketUrl));
    url.protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
    const res = await doFetch(url.href, { cache: "no-store" });
    if (!res || res.status !== 429) return "";
    let line = "";
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") line = body.error.trim();
    } catch (err) {}
    return line || BUSY_LINE;
  } catch (err) {
    return "";
  }
}
