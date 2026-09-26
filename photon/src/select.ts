import type { Category, ChatTurn, TaggedItem } from "./contracts.ts";
import { loadCatalog } from "./catalog.ts";
import { DATACENTRES } from "./datacentres.ts";

export type Intent = "ask" | "more" | "overview" | "both" | "continue";
export type Relation = "answers" | "related";

export interface Ranked {
  item: TaggedItem;
  relation: Relation;
  score: number;
}

const MIN_SCORE = 0.7;
const BAND = 0.5;
const LIMIT = 5;

const STOP = new Set(
  `a an the of to in on for and or what whats is are was were be do does did like looking give me more updates update overview about how with from that this those these want know catch brief happening going please can you your tell show get some any into over under than then our their its it at by as if so but not have has had will would could should there here when where who why which while during after before also too still yet new latest recent hello hi hey thanks thank okay ok summary another additional further deeper picture big compare across lay out just yo help understand topic explain`.split(
    /\s+/,
  ),
);

const KEEP_SHORT = new Set(["ai", "us", "uk", "eu", "sg"]);

const PLACE_TOKEN = new Set([
  "singapore",
  "sg",
  "california",
  "californian",
  "californians",
  "congress",
  "senate",
  "house",
  "washington",
  "federal",
  "usa",
  "united",
  "states",
  "france",
  "germany",
  "china",
  "india",
  "japan",
  "korea",
  "australia",
  "canada",
  "britain",
  "england",
  "europe",
  "malaysia",
  "indonesia",
]);

const OTHER_PLACES = [
  "france",
  "germany",
  "china",
  "india",
  "japan",
  "korea",
  "australia",
  "canada",
  "britain",
  "england",
  "europe",
  "malaysia",
  "indonesia",
];

const DESK: Record<Category, number> = {
  "bill-stuck": 0,
  speech: 1,
  research: 3,
  "local-worry": 4,
  "lab-money": 5,
  other: 6,
};

const BEATS: Record<string, string> = {
  "briefing-bill-vote":
    "A bill to label AI-generated content cleared committee months ago, and leadership has not scheduled a House floor vote.",
  "briefing-bill-senate-hold":
    "A Senate bill to fund AI job training stalled after markup. Sponsors still lack agreement on who gets the grants.",
  "briefing-nist-speech":
    "A Commerce official said the department will keep updating voluntary AI safety guidelines with industry and universities.",
  "briefing-school-ai-policy":
    "Parents pressed a suburban school board for a written policy on students using AI for homework before fall.",
  "briefing-openalex-safety":
    "Researchers compared how labs test models before release and found wide gaps in checks for harmful outputs.",
  "briefing-lab-chip-round":
    "A semiconductor lab closed a large funding round to build faster AI chips and hire more engineers in the U.S.",
  "briefing-lab-cloud-deal":
    "A major AI lab signed a multi-year cloud contract to train larger models.",
  "briefing-data-center-town":
    "Residents in a Midwestern town are split over a data center plan, between the jobs and worries about water and noise.",
};

export function readIntent(message: string): Intent {
  const text = message
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(what about (it|that|this)|tell me about (it|that|this|the topic)|explain( that| it)?|go on|and|why|how so|say more|the topic)$/.test(
      text,
    )
  ) {
    return "continue";
  }
  const more = /\b(more|another|others|else|additional|further|deeper)\b/i.test(message);
  const overview = /\b(overview|summary|summarise|summarize|landscape|big picture|compare|across)\b/i.test(
    message,
  );
  if (more && overview) return "both";
  if (more) return "more";
  if (overview) return "overview";
  return "ask";
}

export function contentTokens(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of raw) {
    if (STOP.has(token)) continue;
    if (token.length <= 2 && !KEEP_SHORT.has(token)) continue;
    const folded = foldToken(token);
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(folded);
  }
  return out;
}

export function placesIn(text: string): Set<string> {
  const lower = text.toLowerCase();
  const places = new Set<string>();
  if (/\bsingapore\b|\bsg\b/.test(lower)) places.add("SG");
  if (/\bcalifornia\b|\bcalifornians?\b/.test(lower)) places.add("US-CA");
  if (/\b(congress|senate|house|washington|federal|united states|u\.s\.|usa)\b/.test(lower)) {
    places.add("US");
  }
  for (const name of OTHER_PLACES) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) places.add(`name:${name}`);
  }
  return places;
}

