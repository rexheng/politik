// GeBIZ tenders come from the data.gov.sg datastore API (spec 5.2), not from scraping.
// Node-only build code: never import this from photon/src.
import { z } from "zod/v4";

import type { Topic } from "../../src/data/schema.ts";
import type { Candidate } from "./candidates.ts";

/** Tenders kept when the GeBIZ rule has no `max`. */
export const DEFAULT_GEBIZ_MAX = 40;

/** One topic group of the selection rule: its own keywords, and the most tenders it may contribute. */
export interface GebizGroup {
  name: string;
  /** Keywords as in `GebizRule.keywords`. */
  keywords: string[];
  /** Most tenders this group contributes to the selection. */
  quota: number;
  /** The topic given, with gov-tech-procurement, to a tender selected through this group. */
  topic: Topic;
}

export interface GebizRule {
  /** The data.gov.sg dataset (resource) id. */
  datasetId: string;
  /**
   * What a tender's description must contain, as a flat list. A plain keyword matches whole words only, ignoring case
   * (`server` does not match "Observer"); regular-expression characters in it are matched literally. A keyword that
   * contains `\b` is taken as a regular-expression source exactly as written, so it can have alternatives (`cent(?:re|er)`).
   * Give either `keywords` or `groups`.
   */
  keywords?: string[];
  /** The same, split into topic groups with a quota each. A tender needs a keyword of at least one group. */
  groups?: GebizGroup[];
  /** Patterns (same syntax as keywords) matched against the description: a match drops the tender, whatever else matched. */
  exclude?: string[];
  /** Agencies in priority order, as names or parts of names. Breaks ties between tenders awarded the same amount. */
  agencyPriority?: string[];
  /** Earliest award date to keep, as YYYY-MM-DD. */
  since: string;
  /** Smallest award to keep, in Singapore dollars. */
  minAwardSgd: number;
  /** Most tenders the build keeps, largest award first. The build keeps 40 when this is not set. */
  max?: number;
}

