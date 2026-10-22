// Turns fetched HTML and PDF bytes into plain text for the passage splitter.
// Node-only build code: never import this from photon/src.
import { extractText } from "unpdf";

/** Elements whose whole subtree is dropped. */
const SKIP = new Set(["script", "style", "nav", "header", "footer", "noscript", "title", "template"]);
/** Elements whose content is raw text up to the closing tag, so a "<" inside it is not markup. */
const RAW_TEXT = new Set(["script", "style"]);
/** Elements that start and end a paragraph. */
const BLOCK = new Set([
  "p", "div", "section", "article", "main", "aside", "li", "ul", "ol", "dl", "dt", "dd", "blockquote", "pre",
  "table", "thead", "tbody", "tfoot", "tr", "figure", "figcaption", "form", "fieldset", "address", "hr", "br",
  "h5", "h6", "details", "summary", "body", "html",
]);
const HEADING = /^h[1-4]$/;

// A comment, a declaration or processing instruction, or a tag. Quoted attribute values may contain ">".
const MARKUP = /<!--[\s\S]*?-->|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  sect: "§", para: "¶", copy: "©", reg: "®", trade: "™", bull: "•", middot: "·",
  deg: "°", times: "×", euro: "€", pound: "£", laquo: "«", raquo: "»",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const collapse = (text: string) => text.replace(/[\s​‌‍﻿]+/g, " ").trim();

/** What `htmlToText({ bullets: true })` puts in front of a list item, so that a list can be told from paragraphs. */
export const BULLET = "• ";

/** An honorific that ends the text so far: Mr, Mrs, Ms, Mdm, Dr, Prof, Er (with or without a full stop). */
const AFTER_HONORIFIC = /(?:^|[\s>(])(?:Mr|Mrs|Ms|Mdm|Dr|Prof|Er)\.?\s*$/;

/**
 * Plain text from an HTML page. Drops script, style, nav, header, footer and noscript (and the page title),
 * writes h1-h4 as one-line "# " headings, keeps paragraph breaks as blank lines and collapses other whitespace.
 * With `bullets`, each list item starts with "• " (the record extractors read provisions from list items).
 */
export function htmlToText(html: string, options: { bullets?: boolean } = {}): string {
  const blocks: string[] = [];
  let current = "";
  let headingDepth = 0;
  let skipTag = "";
  let skipDepth = 0;

  const flush = () => {
    const text = collapse(decodeEntities(current));
    current = "";
    if (!text || text === BULLET.trim()) return;
    blocks.push(headingDepth > 0 ? `# ${text}` : text);
  };

  let last = 0;
  MARKUP.lastIndex = 0;
  for (let m = MARKUP.exec(html); m; m = MARKUP.exec(html)) {
    const [markup, slash, rawName] = m;
    if (skipDepth === 0) current += html.slice(last, m.index);
    last = m.index + markup.length;
    if (rawName === undefined) continue; // comment, declaration or processing instruction

    const name = rawName.toLowerCase();
    const closing = slash === "/";
    const selfClosing = markup.endsWith("/>");

    if (skipDepth > 0) {
      if (name === skipTag && !selfClosing) skipDepth += closing ? -1 : 1;
      continue;
    }
    if (SKIP.has(name)) {
      if (closing || selfClosing) continue;
      if (RAW_TEXT.has(name)) {
        const end = new RegExp(`</${name}\\s*>`, "gi");
        end.lastIndex = last;
        const found = end.exec(html);
        last = found ? found.index + found[0].length : html.length;
        MARKUP.lastIndex = last;
      } else {
        skipTag = name;
        skipDepth = 1;
      }
      continue;
    }
    if (HEADING.test(name)) {
      flush();
      headingDepth = closing ? 0 : 1;
      continue;
    }
    if (BLOCK.has(name)) {
      // A line break right after an honorific is a layout quirk inside one name ("made by Mrs<br>Josephine Teo"), not a new line.
      if (name === "br" && AFTER_HONORIFIC.test(current)) current += " ";
      else if (headingDepth > 0) current += " ";
      else flush();
      if (options.bullets && name === "li" && !closing && headingDepth === 0) current = BULLET;
      continue;
    }
    if (name === "td" || name === "th") current += " ";
  }
  if (skipDepth === 0) current += html.slice(last);
  flush();

  return blocks.join("\n\n");
}

/** Plain text from a PDF, pages merged. Lines keep their breaks, with runs of spaces collapsed. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The target of an inline link or image, `(url)` or `(url "title")`: one level of parentheses inside the url is allowed.
const LINK_TARGET = String.raw`\(\s*(?:<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)`;
// Link text may hold one level of square brackets, as in `[[1]](url)`.
const LINK_TEXT = String.raw`\[((?:[^\[\]]|\[[^\[\]]*\])*)\]`;
const IMAGE = new RegExp(String.raw`!${LINK_TEXT}${LINK_TARGET}`, "g");
const LINK = new RegExp(`${LINK_TEXT}${LINK_TARGET}`, "g");
// `[1]: https://example.test "title"` on a line of its own: a reference-style link definition.
const LINK_DEFINITION = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*\S+(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/gm;

// Paired emphasis markers: the text inside starts and ends with a character that is not a space or the marker itself, and a
// `_` pair is not part of a word (so `snake_case_name` stays). A lone `*`, a rule of asterisks and an unpaired marker never match.
const BOLD_STARS = /\*\*(?=[^\s*])([^\n]*?[^\s*\\])\*\*/g;
const BOLD_UNDERSCORES = /(?<![\w\\])__(?=[^\s_])([^\n]*?[^\s_\\])__(?!\w)/g;
const ITALIC_STAR = /(?<![\w*\\])\*(?=[^\s*])([^*\n]*[^\s*\\])\*(?![\w*])/g;
const ITALIC_UNDERSCORE = /(?<![\w\\])_(?=[^\s_])([^_\n]*[^\s_\\])_(?!\w)/g;
// A backslash before punctuation is Markdown's escape (`1\.` is "1."), and is dropped; a backslash before a letter is kept.
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!|<>~])/g;

/**
 * Text from a hand-placed Markdown file (such as a Firecrawl capture), ready for the passage splitter: a leading
 * byte-order mark is removed, `[text](url)` becomes `text`, `![alt](url)` images are dropped, bare reference-style
 * link definitions (`[1]: url`) are dropped, paired emphasis markers (`**bold**`, `_italic_`) are removed and backslash
 * escapes (`1\.`) are undone, so that the text reads as the page does. Headings (`# `) are kept, because the splitter reads them.
 */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/^\uFEFF/, "")
    .replace(IMAGE, "")
    .replace(LINK, "$1")
    .replace(LINK_DEFINITION, "")
    .replace(BOLD_STARS, "$1")
    .replace(BOLD_UNDERSCORES, "$1")
    .replace(ITALIC_STAR, "$1")
    .replace(ITALIC_UNDERSCORE, "$1")
    .replace(ESCAPE, "$1");
}
