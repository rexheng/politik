// Which passages may be published (R39). A record whose publisher does not allow redistribution (`redistributionOk: false`) keeps its
// metadata, summary and provisions in the committed policies.json (short attributed quotes), but its passages (the full text) are
// never committed: the build writes them to the git-ignored `photon/data/snapshot-private/passages.json`, and the app shows such a
// record only as a quote of at most MAX_RESTRICTED_QUOTE_CHARS characters, with its attribution and a link to the source.
// Pure functions with no I/O, used by the build, check:data, the seed script, the chat and the landing page.
import type { Passage, PolicyRecord } from "./schema.ts";

/** The most characters a restricted record's text may be quoted at, anywhere the app shows it. */
export const MAX_RESTRICTED_QUOTE_CHARS = 280;

/** The most characters a restricted record's committed summary or provision may have: a 280-character prefix and an ellipsis (R42). */
export const MAX_RESTRICTED_CLAIM_CHARS = MAX_RESTRICTED_QUOTE_CHARS + 1;

/** True when the record's publisher allows its text to be redistributed. */
export const isRedistributable = (record: Pick<PolicyRecord, "redistributionOk">): boolean => record.redistributionOk === true;

/** The directory of the private passages that go with the snapshot in `dir`: the same path with `-private` added (`photon/data/snapshot` -> `photon/data/snapshot-private`). */
export function privateDirOf(dir: string): string {
  return `${dir.replace(/[\\/]+$/, "")}-private`;
}

/** The ids of the records that may not be redistributed. */
export function restrictedRecordIds(records: Pick<PolicyRecord, "id" | "redistributionOk">[]): Set<string> {
  return new Set(records.filter((r) => !isRedistributable(r)).map((r) => r.id));
}

/** `passages` split by their record's licence: `open` may be committed and published, `restricted` may not. A passage of an unknown record is restricted. */
export function splitPassagesByLicence(
  records: Pick<PolicyRecord, "id" | "redistributionOk">[],
  passages: Passage[],
): { open: Passage[]; restricted: Passage[] } {
  const open = new Set(records.filter(isRedistributable).map((r) => r.id));
  return { open: passages.filter((p) => open.has(p.recordId)), restricted: passages.filter((p) => !open.has(p.recordId)) };
}

/**
 * The passages that may be shown in full: those of records the publisher allows to be redistributed. For anything that quotes
 * passage text outside the app's cited quotes (the landing page's document tiles, say).
 */
export function redistributablePassages(records: Pick<PolicyRecord, "id" | "redistributionOk">[], passages: Passage[]): Passage[] {
  return splitPassagesByLicence(records, passages).open;
}