// Tuned on 2026-10-15 against the live dataset (18,464 rows; 2,423 tenders awarded since 2023 for S$1M or more).
//
// This implements the approved rule in photon/data/snapshot/candidates.md ("GeBIZ tender selection rule"):
// - Keywords are whole words (see GebizRule). The bare words the first draft used (network, hosting, server, cyber, co-location)
//   matched sewerage, road and cycling-path "networks", server-room air handling, a cybersecurity agency's office renovation
//   and a school's "co-location", so each is now a phrase that names an ICT thing.
// - The four groups and quotas are the approved ones: about 12 AI/analytics, 10 cloud/data-centre, 10 cybersecurity and
//   8 digital-infrastructure. A tender goes to the first group it matches that has room, largest award first, so no one
//   topic fills the list.
// - The approved exclusions (guarding, cleaning, manpower, CCTV maintenance) are in `exclude`. "Unless an ICT keyword also
//   matches" is a lookahead for the strong ICT words, because a pattern cannot see the keyword groups.
// - The agency priority breaks ties between equal awards. It rarely decides anything, which is what a tie-break should do.
export const GEBIZ_RULE: GebizRule = {
  datasetId: "d_acde1106003906a75c3fa052592f2fcb", // "Government Procurement via GeBIZ"
  groups: [
    {
      name: "ai-analytics",
      quota: 12,
      topic: "ai-governance",
      keywords: [
        "artificial intelligence", "AI", "machine learning", "generative", "large language model", "LLM", "chatbot", "chatbots",
        "computer vision", "video analytics", "data analytics", "analytics", "data science", "data platform", "data lake", "big data",
      ],
    },
    {
      name: "cloud-data-centre",
      quota: 10,
      topic: "data-centres",
      keywords: [
        "cloud", "GCC", "SaaS", "\\bsoftware[- ]as[- ]a[- ]service\\b", "\\bdata cent(?:re|er)s?\\b",
        "\\b(?:application|infrastructure|web|website|disaster recovery) hosting\\b", "\\bhosting (?:services?|and operations)\\b",
        "\\bservers? (?:and|&) (?:storage|network)\\b", "server hardware", "server infrastructure", "\\b(?:rack[- ]?mount|on-premise|x86|unix|virtual) servers?\\b",
        "IT infrastructure", "ICT infrastructure",
      ],
    },
    {
      name: "cybersecurity",
      quota: 10,
      topic: "cybersecurity",
      keywords: [
        "cybersecurity", "cyber security", "cyber threat", "cyber defence", "SIEM", "SOC", "\\bsecurity operations? cent(?:re|er)s?\\b",
        "penetration test", "penetration testing", "managed security", "network security", "information security",
        "identity and access management", "endpoint management", "endpoint security", "vulnerability management",
        "threat intelligence", "threat detection", "firewall", "zero trust",
      ],
    },
    {
      name: "digital-infrastructure",
      quota: 8,
      topic: "digital-infrastructure",
      keywords: [
        "5G", "broadband", "fibre optic", "optical fibre", "submarine cable", "subsea cable", "\\bwi-?fi\\b", "SD-WAN", "telecommunications",
        "satellite communications", "internet of things", "IoT",
        "\\bnetwork (?:and|&) security\\b", "\\bnetwork (?:infrastructure|equipment|devices?|hardware|connectivity|refresh|segmentation|services|switch(?:es)?|operations|upgrade)\\b",
        "\\b(?:campus|wireless|managed|enterprise|global|storage area|wide area|local area) network\\b",
      ],
    },
  ],
  exclude: [
    // Guarding, cleaning and manpower contracts. IT security officers and managed security services stay.
    "\\b(?<!technology )security (?:officers?|guards?)\\b",
    "\\b(?<!managed |cyber |cybersecurity |information |network |it |ict )security services\\b",
    "\\b(?<!data )cleaning\\b",
    "^(?!.*\\b(?:cyber|cybersecurity|managed security|cloud|software|data platform)\\b).*\\bmanpower\\b",
    // CCTV maintenance, unless the tender is about analytics or AI.
    "^(?=.*\\bCCTV\\b)(?=.*\\bmaintenance\\b)(?!.*\\b(?:analytics|AI|artificial intelligence)\\b)",
    // Building works and courses that only mention a technology.
    "\\b(?:renovation|air handling units?|co-location of|weather stations?)\\b",
    "\\b(?:leadership|olympians?|training|talent|youth) programmes?\\b",
  ],
  agencyPriority: [
    "Government Technology Agency",
    "Cyber Security Agency",
    "Info-communications Media Development Authority",
    "Ministry of Digital Development and Information",
    "Smart Nation",
  ],
  since: "2023-01-01",
  minAwardSgd: 1_000_000,
};

const ENDPOINT = "https://data.gov.sg/api/action/datastore_search"; // the legacy CKAN-style query API
const PAGE_SIZE = 5000;
const MAX_PAGES = 100;
const MAX_TITLE = 200;

const PageSchema = z.object({
  success: z.literal(true),
  result: z.object({ records: z.array(z.record(z.string(), z.unknown())), total: z.number() }),
});
type Row = Record<string, unknown>;

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
const field = (row: Row, name: string): string => {
  const v = row[name];
  return typeof v === "string" ? collapse(v) : typeof v === "number" ? String(v) : "";
};

async function fetchRows(datasetId: string, fetchImpl: typeof fetch): Promise<Row[]> {
  const rows: Row[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${ENDPOINT}?resource_id=${encodeURIComponent(datasetId)}&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`GeBIZ dataset ${datasetId}: HTTP ${res.status} from ${url}`);
    const body = PageSchema.safeParse(await res.json().catch(() => undefined));
    if (!body.success) throw new Error(`GeBIZ dataset ${datasetId}: unexpected response from ${url}`);
    const { records, total } = body.data.result;
    rows.push(...records);
    offset += records.length;
    if (records.length === 0 || offset >= total) return rows;
  }
  throw new Error(`GeBIZ dataset ${datasetId}: more than ${MAX_PAGES} pages of ${PAGE_SIZE} rows`);
}

/** A tender is awarded when its status says so; "Awarded to No Suppliers", "No award" and cancelled tenders are not. */
const isAwarded = (status: string) => /\bawarded\b/i.test(status) && !/\bno\s+suppliers?\b/i.test(status);

