// What a page says outside its visible text: its meta description and publish date, the facts at the top of a Singapore
// Statutes Online Act, and the body of a Next.js page whose text is in its script payload. This is the only module that
// queries an HTML DOM (with node-html-parser); the loader (fetch.ts) and the record extractors (extract/) share it.
//
// Dates are read as written, with no timezone conversion. Modified dates (`dateModified`, `article:modified_time`,
// `og:updated_time`) are never a publish date, and neither is the banner date of a pdpc.gov.sg page, which is the date of the
// hub page and not of the document it links to.
// Node-only build code: never import this from photon/src.
import { parse, type HTMLElement } from "node-html-parser";

import { htmlToText } from "./extract.ts";
import {
  CONTENTS_HEADING,
  DESCRIPTION_MIN_WORDS,
  PAGE_DESCRIPTION_HEADING,
  findDates,
  normalise,
  parseDate,
} from "./extract/common.ts";
import { wordCount } from "./passages.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Meta tags

type MetaTag = { name: string; property: string; itemprop: string; content: string };

/** Every <meta> of the page, its name, property and itemprop lower-cased and its content with entities decoded. */
function metaTags(root: HTMLElement): MetaTag[] {
  return root.querySelectorAll("meta").map((el) => ({
    name: (el.getAttribute("name") ?? "").trim().toLowerCase(),
    property: (el.getAttribute("property") ?? "").trim().toLowerCase(),
    itemprop: (el.getAttribute("itemprop") ?? "").trim().toLowerCase(),
    content: el.getAttribute("content") ?? "",
  }));
}

/** The first of `meta[name=description]` and `meta[property=og:description]` with at least 15 words. */
function descriptionOf(metas: MetaTag[]): string | undefined {
  const candidates = [
    ...metas.filter((m) => m.name === "description"),
    ...metas.filter((m) => m.property === "og:description" || m.name === "og:description"),
  ];
  for (const m of candidates) {
    const text = normalise(m.content);
    if (wordCount(text) >= DESCRIPTION_MIN_WORDS) return text;
  }
  return undefined;
}

const PUBLISHED_NAMES = new Set(["date", "dcterms.date", "dc.date.issued", "publish-date", "pubdate"]);

/** Every `datePublished` in the page's JSON-LD blocks (also inside `@graph` and nested objects), in document order. */
function jsonLdPublished(root: HTMLElement): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "datePublished" && typeof value === "string") found.push(value);
        else walk(value);
      }
    }
  };
  for (const script of root.querySelectorAll("script")) {
    if (!/ld\+json/i.test(script.getAttribute("type") ?? "")) continue;
    try {
      walk(JSON.parse(script.rawText));
    } catch {
      /* not JSON: ignore this block */
    }
  }
  return found;
}

const firstDate = (values: Iterable<string | undefined>): string | undefined => {
  for (const v of values) {
    const date = parseDate(v);
    if (date) return date;
  }
  return undefined;
};

/** The Isomer template (mddi.gov.sg, csa.gov.sg) prints the date as `1 October 2024` in a paragraph just after the <h1>. */
function isomerDate(root: HTMLElement): string | undefined {
  const flow = root.querySelectorAll("h1, p");
  const at = flow.findIndex((el) => el.tagName === "H1");
  if (at < 0) return undefined;
  for (const p of flow.slice(at + 1).filter((el) => el.tagName === "P").slice(0, 4)) {
    const text = normalise(p.text);
    if (/^\d{1,2} [A-Za-z]+ \d{4}$/.test(text)) return parseDate(text);
  }
  return undefined;
}

/**
 * The page's meta description (at least 15 words after entities are decoded and whitespace is collapsed) and its publish
 * date as `YYYY-MM-DD`. The date is the first valid of: `article:published_time`; the meta names `date`, `dcterms.date`,
 * `DC.date.issued`, `publish-date`, `pubdate` and `itemprop=datePublished`; JSON-LD `datePublished`; the OAG release-date
 * field; `publish_date` in a Next.js payload (imda.gov.sg); the date paragraph after the <h1> of the Isomer template; the
 * first `<time datetime>`. Either is absent when the page has none. Never throws.
 */