function itemPlaces(item: TaggedItem): Set<string> {
  const places = placesIn(
    `${item.title} ${item.plain} ${item.jurisdiction ?? ""} ${item.url ?? ""} ${item.tags.join(" ")}`,
  );
  if (item.jurisdiction === "US-CA" || item.jurisdiction === "SG" || item.jurisdiction === "US") {
    places.add(item.jurisdiction);
  }
  return places;
}

function lastTopicalUserAsk(history: ChatTurn[]): string | undefined {
  const asks = history.filter((turn) => {
    if (turn.role !== "user" || readIntent(turn.text) !== "ask") return false;
    const topic = contentTokens(turn.text).filter((token) => !PLACE_TOKEN.has(token));
    return topic.length > 0 || placesIn(turn.text).size > 0;
  });
  return asks[asks.length - 1]?.text;
}

/** Follow-ups keep the last real question, and add new words only when the new line has some. */
function foldToken(token: string): string {
  if (token === "centre" || token === "centres" || token === "center" || token === "centers") return "center";
  if (token === "datacentre" || token === "datacentres" || token === "datacenter" || token === "datacenters") {
    return "datacenter";
  }
  return token;
}

export function isDataCentreQuestion(question: string): boolean {
  return /data\s*cent|datacent/i.test(question.toLowerCase().replace(/centre/g, "center"));
}

export function wantsExplanation(message: string, intent: Intent): boolean {
  if (intent === "continue") return true;
  return /\b(understand|explain|what is|whats a|what are|help me|tell me)\b/i.test(message.toLowerCase());
}

export function topicQuestion(message: string, history: ChatTurn[]): string {
  if (readIntent(message) === "continue") return lastTopicalUserAsk(history) ?? message;
  if (readIntent(message) === "ask") return message;
  const prior = lastTopicalUserAsk(history);
  if (!prior) return message;
  const extra = contentTokens(message).filter((token) => !PLACE_TOKEN.has(token));
  if (extra.length === 0 && placesIn(message).size === 0) return prior;
  return `${prior} ${message}`;
}

function policySeeking(question: string): boolean {
  return /\b(polic(?:y|ies)|regulations?|laws?|statutes?|bills?|governance|rules?)\b/i.test(question);
}

function policyDoc(item: TaggedItem): boolean {
  if (item.category === "bill-stuck" || item.category === "speech") return true;
  return /\b(polic(?:y|ies)|regulations?|laws?|statutes?|bills?|guidelines?|standards?|congress|legislation|committee|hearing)\b/i.test(
    `${item.title} ${item.plain}`,
  );
}

function siteFits(question: string, item: TaggedItem): boolean {
  if (item.source !== "site") return true;
  const extra = contentTokens(question).filter(
    (token) => !PLACE_TOKEN.has(token) && token !== "data" && token !== "center" && token !== "datacenter",
  );
  if (extra.length === 0) return true;
  const doc = new Set(contentTokens(`${item.title} ${item.plain} ${item.tags.join(" ")}`));
  return extra.some((token) => hasToken(doc, token));
}

function hasToken(doc: Set<string>, token: string): boolean {
  if (doc.has(token)) return true;
  if (doc.has(`${token}s`)) return true;
  if (token.endsWith("s") && token.length > 3 && doc.has(token.slice(0, -1))) return true;
  return false;
}

function scoreItem(question: string, item: TaggedItem): number {
  const topic = contentTokens(question).filter((token) => !PLACE_TOKEN.has(token));
  if (topic.length === 0) return 0;
  const doc = new Set(
    contentTokens(`${item.title} ${item.plain} ${item.tags.join(" ")} ${item.jurisdiction ?? ""}`),
  );
  const title = new Set(contentTokens(item.title));
  let hits = 0;
  let titleHits = 0;
  for (const token of topic) {
    if (hasToken(doc, token)) hits += 1;
    if (hasToken(title, token)) titleHits += 1;
  }
  let score = hits / topic.length + (titleHits / topic.length) * 0.8;
  if (policySeeking(question)) score += policyDoc(item) ? 0.35 : -0.4;
  return score;
}

function relationFor(question: string, item: TaggedItem): Relation {
  const wanted = placesIn(question);
  if (wanted.size === 0) return "answers";
  const found = itemPlaces(item);
  for (const place of wanted) {
    if (found.has(place)) return "answers";
  }
  // A shared topic is not the answer when the question names a place the record does not.
  return "related";
}

function band(rows: Ranked[]): Ranked[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const floor = Math.max(MIN_SCORE, sorted[0].score - BAND);
  return sorted.filter((row) => row.score >= floor);
}

