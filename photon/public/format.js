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

/** "2026-10-15" as "Data as of 15 Oct 2026", or "" when there is no usable date (an empty database has none). */
export function formatAsOf(iso) {
  const match = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(iso.trim()) : null;
  if (!match) return "";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `Data as of ${day} ${MONTHS[month - 1]} ${year}`;
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
