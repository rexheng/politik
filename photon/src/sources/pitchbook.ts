import type { SourceItem } from "../contracts.ts";

type MoneyDto = {
  amount?: number;
  currency?: string;
};

type DictionaryDto = {
  code?: string;
  description?: string;
};

type DealSearchHit = {
  dealId?: string;
  companyId?: string;
  companyName?: string;
};

type DealSearchResponse = {
  items?: DealSearchHit[];
};

type DealBio = {
  dealId?: string;
  companyName?: string;
  dealDate?: string;
  dealAnnouncedDate?: string;
  dealSize?: MoneyDto;
  dealType1?: DictionaryDto;
};

function authHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `PB-Token ${apiKey}`,
  };
}

function formatMoney(money?: MoneyDto): string | undefined {
  if (money?.amount == null || !Number.isFinite(money.amount)) return undefined;
  const currency = money.currency?.trim();
  return currency ? `${money.amount} ${currency}` : String(money.amount);
}

function toPlain(opts: {
  companyName: string;
  dealType?: string;
  dealSize?: string;
  dealDate?: string;
}): string {
  const { companyName, dealType, dealSize, dealDate } = opts;
  let sentence = `${companyName} has a PitchBook deal`;
  if (dealType) sentence += ` (${dealType})`;
  if (dealSize) sentence += ` sized ${dealSize}`;
  if (dealDate) sentence += ` dated ${dealDate}`;
  return `${sentence}.`;
}

async function fetchDealBio(
  apiKey: string,
  dealId: string,
): Promise<DealBio | null> {
  try {
    const res = await fetch(
      `https://api.pitchbook.com/deals/${encodeURIComponent(dealId)}/bio`,
      {
        method: "GET",
        headers: authHeaders(apiKey),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as DealBio;
  } catch {
    return null;
  }
}

function toSourceItem(
  hit: DealSearchHit,
  bio: DealBio | null,
): SourceItem | null {
  const dealId = hit.dealId?.trim() || bio?.dealId?.trim();
  const companyName =
    bio?.companyName?.trim() || hit.companyName?.trim() || undefined;
  if (!dealId || !companyName) return null;

  const dealType = bio?.dealType1?.description?.trim();
  const dealSize = formatMoney(bio?.dealSize);
  const dealDate =
    bio?.dealDate?.trim() || bio?.dealAnnouncedDate?.trim() || undefined;

  const item: SourceItem = {
    id: dealId,
    source: "pitchbook",
    title: dealType ? `${companyName} — ${dealType}` : companyName,
    plain: toPlain({ companyName, dealType, dealSize, dealDate }),
  };
  if (dealDate) item.happenedAt = dealDate;
  return item;
}

export async function fetchPitchbook(apiKey?: string): Promise<SourceItem[]> {
  const key = apiKey?.trim();
  if (!key) return [];

  try {
    const url = new URL("https://api.pitchbook.com/deals/search");
    url.searchParams.set("keywords", "artificial intelligence");
    url.searchParams.set("onlyMostRecentTransaction", "TRUE");
    url.searchParams.set("page", "1");
    url.searchParams.set("perPage", "5");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: authHeaders(key),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as DealSearchResponse;
    const hits = Array.isArray(data.items) ? data.items.slice(0, 5) : [];
    if (hits.length === 0) return [];

    const enriched = await Promise.all(
      hits.map(async (hit) => {
        const dealId = hit.dealId?.trim();
        const bio = dealId ? await fetchDealBio(key, dealId) : null;
        return toSourceItem(hit, bio);
      }),
    );

    return enriched.filter((item): item is SourceItem => item != null);
  } catch {
    return [];
  }
}