function parseAmount(row: Row): number {
  const v = row.awarded_amt;
  if (typeof v === "number") return v;
  if (typeof v !== "string") return Number.NaN;
  const cleaned = v.replace(/[\s,]|S\$/gi, "");
  return cleaned === "" ? Number.NaN : Number(cleaned);
}

/** Reads "6/9/2021" (day/month/year, as the dataset writes it) or "2021-09-06" as an ISO date; anything else is null. */
function parseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(v);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  const parts = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  if (!parts) return null;
  const [y, m, d] = parts.map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const idFor = (tenderNo: string) =>
  `sg-gebiz-${tenderNo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
const sgd = (n: number) => `S$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

type Award = { supplier: string; amount: number };
type Tender = { tenderNo: string; description: string; agency: string; date: string; awards: Award[] };

/** A matched tender: the candidate row, the text the build enriches, and the groups whose keywords matched (in rule order). */
export type GebizTender = { candidate: Candidate; text: string; matched: string[] };

function describe(rule: GebizRule, t: Tender, matched: string[]): GebizTender {
  const awards = [...t.awards].sort((a, b) => b.amount - a.amount || a.supplier.localeCompare(b.supplier));
  const largest = awards[0]!.amount;
  const lines = [
    `Tender number: ${t.tenderNo}`,
    `Description: ${t.description}`,
    `Agency: ${t.agency}`,
    ...(awards.length === 1
      ? [`Supplier: ${awards[0]!.supplier}`, `Awarded amount: ${sgd(largest)}`]
      : [`Suppliers: ${awards.map((a) => `${a.supplier} (${sgd(a.amount)})`).join("; ")}`, `Largest single award: ${sgd(largest)}`]),
    `Award date: ${t.date}`,
  ];
  const title = t.description.length > MAX_TITLE ? `${t.description.slice(0, MAX_TITLE - 1).trimEnd()}…` : t.description;
  return {
    candidate: {
      include: true,
      id: idFor(t.tenderNo),
      jurisdiction: "SG",
      title,
      type: "tender",
      topics: ["gov-tech-procurement"],
      status: "awarded",
      landmark: false,
      url: `https://data.gov.sg/datasets/${rule.datasetId}/view#${encodeURIComponent(t.tenderNo)}`,
      urlConfidence: "constructed",
      why: `Selected by the GeBIZ keyword rule (largest award ${sgd(largest)}, awarded ${t.date})`,
    },
    text: lines.join("\n"),
    matched,
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A plain term becomes a whole-word, case-insensitive pattern: its regular-expression characters are matched literally,
 * and `\b` is put at each end that is a letter or digit (an end like the `)` in "wi-fi (v6)" has no word edge to anchor).
 * A term that contains `\b` is a pattern source, used as written.
 */
function compileTerm(term: string, what: string): RegExp {
  const source = term.includes("\\b") ? term : `${/^\w/.test(term) ? "\\b" : ""}${escapeRegExp(term)}${/\w$/.test(term) ? "\\b" : ""}`;
  try {
    return new RegExp(source, "i");
  } catch {
    throw new Error(`GeBIZ ${what} "${term}" is not a valid pattern`);
  }
}

/** The keyword sets a rule matches against: its groups, or one unnamed group for a flat keyword list. */
function keywordSets(rule: GebizRule): { name: string; patterns: RegExp[] }[] {
  if (rule.groups && rule.keywords) throw new Error("A GeBIZ rule has either keywords or groups, not both");
  if (rule.groups) {
    const names = new Set<string>();
    return rule.groups.map((group) => {
      if (!group.name || names.has(group.name)) throw new Error(`GeBIZ group names must be unique and not empty, got "${group.name}"`);
      names.add(group.name);
      if (!Number.isInteger(group.quota) || group.quota < 0) throw new Error(`GeBIZ group "${group.name}": quota must be a whole number of at least 0`);
      return { name: group.name, patterns: group.keywords.map((kw) => compileTerm(kw, "keyword")) };
    });
  }
  return [{ name: "", patterns: (rule.keywords ?? []).map((kw) => compileTerm(kw, "keyword")) }];
}

/** How early the tender's agency is in `rule.agencyPriority` (the list's length when it is not there). */
function agencyRank(rule: GebizRule, agency: string): number {
  const list = rule.agencyPriority ?? [];
  const at = list.findIndex((name) => agency.toLowerCase().includes(name.toLowerCase()));
  return at === -1 ? list.length : at;
}

/**
 * Pages through the data.gov.sg GeBIZ dataset and returns one tender candidate, with its text, per awarded tender whose
 * description matches a keyword (of any group) and no `exclude` pattern, whose award date is on or after `since`, and
 * whose largest single award is at least `minAwardSgd`. A tender can have several award rows (one per supplier or item);
 * they are merged by tender number and listed individually, never summed, because a framework agreement repeats its
 * ceiling value on every supplier's row. Rows with no usable tender number, date or amount are skipped.
 * Results are ordered by largest award, then agency priority, then id. Every match is returned: `selectTenders` applies
 * the group quotas and `max`.
 */
export async function fetchGebizTenders(rule: GebizRule, fetchImpl: typeof fetch = fetch): Promise<GebizTender[]> {
  const sets = keywordSets(rule);
  const excluded = (rule.exclude ?? []).map((pattern) => compileTerm(pattern, "exclude pattern"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.since)) throw new Error(`GeBIZ since "${rule.since}" must be YYYY-MM-DD`);

  const tenders = new Map<string, Tender>();
  for (const row of await fetchRows(rule.datasetId, fetchImpl)) {
    const tenderNo = field(row, "tender_no");
    const description = field(row, "tender_description");
    const date = parseDate(row.award_date);
    const amount = parseAmount(row);
    if (!tenderNo || !/[a-z0-9]/i.test(tenderNo) || !description || date === null || !Number.isFinite(amount)) continue;
    if (!isAwarded(field(row, "tender_detail_status"))) continue;

    const id = idFor(tenderNo);
    const award: Award = { supplier: field(row, "supplier_name") || "(not stated)", amount };
    const known = tenders.get(id);
    if (known) {
      known.awards.push(award);
      if (date > known.date) known.date = date;
    } else {
      tenders.set(id, { tenderNo, description, agency: field(row, "agency") || "(not stated)", date, awards: [award] });
    }
  }

  return [...tenders.entries()]
    .map(([id, t]) => ({ id, t, largest: Math.max(...t.awards.map((a) => a.amount)) }))
    .filter(({ t, largest }) => t.date >= rule.since && largest >= rule.minAwardSgd)
    .filter(({ t }) => !excluded.some((pattern) => pattern.test(t.description)))
    .flatMap((entry) => {
      const hit = sets.filter((set) => set.patterns.some((pattern) => pattern.test(entry.t.description)));
      return hit.length > 0 ? [{ ...entry, matched: hit.map((set) => set.name).filter(Boolean), rank: agencyRank(rule, entry.t.agency) }] : [];
    })
    .sort((a, b) => b.largest - a.largest || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ t, matched }) => describe(rule, t, matched));
}

/**
 * The tenders the build keeps from `tenders` (as `fetchGebizTenders` returns them, largest award first). With groups,
 * each tender goes to the first group it matches that still has room under its quota, so no one topic can fill the
 * list; a tender whose groups are all full is left out. The kept tenders then get that group's topic alongside
 * gov-tech-procurement. At most `rule.max` (40 if unset) are kept, largest award first.
 */
export function selectTenders(rule: GebizRule, tenders: GebizTender[]): GebizTender[] {
  const max = rule.max ?? DEFAULT_GEBIZ_MAX;
  if (!rule.groups) return tenders.slice(0, max);
  const left = new Map(rule.groups.map((g) => [g.name, g.quota]));
  const topicOf = new Map(rule.groups.map((g) => [g.name, g.topic]));
  const kept: GebizTender[] = [];
  for (const tender of tenders) {
    const group = tender.matched.find((name) => (left.get(name) ?? 0) > 0);
    if (group === undefined) continue;
    left.set(group, left.get(group)! - 1);
    const topic = topicOf.get(group)!;
    kept.push({ ...tender, candidate: { ...tender.candidate, topics: topic === "gov-tech-procurement" ? [topic] : [topic, "gov-tech-procurement"] } });
  }
  return kept.slice(0, max);
}