function diversify(rows: Ranked[]): Ranked[] {
  const counts = new Map<string, number>();
  const out: Ranked[] = [];
  for (const row of rows) {
    const key = row.item.source;
    const seen = counts.get(key) ?? 0;
    if (key !== "briefing" && seen >= 2) continue;
    counts.set(key, seen + 1);
    out.push(row);
  }
  return out;
}

export function takeTop(question: string, items: TaggedItem[]): Ranked[] {
  const scored = items
    .filter((item) => item.title.trim() && item.plain.trim())
    .map((item) => ({
      item,
      relation: relationFor(question, item),
      score: scoreItem(question, item),
    }))
    .filter((row) => row.score >= MIN_SCORE && siteFits(question, row.item));
  const answers = diversify(band(scored.filter((row) => row.relation === "answers"))).slice(0, LIMIT);
  if (answers.length >= LIMIT) return answers;
  const related = diversify(band(scored.filter((row) => row.relation === "related")));
  const kept = [...answers];
  for (const row of related) {
    if (kept.length >= LIMIT) break;
    kept.push(row);
  }
  return kept;
}

function desk(item: TaggedItem): number {
  if (item.source === "ca-ag") return 2;
  return DESK[item.category] ?? 6;
}

export function present(rows: Ranked[]): Ranked[] {
  return [...rows].sort((a, b) => {
    if (a.relation !== b.relation) return a.relation === "answers" ? -1 : 1;
    const byDesk = desk(a.item) - desk(b.item);
    if (byDesk !== 0) return byDesk;
    return b.score - a.score;
  });
}

export function catalogItems(): TaggedItem[] {
  return loadCatalog().latest.map((doc, index) => ({
    id: `ca-ag-${index}`,
    source: "ca-ag",
    title: doc.title,
    plain: /catastrophic ai/i.test(doc.title)
      ? "Attorney General Bonta called on Congress to act on catastrophic AI threats."
      : "Press release from the California Attorney General.",
    url: doc.url,
    happenedAt: doc.published,
    jurisdiction: doc.jurisdiction,
    category: "other" as const,
    tags: [],
  }));
}

export function siteItems(): TaggedItem[] {
  return DATACENTRES.map((site) => {
    const state = site.place.split(",").pop()?.trim() ?? "";
    const california = /california/i.test(site.place);
    const underConstruction = /under construction/i.test(site.detail);
    const plain = underConstruction
      ? `Data centre under construction in ${site.place}.`
      : /campus|stargate/i.test(site.detail)
        ? `Data centre in ${site.place}. ${site.detail}.`
        : `Data centre at ${site.detail}, ${site.place}.`;
    return {
      id: site.id,
      source: "site" as const,
      title: `${site.title}, ${site.place}`,
      plain,
      url: site.url,
      jurisdiction: california ? "US-CA" : "US",
      category: "local-worry" as const,
      tags: ["data-center", `state:${state}`],
    };
  });
}

export function focusCentres(items: TaggedItem[]): Ranked[] {
  const rows: Ranked[] = [];
  const dispute = items.find((item) => item.id === "briefing-data-center-town");
  if (dispute) rows.push({ item: dispute, relation: "answers", score: 2 });
  const seen = new Set<string>();
  for (const item of items) {
    if (item.source !== "site") continue;
    const state = item.tags.find((tag) => tag.startsWith("state:"))?.slice(6) ?? "";
    if (!state || seen.has(state)) continue;
    seen.add(state);
    rows.push({ item, relation: "answers", score: 1 });
    if (seen.size >= 4) break;
  }
  return rows;
}

