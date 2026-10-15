// The policy dataset contract: record shapes (zod schemas and the types inferred from them)
// and the query types shared by the store and its callers. Runs in both the Worker and Node.
import { z } from "zod/v4";

export const JurisdictionSchema = z.enum(["US-CA", "SG"]);
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

export const RecordTypeSchema = z.enum([
  "bill",
  "statute",
  "regulation",
  "executive-order",
  "guidance", // frameworks, guidelines, agency reports
  "tender",
  "press-release",
  "hansard",
]);
export type RecordType = z.infer<typeof RecordTypeSchema>;

export const TopicSchema = z.enum([
  "ai-governance",
  "data-centres",
  "privacy-data",
  "cybersecurity",
  "online-safety",
  "gov-tech-procurement",
  "digital-infrastructure",
]);
export type Topic = z.infer<typeof TopicSchema>;
export const TOPICS: readonly Topic[] = TopicSchema.options;

export const StatusSchema = z.enum([
  "proposed",
  "in-progress",
  "passed",
  "enacted",
  "in-force",
  "vetoed",
  "failed",
  "withdrawn",
  "superseded",
  "open", // tenders
  "awarded",
  "closed",
  "published", // guidance, releases, hansard
]);
export type Status = z.infer<typeof StatusSchema>;

// Dates that are compared as strings (`since`, lastActivity) are plain ISO dates (YYYY-MM-DD).
const IsoDateSchema = z.iso.date();
const IsoTimestampSchema = z.iso.datetime({ offset: true });
const NonEmpty = z.string().min(1);
const HttpUrlSchema = z.url({ protocol: /^https?$/ });

/** Every enriched claim names the passages that support it (passage ids). */
export type Supported<T> = { value: T; support: string[] };

const supported = <V extends z.ZodType>(value: V) =>
  z.strictObject({ value, support: z.array(NonEmpty).min(1) });

export const RelationSchema = z.enum(["amends", "implements", "replaces", "responds-to", "related"]);

export const PolicyRecordSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase slug"),
  jurisdiction: JurisdictionSchema,
  type: RecordTypeSchema,
  title: NonEmpty,
  shortTitle: NonEmpty.optional(),
  issuer: NonEmpty,
  status: supported(StatusSchema),
  statusDate: IsoDateSchema.optional(),
  timeline: z.array(z.strictObject({ date: IsoDateSchema, event: NonEmpty, support: z.array(NonEmpty).min(1) })),
  summary: supported(NonEmpty),
  provisions: z.array(supported(NonEmpty)),
  affected: z.array(supported(NonEmpty)),
  topics: z.array(TopicSchema).min(1),
  related: z.array(z.strictObject({ id: NonEmpty, relation: RelationSchema })),
  // provenance
  url: HttpUrlSchema,
  publisher: NonEmpty,
  published: IsoDateSchema.optional(),
  fetched: IsoTimestampSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be a full 64-character hex sha256"),
  attribution: NonEmpty,
  redistributionOk: z.boolean(),
  landmark: z.boolean(),
  review: z.strictObject({
    state: z.enum(["auto-checked", "human-reviewed"]),
    reviewedAt: IsoDateSchema.optional(),
    reviewer: NonEmpty.optional(),
  }),
});
export type PolicyRecord = z.infer<typeof PolicyRecordSchema>;

export const PassageSchema = z
  .strictObject({
    id: NonEmpty,
    recordId: NonEmpty,
    seq: z.number().int().min(1),
    heading: NonEmpty.optional(),
    text: NonEmpty,
  })
  .refine((p) => p.id === `${p.recordId}#${p.seq}`, {
    path: ["id"],
    message: "must equal `${recordId}#${seq}`",
  });
export type Passage = z.infer<typeof PassageSchema>;

const countsBy = <K extends z.ZodEnum>(keys: K) => z.record(keys, z.number().int().min(0));

export const ManifestSchema = z.strictObject({
  snapshotDate: IsoDateSchema, // the "as of" date shown to users
  builtAt: IsoTimestampSchema,
  models: z.strictObject({ enrich: NonEmpty, verify: NonEmpty }),
  counts: z.strictObject({
    total: z.number().int().min(0),
    byJurisdiction: countsBy(JurisdictionSchema),
    byType: countsBy(RecordTypeSchema),
  }),
  excluded: z.array(
    z.strictObject({
      id: NonEmpty,
      jurisdiction: JurisdictionSchema,
      url: HttpUrlSchema,
      title: NonEmpty,
      reason: NonEmpty,
    }),
  ),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** `since` compares against a record's lastActivity. */
export interface Filters {
  jurisdiction?: Jurisdiction;
  types?: RecordType[];
  topics?: Topic[];
  since?: string;
}

export interface RecordSummary {
  id: string;
  jurisdiction: Jurisdiction;
  type: RecordType;
  title: string;
  shortTitle?: string;
  status: Status;
  statusDate?: string;
  published?: string;
  lastActivity: string;
  summary: string;
  url: string;
  publisher: string;
  landmark: boolean;
  reviewState: "auto-checked" | "human-reviewed";
}

export type PassageHit = { passage: Passage; record: RecordSummary; score: number };

/**
 * The newest of `published`, `statusDate` and the timeline dates, as an ISO date.
 * Returns "" for a record with none of them, so it sorts oldest and never matches a `since` filter.
 */
export function lastActivity(r: PolicyRecord): string {
  let newest = "";
  for (const date of [r.published, r.statusDate, ...r.timeline.map((e) => e.date)]) {
    if (date && date > newest) newest = date;
  }
  return newest;
}
