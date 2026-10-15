// The Sources page's view of the policy dataset, built from the D1 store on each request.
import type { D1Like } from "./data/d1.ts";
import type { Manifest, PolicyRecord, RecordSummary } from "./data/schema.ts";
import { getManifest, getRecord, listRecords } from "./data/store.ts";

export interface CatalogDoc {
  title: string;
  kind: string;
  jurisdiction: string;
  sourceId: string;
  published: string;
  url: string;
  fetched: string;
  sha256: string;
  redistributionOk: boolean;
  attribution: string;
}

export interface CatalogSource {
  id: string;
  documents: number;
  redistributionOk: boolean;
  attribution: string;
}

export interface CatalogJurisdiction {
  id: string;
  label: string;
  documents: number;
}

export interface BlockedSource {
  id: string;
  jurisdiction: string;
  live: boolean;
  ended: string;
  error: string;
  url: string;
  attribution: string;
  officialText: false;
}

export interface Catalog {
  blocked: BlockedSource[];
  jurisdictions: CatalogJurisdiction[];
  sources: CatalogSource[];
  latest: CatalogDoc[];
  /** The "as of" date of the loaded snapshot, or "" when D1 has not been seeded. */
  snapshotDate: string;
}

const RECENT_LIMIT = 10;

function emptyCatalog(): Catalog {
  return { blocked: [], jurisdictions: [], sources: [], latest: [], snapshotDate: "" };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

async function buildCatalog(db: D1Like, manifest: Manifest, records: RecordSummary[]): Promise<Catalog> {
  const jurisdictions: CatalogJurisdiction[] = Object.entries(manifest.counts.byJurisdiction).map(
    ([id, documents]) => ({ id, label: id, documents }),
  );

  const blocked: BlockedSource[] = manifest.excluded.map((row) => ({
    id: row.id,
    jurisdiction: row.jurisdiction,
    live: false,
    ended: manifest.builtAt,
    error: row.reason,
    url: row.url,
    attribution: "",
    officialText: false,
  }));

  const byPublisher = new Map<string, RecordSummary[]>();
  for (const record of records) {
    const group = byPublisher.get(record.publisher);
    if (group) group.push(record);
    else byPublisher.set(record.publisher, [record]);
  }

  // Newest published first. A record with no published date has no place in this list. Ties break on the
  // id so the order is the same on every request.
  const latest = records
    .filter((r): r is RecordSummary & { published: string } => r.published !== undefined)
    .sort((a, b) => compare(b.published, a.published) || compare(a.id, b.id))
    .slice(0, RECENT_LIMIT);

  // Provenance (fetched, sha256, attribution) lives only in the full record, so read the few that are shown.
  const wanted = new Set([...[...byPublisher.values()].map((group) => group[0].id), ...latest.map((r) => r.id)]);
  const full = new Map<string, PolicyRecord>();
  await Promise.all(
    [...wanted].map(async (id) => {
      const record = await getRecord(db, id);
      if (record) full.set(id, record);
    }),
  );

  const sources: CatalogSource[] = [...byPublisher]
    .map(([id, group]) => {
      const first = full.get(group[0].id);
      return {
        id,
        documents: group.length,
        redistributionOk: first?.redistributionOk ?? false,
        attribution: first?.attribution ?? "",
      };
    })
    .sort((a, b) => b.documents - a.documents || compare(a.id, b.id));

  const docs: CatalogDoc[] = latest.flatMap((summary) => {
    const record = full.get(summary.id);
    if (!record) return [];
    return [
      {
        title: summary.title,
        kind: summary.type,
        jurisdiction: summary.jurisdiction,
        sourceId: summary.publisher,
        published: summary.published,
        url: summary.url,
        fetched: record.fetched,
        sha256: record.sha256,
        redistributionOk: record.redistributionOk,
        attribution: record.attribution,
      },
    ];
  });

  return { blocked, jurisdictions, sources, latest: docs, snapshotDate: manifest.snapshotDate };
}

/**
 * The catalog for `/api/sources`. An unseeded or unmigrated D1, or any store error, gives the
 * empty catalog (`snapshotDate: ""`) rather than a failure, so the page shows its empty state.
 */
export async function loadCatalog(db: D1Like): Promise<Catalog> {
  try {
    const manifest = await getManifest(db);
    if (!manifest) return emptyCatalog();
    return await buildCatalog(db, manifest, await listRecords(db));
  } catch (error) {
    console.warn("catalog: the policy store could not be read", error);
    return emptyCatalog();
  }
}