function countText(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function coverageNotes(question: string, items: Ranked[]): string[] {
  if (!placesIn(question).has("SG") || !policySeeking(question)) return [];
  const hasSgAnswer = items.some(
    (row) => row.relation === "answers" && itemPlaces(row.item).has("SG"),
  );
  const official = items.some(
    (row) =>
      row.relation === "answers" &&
      itemPlaces(row.item).has("SG") &&
      row.item.source !== "openalex",
  );
  const catalog = loadCatalog();
  const blocked = catalog.blocked.find((row) => row.jurisdiction === "SG");
  const gebiz = catalog.sources.find((row) => row.id === "gebiz");
  const notes: string[] = [];
  if (blocked && !official) {
    const denied = blocked.error.includes("403");
    notes.push(
      denied
        ? "Singapore Statutes Online returned HTTP 403. I don't have the Attorney-General's Chambers legislation."
        : "Singapore Statutes Online is unavailable. I don't have the Attorney-General's Chambers legislation.",
    );
  }
  if (gebiz && !hasSgAnswer) {
    notes.push(
      `The Singapore records on file are ${countText(gebiz.documents)} GeBIZ procurement notices. They record government purchases.`,
    );
  }
  return notes;
}

export function mismatchNote(question: string, item: TaggedItem): string | undefined {
  const wanted = placesIn(question);
  const found = itemPlaces(item);
  if (wanted.has("SG") && !found.has("SG")) return "Not Singapore";
  if (wanted.has("US-CA") && !found.has("US-CA")) return "Not California";
  if (wanted.has("US") && !found.has("US")) return "Outside that jurisdiction";
  for (const place of wanted) {
    if (place.startsWith("name:") && !found.has(place)) {
      const name = place.slice(5);
      return `Not ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    }
  }
  if (wanted.size > 0) return "Different place";
  return undefined;
}

function beat(item: TaggedItem): string {
  const known = BEATS[item.id];
  if (known) return known;
  if (item.source === "ca-ag" && /catastrophic ai/i.test(`${item.title} ${item.plain}`)) {
    return "Attorney General Bonta called on Congress to act on catastrophic AI threats.";
  }
  const text = item.plain.trim().replace(/\s+/g, " ");
  if (!text) return item.title.trim();
  const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
  if (item.source === "openalex") return `From the research: ${sentence}`;
  if (item.source === "ca-ag") return sentence;
  return sentence;
}

export function discuss(input: {
  question: string;
  notes: string[];
  items: Ranked[];
  withheld: boolean;
  exhausted: boolean;
  explain: boolean;
  earlier: string;
}): string {
  const { question, notes, items, withheld, exhausted, explain, earlier } = input;
  if (explain && isDataCentreQuestion(question)) return explainDataCentres(earlier);
  if (exhausted) {
    return ["That's the full set I have on this.", ...notes].filter(Boolean).join("\n\n");
  }

  const parts: string[] = [];
  if (items.length === 0) {
    if (placesIn(question).has("SG") && policySeeking(question)) {
      parts.push("I don't have Singapore's AI policy in this set.");
    } else if (placesIn(question).has("SG")) {
      parts.push("I don't have a Singapore record that answers that.");
    } else if (!withheld) {
      return "I do not have a fresh update on that yet.";
    } else {
      parts.push("I don't have a record that answers that.");
    }
  }

  parts.push(...notes);
  if (items.length > 0 && placesIn(question).size > 0 && items.every((row) => row.relation === "related")) {
    parts.push("Outside Singapore, this is what the file has.");
  }
  if (withheld && items.length === 0) {
    parts.push("Ask for an overview if you want notes from other places.");
  }
  for (const row of items) parts.push(beat(row.item));
  return parts.join("\n\n");
}

function explainDataCentres(earlier: string): string {
  const saidMap = /servers/i.test(earlier);
  const saidBuild = /under construction|stargate/i.test(earlier);
  if (!saidMap) {
    return [
      "A data centre is a building full of servers.",
      `The set has ${DATACENTRES.length}, all in the western U.S.`,
      "Nevada: Vantage and Apple in Sparks, Switch in Las Vegas.",
      "Arizona: Apple and Meta in Mesa.",
      "California: Equinix in Santa Clara, CoreSite in Los Angeles, and two Digital Realty buildings in San Francisco.",
      "Utah: Meta in Eagle Mountain, the Utah Data Center in Bluffdale, and Creekstone in Delta.",
      "Also CoreSite in Denver, Google in The Dalles, Oregon, Meta in Los Lunas, and Project Jupiter in Santa Teresa, New Mexico.",
      "A separate note has no street address. A Midwestern town heard a proposal. Some people want the jobs and the tax base. Others are worried about water and noise. The note never names the town or records a vote.",
    ].join("\n\n");
  }
  if (!saidBuild) {
    return [
      "Creekstone in Delta, Utah, is still under construction. Project Jupiter in Santa Teresa is a Stargate campus in Doña Ana County. The other sites are already standing, and each one has an address.",
      "The Midwest note only records the argument. Jobs and the tax base on one side. Water and noise on the other. No town name. No vote.",
    ].join("\n\n");
  }
  return `That's the whole of it in this set. ${DATACENTRES.length} western campuses, and one proposal that never names the town.`;
}
