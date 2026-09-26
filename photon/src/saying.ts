import type { Category, SourceItem, SourceName, TaggedItem } from "./contracts.ts";
import { categorise } from "./categoriser.ts";
import { loadBriefings } from "./briefings.ts";
import { fetchOpenAlex } from "./sources/openalex.ts";
import type { Env } from "./ask.ts";

export const GROUP_URL =
  "https://www.facebook.com/groups/saynotodatacenters/";

export const BLUESKY_URL = "https://bsky.app/profile/datacenter.bsky.social";

export type CommentSentiment = "for" | "against" | "unsure";

export interface SayingComment {
  text: string;
  sentiment: CommentSentiment;
}

export interface SayingItem {
  title: string;
  plain: string;
  url?: string;
  happenedAt?: string;
  source: string;
  category: Category;
  tags: Array<{ text: string; significance: number }>;
}

export interface SayingPayload {
  groupUrl: string;
  blueskyUrl: string;
  scannedAt: string;
  items: SayingItem[];
  comments: SayingComment[];
}

function isDataCenterOrLocal(item: TaggedItem): boolean {
  if (item.category === "local-worry") return true;
  if (item.tags.some((tag) => /data[\s-]?center/i.test(tag) || tag === "data-center")) {
    return true;
  }
  return /data\s*center/i.test(`${item.title} ${item.plain}`);
}

function topSignificance(item: SayingItem): number {
  return item.tags[0]?.significance ?? 0;
}

export async function buildSaying(env: Env): Promise<SayingPayload> {
  const briefings = loadBriefings().filter(isDataCenterOrLocal);
  let papers: SourceItem[] = [];
  try {
    papers = await fetchOpenAlex("data center");
  } catch {
    papers = [];
  }

  const rows: SourceItem[] = [...briefings, ...papers];
  const items: SayingItem[] = [];

  for (const row of rows) {
    let category: Category = "other";
    let tags: SayingItem["tags"] = [{ text: "other", significance: 0.2 }];
    try {
      const judged = await categorise(
        `${row.title}. ${row.plain}`,
        env.TYPESAFE_API_KEY,
        row.source,
      );
      category = judged.category;
      tags = [...judged.tags].sort((a, b) => b.significance - a.significance);
    } catch {
      /* keep fallbacks */
    }

    const out: SayingItem = {
      title: row.title,
      plain: row.plain,
      source: row.source,
      category,
      tags,
    };
    if (row.url) out.url = row.url;
    if (row.happenedAt) out.happenedAt = row.happenedAt;
    items.push(out);
  }

  items.sort((a, b) => topSignificance(b) - topSignificance(a));

  return {
    groupUrl: GROUP_URL,
    blueskyUrl: BLUESKY_URL,
    scannedAt: new Date().toISOString(),
    items,
    comments: [],
  };
}

export function asKnowledge(items: SayingItem[]): TaggedItem[] {
  return items.map((item, i) => {
    const out: TaggedItem = {
      id: `saying-${i}`,
      source: item.source as SourceName,
      title: item.title,
      plain: item.plain,
      category: item.category,
      tags: item.tags.map((tag) => tag.text),
    };
    if (item.url) out.url = item.url;
    if (item.happenedAt) out.happenedAt = item.happenedAt;
    return out;
  });
}
