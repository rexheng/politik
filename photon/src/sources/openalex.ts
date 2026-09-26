import type { SourceItem } from "../contracts.ts";

type OpenAlexWork = {
  id?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  doi?: string | null;
  primary_location?: {
    landing_page_url?: string | null;
    source?: {
      display_name?: string;
    } | null;
  } | null;
};

type OpenAlexResponse = {
  results?: OpenAlexWork[];
};

function venueName(work: OpenAlexWork): string | undefined {
  return work.primary_location?.source?.display_name;
}

function workTitle(work: OpenAlexWork): string | undefined {
  const title = work.title?.trim() || work.display_name?.trim();
  return title || undefined;
}

function landingUrl(work: OpenAlexWork): string | undefined {
  const landing = work.primary_location?.landing_page_url?.trim();
  if (landing) return landing;
  if (work.doi) return work.doi;
  if (work.id) return work.id;
  return undefined;
}

function toPlain(work: OpenAlexWork): string {
  const title = workTitle(work) || "Untitled work";
  const year = work.publication_year;
  const venue = venueName(work);
  if (year != null && venue) {
    return `${title} (${year}) appears in ${venue}.`;
  }
  if (year != null) {
    return `${title} was published in ${year}.`;
  }
  if (venue) {
    return `${title} appears in ${venue}.`;
  }
  return `${title}.`;
}

function toSourceItem(work: OpenAlexWork): SourceItem | null {
  const title = workTitle(work);
  if (!work.id || !title) return null;
  const item: SourceItem = {
    id: work.id,
    source: "openalex",
    title,
    plain: toPlain(work),
  };
  const url = landingUrl(work);
  if (url) item.url = url;
  if (work.publication_date) item.happenedAt = work.publication_date;
  return item;
}

export async function fetchOpenAlex(query: string): Promise<SourceItem[]> {
  try {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", query);
    url.searchParams.set("per_page", "5");
    url.searchParams.set(
      "select",
      "id,title,publication_year,publication_date,doi,primary_location",
    );

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Politik/1.0",
      },
    });

    if (!res.ok) return [];

    const data = (await res.json()) as OpenAlexResponse;
    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .map(toSourceItem)
      .filter((item): item is SourceItem => item != null);
  } catch {
    return [];
  }
}
