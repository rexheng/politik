// GeBIZ tenders come from the data.gov.sg datastore API (spec 5.2), not from scraping.
// Node-only build code: never import this from photon/src.
import { z } from "zod/v4";

import type { Candidate } from "./candidates.ts";

export interface GebizRule {
  /** The data.gov.sg dataset (resource) id. */
  datasetId: string;
  /** Case-insensitive regular-expression sources; a tender is kept if any one matches its description. */
  keywords: string[];
  /** Earliest award date to keep, as YYYY-MM-DD. */
  since: string;
  /** Smallest award to keep, in Singapore dollars. */
  minAwardSgd: number;
  /** Most tenders the build keeps, largest award first. The build keeps 40 when this is not set. */
  max?: number;
}

// provisional — set from owner-approved candidates.md in Task 7
export const GEBIZ_RULE: GebizRule = {
  datasetId: "d_acde1106003906a75c3fa052592f2fcb", // "Government Procurement via GeBIZ"
  keywords: [
    // AI and analytics
    "artificial intelligence", "\\bAI\\b", "machine learning", "generative", "large language model", "\\bLLM\\b",
    "chatbot", "computer vision", "video analytics", "data analytics", "data science",
    // cloud and data centres
    "cloud", "\\bGCC\\b", "\\bSaaS\\b", "data cent(?:re|er)", "co-location", "hosting", "server",
    // cybersecurity
    "cyber", "security operations cent(?:re|er)", "\\bSOC\\b", "penetration test", "vulnerability", "managed security", "threat",
    // digital infrastructure
    "network", "\\b5G\\b", "broadband", "fibre", "submarine cable", "wi-?fi",
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

function describe(rule: GebizRule, t: Tender): { candidate: Candidate; text: string } {
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
  };
}

/**
 * Pages through the data.gov.sg GeBIZ dataset and returns one tender candidate, with its text, per awarded tender whose
 * description matches a keyword, whose award date is on or after `since`, and whose largest single award is at least
 * `minAwardSgd`. A tender can have several award rows (one per supplier or item); they are merged by tender number and
 * listed individually, never summed, because a framework agreement repeats its ceiling value on every supplier's row.
 * Rows with no usable tender number, date or amount are skipped. Results are ordered by largest award, then id.
 */
export async function fetchGebizTenders(
  rule: GebizRule,
  fetchImpl: typeof fetch = fetch,
): Promise<{ candidate: Candidate; text: string }[]> {
  const keywords = rule.keywords.map((kw) => {
    try {
      return new RegExp(kw, "i");
    } catch {
      throw new Error(`GeBIZ keyword "${kw}" is not a valid pattern`);
    }
  });
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
    .filter(({ t, largest }) => t.date >= rule.since && largest >= rule.minAwardSgd && keywords.some((kw) => kw.test(t.description)))
    .sort((a, b) => b.largest - a.largest || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ t }) => describe(rule, t));
}
