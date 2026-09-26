import { DATACENTRES } from "./datacentres.ts";

export interface TraceStep {
  id: string;
  label: string;
  url?: string;
}

export interface MapPoint {
  id: string;
  title: string;
  lat: number;
  lng: number;
  place: string;
  source: "web" | "openalex";
  url: string;
  kind: "datacentre" | "university";
  detail?: string;
}

export interface Unplaced {
  id: string;
  title: string;
  source: string;
  url?: string;
  kind: string;
}

export interface MapPayload {
  trace: TraceStep[];
  points: MapPoint[];
  unplaced: Unplaced[];
}

const ARXIV_SOURCE = "S4306400194";
const DATA_CENTRE_TITLE = /data\s*cent(?:er|re)s?|datacent(?:er|re)s?/i;
const TITLE_SEARCHES = ["data center", "datacenter", "data centre"];

/** Frame that matches the western map: California across to the Rockies. */
const VIEW = { minLat: 31, maxLat: 49, minLng: -125, maxLng: -102 };

type Institution = {
  id?: string;
  display_name?: string;
  country_code?: string;
  type?: string;
};

type Work = {
  id?: string;
  title?: string;
  doi?: string | null;
  authorships?: Array<{ institutions?: Institution[] }>;
};

type Pending = {
  id: string;
  name: string;
  papers: number;
  sample: string;
  url: string;
};

const HEADERS = { Accept: "application/json", "User-Agent": "Politik/1.0" };

function institutionId(id: string): string | undefined {
  const short = id.split("/").pop()?.trim();
  return short || undefined;
}

function cleanText(value: string): string {
  return value.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}

function workUrl(work: Work): string | undefined {
  if (work.doi?.startsWith("http")) return work.doi;
  if (work.id?.startsWith("http")) return work.id;
  return undefined;
}

function inView(lat: number, lng: number): boolean {
  return lat >= VIEW.minLat && lat <= VIEW.maxLat && lng >= VIEW.minLng && lng <= VIEW.maxLng;
}

function datacentrePoints(): MapPoint[] {
  return DATACENTRES.map((site) => ({
    id: site.id,
    title: site.title,
    lat: site.lat,
    lng: site.lng,
    place: site.place,
    source: "web",
    url: site.url,
    kind: "datacentre",
    detail: site.detail,
  }));
}

function sourceTrace(datacentres: number, universities: number): TraceStep[] {
  return [
    { id: "web", label: `${datacentres} datacentres · web` },
    {
      id: "openalex",
      label: `${universities} universities · arXiv on OpenAlex`,
      url: "https://openalex.org/S4306400194",
    },
  ];
}

export async function loadMap(query = "data center"): Promise<MapPayload> {
  const datacentres = datacentrePoints();
  const universities = await loadUniversities(query);
  return {
    trace: sourceTrace(datacentres.length, universities.length),
    points: [...datacentres, ...universities],
    unplaced: [],
  };
}

async function loadUniversities(query: string): Promise<MapPoint[]> {
  try {
    const pending = await arxivAffiliations(query);
    const located = await locateInstitutions([...pending.keys()]);
    const points: MapPoint[] = [];
    for (const row of pending.values()) {
      const place = located.get(row.id);
      if (!place || !inView(place.lat, place.lng)) continue;
      const detail =
        row.papers > 1 ? `${row.papers} arXiv works · ${row.sample}` : row.sample;
      points.push({
        id: row.id,
        title: row.name,
        lat: place.lat,
        lng: place.lng,
        place: place.place,
        source: "openalex",
        url: row.url,
        kind: "university",
        detail,
      });
    }
    return points;
  } catch {
    return [];
  }
}

async function arxivAffiliations(query: string): Promise<Map<string, Pending>> {
  const searches = TITLE_SEARCHES.includes(query) ? TITLE_SEARCHES : [query, ...TITLE_SEARCHES];
  const batches = await Promise.all(searches.map(fetchArxivWorks));
  const pending = new Map<string, Pending>();
  const counted = new Set<string>();
  for (const works of batches) {
    for (const work of works) {
      const title = work.title ? cleanText(work.title) : "";
      const link = workUrl(work);
      if (!title || !work.id || !link || !DATA_CENTRE_TITLE.test(title)) continue;
      for (const authorship of work.authorships ?? []) {
        for (const institution of authorship.institutions ?? []) {
          if (institution.type !== "education" || institution.country_code !== "US") continue;
          if (!institution.id) continue;
          const key = `${work.id}:${institution.id}`;
          if (counted.has(key)) continue;
          counted.add(key);
          const existing = pending.get(institution.id);
          if (existing) {
            existing.papers += 1;
            continue;
          }
          pending.set(institution.id, {
            id: institution.id,
            name: institution.display_name ? cleanText(institution.display_name) : "University",
            papers: 1,
            sample: title,
            url: link,
          });
        }
      }
    }
  }
  return pending;
}

async function fetchArxivWorks(query: string): Promise<Work[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set(
    "filter",
    `locations.source.id:${ARXIV_SOURCE},title.search:${query},authorships.institutions.country_code:US`,
  );
  url.searchParams.set("per_page", "100");
  url.searchParams.set("select", "id,title,doi,authorships");
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: Work[] };
  return data.results ?? [];
}

async function locateInstitutions(
  ids: string[],
): Promise<Map<string, { lat: number; lng: number; place: string }>> {
  const shorts = ids
    .map(institutionId)
    .filter((id): id is string => Boolean(id));
  const unique = [...new Set(shorts)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 40) chunks.push(unique.slice(i, i + 40));
  const groups = await Promise.all(chunks.map(fetchInstitutionChunk));
  const located = new Map<string, { lat: number; lng: number; place: string }>();
  for (const group of groups) {
    for (const [id, place] of group) located.set(id, place);
  }
  return located;
}

async function fetchInstitutionChunk(
  chunk: string[],
): Promise<Map<string, { lat: number; lng: number; place: string }>> {
  const located = new Map<string, { lat: number; lng: number; place: string }>();
  if (chunk.length === 0) return located;
  try {
    const url = new URL("https://api.openalex.org/institutions");
    url.searchParams.set("filter", `openalex_id:${chunk.join("|")}`);
    url.searchParams.set("select", "id,display_name,geo");
    url.searchParams.set("per_page", "50");
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return located;
    const data = (await res.json()) as {
      results?: Array<{
        id?: string;
        display_name?: string;
        geo?: {
          city?: string | null;
          region?: string | null;
          latitude?: number | null;
          longitude?: number | null;
        } | null;
      }>;
    };
    for (const row of data.results ?? []) {
      if (!row.id) continue;
      const lat = row.geo?.latitude;
      const lng = row.geo?.longitude;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const where = [row.geo?.city, row.geo?.region].filter(Boolean).join(", ");
      const place = { lat, lng, place: where || row.display_name || "University" };
      located.set(row.id, place);
      const short = institutionId(row.id);
      if (short) located.set(short, place);
      located.set(`https://openalex.org/${short}`, place);
    }
  } catch {
    return located;
  }
  return located;
}