export function pageMeta(html: string): { description?: string; published?: string } {
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return {};
  }
  const metas = metaTags(root);
  const description = descriptionOf(metas);

  const published =
    firstDate(metas.filter((m) => m.property === "article:published_time").map((m) => m.content)) ??
    firstDate(metas.filter((m) => PUBLISHED_NAMES.has(m.name) || m.itemprop === "datepublished").map((m) => m.content)) ??
    firstDate(jsonLdPublished(root)) ??
    firstDate(root.querySelectorAll(".field-name-field-release-date .date-display-single").map((el) => el.getAttribute("content"))) ??
    firstDate([nextPayload(html)?.publishDate]) ??
    isomerDate(root) ??
    firstDate(root.querySelectorAll("time").map((el) => el.getAttribute("datetime")));

  return { ...(description ? { description } : {}), ...(published ? { published } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Next.js pages (imda.gov.sg, pdpc.gov.sg)

/**
 * These sites are built with Next.js and keep the text of a page in the script payload of the HTML, not in its body. The
 * payload is the React Server Components "flight" stream, which the page hands to the browser in pieces:
 * `self.__next_f.push([1, "<chunk>"])`. The chunks together are rows, `<hex id>:<json>` ending in a newline, and text rows,
 * `<hex id>:T<hex byte length>,<that many bytes of text>`, which hold the long strings; a row refers to a text row as
 * `"$<hex id>"`. A page's text is in the `section_description` of each of its sections (IMDA) or in a `content` that is a
 * reference to a text row (PDPC), as HTML; `page_title` and `publish_date` sit in one object.
 */
const PUSH = /self\.__next_f\.push\((\[(?:[^\]"]|"(?:[^"\\]|\\.)*")*\])\)/g;

function flightStream(html: string): string | undefined {
  if (!html.includes("__next_f")) return undefined;
  let stream = "";
  let found = false;
  for (const m of html.matchAll(PUSH)) {
    try {
      const chunk = JSON.parse(m[1]!) as unknown;
      if (Array.isArray(chunk) && chunk[0] === 1 && typeof chunk[1] === "string") {
        stream += chunk[1];
        found = true;
      }
    } catch {
      /* not a chunk we can read */
    }
  }
  return found ? stream : undefined;
}

const HEX = /^[0-9a-f]+$/;

interface FlightRows {
  /** The rows that are JSON, by id. */
  json: Map<string, unknown>;
  /** Their ids in stream order, which is not page order: React sends a slow part of the page after the parts around it. */
  order: string[];
  /** The text rows, by id. */
  text: Map<string, string>;
}

function flightRows(stream: string): FlightRows {
  const bytes = Buffer.from(stream, "utf8");
  const rows: FlightRows = { json: new Map(), order: [], text: new Map() };
  let pos = 0;
  while (pos < bytes.length) {
    if (bytes[pos] === 0x0a) {
      pos++;
      continue;
    }
    const colon = bytes.indexOf(0x3a, pos);
    const id = colon < 0 ? "" : bytes.toString("utf8", pos, colon);
    if (!HEX.test(id)) {
      const newline = bytes.indexOf(0x0a, pos); // out of step: skip the rest of this line
      if (newline < 0) break;
      pos = newline + 1;
      continue;
    }
    const start = colon + 1;
    if (bytes[start] === 0x54) {
      const comma = bytes.indexOf(0x2c, start);
      const length = comma < 0 ? "" : bytes.toString("utf8", start + 1, comma);
      if (HEX.test(length)) {
        const end = comma + 1 + parseInt(length, 16);
        rows.text.set(id, bytes.toString("utf8", comma + 1, end));
        pos = end;
        continue;
      }
    }
    const newline = bytes.indexOf(0x0a, start);
    const end = newline < 0 ? bytes.length : newline;
    const raw = bytes.toString("utf8", start, end);
    pos = end + 1;
    if (raw[0] === "[" || raw[0] === "{") {
      try {
        rows.json.set(id, JSON.parse(raw));
        rows.order.push(id);
      } catch {
        /* a row we cannot read */
      }
    }
  }
  return rows;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface NextPayload {
  /** `page_title` of the object that holds `publish_date`. */
  pageTitle?: string;
  /** `publish_date` as written, such as `25 May 2022`. */
  publishDate?: string;
  /** The page's sections as HTML, each section's title (if it has one) as an <h2> in front of its text; "" if there is none. */
  bodyHtml: string;
}

/** What the Next.js payload of a page holds (see above). `null` for a page without one, or one with none of these. */
export function nextPayload(html: string): NextPayload | null {
  const stream = flightStream(html);
  if (stream === undefined) return null;
  const { json, order, text } = flightRows(stream);

  let pageTitle: string | undefined;
  let publishDate: string | undefined;
  const sections: string[] = [];
  const asHtml = (value: unknown, onlyReference: boolean): string | undefined => {
    if (typeof value !== "string") return undefined;
    const ref = /^\$([0-9a-f]+)$/.exec(value);
    const resolved = ref ? text.get(ref[1]!) : onlyReference ? undefined : value;
    return resolved && resolved.trimStart().startsWith("<") ? resolved : undefined;
  };
  // Page order, not stream order: start at the root row (0) and expand each reference to another row where it stands.
  const expanded = new Set<string>();
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      const ref = /^\$[L@]?([0-9a-f]+)$/.exec(node)?.[1];
      if (ref && json.has(ref) && !expanded.has(ref)) {
        expanded.add(ref);
        walk(json.get(ref));
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    // The page's own date sits in the object that also has its title; a related-news card has a date and no page_title.
    if (
      publishDate === undefined &&
      typeof o.publish_date === "string" &&
      o.publish_date.trim() &&
      !o.publish_date.startsWith("$") &&
      typeof o.page_title === "string" &&
      !o.page_title.startsWith("$")
    ) {
      publishDate = o.publish_date.trim();
      pageTitle = normalise(o.page_title);
    }
    const body = asHtml(o.section_description, false) ?? asHtml(o.content, true);
    if (body) {
      const title = typeof o.section_title === "string" && !o.section_title.startsWith("$") ? normalise(o.section_title) : "";
      sections.push(`${title ? `<h2>${escapeHtml(title)}</h2>\n` : ""}${body}`);
    }
    for (const value of Object.values(o)) walk(value);
  };
  for (const id of ["0", ...order]) {
    if (expanded.has(id) || !json.has(id)) continue;
    expanded.add(id);
    walk(json.get(id)); // the rest, in stream order, for rows the root does not lead to
  }

  if (publishDate === undefined && sections.length === 0) return null;
  return { ...(pageTitle ? { pageTitle } : {}), ...(publishDate ? { publishDate } : {}), bodyHtml: sections.join("\n") };
}

// ---------------------------------------------------------------------------------------------------------------------
// Singapore Statutes Online

export interface SsoFacts {
  /** The long title with the amendment cites (such as `[22/2016]`) taken out. */
  longTitle?: string;
  /** The pieces of the long title between the removed cites, each as the page writes it, so that each is verbatim. */
  longTitleParts: string[];
  commencement?: { date: string; written: string };
  assent?: { date: string; written: string };
  /** The table of contents in page order: Parts (`Part 4 COLLECTION, USE AND DISCLOSURE OF PERSONAL DATA`) and sections (`13 Consent required`). */
  toc: { kind: "part" | "section"; text: string }[];
}

const AMEND_NOTE = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bamendNote\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi;

/** The first date in the text of the first element that has one, with the way the page writes it. */
function firstDateIn(elements: HTMLElement[], after?: RegExp): { date: string; written: string } | undefined {
  for (const el of elements) {
    let text = normalise(el.text);
    if (after) {
      const m = after.exec(text);
      if (!m) continue;
      text = text.slice(m.index + m[0].length);
    }
    const found = findDates(text)[0];
    if (found) return { date: found.iso, written: found.written };
  }
  return undefined;
}

/**
 * The facts at the top of a Singapore Statutes Online Act: the long title (`td.longTitle`, without the nested
 * `div.amendNote` cites), the first commencement (`td.cDate` of a revised edition, else `div.cDateL` of the original
 * format), the assent (`td.PADate`, else `div.sigDate`; a revised edition shows none) and the table of contents: Parts from
 * `a.nav-link[href^="#P"] > b` (a Part with no title, or a Division, is left out) and sections from
 * `a.nav-link[href^="#pr"][data-part] span`. The site loads most of an Act by script, but the front matter and the whole
 * table of contents are in the page itself. `null` when the page has none of these.
 */
export function ssoFacts(html: string): SsoFacts | null {
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return null;
  }

  const titleCell = root.querySelector("td.longTitle");
  const longTitleParts = titleCell
    ? titleCell.innerHTML
        .split(AMEND_NOTE)
        .map((piece) => normalise(htmlToText(piece)))
        .filter(Boolean)
    : [];
  const longTitle = longTitleParts.length > 0 ? longTitleParts.join(" ") : undefined;

  const commencement = firstDateIn(root.querySelectorAll("td.cDate")) ?? firstDateIn(root.querySelectorAll("div.cDateL"));
  const assent =
    firstDateIn(root.querySelectorAll("td.PADate"), /assented to by the President on\s+/i) ?? firstDateIn(root.querySelectorAll("div.sigDate"));

  const toc: SsoFacts["toc"] = [];
  const seen = new Set<string>();
  for (const a of root.querySelectorAll('a.nav-link[href^="#P"], a.nav-link[href^="#pr"][data-part]')) {
    const href = a.getAttribute("href") ?? "";
    const kind = href.startsWith("#pr") ? "section" : "part";
    const text = normalise((kind === "section" ? a.querySelector("span") : a.querySelector("b"))?.text ?? "");
    if (!text || (kind === "part" && !/^Part\s+\S+\s+\S/.test(text))) continue;
    if (seen.has(`${kind}:${text}`)) continue;
    seen.add(`${kind}:${text}`);
    toc.push({ kind, text });
  }

  const has = longTitle !== undefined || commencement || assent || toc.length > 0 || root.querySelector("td.cDate, div.cDateL, td.PADate, div.sigDate");
  if (!has) return null;
  return {
    ...(longTitle ? { longTitle } : {}),
    longTitleParts,
    ...(commencement ? { commencement } : {}),
    ...(assent ? { assent } : {}),
    toc,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The text of an HTML page

const withoutEllipsis = (text: string) => text.replace(/\s*(?:…|\.\.\.)$/, "");

/**
 * Sections that make facts outside a page's visible body citable (spec 5.2), each in the publisher's own words: `# Page
 * description` and the meta description (when it is at least 15 words), and for a Statutes Online Act `# Contents` and one
 * paragraph per table-of-contents entry. Whatever the body already holds is left out: a description that is the start of a
 * body paragraph (even if cut off with an ellipsis), and each contents entry that occurs in the body. "" when there is none.
 */
export function pageBlocks(html: string, body: string): string {
  const flat = normalise(body);
  const blocks: string[] = [];

  const description = pageMeta(html).description;
  if (description && !flat.includes(normalise(withoutEllipsis(description)))) blocks.push(`# ${PAGE_DESCRIPTION_HEADING}\n\n${description}`);

  const missing = (ssoFacts(html)?.toc ?? []).map((e) => e.text).filter((entry) => !flat.includes(entry));
  if (missing.length > 0) blocks.push(`# ${CONTENTS_HEADING}\n\n${missing.join("\n\n")}`);

  return blocks.join("\n\n");
}

/**
 * The text of an HTML page for the record store. `body` is the page's visible text (`htmlToText`, list items marked with a
 * bullet) and, for a Next.js page whose text is in its script payload and not in its body, that text in front of it, under
 * the page's title; this is what the 150-word gate counts. `text` is `body` with the `pageBlocks` in front.
 */
export function htmlPageText(html: string): { text: string; body: string } {
  const visible = htmlToText(html, { bullets: true });
  let body = visible;

  const next = nextPayload(html);
  if (next && next.bodyHtml) {
    const payloadText = htmlToText(next.bodyHtml, { bullets: true });
    if (wordCount(payloadText) > wordCount(visible)) {
      let title = next.pageTitle;
      if (!title) {
        try {
          title = normalise(parse(html).querySelector("h1")?.text ?? "");
        } catch {
          title = undefined;
        }
      }
      body = [title ? `# ${title}` : "", payloadText, visible].filter(Boolean).join("\n\n");
    }
  }

  const blocks = pageBlocks(html, body);
  return { text: blocks ? `${blocks}\n\n${body}` : body, body };
}
