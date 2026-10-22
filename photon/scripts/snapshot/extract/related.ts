// Links between records (spec 5.3 `related`): another record of the same jurisdiction whose bill number ("SB 1047",
// "Senate Bill 1047") or Act short title ("Personal Data Protection Act", without its year) appears in this record's text.
// The relation is always `related`. It is called once, after the build knows which records were built, so a link can only
// point at a record that is in the snapshot.
// Node-only build code: never import this from photon/src.
import type { Jurisdiction } from "../../../src/data/schema.ts";

export type RelatedItem = { id: string; jurisdiction: Jurisdiction; title: string; shortTitle?: string; text: string };
export type RelatedLinks = Map<string, { id: string; relation: "related" }[]>;

/** The measure types of the California Legislature: the abbreviation, and how a document spells it out. */
const MEASURES: Record<string, string> = {
  SB: "Senate Bill",
  AB: "Assembly Bill",
  SCR: "Senate Concurrent Resolution",
  ACR: "Assembly Concurrent Resolution",
  SJR: "Senate Joint Resolution",
  AJR: "Assembly Joint Resolution",
  SCA: "Senate Constitutional Amendment",
  ACA: "Assembly Constitutional Amendment",
};
const BY_NAME = new Map(Object.entries(MEASURES).map(([abbr, name]) => [name, abbr]));
const ABBREVIATED = new RegExp(`\\b(${Object.keys(MEASURES).join("|")})\\s?(\\d{1,5})\\b`, "g");
const SPELLED = new RegExp(`\\b(${[...BY_NAME.keys()].join("|")}) (\\d{1,5})\\b`, "g");

/** The bills a text names, as `SB 53`: "SB 53", "SB53" and "Senate Bill 53" all give it. */
function billsNamed(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(ABBREVIATED)) found.add(`${m[1]} ${Number(m[2])}`);
  for (const m of text.matchAll(SPELLED)) found.add(`${BY_NAME.get(m[1]!)} ${Number(m[2])}`);
  return found;
}

/** `Personal Data Protection Act` from `Personal Data Protection Act 2012`; undefined for a title that is not an Act with a year. */
const actShortTitle = (title: string): string | undefined => /^(.*\S\s+Act)\s+\d{4}$/.exec(title.trim())?.[1];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** For each record, the records of its jurisdiction that its text names, by id, each once. */
export function linkRelated(items: RelatedItem[]): RelatedLinks {
  const links: RelatedLinks = new Map();
  const bills = new Map<string, RelatedItem>(); // "SB 53" -> its record
  const acts: { item: RelatedItem; pattern: RegExp }[] = [];
  for (const item of items) {
    if (item.shortTitle && /^[A-Z]{2,3} \d+$/.test(item.shortTitle)) bills.set(`${item.jurisdiction} ${item.shortTitle}`, item);
    const short = actShortTitle(item.title);
    if (short) acts.push({ item, pattern: new RegExp(`(?<![\\w])${escape(short)}(?![\\w])`) });
  }

  for (const item of items) {
    const linked = new Set<string>();
    for (const bill of billsNamed(item.text)) {
      const target = bills.get(`${item.jurisdiction} ${bill}`);
      if (target && target.id !== item.id) linked.add(target.id);
    }
    for (const { item: target, pattern } of acts) {
      if (target.id !== item.id && target.jurisdiction === item.jurisdiction && pattern.test(item.text)) linked.add(target.id);
    }
    links.set(item.id, [...linked].sort().map((id) => ({ id, relation: "related" as const })));
  }
  return links;
}
