const SEARCH = "https://policy-tracker.rexheng-policy.workers.dev/api/search";
const TRACKER = "https://policy-tracker.rexheng-policy.workers.dev";

const DATA_CENTRE = /data\s*cent(?:er|re)s?|datacent(?:er|re)s?/i;
const CALIFORNIA_STORY = /\b(ai|climate|wind|forest|water|energy|grid|riverside)\b/i;

const SINGAPORE = { lat: 1.2905, lng: 103.852 };

const PLACES: Array<{ needle: string; lat: number; lng: number; label: string }> = [
  { needle: "riverside", lat: 33.95335, lng: -117.39616, label: "Riverside, California" },
  { needle: "san francisco", lat: 37.7749, lng: -122.4194, label: "San Francisco, California" },
  { needle: "los angeles", lat: 34.05223, lng: -118.24368, label: "Los Angeles, California" },
  { needle: "san diego", lat: 32.7157, lng: -117.1611, label: "San Diego, California" },
  { needle: "oakland", lat: 37.8044, lng: -122.2712, label: "Oakland, California" },
  { needle: "san jose", lat: 37.3382, lng: -121.8863, label: "San Jose, California" },
  { needle: "sacramento", lat: 38.58157, lng: -121.4944, label: "Sacramento, California" },
];

const SACRAMENTO = PLACES[PLACES.length - 1];

export interface PolicyPin {
  id: string;
  title: string;
  lat: number;
  lng: number;
  place: string;
  url: string;
  detail: string;
  frame: "west" | "singapore";
}

interface Hit {
  id?: string;
  title?: string;
  url?: string;
  jurisdiction?: string;
  type?: string;
  publishedAt?: string;
  sourceId?: string;
}

export async function loadPolicy(): Promise<PolicyPin[]> {
  const batches = await Promise.all([
    search("data centre"),
    search("data center"),
    search("datacenter"),
    search("Bonta"),
    search("forest"),
  ]);
  const hits = dedupe(batches.flat());
  const contracts = hits.filter(
    (hit) => hit.jurisdiction === "SG" && DATA_CENTRE.test(hit.title || ""),
  );
  const filings = hits.filter(
    (hit) => hit.jurisdiction === "US-CA" && CALIFORNIA_STORY.test(hit.title || ""),
  );
  return [...placeCalifornia(filings), ...placeSingapore(contracts)];
}

export const POLICY_HOME = TRACKER;

async function search(query: string): Promise<Hit[]> {
  const url = new URL(SEARCH);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Politik/1.0" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { hits?: Hit[] };
  return Array.isArray(data.hits) ? data.hits : [];
}

function dedupe(hits: Hit[]): Hit[] {
  const seen = new Set<string>();
  const unique: Hit[] = [];
  for (const hit of hits) {
    const id = hit.id?.trim();
    const title = hit.title?.trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    unique.push({ ...hit, id, title });
  }
  return unique;
}

function placeCalifornia(hits: Hit[]): PolicyPin[] {
  const slots = new Map<string, number>();
  const pins: PolicyPin[] = [];
  for (const hit of hits) {
    const named = namedPlace(hit.title || "");
    const place = named ?? SACRAMENTO;
    const key = place.label;
    const slot = slots.get(key) ?? 0;
    slots.set(key, slot + 1);
    const shifted = slot === 0 ? { lat: place.lat, lng: place.lng } : fan(place.lat, place.lng, slot, 0.18);
    const date = (hit.publishedAt || "").slice(0, 10);
    pins.push({
      id: `policy-${hit.id}`,
      title: hit.title || "California filing",
      lat: shifted.lat,
      lng: shifted.lng,
      place: place.label,
      url: hit.url || POLICY_HOME,
      detail: ["California Attorney General", date].filter(Boolean).join(" · "),
      frame: "west",
    });
  }
  return pins;
}

function placeSingapore(hits: Hit[]): PolicyPin[] {
  return hits.map((hit, index) => {
    const spot = fan(SINGAPORE.lat, SINGAPORE.lng, index, 0.05, hits.length);
    const date = (hit.publishedAt || "").slice(0, 10);
    return {
      id: `policy-${hit.id}`,
      title: hit.title || "Singapore tender",
      lat: spot.lat,
      lng: spot.lng,
      place: "Singapore",
      url: hit.url || `${TRACKER}/contracts`,
      detail: ["GeBIZ tender", date].filter(Boolean).join(" · "),
      frame: "singapore",
    };
  });
}

function namedPlace(title: string): { lat: number; lng: number; label: string } | null {
  const lower = title.toLowerCase();
  for (const place of PLACES) {
    if (place.needle === "sacramento") continue;
    if (lower.includes(place.needle)) return place;
  }
  return null;
}

function fan(lat: number, lng: number, index: number, radius: number, total?: number): { lat: number; lng: number } {
  const step = total && total > 1 ? (Math.PI * 2) / total : 1.15;
  const angle = total && total > 1 ? index * step - Math.PI / 2 : index * step;
  const reach = total && total > 1 ? radius : radius * (0.65 + index * 0.15);
  return {
    lat: lat + Math.sin(angle) * reach,
    lng: lng + Math.cos(angle) * reach,
  };
}
